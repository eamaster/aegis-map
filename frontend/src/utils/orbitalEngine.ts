/**
 * Orbital Math Engine using Satellite.js
 * Calculates satellite pass predictions for disaster locations and caches per-step
 * look angles across threshold queries in a single propagation session.
 */

import * as satellite from 'satellite.js';
import {
	illuminationAt,
	resolveSatelliteCapabilities,
	type Illumination,
	type SensorCapabilities,
} from '../../../shared/contracts';

export interface SatellitePass {
	satelliteName: string;
	time: Date;
	elevation: number;
	azimuth: number;
	maxElevationDeg: number;
}

export interface EnrichedSatellitePass extends SatellitePass {
	noradId: number | null;
	peakTime: Date;
	riseEstimateTime: Date;
	setEstimateTime: Date;
	tleEpochIso: string | null;
	illumination: Illumination;
	capabilities: SensorCapabilities | null;
}

interface ParsedTleBlock {
	name: string;
	line1: string;
	line2: string;
	noradId: number | null;
	tleEpochIso: string | null;
}

function parseTleEpochIso(line1: string): string | null {
	const field = line1.substring(18, 32);
	if (!/^\d{5}\.\d{8}$/.test(field)) return null;
	const yy = Number(field.slice(0, 2));
	const dayOfYear = Number(field.slice(2));
	const year = yy < 57 ? 2000 + yy : 1900 + yy;
	const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
	if (dayOfYear < 1 || dayOfYear >= (isLeap ? 367 : 366)) return null;
	return new Date(Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000).toISOString();
}

/** Parse raw TLE data into satellite records */
function parseTLEs(tleData: string): ParsedTleBlock[] {
	const lines = tleData.trim().split('\n');
	const satellites: ParsedTleBlock[] = [];

	for (let i = 0; i < lines.length; i += 3) {
		if (i + 2 < lines.length) {
			const name = lines[i].trim();
			const line1 = lines[i + 1].trim();
			const line2 = lines[i + 2].trim();
			const rawCat = Number(line1.substring(2, 7).trim());
			satellites.push({
				name,
				line1,
				line2,
				noradId: Number.isInteger(rawCat) && rawCat > 0 ? rawCat : null,
				tleEpochIso: parseTleEpochIso(line1),
			});
		}
	}

	return satellites;
}

interface LookSample {
	el: number;
	az: number;
}

export interface PassSessionResolution {
	pass: EnrichedSatellitePass | null;
	threshold: number | null;
	allFleetPasses: EnrichedSatellitePass[];
	propagationCount: number;
}

export interface PassPredictionSession {
	readonly propagationCount: number;
	predictPassesAtThreshold(minElevation?: number): EnrichedSatellitePass[];
	resolveNextBestPass(thresholds?: readonly number[]): PassSessionResolution;
}

const STEP_MS = 5 * 60 * 1000;
const SKIP_MS = 90 * 60 * 1000;

/**
 * Create a memoized SGP4 propagation session for one observer location and TLE set.
 * Reuses computed look angles across 25°/15°/5° threshold checks and multi-satellite comparison.
 */
