/**
 * Disaster Data Adapters (NASA EONET v3 + USGS Earthquakes)
 * Provides normalized, validated disaster records with per-source status.
 *
 * Records with missing/invalid identity, timestamps, or coordinates are
 * rejected and counted — never assigned the current time or (0, 0).
 * Provider content that does not match the expected schema, or in which
 * every record is invalid, is a source failure ('malformed'), not an
 * empty dataset.
 */

export type DisasterSeverity = 'low' | 'medium' | 'high';

export interface DisasterRecord {
	id: string;
	type: 'fire' | 'volcano' | 'earthquake';
	title: string;
	lng: number;
	lat: number;
	date: string;
	severity: DisasterSeverity;
	magnitude?: number;
}

export type DisasterSourceName = 'eonet' | 'usgs';
export type DisasterSourceState = 'ok' | 'failed' | 'malformed';

export interface DisasterSourceStatus {
	status: DisasterSourceState;
	count: number;
	rejected: number;
}

export type DisasterSources = Record<DisasterSourceName, DisasterSourceStatus>;

export interface DisasterFetchResult {
	disasters: DisasterRecord[];
	sources: DisasterSources;
	partial: boolean;
}

export class DisasterUpstreamError extends Error {
	readonly sources: DisasterSources;
	constructor(sources: DisasterSources) {
		super('Both EONET and USGS upstream services failed');
		this.name = 'DisasterUpstreamError';
		this.sources = sources;
	}
}

class MalformedSourceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MalformedSourceError';
	}
}

export interface LngLat {
	lng: number;
	lat: number;
}

/** Strict [lng, lat] pair: both must be real finite numbers in range (0 is valid; null is not). */
export function readLngLat(value: unknown): LngLat | null {
	if (!Array.isArray(value) || value.length < 2) return null;
	const [lng, lat] = value;
	if (typeof lng !== 'number' || typeof lat !== 'number') return null;
	if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
	if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
	return { lng, lat };
}

function parseTimestamp(value: unknown): number | null {
	if (typeof value !== 'string' || value.trim() === '') return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}

/**
 * Representative point for a polygon outer ring: the center of its
 * longitude/latitude bounding box. This is not an area centroid.
 * Longitudes are unwrapped along the ring so rings crossing the
 * antimeridian are measured across it; the duplicated closing vertex does
 * not affect the result. Any invalid vertex rejects the ring.
 */
export function polygonRepresentativePoint(ring: unknown): LngLat | null {
	if (!Array.isArray(ring)) return null;
	const pts: LngLat[] = [];
	for (const vertex of ring) {
		const p = readLngLat(vertex);
		if (!p) return null;
		pts.push(p);
	}
	if (pts.length > 1 && pts[0].lng === pts[pts.length - 1].lng && pts[0].lat === pts[pts.length - 1].lat) {
		pts.pop();
	}
	if (pts.length < 3) return null;

	let prev = pts[0].lng;
	let minLng = prev;
	let maxLng = prev;
	let minLat = pts[0].lat;
	let maxLat = pts[0].lat;
	for (let i = 1; i < pts.length; i++) {
		let lng = pts[i].lng;
		while (lng - prev > 180) lng -= 360;
		while (lng - prev < -180) lng += 360;
		prev = lng;
		minLng = Math.min(minLng, lng);
		maxLng = Math.max(maxLng, lng);
		minLat = Math.min(minLat, pts[i].lat);
		maxLat = Math.max(maxLat, pts[i].lat);
	}

	let lng = (minLng + maxLng) / 2;
	lng = ((((lng + 180) % 360) + 360) % 360) - 180;
	return { lng, lat: (minLat + maxLat) / 2 };
}

/** Point -> its coordinates; Polygon -> bounding-box center of the outer ring. */
export function extractEonetCoordinates(geom: unknown): LngLat | null {
	if (!geom || typeof geom !== 'object') return null;
	const g = geom as { type?: unknown; coordinates?: unknown };
	if (g.type === 'Point') return readLngLat(g.coordinates);
	if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
		return polygonRepresentativePoint(g.coordinates[0]);
	}
	return null;
}

export interface NormalizeResult {
	records: DisasterRecord[];
	rejected: number;
}

/**
 * Normalize EONET events. All categories are considered; the latest
 * geometry with a valid date and coordinates is used.
 */
export function normalizeEonetEvents(events: readonly unknown[]): NormalizeResult {
	const records: DisasterRecord[] = [];
	let rejected = 0;

	for (const raw of events) {
		const event = raw as {
			id?: unknown;
			title?: unknown;
			categories?: unknown;
			geometry?: unknown;
		} | null;
		if (!event || typeof event.id !== 'string' || !event.id || !Array.isArray(event.categories)) {
			rejected++;
			continue;
		}
		const categoryIds = event.categories
			.map((c) => (c && typeof c === 'object' ? (c as { id?: unknown }).id : undefined))
			.filter((id): id is string => typeof id === 'string');
		const hasWildfire = categoryIds.includes('wildfires');
		const hasVolcano = categoryIds.includes('volcanoes');
		if (!hasWildfire && !hasVolcano) continue;
		const type: 'fire' | 'volcano' = hasWildfire ? 'fire' : 'volcano';

		if (!Array.isArray(event.geometry)) {
			rejected++;
			continue;
		}

		let latest: { ms: number; point: LngLat } | null = null;
		for (const geom of event.geometry) {
			const ms = parseTimestamp((geom as { date?: unknown } | null)?.date);
			const point = extractEonetCoordinates(geom);
			if (ms === null || !point) continue;
			if (!latest || ms > latest.ms) latest = { ms, point };
		}
		if (!latest) {
			rejected++;
			continue;
		}

		const title = typeof event.title === 'string' && event.title.trim() ? event.title.trim() : null;
		records.push({
			id: event.id,
			type,
			title: title ?? (type === 'fire' ? 'Wildfire Event' : 'Volcano Event'),
			lng: latest.point.lng,
			lat: latest.point.lat,
			date: new Date(latest.ms).toISOString(),
			severity: 'medium',
		});
	}

	return { records, rejected };
}

