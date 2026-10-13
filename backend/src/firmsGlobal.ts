import {
	FIRMS_GLOBAL_CACHE_PREFIX,
	FIRMS_GLOBAL_CACHE_TTL_SECONDS,
	FIRMS_GLOBAL_LKG_PREFIX,
	FIRMS_GLOBAL_LKG_TTL_SECONDS,
	FIRMS_GRID_SIZE_DEG,
	FIRMS_INTENSITY_THRESHOLDS,
	GLOBAL_FIRMS_PRODUCTS,
	GlobalFirmsProduct,
	ObservationWindow,
} from './config';
import {
	FIRMS_REQUIRED_HEADERS,
	parseStrictNumber,
	redactSecret,
	utcDateString,
	validateCoordinates,
} from './firms';

/**
 * NASA FIRMS Worldwide Satellite Thermal Detection Adapter & Grid Aggregator
 *
 * Ingests worldwide VIIRS data across 3 operational sensors:
 * - VIIRS_SNPP_NRT (Suomi NPP, 375 m)
 * - VIIRS_NOAA20_NRT (NOAA-20 / JPSS-1, 375 m)
 * - VIIRS_NOAA21_NRT (NOAA-21 / JPSS-2, 375 m)
 *
 * Aggregates tens of thousands of raw sensor observations into deterministic 0.5°
 * spatial cells, strictly tracking accounting identities:
 *   rawRows === malformedRows + outOfWindowRows + duplicateRows + acceptedDetections
 *   sum(cell.detectionCount) === acceptedDetections
 *
 * Public GET /api/v2/disasters never touches NASA FIRMS upstream. Data is pre-cached
 * in Cloudflare KV via Scheduled Cron triggers.
 */

export type DetectionIntensity = 'low' | 'medium' | 'high';

export interface FireDetectionCell {
	cellId: string;
	lat: number;
	lng: number;
	bounds: [number, number, number, number]; // [west, south, east, north]
	detectionCount: number;
	maxFrp: number | null;
	avgFrp: number | null;
	maxBrightTi4: number | null;
	latestAcqTime: string; // ISO UTC string
	confidenceCounts: {
		high: number;
		nominal: number;
		low: number;
		unknown: number;
	};
	dayNightCounts: {
		day: number;
		night: number;
		unknown: number;
	};
	satelliteCounts: Record<string, number>;
	intensity: DetectionIntensity;
}

export interface FirmsAccounting {
	rawRows: number;
	malformedRows: number;
	outOfWindowRows: number;
	duplicateRows: number;
	acceptedDetections: number;
}

export interface WindowRange {
	startInclusive: string; // ISO UTC
	endExclusive: string;   // ISO UTC
}

export type SensorStatus = 'ok' | 'failed' | 'timeout' | 'malformed';

export interface SensorCoverageReport {
	status: SensorStatus;
	httpStatus?: number;
	rawRows: number;
	acceptedRows: number;
	errorReason?: string;
}

export interface FirmsGlobalSnapshot {
	version: 2;
	window: ObservationWindow;
	windowRange: WindowRange;
	generatedAt: string; // ISO UTC
	sensors: Record<GlobalFirmsProduct, SensorCoverageReport>;
	accounting: FirmsAccounting;
	totalDetections: number;
	cells: FireDetectionCell[];
}

export interface CellBounds {
	cellId: string;
	centerLat: number;
	centerLng: number;
	bounds: [number, number, number, number];
}

/**
 * Deterministically partition global coordinates into 0.5° grid cells.
 * Antimeridian (-180 / 180) and poles (-90 / 90) are safely clamped and wrapped.
 */
export function computeCellBounds(lat: number, lng: number, gridSize = FIRMS_GRID_SIZE_DEG): CellBounds {
	const clampedLat = Math.max(-90, Math.min(89.999999, lat));
	let normalizedLng = lng;
	while (normalizedLng < -180) normalizedLng += 360;
	while (normalizedLng >= 180) normalizedLng -= 360;

	const latIndex = Math.floor(clampedLat / gridSize);
	const lngIndex = Math.floor(normalizedLng / gridSize);

	const south = Math.round(latIndex * gridSize * 10000) / 10000;
	const north = Math.min(90, Math.round((latIndex + 1) * gridSize * 10000) / 10000);
	const west = Math.round(lngIndex * gridSize * 10000) / 10000;
	const east = Math.round((lngIndex + 1) * gridSize * 10000) / 10000;

	const centerLat = Math.round(((south + north) / 2) * 10000) / 10000;
	const centerLng = Math.round(((west + east) / 2) * 10000) / 10000;
	const cellId = `cell:${centerLat.toFixed(2)}:${centerLng.toFixed(2)}`;

	return { cellId, centerLat, centerLng, bounds: [west, south, east, north] };
}

