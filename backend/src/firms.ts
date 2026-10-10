/**
 * NASA FIRMS (Fire Information for Resource Management System) Adapter
 *
 * Area API: /api/area/csv/[MAP_KEY]/[SOURCE]/[AREA_COORDINATES]/[DAY_RANGE]/[DATE]
 * Returns data for [DATE] .. [DATE + DAY_RANGE - 1]; DAY_RANGE must be 1..5;
 * AREA_COORDINATES must lie within -180,-90,180,90.
 *
 * The 7-day lookback (UTC dates today-6 .. today) is fetched as two supported
 * windows with explicit start dates:
 *   recent: DAY_RANGE=5, DATE=today-4  -> today-4 .. today
 *   prior:  DAY_RANGE=2, DATE=today-6  -> today-6 .. today-5
 *
 * Coverage policy: if one window fails, the response is labeled
 * coverage.status = 'partial' (with the missing dates) and is never cached.
 * If both windows fail, the request is unavailable (no hotspot data).
 *
 * Kept free of non-erasable TypeScript syntax so scripts can import it with
 * `node --experimental-strip-types`.
 */

export type FirmsConfidence = 'l' | 'n' | 'h';
export type FirmsDayNight = 'D' | 'N';

export interface FireHotspot {
	latitude: number;
	longitude: number;
	/** Brightness temperature, VIIRS I-4 channel (K). Null when not reported. */
	bright_ti4: number | null;
	/** Brightness temperature, VIIRS I-5 channel (K). Null when not reported. */
	bright_ti5: number | null;
	scan: number | null;
	track: number | null;
	/** UTC acquisition date YYYY-MM-DD. */
	acq_date: string;
	/** UTC acquisition time HHMM (zero-padded). */
	acq_time: string;
	satellite: string;
	confidence: FirmsConfidence | null;
	version: string | null;
	/** Fire radiative power (MW). Null when not reported. */
	frp: number | null;
	daynight: FirmsDayNight | null;
}

export type FirmsWindowStatus = 'ok' | 'http_error' | 'timeout' | 'network_error' | 'malformed';

export interface FirmsWindowResult {
	id: 'recent' | 'prior';
	startDate: string;
	endDate: string;
	dayRange: number;
	status: FirmsWindowStatus;
	httpStatus?: number;
	detections: number;
	rejectedRows: number;
}

export type FirmsCoverageStatus = 'complete' | 'partial' | 'unavailable';

export interface FirmsCoverage {
	status: FirmsCoverageStatus;
	timezone: 'UTC';
	requestedStart: string;
	requestedEnd: string;
	missingDates: string[];
	windows: FirmsWindowResult[];
}

export interface HotspotStats {
	totalCount: number;
	highConfidence: number;
	nominalConfidence: number;
	lowConfidence: number;
	unknownConfidence: number;
	/** Max bright_ti4 over reported values; null when none reported. */
	maxBrightness: number | null;
	/** Max FRP over reported values; null when none reported. */
	maxPower: number | null;
}

export interface FireHotspotsResponse extends HotspotStats {
	hotspots: FireHotspot[];
	source: string;
	sensor: string;
	bboxes: string[];
	coverage: FirmsCoverage;
	rejectedRows: number;
	fetchedAt: string;
	cacheVersion: string;
}

export const FIRMS_SOURCE = 'VIIRS_SNPP_NRT';
export const FIRMS_SENSOR_LABEL = 'VIIRS S-NPP 375 m (NRT)';
export const FIRMS_BBOX_DELTA = 0.5;
export const FIRMS_CACHE_TTL_SECONDS = 1800;
export const FIRMS_CACHE_VERSION = 'v4';
export const FIRMS_REQUEST_TIMEOUT_MS = 8000;
export const FIRMS_LOOKBACK_DAYS = 7;
const FIRMS_AREA_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

/** Columns that must be present for a VIIRS response to be accepted, even when empty. */
export const FIRMS_REQUIRED_HEADERS = [
	'latitude',
	'longitude',
	'bright_ti4',
	'acq_date',
	'acq_time',
	'satellite',
	'confidence',
	'frp',
	'daynight',
] as const;

const STRICT_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Parse a complete decimal string. Rejects partial numerics ("45garbage"),
 * hex, empty strings, and non-finite values that Number/parseFloat accept.
 */