export function createPassPredictionSession(
	tleRawData: string,
	observerLat: number,
	observerLng: number,
	startTime: Date = new Date(),
	windowHours: number = 24,
): PassPredictionSession {
	const validCoords =
		Number.isFinite(observerLat) &&
		Number.isFinite(observerLng) &&
		Math.abs(observerLat) <= 90 &&
		Math.abs(observerLng) <= 180;

	const startMs = startTime.getTime();
	const endMs = startMs + windowHours * 60 * 60 * 1000;
	const steps = Math.ceil((endMs - startMs) / STEP_MS);

	let propagationCount = 0;

	interface PreparedSat {
		meta: ParsedTleBlock;
		capabilities: SensorCapabilities | null;
		resolvedNoradId: number | null;
		coarse: Array<LookSample | null>;
		evalAt: (ms: number) => LookSample | null;
	}

	const prepared: PreparedSat[] = [];

	if (validCoords) {
		const observerGd = {
			longitude: satellite.degreesToRadians(observerLng),
			latitude: satellite.degreesToRadians(observerLat),
			height: 0,
		};

		for (const sat of parseTLEs(tleRawData)) {
			try {
				const satrec = satellite.twoline2satrec(sat.line1, sat.line2);
				if (!satrec || typeof satrec === 'boolean') {
					console.warn(`⚠️ Failed to initialize satellite ${sat.name}`);
					continue;
				}
				const sampleCache = new Map<number, LookSample | null>();
				const evalAt = (ms: number): LookSample | null => {
					const cached = sampleCache.get(ms);
					if (cached !== undefined) return cached;
					propagationCount++;
					const t = new Date(ms);
					const pv = satellite.propagate(satrec, t);
					let value: LookSample | null = null;
					if (pv && pv.position && typeof pv.position !== 'boolean') {
						const gmst = satellite.gstime(t);
						const ecf = satellite.eciToEcf(pv.position, gmst);
						const look = satellite.ecfToLookAngles(observerGd, ecf);
						const el = satellite.radiansToDegrees(look.elevation);
						const az = satellite.radiansToDegrees(look.azimuth);
						if (Number.isFinite(el) && Number.isFinite(az)) {
							value = { el, az };
						}
					}
					sampleCache.set(ms, value);
					return value;
				};

				const coarse = new Array<LookSample | null>(steps);
				for (let idx = 0; idx < steps; idx++) {
					coarse[idx] = evalAt(startMs + idx * STEP_MS);
				}

				const resolved = resolveSatelliteCapabilities(sat.name);
				prepared.push({
					meta: sat,
					capabilities: resolved.capabilities,
					resolvedNoradId: sat.noradId ?? resolved.noradId,
					coarse,
					evalAt,
				});
			} catch (error) {
				console.error(`❌ Error processing satellite ${sat.name}:`, error);
			}
		}
	}

	const predictPassesAtThreshold = (minElevation: number = 25): EnrichedSatellitePass[] => {
		if (!validCoords || prepared.length === 0) return [];
		const passes: EnrichedSatellitePass[] = [];

		for (const sat of prepared) {
			let currentMs = startMs;
			let inPass = false;
			let skipUntilMs: number | null = null;

			while (currentMs < endMs) {
				if (skipUntilMs !== null && currentMs < skipUntilMs) {
					currentMs = skipUntilMs;
					skipUntilMs = null;
					continue;
				}

				const idx = Math.round((currentMs - startMs) / STEP_MS);
				const sample = idx >= 0 && idx < sat.coarse.length && startMs + idx * STEP_MS === currentMs
					? sat.coarse[idx]
					: sat.evalAt(currentMs);

				if (sample) {
					if (sample.el >= minElevation) {
						if (!inPass) {
							let maxEl = sample.el;
							let peakMs = currentMs;
							let riseMs = currentMs;
							let setMs = currentMs;
							let foundRise = false;

							const scanStart = currentMs - 4 * 60_000;
							const scanEnd = currentMs + 16 * 60_000;
							for (let scanMs = scanStart; scanMs <= scanEnd; scanMs += 60_000) {
								const fine = sat.evalAt(scanMs);
								if (fine) {
									if (fine.el > maxEl) {
										maxEl = fine.el;
										peakMs = scanMs;
									}
									if (fine.el >= minElevation) {
										if (!foundRise) {
											riseMs = scanMs;
											foundRise = true;
										}
										setMs = scanMs;
									}
								}
							}

							const passTime = new Date(currentMs);
							passes.push({
								satelliteName: sat.meta.name,
								noradId: sat.resolvedNoradId,
								time: passTime,
								peakTime: new Date(peakMs),
								riseEstimateTime: new Date(riseMs),
								setEstimateTime: new Date(setMs),
								elevation: sample.el,
								azimuth: sample.az,
								maxElevationDeg: Math.round(maxEl * 10) / 10,
								tleEpochIso: sat.meta.tleEpochIso,
								illumination: illuminationAt(observerLat, observerLng, passTime),
								capabilities: sat.capabilities,
							});
							inPass = true;
							skipUntilMs = currentMs + SKIP_MS;
						}
					} else {
						inPass = false;
					}
				}

				currentMs += STEP_MS;
			}
		}

		return passes.sort((a, b) => a.time.getTime() - b.time.getTime());
	};

	const resolveNextBestPass = (thresholds: readonly number[] = [25, 15, 5]): PassSessionResolution => {
		let chosenPass: EnrichedSatellitePass | null = null;
		let chosenThreshold: number | null = null;
		let chosenList: EnrichedSatellitePass[] = [];

		for (const thr of thresholds) {
			const list = predictPassesAtThreshold(thr);
			if (list.length > 0 && !chosenPass) {
				chosenPass = list[0];
				chosenThreshold = thr;
				chosenList = list;
				break;
			}
		}

		// For multi-satellite comparison, include all upcoming passes >= lowest threshold (5°)
		const lowestThr = thresholds[thresholds.length - 1] ?? 5;
		const allFleetPasses =
			chosenThreshold === lowestThr ? chosenList : predictPassesAtThreshold(lowestThr);

		return {
			pass: chosenPass,
			threshold: chosenThreshold,
			allFleetPasses,
			propagationCount,
		};
	};

	return {
		get propagationCount() {
			return propagationCount;
		},
		predictPassesAtThreshold,
		resolveNextBestPass,
	};
}

function toLegacyPass(p: EnrichedSatellitePass): SatellitePass {
	return {
		satelliteName: p.satelliteName,
		time: p.time,
		elevation: p.elevation,
		azimuth: p.azimuth,
		maxElevationDeg: p.maxElevationDeg,
	};
}

/**
 * Predict satellite passes over a given location
 * @param tleRawData - Raw TLE string from CelesTrak
 * @param observerLat - Observer latitude in degrees
 * @param observerLng - Observer longitude in degrees
 * @param minElevation - Minimum elevation angle in degrees (default 25)
 * @param startTime - Start of the 24 h search window (default: now)
 * @returns Array of upcoming passes sorted by time
 */
export function predictPasses(
	tleRawData: string,
	observerLat: number,
	observerLng: number,
	minElevation: number = 25,
	startTime: Date = new Date(),
): SatellitePass[] {
	return createPassPredictionSession(tleRawData, observerLat, observerLng, startTime)
		.predictPassesAtThreshold(minElevation)
		.map(toLegacyPass);
}

/**
 * Get the next pass for any satellite over a location
 */
export function getNextPass(
	tleRawData: string,
	observerLat: number,
	observerLng: number,
	startTime: Date = new Date(),
): SatellitePass | null {
	const passes = predictPasses(tleRawData, observerLat, observerLng, 25, startTime);
	return passes.length > 0 ? passes[0] : null;
}