/** Compute rolling UTC [startInclusive, endExclusive) interval. */
export function calculateWindowRange(window: ObservationWindow, now = new Date()): WindowRange {
	const durationMs = window === '24h' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
	const startMs = now.getTime() - durationMs;
	return {
		startInclusive: new Date(startMs).toISOString(),
		endExclusive: now.toISOString(),
	};
}

function addUtcDays(date: Date, days: number): Date {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	d.setUTCDate(d.getUTCDate() + days);
	return d;
}

export interface FirmsWorldPlan {
	product: GlobalFirmsProduct;
	dayRange: number;
	startDate: string;
	description: string;
}

const FIRMS_AREA_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

/**
 * Generate plan for fetching worldwide FIRMS data.
 * For 24h: 1 request per sensor with dayRange=2 (yesterday + today).
 * For 7d: 2 requests per sensor with dayRange=4 (today-3..today) and dayRange=3 (today-6..today-4).
 */
export function planWorldFirmsRequests(window: ObservationWindow, now = new Date()): FirmsWorldPlan[] {
	const plans: FirmsWorldPlan[] = [];

	if (window === '24h') {
		const startDate = utcDateString(addUtcDays(now, -1));
		for (const product of GLOBAL_FIRMS_PRODUCTS) {
			plans.push({
				product,
				dayRange: 2,
				startDate,
				description: `${product} 2-day world window starting ${startDate}`,
			});
		}
	} else {
		const recentStart = utcDateString(addUtcDays(now, -3));
		const priorStart = utcDateString(addUtcDays(now, -6));
		for (const product of GLOBAL_FIRMS_PRODUCTS) {
			plans.push({
				product,
				dayRange: 4,
				startDate: recentStart,
				description: `${product} recent 4-day window starting ${recentStart}`,
			});
			plans.push({
				product,
				dayRange: 3,
				startDate: priorStart,
				description: `${product} prior 3-day window starting ${priorStart}`,
			});
		}
	}

	return plans;
}

export function buildGlobalFirmsUrl(mapKey: string, product: GlobalFirmsProduct, dayRange: number, startDate: string): string {
	return `${FIRMS_AREA_BASE}/${encodeURIComponent(mapKey)}/${product}/world/${dayRange}/${startDate}`;
}

export function computeIntensity(detectionCount: number, maxFrp: number | null): DetectionIntensity {
	if (detectionCount >= FIRMS_INTENSITY_THRESHOLDS.high.minDetections || (maxFrp !== null && maxFrp >= FIRMS_INTENSITY_THRESHOLDS.high.minFrp)) {
		return 'high';
	}
	if (detectionCount >= FIRMS_INTENSITY_THRESHOLDS.medium.minDetections || (maxFrp !== null && maxFrp >= FIRMS_INTENSITY_THRESHOLDS.medium.minFrp)) {
		return 'medium';
	}
	return 'low';
}

interface MutableCell {
	cellId: string;
	lat: number;
	lng: number;
	bounds: [number, number, number, number];
	detectionCount: number;
	maxFrp: number | null;
	sumFrp: number;
	frpCount: number;
	maxBrightTi4: number | null;
	latestAcqTime: string;
	confidenceCounts: { high: number; nominal: number; low: number; unknown: number };
	dayNightCounts: { day: number; night: number; unknown: number };
	satelliteCounts: Record<string, number>;
}

export class WorldGridAggregator {
	private readonly cells = new Map<string, MutableCell>();
	private readonly seenObservations = new Set<string>();
	readonly accounting: FirmsAccounting = {
		rawRows: 0,
		malformedRows: 0,
		outOfWindowRows: 0,
		duplicateRows: 0,
		acceptedDetections: 0,
	};
	readonly windowRange: WindowRange;