/**
 * Normalize USGS GeoJSON features. Zero magnitude is preserved; a null
 * magnitude is reported as unknown (no magnitude field).
 */
export function normalizeUsgsFeatures(features: readonly unknown[]): NormalizeResult {
	const records: DisasterRecord[] = [];
	let rejected = 0;

	for (const raw of features) {
		const feature = raw as {
			id?: unknown;
			properties?: { mag?: unknown; place?: unknown; time?: unknown } | null;
			geometry?: { type?: unknown; coordinates?: unknown } | null;
		} | null;
		const point = feature?.geometry?.type === 'Point' ? readLngLat(feature.geometry.coordinates) : null;
		const time = feature?.properties?.time;
		// Finite numbers beyond the ECMAScript date range make toISOString throw.
		const date = typeof time === 'number' ? new Date(time) : null;
		const mag = feature?.properties?.mag;
		const magValid = mag === null || mag === undefined || (typeof mag === 'number' && Number.isFinite(mag));

		if (
			!feature ||
			typeof feature.id !== 'string' ||
			!feature.id ||
			!point ||
			!date ||
			Number.isNaN(date.getTime()) ||
			!magValid
		) {
			rejected++;
			continue;
		}

		const magnitude = typeof mag === 'number' ? mag : undefined;
		let severity: DisasterSeverity = 'low';
		if (magnitude !== undefined) {
			if (magnitude >= 6.0) severity = 'high';
			else if (magnitude >= 4.5) severity = 'medium';
		}

		const place = feature.properties?.place;
		records.push({
			id: feature.id,
			type: 'earthquake',
			title: typeof place === 'string' && place.trim() ? place.trim() : 'Unspecified location',
			lng: point.lng,
			lat: point.lat,
			date: date.toISOString(),
			severity,
			...(magnitude !== undefined ? { magnitude } : {}),
		});
	}

	return { records, rejected };
}

export const EONET_URL =
	'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires,volcanoes&days=60';
export const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';

export function parseEonetPayload(payload: unknown): NormalizeResult {
	const events = (payload as { events?: unknown } | null)?.events;
	if (!Array.isArray(events)) throw new MalformedSourceError('EONET payload has no events array');
	return normalizeEonetEvents(events);
}

export function parseUsgsPayload(payload: unknown): NormalizeResult {
	const p = payload as { type?: unknown; features?: unknown } | null;
	if (!p || p.type !== 'FeatureCollection' || !Array.isArray(p.features)) {
		throw new MalformedSourceError('USGS payload is not a FeatureCollection');
	}
	return normalizeUsgsFeatures(p.features);
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function loadSource(
	name: DisasterSourceName,
	url: string,
	timeoutMs: number,
	parse: (payload: unknown) => NormalizeResult,
	fetchImpl: FetchLike,
): Promise<{ status: DisasterSourceStatus; records: DisasterRecord[] }> {
	try {
		const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) {
			console.warn(`${name} fetch failed: HTTP ${res.status}`);
			return { status: { status: 'failed', count: 0, rejected: 0 }, records: [] };
		}
		let payload: unknown;
		try {
			payload = await res.json();
		} catch {
			throw new MalformedSourceError(`${name} response is not JSON`);
		}
		const { records, rejected } = parse(payload);
		if (records.length === 0 && rejected > 0) {
			console.warn(`${name} malformed: all ${rejected} records invalid`);
			return { status: { status: 'malformed', count: 0, rejected }, records: [] };
		}
		if (rejected > 0) console.warn(`${name}: rejected ${rejected} invalid records`);
		return { status: { status: 'ok', count: records.length, rejected }, records };
	} catch (err) {
		if (err instanceof MalformedSourceError) {
			console.warn(`${name} malformed: ${err.message}`);
			return { status: { status: 'malformed', count: 0, rejected: 0 }, records: [] };
		}
		console.warn(`${name} fetch failed: ${err instanceof Error ? err.name : 'Error'}`);
		return { status: { status: 'failed', count: 0, rejected: 0 }, records: [] };
	}
}

/**
 * Fetch EONET and USGS independently. One failed source yields a partial
 * result with that source's status; both failing throws DisasterUpstreamError.
 */
export async function fetchDisasters(fetchImpl?: FetchLike): Promise<DisasterFetchResult> {
	const doFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
	const [eonet, usgs] = await Promise.all([
		loadSource('eonet', EONET_URL, 15000, parseEonetPayload, doFetch),
		loadSource('usgs', USGS_URL, 8000, parseUsgsPayload, doFetch),
	]);

	const sources: DisasterSources = { eonet: eonet.status, usgs: usgs.status };
	if (eonet.status.status !== 'ok' && usgs.status.status !== 'ok') {
		throw new DisasterUpstreamError(sources);
	}

	const map = new Map<string, DisasterRecord>();
	for (const d of [...eonet.records, ...usgs.records]) map.set(d.id, d);

	return {
		disasters: Array.from(map.values()),
		sources,
		partial: eonet.status.status !== 'ok' || usgs.status.status !== 'ok',
	};
}

/** Header form: "eonet=ok;usgs=failed". */
export function formatDisasterSourcesHeader(sources: DisasterSources): string {
	return `eonet=${sources.eonet.status};usgs=${sources.usgs.status}`;
}