export function parseStrictNumber(value: string | null | undefined): number | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!STRICT_DECIMAL.test(trimmed)) return null;
	const n = Number(trimmed);
	return Number.isFinite(n) ? n : null;
}

export function validateCoordinates(lat: number, lng: number): { valid: boolean; reason?: string } {
	if (!Number.isFinite(lat)) {
		return { valid: false, reason: 'Latitude must be a finite number' };
	}
	if (!Number.isFinite(lng)) {
		return { valid: false, reason: 'Longitude must be a finite number' };
	}
	if (lat < -90 || lat > 90) {
		return { valid: false, reason: 'Latitude must be between -90 and 90 degrees' };
	}
	if (lng < -180 || lng > 180) {
		return { valid: false, reason: 'Longitude must be between -180 and 180 degrees' };
	}
	return { valid: true };
}

/** Parse lat/lng query strings strictly; returns a reason on failure. */
export function parseCoordinateQuery(
	lat: string | undefined,
	lng: string | undefined,
): { ok: true; lat: number; lng: number } | { ok: false; reason: string } {
	if (lat === undefined || lng === undefined || lat === '' || lng === '') {
		return { ok: false, reason: 'Missing lat or lng query parameter' };
	}
	const latNum = parseStrictNumber(lat);
	const lngNum = parseStrictNumber(lng);
	if (latNum === null || lngNum === null) {
		return { ok: false, reason: 'lat and lng must be plain decimal numbers' };
	}
	const validation = validateCoordinates(latNum, lngNum);
	if (!validation.valid) {
		return { ok: false, reason: validation.reason || 'Invalid coordinates' };
	}
	return { ok: true, lat: latNum, lng: lngNum };
}

function formatBbox(west: number, south: number, east: number, north: number): string {
	return `${west.toFixed(4)},${south.toFixed(4)},${east.toFixed(4)},${north.toFixed(4)}`;
}

/**
 * Build west,south,east,north boxes covering ±delta around the point.
 * Latitude is clamped at the poles. A box that crosses the antimeridian is
 * split into two boxes so the full longitude span is queried.
 */
export function buildFirmsBboxes(lat: number, lng: number, delta: number = FIRMS_BBOX_DELTA): string[] {
	const south = Math.max(-90, lat - delta);
	const north = Math.min(90, lat + delta);
	const west = lng - delta;
	const east = lng + delta;

	if (west < -180) {
		return [formatBbox(west + 360, south, 180, north), formatBbox(-180, south, east, north)];
	}
	if (east > 180) {
		return [formatBbox(west, south, 180, north), formatBbox(-180, south, east - 360, north)];
	}
	return [formatBbox(west, south, east, north)];
}

export function utcDateString(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	d.setUTCDate(d.getUTCDate() + days);
	return d;
}

/** Inclusive list of YYYY-MM-DD dates from start to end. */
function datesBetween(start: string, end: string): string[] {
	const out: string[] = [];
	const cursor = new Date(`${start}T00:00:00Z`);
	const last = new Date(`${end}T00:00:00Z`);
	while (cursor.getTime() <= last.getTime()) {
		out.push(utcDateString(cursor));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return out;
}

export interface FirmsWindowPlan {
	id: 'recent' | 'prior';
	startDate: string;
	endDate: string;
	dayRange: number;
}

export function planFirmsWindows(now: Date): FirmsWindowPlan[] {
	return [
		{
			id: 'recent',
			startDate: utcDateString(addUtcDays(now, -4)),
			endDate: utcDateString(addUtcDays(now, 0)),
			dayRange: 5,
		},
		{
			id: 'prior',
			startDate: utcDateString(addUtcDays(now, -6)),
			endDate: utcDateString(addUtcDays(now, -5)),
			dayRange: 2,
		},
	];
}

export function buildFirmsAreaUrl(mapKey: string, bbox: string, dayRange: number, startDate: string): string {
	return `${FIRMS_AREA_BASE}/${encodeURIComponent(mapKey)}/${FIRMS_SOURCE}/${bbox}/${dayRange}/${startDate}`;
}

/** Cache key bound to the exact queried boxes, source, and UTC date window. */
export function buildFirmsCacheKey(bboxes: readonly string[], requestedStart: string, requestedEnd: string): string {
	return `firms:${FIRMS_CACHE_VERSION}:${FIRMS_SOURCE}:${bboxes.join('|')}:${requestedStart}_${requestedEnd}`;
}

export function redactSecret(text: string, secret: string): string {
	if (!secret) return text;
	return text.split(secret).join('[REDACTED]').split(encodeURIComponent(secret)).join('[REDACTED]');
}

function isValidUtcDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const d = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && utcDateString(d) === value;
}

