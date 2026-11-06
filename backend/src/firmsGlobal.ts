import {
	DEFAULT_OBSERVATION_WINDOW,
	FIRMS_GLOBAL_CACHE_PREFIX,
	FIRMS_GLOBAL_CACHE_TTL_SECONDS,
	FIRMS_GLOBAL_CELLS_PREFIX,
	FIRMS_GLOBAL_FETCH_TIMEOUT_MS,
	FIRMS_GLOBAL_LKG_CELLS_PREFIX,
	FIRMS_GLOBAL_LKG_META_PREFIX,
	FIRMS_GLOBAL_LKG_PREFIX,
	FIRMS_GLOBAL_LKG_TTL_SECONDS,
	FIRMS_GLOBAL_META_PREFIX,
	FIRMS_GLOBAL_STALE_AFTER_MS,
	FIRMS_GRID_SIZE_DEG,
	FIRMS_INTENSITY_THRESHOLDS,
	GLOBAL_FIRMS_PRODUCTS,
	GlobalFirmsProduct,
	isObservationWindow,
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
 * Ingests worldwide VIIRS data across operational sensors configured in config.
 *
 * Aggregates tens of thousands of raw sensor observations into deterministic 0.5°
 * spatial cells, strictly tracking accounting identities:
 *   rawRows === malformedRows + outOfWindowRows + duplicateRows + acceptedDetections
 *   sum(cell.detectionCount) === acceptedDetections
 *
 * Public GET /api/v2/disasters reads validated KV snapshots or triggers a single
 * background warm-up. Data is also pre-cached via Scheduled Cron triggers.
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

export type SensorStatus = 'ok' | 'no_data' | 'failed' | 'timeout' | 'malformed' | 'warming';
export type FirmsReportStatus = 'ok' | 'stale' | 'partial' | 'unavailable' | 'warming';

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

export interface FirmsGlobalMeta {
	version: 2;
	window: ObservationWindow;
	windowRange: WindowRange;
	generatedAt: string; // ISO UTC
	sensors: Record<GlobalFirmsProduct, SensorCoverageReport>;
	accounting: FirmsAccounting;
	totalDetections: number;
	cellCount: number;
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
	const durationMs = window === DEFAULT_OBSERVATION_WINDOW ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
	const startMs = now.getTime() - durationMs;
	return {
		startInclusive: new Date(startMs).toISOString(),
		endExclusive: now.toISOString(),
	};
}

/**
 * True when an ISO UTC timestamp lies in [startInclusive, endExclusive).
 * Compares parsed instants so "...:00Z" and "...:00.000Z" forms agree.
 */
export function isInWindowRange(iso: string, range: WindowRange): boolean {
	const t = Date.parse(iso);
	return Number.isFinite(t) && t >= Date.parse(range.startInclusive) && t < Date.parse(range.endExclusive);
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

	if (window === DEFAULT_OBSERVATION_WINDOW) {
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

export interface IngestCsvResult {
	ok: boolean;
	status: 'ok' | 'no_data' | 'malformed';
	rawRows: number;
	acceptedRows: number;
	error?: string;
}

export class WorldGridAggregator {
	private readonly cells = new Map<string, MutableCell>();
	private readonly seenObservations = new Set<bigint>();
	private readonly satelliteIds = new Map<string, number>();
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

	private getSatelliteId(satellite: string): number {
		let id = this.satelliteIds.get(satellite);
		if (id === undefined) {
			id = this.satelliteIds.size + 1;
			this.satelliteIds.set(satellite, id);
		}
		return id;
	}

	/**
	 * Pack (lat@1e-5°, lng@1e-5°, YYYY-MM-DD, HHMM, satellite) losslessly into a
	 * compact BigInt key to avoid allocating hundreds of thousands of heap strings.
	 */
	private packObservationKey(
		lat: number,
		lng: number,
		rawDate: string,
		hh: number,
		mm: number,
		satellite: string,
	): bigint {
		const latInt = BigInt(Math.round((lat + 90) * 100_000));
		const lngInt = BigInt(Math.round((lng + 180) * 100_000));
		const year = Number(rawDate.slice(0, 4));
		const month = Number(rawDate.slice(5, 7));
		const day = Number(rawDate.slice(8, 10));
		const dateInt = BigInt((year * 16 + month) * 32 + day);
		const timeInt = BigInt(hh * 60 + mm);
		const satInt = BigInt(this.getSatelliteId(satellite));

		return (((((((latInt << 26n) | lngInt) << 21n) | dateInt) << 11n) | timeInt) << 8n) | satInt;
	}

	ingestCsv(csvText: string): IngestCsvResult {
		const len = csvText.length;
		let pos = 0;

		const nextNonEmptyLine = (): string | null => {
			while (pos < len) {
				let end = csvText.indexOf('\n', pos);
				if (end === -1) end = len;
				let lineEnd = end;
				if (lineEnd > pos && csvText.charCodeAt(lineEnd - 1) === 13) lineEnd--;
				const line = csvText.slice(pos, lineEnd).trim();
				pos = end + 1;
				if (line.length > 0) return line;
			}
			return null;
		};

		const headerLine = nextNonEmptyLine();
		if (headerLine === null) {
			return { ok: false, status: 'no_data', rawRows: 0, acceptedRows: 0, error: 'Empty response' };
		}

		const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
		const missing = FIRMS_REQUIRED_HEADERS.filter((h) => !headers.includes(h));
		if (missing.length > 0) {
			return {
				ok: false,
				status: 'malformed',
				rawRows: 0,
				acceptedRows: 0,
				error: `Missing required columns: ${missing.join(',')}`,
			};
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

		let rawInFile = 0;
		let acceptedInFile = 0;

		let line: string | null;
		while ((line = nextNonEmptyLine()) !== null) {
			rawInFile++;
			this.accounting.rawRows++;
			const parts = line.split(',').map((p) => p.trim());
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
			if (!isInWindowRange(acqIso, this.windowRange)) {
				this.accounting.outOfWindowRows++;
				continue;
			}

			// Deduplicate identical satellite observations using compact BigInt key
			const dedupKey = this.packObservationKey(lat, lng, rawDate, hh, mm, satellite);
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

		if (rawInFile === 0) {
			return { ok: false, status: 'no_data', rawRows: 0, acceptedRows: 0, error: 'No data rows in response' };
		}

		return { ok: true, status: 'ok', rawRows: rawInFile, acceptedRows: acceptedInFile };
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
	const timeoutMs = options.timeoutMs ?? FIRMS_GLOBAL_FETCH_TIMEOUT_MS;

	const windowRange = calculateWindowRange(window, now);
	const plans = planWorldFirmsRequests(window, now);
	const aggregator = new WorldGridAggregator(windowRange);

	const sensors = {} as Record<GlobalFirmsProduct, SensorCoverageReport>;
	for (const product of GLOBAL_FIRMS_PRODUCTS) {
		sensors[product] = { status: 'ok', rawRows: 0, acceptedRows: 0 };
	}

	// Execute planned fetches sequentially to respect upstream bandwidth & avoid NASA multi-stream throttling
	for (const plan of plans) {
		const url = buildGlobalFirmsUrl(mapKey, plan.product, plan.dayRange, plan.startDate);
		try {
			const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
			if (!res.ok) {
				console.warn(`FIRMS World ${plan.description}: HTTP ${res.status}`);
				sensors[plan.product].status = 'failed';
				sensors[plan.product].httpStatus = res.status;
				sensors[plan.product].errorReason = `HTTP ${res.status}`;
				continue;
			}
			const text = await res.text();
			const result = aggregator.ingestCsv(text);
			sensors[plan.product].rawRows += result.rawRows;
			sensors[plan.product].acceptedRows += result.acceptedRows;
			if (!result.ok) {
				if (result.status === 'no_data') {
					console.warn(`FIRMS World ${plan.description}: no_data (${result.error})`);
					if (sensors[plan.product].status === 'ok') {
						sensors[plan.product].status = 'no_data';
						sensors[plan.product].errorReason = result.error;
					}
				} else {
					console.warn(`FIRMS World ${plan.description}: malformed (${result.error})`);
					if (sensors[plan.product].status === 'ok' || sensors[plan.product].status === 'no_data') {
						sensors[plan.product].status = 'malformed';
						sensors[plan.product].errorReason = result.error;
					}
				}
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
	}

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
		isObservationWindow(s.window) &&
		typeof s.generatedAt === 'string' &&
		typeof s.totalDetections === 'number' &&
		Array.isArray(s.cells) &&
		!!s.accounting &&
		typeof s.accounting.rawRows === 'number' &&
		typeof s.accounting.acceptedDetections === 'number' &&
		s.accounting.acceptedDetections === s.totalDetections
	);
}

export function isSnapshotUsable(snapshot: Pick<FirmsGlobalSnapshot, 'sensors'>): boolean {
	return Object.values(snapshot.sensors).some((s) => s.status === 'ok');
}

/**
 * Derive snapshot-level status:
 * - 'unavailable': no sensor has status === 'ok'
 * - 'stale': served from LKG backup OR generatedAt is older than 2× ingestion cadence (6h)
 * - 'ok': all configured sensors have status === 'ok'
 * - 'partial': at least one sensor is 'ok', but one or more sensors lagged ('no_data') or failed
 */
export function computeSnapshotStatus(
	meta: Pick<FirmsGlobalMeta, 'generatedAt' | 'sensors'>,
	options: { isLkg?: boolean; now?: Date; staleAfterMs?: number } = {},
): 'ok' | 'partial' | 'stale' | 'unavailable' {
	const sensorValues = Object.values(meta.sensors ?? {});
	if (sensorValues.length === 0 || !sensorValues.some((s) => s.status === 'ok')) {
		return 'unavailable';
	}
	if (options.isLkg) {
		return 'stale';
	}
	const generatedMs = Date.parse(meta.generatedAt);
	const nowMs = (options.now ?? new Date()).getTime();
	const staleAfterMs = options.staleAfterMs ?? FIRMS_GLOBAL_STALE_AFTER_MS;
	if (!Number.isFinite(generatedMs) || nowMs - generatedMs > staleAfterMs) {
		return 'stale';
	}
	if (sensorValues.every((s) => s.status === 'ok')) {
		return 'ok';
	}
	return 'partial';
}

export function extractFirmsMeta(snapshot: FirmsGlobalSnapshot): FirmsGlobalMeta {
	return {
		version: snapshot.version,
		window: snapshot.window,
		windowRange: snapshot.windowRange,
		generatedAt: snapshot.generatedAt,
		sensors: snapshot.sensors,
		accounting: snapshot.accounting,
		totalDetections: snapshot.totalDetections,
		cellCount: snapshot.cells.length,
	};
}

export function serializeGlobalFirmsSnapshotSplit(snapshot: FirmsGlobalSnapshot): {
	meta: FirmsGlobalMeta;
	metaJson: string;
	cellsJson: string;
} {
	const meta = extractFirmsMeta(snapshot);
	return {
		meta,
		metaJson: JSON.stringify(meta),
		cellsJson: JSON.stringify(snapshot.cells),
	};
}

export function isValidFirmsMeta(doc: unknown): doc is FirmsGlobalMeta {
	if (!doc || typeof doc !== 'object') return false;
	const m = doc as Partial<FirmsGlobalMeta>;
	return (
		m.version === 2 &&
		isObservationWindow(m.window) &&
		!!m.windowRange &&
		typeof m.windowRange.startInclusive === 'string' &&
		typeof m.windowRange.endExclusive === 'string' &&
		typeof m.generatedAt === 'string' &&
		Number.isFinite(Date.parse(m.generatedAt)) &&
		!!m.sensors &&
		typeof m.sensors === 'object' &&
		typeof m.totalDetections === 'number' &&
		typeof m.cellCount === 'number' &&
		Number.isInteger(m.cellCount) &&
		m.cellCount >= 0 &&
		!!m.accounting &&
		typeof m.accounting.rawRows === 'number' &&
		typeof m.accounting.acceptedDetections === 'number' &&
		m.accounting.acceptedDetections === m.totalDetections
	);
}

export function isValidRawCellsJson(raw: string | null | undefined, expectedCellCount?: number): raw is string {
	if (typeof raw !== 'string') return false;
	const trimmed = raw.trim();
	if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return false;
	if (expectedCellCount === 0) return trimmed === '[]';
	if (typeof expectedCellCount === 'number' && expectedCellCount > 0) return trimmed.length > 2;
	return true;
}

/**
 * Build fallback FIRMS coverage report across all configured sensors.
 * Iterates GLOBAL_FIRMS_PRODUCTS so adding a sensor in config requires no route edits.
 */
export function buildFallbackFirmsReport(status: 'unavailable' | 'warming' = 'unavailable'): {
	status: 'unavailable' | 'warming';
	generatedAt: string;
	isLkgFallback: false;
	sensors: Record<GlobalFirmsProduct, SensorCoverageReport>;
	accounting: FirmsAccounting;
} {
	const sensors = {} as Record<GlobalFirmsProduct, SensorCoverageReport>;
	for (const product of GLOBAL_FIRMS_PRODUCTS) {
		sensors[product] = {
			status: status === 'warming' ? 'warming' : 'failed',
			rawRows: 0,
			acceptedRows: 0,
		};
	}
	return {
		status,
		generatedAt: new Date().toISOString(),
		isLkgFallback: false,
		sensors,
		accounting: { rawRows: 0, malformedRows: 0, outOfWindowRows: 0, duplicateRows: 0, acceptedDetections: 0 },
	};
}

/**
 * Persist split global snapshot to KV storage: writes separate small `meta` and raw `cells`
 * keys (plus LKG backups) so Worker GET handlers never parse the multi-MB cells array.
 */
export async function saveGlobalFirmsSnapshotSplit(kv: KVNamespace, snapshot: FirmsGlobalSnapshot): Promise<void> {
	const { metaJson, cellsJson } = serializeGlobalFirmsSnapshotSplit(snapshot);
	const metaKey = cacheKeyForWindow(snapshot.window, FIRMS_GLOBAL_META_PREFIX);
	const cellsKey = cacheKeyForWindow(snapshot.window, FIRMS_GLOBAL_CELLS_PREFIX);
	const lkgMetaKey = cacheKeyForWindow(snapshot.window, FIRMS_GLOBAL_LKG_META_PREFIX);
	const lkgCellsKey = cacheKeyForWindow(snapshot.window, FIRMS_GLOBAL_LKG_CELLS_PREFIX);

	await Promise.all([
		kv.put(metaKey, metaJson, { expirationTtl: FIRMS_GLOBAL_CACHE_TTL_SECONDS }),
		kv.put(cellsKey, cellsJson, { expirationTtl: FIRMS_GLOBAL_CACHE_TTL_SECONDS }),
		kv.put(lkgMetaKey, metaJson, { expirationTtl: FIRMS_GLOBAL_LKG_TTL_SECONDS }),
		kv.put(lkgCellsKey, cellsJson, { expirationTtl: FIRMS_GLOBAL_LKG_TTL_SECONDS }),
	]);
}

export interface ReadSplitSnapshotResult {
	meta: FirmsGlobalMeta;
	cellsJson: string;
	isLkg: boolean;
	status: 'ok' | 'partial' | 'stale';
}

/**
 * Retrieve split global FIRMS metadata (parsed) and raw cells JSON string (unparsed) from KV.
 * Falls back to LKG split keys if active keys are missing or corrupted.
 */
export async function loadGlobalFirmsMeta(
	kv: KVNamespace | undefined,
	window: ObservationWindow,
	options: { now?: Date } = {},
): Promise<ReadSplitSnapshotResult | null> {
	if (!kv) return null;

	const metaKey = cacheKeyForWindow(window, FIRMS_GLOBAL_META_PREFIX);
	const cellsKey = cacheKeyForWindow(window, FIRMS_GLOBAL_CELLS_PREFIX);
	try {
		const [rawMeta, rawCells] = await Promise.all([kv.get(metaKey), kv.get(cellsKey)]);
		if (rawMeta && rawCells) {
			const parsedMeta: unknown = JSON.parse(rawMeta);
			if (
				isValidFirmsMeta(parsedMeta) &&
				parsedMeta.window === window &&
				isSnapshotUsable(parsedMeta) &&
				isValidRawCellsJson(rawCells, parsedMeta.cellCount)
			) {
				const status = computeSnapshotStatus(parsedMeta, { isLkg: false, now: options.now });
				if (status !== 'unavailable') {
					return { meta: parsedMeta, cellsJson: rawCells.trim(), isLkg: false, status };
				}
			}
		}
	} catch (err) {
		console.warn(`Split snapshot read error for ${metaKey}:`, err instanceof Error ? err.name : 'Error');
	}

	// Fallback to Last-Known-Good (LKG) split keys
	const lkgMetaKey = cacheKeyForWindow(window, FIRMS_GLOBAL_LKG_META_PREFIX);
	const lkgCellsKey = cacheKeyForWindow(window, FIRMS_GLOBAL_LKG_CELLS_PREFIX);
	try {
		const [rawLkgMeta, rawLkgCells] = await Promise.all([kv.get(lkgMetaKey), kv.get(lkgCellsKey)]);
		if (rawLkgMeta && rawLkgCells) {
			const parsedLkgMeta: unknown = JSON.parse(rawLkgMeta);
			if (
				isValidFirmsMeta(parsedLkgMeta) &&
				parsedLkgMeta.window === window &&
				isSnapshotUsable(parsedLkgMeta) &&
				isValidRawCellsJson(rawLkgCells, parsedLkgMeta.cellCount)
			) {
				return { meta: parsedLkgMeta, cellsJson: rawLkgCells.trim(), isLkg: true, status: 'stale' };
			}
		}
	} catch (err) {
		console.warn(`Split LKG read error for ${lkgMetaKey}:`, err instanceof Error ? err.name : 'Error');
	}

	return null;
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
		saveGlobalFirmsSnapshotSplit(kv, snapshot),
	]);
}

export interface ReadSnapshotResult {
	snapshot: FirmsGlobalSnapshot;
	isLkg: boolean;
	status: 'ok' | 'partial' | 'stale';
}

/**
 * Retrieve global snapshot from KV: reads active snapshot, falling back to LKG if missing or corrupted.
 */
export async function loadGlobalFirmsSnapshot(
	kv: KVNamespace | undefined,
	window: ObservationWindow,
	options: { now?: Date } = {},
): Promise<ReadSnapshotResult | null> {
	if (!kv) return null;

	const snapshotKey = cacheKeyForWindow(window, FIRMS_GLOBAL_CACHE_PREFIX);
	try {
		const raw = await kv.get(snapshotKey);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (isValidSnapshot(parsed) && isSnapshotUsable(parsed)) {
				const status = computeSnapshotStatus(
					{ generatedAt: parsed.generatedAt, sensors: parsed.sensors },
					{ isLkg: false, now: options.now },
				);
				if (status !== 'unavailable') {
					return { snapshot: parsed, isLkg: false, status };
				}
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
			if (isValidSnapshot(parsedLkg) && isSnapshotUsable(parsedLkg)) {
				return { snapshot: parsedLkg, isLkg: true, status: 'stale' };
			}
		}
	} catch (err) {
		console.warn(`LKG read error for ${lkgKey}:`, err instanceof Error ? err.name : 'Error');
	}

	return null;
}