	constructor(windowRange: WindowRange) {
		this.windowRange = windowRange;
	}

	ingestCsv(csvText: string): { ok: boolean; acceptedRows: number; error?: string } {
		const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
		if (lines.length === 0) {
			return { ok: false, acceptedRows: 0, error: 'Empty response' };
		}

		const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
		const missing = FIRMS_REQUIRED_HEADERS.filter((h) => !headers.includes(h));
		if (missing.length > 0) {
			return { ok: false, acceptedRows: 0, error: `Missing required columns: ${missing.join(',')}` };
		}

		const col = (name: string) => headers.indexOf(name);
		const idxLat = col('latitude');
		const idxLng = col('longitude');
		const idxB4 = col('bright_ti4');
		const idxDate = col('acq_date');
		const idxTime = col('acq_time');
		const idxSat = col('satellite');
		const idxConf = col('confidence');
		const idxFrp = col('frp');
		const idxDn = col('daynight');

		let acceptedInFile = 0;

		for (let i = 1; i < lines.length; i++) {
			this.accounting.rawRows++;
			const parts = lines[i].split(',').map((p) => p.trim());
			if (parts.length !== headers.length) {
				this.accounting.malformedRows++;
				continue;
			}

			const lat = parseStrictNumber(parts[idxLat]);
			const lng = parseStrictNumber(parts[idxLng]);
			const rawDate = parts[idxDate];
			const rawTime = parts[idxTime];
			const satellite = parts[idxSat];
			const rawConf = parts[idxConf]?.toLowerCase();
			const rawDn = parts[idxDn]?.toUpperCase();
			const b4 = parseStrictNumber(parts[idxB4]);
			const frp = parseStrictNumber(parts[idxFrp]);

			// Validate coordinates & basic formats
			if (
				lat === null ||
				lng === null ||
				!validateCoordinates(lat, lng).valid ||
				!/^\d{4}-\d{2}-\d{2}$/.test(rawDate) ||
				!/^\d{1,4}$/.test(rawTime) ||
				!satellite
			) {
				this.accounting.malformedRows++;
				continue;
			}

			const paddedTime = rawTime.padStart(4, '0');
			const hh = Number(paddedTime.slice(0, 2));
			const mm = Number(paddedTime.slice(2));
			if (hh > 23 || mm > 59) {
				this.accounting.malformedRows++;
				continue;
			}

			// Validate acquisition timestamp against rolling [startInclusive, endExclusive) window
			const acqIso = `${rawDate}T${paddedTime.slice(0, 2)}:${paddedTime.slice(2)}:00.000Z`;
			if (acqIso < this.windowRange.startInclusive || acqIso >= this.windowRange.endExclusive) {
				this.accounting.outOfWindowRows++;
				continue;
			}

			// Deduplicate identical satellite observations
			const dedupKey = `${lat.toFixed(5)}|${lng.toFixed(5)}|${rawDate}|${paddedTime}|${satellite}`;
			if (this.seenObservations.has(dedupKey)) {
				this.accounting.duplicateRows++;
				continue;
			}
			this.seenObservations.add(dedupKey);

			// Valid accepted detection
			this.accounting.acceptedDetections++;
			acceptedInFile++;

			// Aggregate into spatial grid cell
			const { cellId, centerLat, centerLng, bounds } = computeCellBounds(lat, lng);
			let cell = this.cells.get(cellId);
			if (!cell) {
				cell = {
					cellId,
					lat: centerLat,
					lng: centerLng,
					bounds,
					detectionCount: 0,
					maxFrp: null,
					sumFrp: 0,
					frpCount: 0,
					maxBrightTi4: null,
					latestAcqTime: acqIso,
					confidenceCounts: { high: 0, nominal: 0, low: 0, unknown: 0 },
					dayNightCounts: { day: 0, night: 0, unknown: 0 },
					satelliteCounts: {},
				};
				this.cells.set(cellId, cell);
			}

			cell.detectionCount++;
			if (frp !== null && frp >= 0) {
				cell.sumFrp += frp;
				cell.frpCount++;
				if (cell.maxFrp === null || frp > cell.maxFrp) {
					cell.maxFrp = frp;
				}
			}
			if (b4 !== null && b4 > 0) {
				if (cell.maxBrightTi4 === null || b4 > cell.maxBrightTi4) {
					cell.maxBrightTi4 = b4;
				}
			}
			if (acqIso > cell.latestAcqTime) {
				cell.latestAcqTime = acqIso;
			}

			if (rawConf === 'h' || rawConf === 'high') cell.confidenceCounts.high++;
			else if (rawConf === 'n' || rawConf === 'nominal') cell.confidenceCounts.nominal++;
			else if (rawConf === 'l' || rawConf === 'low') cell.confidenceCounts.low++;
			else cell.confidenceCounts.unknown++;

			if (rawDn === 'D') cell.dayNightCounts.day++;
			else if (rawDn === 'N') cell.dayNightCounts.night++;
			else cell.dayNightCounts.unknown++;

			cell.satelliteCounts[satellite] = (cell.satelliteCounts[satellite] || 0) + 1;
		}

		return { ok: true, acceptedRows: acceptedInFile };
	}