function normalizeAcqTime(value: string): string | null {
	if (!/^\d{1,4}$/.test(value)) return null;
	const padded = value.padStart(4, '0');
	const hh = Number(padded.slice(0, 2));
	const mm = Number(padded.slice(2));
	if (hh > 23 || mm > 59) return null;
	return padded;
}

function parseConfidence(value: string): FirmsConfidence | null | undefined {
	const v = value.trim().toLowerCase();
	if (v === '') return null;
	if (v === 'h' || v === 'high') return 'h';
	if (v === 'n' || v === 'nominal') return 'n';
	if (v === 'l' || v === 'low') return 'l';
	return undefined;
}

function parseDayNight(value: string): FirmsDayNight | null | undefined {
	const v = value.trim().toUpperCase();
	if (v === '') return null;
	if (v === 'D' || v === 'N') return v;
	return undefined;
}

/** Optional measurement: empty -> null, strict finite number -> value, anything else -> undefined (invalid). */
function parseMeasurement(value: string | undefined, min: number, exclusiveMin: boolean): number | null | undefined {
	if (value === undefined || value.trim() === '') return null;
	const n = parseStrictNumber(value);
	if (n === null) return undefined;
	if (exclusiveMin ? n <= min : n < min) return undefined;
	return n;
}

export type FirmsCsvResult =
	| { ok: true; hotspots: FireHotspot[]; rejectedRows: number }
	| { ok: false; reason: string };

/** The request a CSV body answers; rows outside it are rejected. */
export interface FirmsCsvExpectation {
	startDate: string;
	endDate: string;
	/** west,south,east,north as sent to FIRMS. */
	bbox: string;
}

const BBOX_EPSILON = 1e-6;

function insideBbox(lat: number, lng: number, bbox: string): boolean {
	const [west, south, east, north] = bbox.split(',').map(Number);
	return (
		lng >= west - BBOX_EPSILON &&
		lng <= east + BBOX_EPSILON &&
		lat >= south - BBOX_EPSILON &&
		lat <= north + BBOX_EPSILON
	);
}

/**
 * Parse FIRMS CSV by header name. The header row must contain every
 * FIRMS_REQUIRED_HEADERS column; otherwise the body is treated as provider
 * error content (HTML, "Invalid MAP_KEY", etc.), never as an empty dataset.
 *
 * Rows with an invalid identity (coordinates, date, time, satellite), with
 * present-but-invalid values, or outside the expected window/bbox are
 * rejected and counted. Missing optional values are null — never defaulted.
 * A body whose data rows are all invalid is malformed, not empty.
 */
export function parseFirmsCsv(csvText: string, expect?: FirmsCsvExpectation): FirmsCsvResult {
	const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
	if (lines.length === 0) {
		return { ok: false, reason: 'empty body' };
	}
	const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
	const missing = FIRMS_REQUIRED_HEADERS.filter((h) => !headers.includes(h));
	if (missing.length > 0) {
		return { ok: false, reason: `missing required columns: ${missing.join(',')}` };
	}

	const col = (name: string) => headers.indexOf(name);
	const idx = {
		lat: col('latitude'),
		lng: col('longitude'),
		b4: col('bright_ti4'),
		b5: col('bright_ti5'),
		scan: col('scan'),
		track: col('track'),
		date: col('acq_date'),
		time: col('acq_time'),
		sat: col('satellite'),
		conf: col('confidence'),
		ver: col('version'),
		frp: col('frp'),
		dn: col('daynight'),
	};
	const cell = (parts: string[], i: number): string | undefined => (i >= 0 ? parts[i] : undefined);

	const hotspots: FireHotspot[] = [];
	let rejectedRows = 0;

	for (let i = 1; i < lines.length; i++) {
		const parts = lines[i].split(',').map((p) => p.trim());
		if (parts.length !== headers.length) {
			rejectedRows++;
			continue;
		}

		const latitude = parseStrictNumber(parts[idx.lat]);
		const longitude = parseStrictNumber(parts[idx.lng]);
		const acqTime = normalizeAcqTime(parts[idx.time]);
		const acqDate = parts[idx.date];
		const satellite = parts[idx.sat];
		const confidence = parseConfidence(parts[idx.conf]);
		const daynight = parseDayNight(parts[idx.dn]);
		const bright_ti4 = parseMeasurement(parts[idx.b4], 0, true);
		const bright_ti5 = parseMeasurement(cell(parts, idx.b5), 0, true);
		const scan = parseMeasurement(cell(parts, idx.scan), 0, true);
		const track = parseMeasurement(cell(parts, idx.track), 0, true);
		const frp = parseMeasurement(parts[idx.frp], 0, false);

		if (
			latitude === null ||
			longitude === null ||
			!validateCoordinates(latitude, longitude).valid ||
			!isValidUtcDate(acqDate) ||
			acqTime === null ||
			!satellite ||
			confidence === undefined ||
			daynight === undefined ||
			bright_ti4 === undefined ||
			bright_ti5 === undefined ||
			scan === undefined ||
			track === undefined ||
			frp === undefined ||
			(expect &&
				(acqDate < expect.startDate || acqDate > expect.endDate || !insideBbox(latitude, longitude, expect.bbox)))
		) {
			rejectedRows++;
			continue;
		}

		const version = cell(parts, idx.ver);
		hotspots.push({
			latitude,
			longitude,
			bright_ti4,
			bright_ti5,
			scan,
			track,
			acq_date: acqDate,
			acq_time: acqTime,
			satellite,
			confidence,
			version: version ? version : null,
			frp,
			daynight,
		});
	}

	if (hotspots.length === 0 && rejectedRows > 0) {
		return { ok: false, reason: `all ${rejectedRows} data rows invalid` };
	}
	return { ok: true, hotspots, rejectedRows };
}

export function hotspotIdentity(h: FireHotspot): string {
	return `${h.latitude.toFixed(5)}|${h.longitude.toFixed(5)}|${h.acq_date}|${h.acq_time}|${h.satellite}`;
}

/** Deduplicate by observation identity (location, UTC date/time, satellite). */
export function deduplicateHotspots(records: readonly FireHotspot[]): FireHotspot[] {
	const map = new Map<string, FireHotspot>();
	for (const h of records) {
		const key = hotspotIdentity(h);
		if (!map.has(key)) map.set(key, h);
	}
	return Array.from(map.values());
}