	buildCells(): FireDetectionCell[] {
		const out: FireDetectionCell[] = [];
		for (const c of this.cells.values()) {
			const avgFrp = c.frpCount > 0 ? Math.round((c.sumFrp / c.frpCount) * 10) / 10 : null;
			out.push({
				cellId: c.cellId,
				lat: c.lat,
				lng: c.lng,
				bounds: c.bounds,
				detectionCount: c.detectionCount,
				maxFrp: c.maxFrp,
				avgFrp,
				maxBrightTi4: c.maxBrightTi4,
				latestAcqTime: c.latestAcqTime,
				confidenceCounts: { ...c.confidenceCounts },
				dayNightCounts: { ...c.dayNightCounts },
				satelliteCounts: { ...c.satelliteCounts },
				intensity: computeIntensity(c.detectionCount, c.maxFrp),
			});
		}

		// Sort deterministically: highest detection count first, then cellId
		out.sort((a, b) => b.detectionCount - a.detectionCount || a.cellId.localeCompare(b.cellId));
		return out;
	}

	assertAccountingIdentity(): boolean {
		const sumAccounted =
			this.accounting.malformedRows +
			this.accounting.outOfWindowRows +
			this.accounting.duplicateRows +
			this.accounting.acceptedDetections;
		const sumCells = Array.from(this.cells.values()).reduce((acc, c) => acc + c.detectionCount, 0);

		return this.accounting.rawRows === sumAccounted && sumCells === this.accounting.acceptedDetections;
	}
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface IngestOptions {
	now?: Date;
	fetchImpl?: FetchLike;
	timeoutMs?: number;
}

/**
 * Fetch and aggregate worldwide FIRMS VIIRS detections for the specified window.
 */
export async function ingestGlobalFirms(
	mapKey: string,
	window: ObservationWindow,
	options: IngestOptions = {},
): Promise<FirmsGlobalSnapshot> {
	const now = options.now ?? new Date();
	const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
	const timeoutMs = options.timeoutMs ?? 25000;

	const windowRange = calculateWindowRange(window, now);
	const plans = planWorldFirmsRequests(window, now);
	const aggregator = new WorldGridAggregator(windowRange);

	const sensors: Record<GlobalFirmsProduct, SensorCoverageReport> = {
		VIIRS_SNPP_NRT: { status: 'ok', rawRows: 0, acceptedRows: 0 },
		VIIRS_NOAA20_NRT: { status: 'ok', rawRows: 0, acceptedRows: 0 },
		VIIRS_NOAA21_NRT: { status: 'ok', rawRows: 0, acceptedRows: 0 },
	};

	// Execute planned fetches in parallel
	await Promise.all(
		plans.map(async (plan) => {
			const url = buildGlobalFirmsUrl(mapKey, plan.product, plan.dayRange, plan.startDate);
			try {
				const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
				if (!res.ok) {
					console.warn(`FIRMS World ${plan.description}: HTTP ${res.status}`);
					sensors[plan.product].status = 'failed';
					sensors[plan.product].httpStatus = res.status;
					sensors[plan.product].errorReason = `HTTP ${res.status}`;
					return;
				}
				const text = await res.text();
				const result = aggregator.ingestCsv(text);
				if (!result.ok) {
					console.warn(`FIRMS World ${plan.description}: malformed (${result.error})`);
					if (sensors[plan.product].status === 'ok') {
						sensors[plan.product].status = 'malformed';
						sensors[plan.product].errorReason = result.error;
					}
				} else {
					sensors[plan.product].acceptedRows += result.acceptedRows;
				}
			} catch (err) {
				const isTimeout =
					err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
				const status: SensorStatus = isTimeout ? 'timeout' : 'failed';
				const message = err instanceof Error ? redactSecret(err.message, mapKey) : 'unknown';
				console.warn(`FIRMS World ${plan.description}: ${status} (${message})`);
				sensors[plan.product].status = status;
				sensors[plan.product].errorReason = message;
			}
		}),
	);

	if (!aggregator.assertAccountingIdentity()) {
		console.error('Accounting invariant violation in WorldGridAggregator!', aggregator.accounting);
	}

	const cells = aggregator.buildCells();
	return {
		version: 2,
		window,
		windowRange,
		generatedAt: now.toISOString(),
		sensors,
		accounting: aggregator.accounting,
		totalDetections: aggregator.accounting.acceptedDetections,
		cells,
	};
}

export function cacheKeyForWindow(window: ObservationWindow, prefix = FIRMS_GLOBAL_CACHE_PREFIX): string {
	return `${prefix}:${window}`;
}

export function isValidSnapshot(doc: unknown): doc is FirmsGlobalSnapshot {
	if (!doc || typeof doc !== 'object') return false;
	const s = doc as Partial<FirmsGlobalSnapshot>;
	return (
		s.version === 2 &&
		(s.window === '24h' || s.window === '7d') &&
		typeof s.generatedAt === 'string' &&
		typeof s.totalDetections === 'number' &&
		Array.isArray(s.cells) &&
		!!s.accounting &&
		typeof s.accounting.rawRows === 'number' &&
		typeof s.accounting.acceptedDetections === 'number' &&
		s.accounting.acceptedDetections === s.totalDetections
	);
}

/**
 * Persist global snapshot to KV storage: writes both the rolling snapshot and the LKG backup.
 */
export async function saveGlobalFirmsSnapshot(kv: KVNamespace, snapshot: FirmsGlobalSnapshot): Promise<void> {
	const json = JSON.stringify(snapshot);
	const snapshotKey = cacheKeyForWindow(snapshot.window, FIRMS_GLOBAL_CACHE_PREFIX);
	const lkgKey = cacheKeyForWindow(snapshot.window, FIRMS_GLOBAL_LKG_PREFIX);

	await Promise.all([
		kv.put(snapshotKey, json, { expirationTtl: FIRMS_GLOBAL_CACHE_TTL_SECONDS }),
		kv.put(lkgKey, json, { expirationTtl: FIRMS_GLOBAL_LKG_TTL_SECONDS }),
	]);
}

export interface ReadSnapshotResult {
	snapshot: FirmsGlobalSnapshot;
	isLkg: boolean;
	status: 'ok' | 'stale';
}

/**
 * Retrieve global snapshot from KV: reads active snapshot, falling back to LKG if missing or corrupted.
 */
export async function loadGlobalFirmsSnapshot(
	kv: KVNamespace | undefined,
	window: ObservationWindow,
): Promise<ReadSnapshotResult | null> {
	if (!kv) return null;

	const snapshotKey = cacheKeyForWindow(window, FIRMS_GLOBAL_CACHE_PREFIX);
	try {
		const raw = await kv.get(snapshotKey);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (isValidSnapshot(parsed)) {
				return { snapshot: parsed, isLkg: false, status: 'ok' };
			}
		}
	} catch (err) {
		console.warn(`Snapshot read error for ${snapshotKey}:`, err instanceof Error ? err.name : 'Error');
	}

	// Fallback to Last-Known-Good (LKG)
	const lkgKey = cacheKeyForWindow(window, FIRMS_GLOBAL_LKG_PREFIX);
	try {
		const rawLkg = await kv.get(lkgKey);
		if (rawLkg) {
			const parsedLkg = JSON.parse(rawLkg);
			if (isValidSnapshot(parsedLkg)) {
				return { snapshot: parsedLkg, isLkg: true, status: 'stale' };
			}
		}
	} catch (err) {
		console.warn(`LKG read error for ${lkgKey}:`, err instanceof Error ? err.name : 'Error');
	}

	return null;
}