export function computeHotspotStats(hotspots: readonly FireHotspot[]): HotspotStats {
	let highConfidence = 0;
	let nominalConfidence = 0;
	let lowConfidence = 0;
	let unknownConfidence = 0;
	let maxBrightness: number | null = null;
	let maxPower: number | null = null;

	for (const h of hotspots) {
		if (h.confidence === 'h') highConfidence++;
		else if (h.confidence === 'n') nominalConfidence++;
		else if (h.confidence === 'l') lowConfidence++;
		else unknownConfidence++;
		if (h.bright_ti4 !== null && (maxBrightness === null || h.bright_ti4 > maxBrightness)) {
			maxBrightness = h.bright_ti4;
		}
		if (h.frp !== null && (maxPower === null || h.frp > maxPower)) {
			maxPower = h.frp;
		}
	}

	return {
		totalCount: hotspots.length,
		highConfidence,
		nominalConfidence,
		lowConfidence,
		unknownConfidence,
		maxBrightness,
		maxPower,
	};
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface BoxOutcome {
	status: FirmsWindowStatus;
	httpStatus?: number;
	hotspots: FireHotspot[];
	rejectedRows: number;
}

async function fetchBox(
	url: string,
	expect: FirmsCsvExpectation,
	mapKey: string,
	label: string,
	fetchImpl: FetchLike,
): Promise<BoxOutcome> {
	let res: Response;
	try {
		res = await fetchImpl(url, { signal: AbortSignal.timeout(FIRMS_REQUEST_TIMEOUT_MS) });
	} catch (err) {
		const name = err instanceof Error ? err.name : 'Error';
		const status: FirmsWindowStatus = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error';
		const message = err instanceof Error ? redactSecret(err.message, mapKey) : 'unknown';
		console.warn(`FIRMS ${label}: ${status} (${name}: ${message})`);
		return { status, hotspots: [], rejectedRows: 0 };
	}

	if (!res.ok) {
		console.warn(`FIRMS ${label}: HTTP ${res.status}`);
		return { status: 'http_error', httpStatus: res.status, hotspots: [], rejectedRows: 0 };
	}

	let text: string;
	try {
		text = await res.text();
	} catch (err) {
		const name = err instanceof Error ? err.name : 'Error';
		console.warn(`FIRMS ${label}: body read failed (${name})`);
		return { status: name === 'TimeoutError' ? 'timeout' : 'network_error', httpStatus: res.status, hotspots: [], rejectedRows: 0 };
	}

	const parsed = parseFirmsCsv(text, expect);
	if (!parsed.ok) {
		console.warn(`FIRMS ${label}: malformed response (${parsed.reason})`);
		return { status: 'malformed', httpStatus: res.status, hotspots: [], rejectedRows: 0 };
	}
	if (parsed.rejectedRows > 0) {
		console.warn(`FIRMS ${label}: rejected ${parsed.rejectedRows} invalid rows`);
	}
	return { status: 'ok', httpStatus: res.status, hotspots: parsed.hotspots, rejectedRows: parsed.rejectedRows };
}

export interface FirmsFetchOptions {
	now?: Date;
	fetchImpl?: FetchLike;
}

/**
 * Fetch the 7-day window. Never converts a failed window into "no detections":
 * each window carries its own status, and coverage.status reflects them.
 */
export async function fetch7DayFirmsHotspots(
	lat: number,
	lng: number,
	mapKey: string,
	options: FirmsFetchOptions = {},
): Promise<FireHotspotsResponse> {
	const now = options.now ?? new Date();
	const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
	const bboxes = buildFirmsBboxes(lat, lng);
	const plans = planFirmsWindows(now);

	const windowResults = await Promise.all(
		plans.map(async (plan) => {
			const boxes = await Promise.all(
				bboxes.map((bbox, i) =>
					fetchBox(
						buildFirmsAreaUrl(mapKey, bbox, plan.dayRange, plan.startDate),
						{ startDate: plan.startDate, endDate: plan.endDate, bbox },
						mapKey,
						`${plan.id} window box ${i + 1}/${bboxes.length}`,
						fetchImpl,
					),
				),
			);
			const failed = boxes.find((b) => b.status !== 'ok');
			const hotspots = failed ? [] : boxes.flatMap((b) => b.hotspots);
			const result: FirmsWindowResult = {
				id: plan.id,
				startDate: plan.startDate,
				endDate: plan.endDate,
				dayRange: plan.dayRange,
				status: failed ? failed.status : 'ok',
				...(failed?.httpStatus !== undefined ? { httpStatus: failed.httpStatus } : {}),
				detections: hotspots.length,
				rejectedRows: boxes.reduce((sum, b) => sum + b.rejectedRows, 0),
			};
			return { result, hotspots };
		}),
	);

	const okWindows = windowResults.filter((w) => w.result.status === 'ok');
	const status: FirmsCoverageStatus =
		okWindows.length === windowResults.length ? 'complete' : okWindows.length === 0 ? 'unavailable' : 'partial';

	const missingDates = windowResults
		.filter((w) => w.result.status !== 'ok')
		.flatMap((w) => datesBetween(w.result.startDate, w.result.endDate))
		.sort();

	const hotspots = deduplicateHotspots(okWindows.flatMap((w) => w.hotspots));
	const stats = computeHotspotStats(hotspots);

	return {
		hotspots,
		...stats,
		source: FIRMS_SOURCE,
		sensor: FIRMS_SENSOR_LABEL,
		bboxes,
		coverage: {
			status,
			timezone: 'UTC',
			requestedStart: plans[1].startDate,
			requestedEnd: plans[0].endDate,
			missingDates,
			windows: windowResults.map((w) => w.result),
		},
		rejectedRows: windowResults.reduce((sum, w) => sum + w.result.rejectedRows, 0),
		fetchedAt: now.toISOString(),
		cacheVersion: FIRMS_CACHE_VERSION,
	};
}

/** Accept a cached entry only if it is a complete response written by this cache version. */
export function isUsableCachedFirms(value: unknown): value is FireHotspotsResponse {
	if (!value || typeof value !== 'object') return false;
	const v = value as Partial<FireHotspotsResponse>;
	return (
		v.cacheVersion === FIRMS_CACHE_VERSION &&
		Array.isArray(v.hotspots) &&
		typeof v.totalCount === 'number' &&
		v.totalCount === v.hotspots.length &&
		!!v.coverage &&
		v.coverage.status === 'complete'
	);
}
