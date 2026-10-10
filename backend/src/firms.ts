/**
 * NASA FIRMS (Fire Information for Resource Management System) Adapter
 * 
 * Sourced from official NASA FIRMS Area API documentation:
 * Format: /api/area/csv/[MAP_KEY]/[SOURCE]/[BBOX]/[DAY_RANGE]/[DATE]
 * Valid DAY_RANGE values are 1..5.
 * 
 * To fulfill the requested 7-day lookback window:
 * Split into two documented supported requests:
 * 1. Most recent 5 days: DAY_RANGE=5 (no date specified).
 * 2. Preceding 2 days: DAY_RANGE=2, starting at (now - 6 days in UTC).
 * Results are combined and deduplicated by unique observation identity.
 */

export interface FireHotspot {
	latitude: number;
	longitude: number;
	bright_ti4: number;
	scan: number;
	track: number;
	acq_date: string;
	acq_time: string;
	satellite: string;
	confidence: string;
	version: string;
	bright_ti5: number;
	frp: number;
	daynight: string;
}

export interface FireHotspotsResponse {
	hotspots: FireHotspot[];
	totalCount: number;
	highConfidence: number;
	maxBrightness: number;
	maxPower: number;
	message?: string;
}

export const FIRMS_SOURCE = 'VIIRS_SNPP_NRT';
export const FIRMS_BBOX_DELTA = 0.5; // ±0.5° bounding box
export const FIRMS_CACHE_TTL_SECONDS = 1800; // 30 minutes cache

/**
 * Validate latitude and longitude coordinates.
 */
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

/**
 * Build FIRMS bounding box string in order: west,south,east,north (lon1,lat1,lon2,lat2).
 * Handles pole clamping and antimeridian bounds.
 */
export function buildFirmsBbox(lat: number, lng: number, delta: number = FIRMS_BBOX_DELTA): string {
	const south = Math.max(-90, lat - delta);
	const north = Math.min(90, lat + delta);
	const west = Math.max(-180, Math.min(180, lng - delta));
	const east = Math.max(-180, Math.min(180, lng + delta));

	return `${west.toFixed(4)},${south.toFixed(4)},${east.toFixed(4)},${north.toFixed(4)}`;
}

/**
 * Parse FIRMS CSV text into FireHotspot records using validated header names.
 * Never relies on hardcoded column indices.
 */
export function parseFirmsCsv(csvText: string): FireHotspot[] {
	const trimmed = csvText.trim();
	if (!trimmed) return [];

	const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
	if (lines.length <= 1) return []; // Header only or empty

	const headerLine = lines[0];
	const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());

	const col = (name: string): number => headers.indexOf(name.toLowerCase());

	const latIdx = col('latitude');
	const lngIdx = col('longitude');
	const bright4Idx = col('bright_ti4');
	const scanIdx = col('scan');
	const trackIdx = col('track');
	const dateIdx = col('acq_date');
	const timeIdx = col('acq_time');
	const satIdx = col('satellite');
	const confIdx = col('confidence');
	const verIdx = col('version');
	const bright5Idx = col('bright_ti5');
	const frpIdx = col('frp');
	const dayNightIdx = col('daynight');

	// Require at least latitude and longitude headers
	if (latIdx === -1 || lngIdx === -1) {
		return [];
	}

	const hotspots: FireHotspot[] = [];

	for (let i = 1; i < lines.length; i++) {
		const parts = lines[i].split(',').map((p) => p.trim());
		if (parts.length < Math.max(latIdx, lngIdx) + 1) continue;

		const latitude = Number.parseFloat(parts[latIdx]);
		const longitude = Number.parseFloat(parts[lngIdx]);

		if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

		const bright_ti4 = bright4Idx >= 0 ? Number.parseFloat(parts[bright4Idx]) || 0 : 0;
		const scan = scanIdx >= 0 ? Number.parseFloat(parts[scanIdx]) || 0 : 0;
		const track = trackIdx >= 0 ? Number.parseFloat(parts[trackIdx]) || 0 : 0;
		const acq_date = dateIdx >= 0 ? parts[dateIdx] || '' : '';
		const acq_time = timeIdx >= 0 ? parts[timeIdx] || '' : '';
		const satellite = satIdx >= 0 ? parts[satIdx] || '' : '';
		const confidence = confIdx >= 0 ? parts[confIdx] || 'n' : 'n';
		const version = verIdx >= 0 ? parts[verIdx] || '' : '';
		const bright_ti5 = bright5Idx >= 0 ? Number.parseFloat(parts[bright5Idx]) || 0 : 0;
		const frp = frpIdx >= 0 ? Number.parseFloat(parts[frpIdx]) || 0 : 0;
		const daynight = dayNightIdx >= 0 ? parts[dayNightIdx] || 'D' : 'D';

		hotspots.push({
			latitude,
			longitude,
			bright_ti4,
			scan,
			track,
			acq_date,
			acq_time,
			satellite,
			confidence,
			version,
			bright_ti5,
			frp,
			daynight,
		});
	}

	return hotspots;
}

/**
 * Deduplicate hotspots across multiple query windows by unique observation identity.
 */
export function deduplicateHotspots(records: FireHotspot[]): FireHotspot[] {
	const map = new Map<string, FireHotspot>();
	for (const h of records) {
		// Key on rounded coordinates, date, time, and satellite
		const key = `${h.latitude.toFixed(5)}|${h.longitude.toFixed(5)}|${h.acq_date}|${h.acq_time}|${h.satellite}`;
		if (!map.has(key)) {
			map.set(key, h);
		}
	}
	return Array.from(map.values());
}

/**
 * Compute aggregate statistics over valid finite hotspot records.
 * Never outputs NaN or -Infinity.
 */
export function computeHotspotStats(hotspots: FireHotspot[]): {
	totalCount: number;
	highConfidence: number;
	maxBrightness: number;
	maxPower: number;
} {
	const totalCount = hotspots.length;
	if (totalCount === 0) {
		return {
			totalCount: 0,
			highConfidence: 0,
			maxBrightness: 0,
			maxPower: 0,
		};
	}

	const highConfidence = hotspots.filter(
		(h) => h.confidence === 'h' || h.confidence === 'high',
	).length;

	let maxBrightness = 0;
	let maxPower = 0;

	for (const h of hotspots) {
		if (Number.isFinite(h.bright_ti4) && h.bright_ti4 > maxBrightness) {
			maxBrightness = h.bright_ti4;
		}
		if (Number.isFinite(h.frp) && h.frp > maxPower) {
			maxPower = h.frp;
		}
	}

	return {
		totalCount,
		highConfidence,
		maxBrightness,
		maxPower,
	};
}

/**
 * Fetch 7-day fire hotspot data using supported Area API requests (ranges <= 5).
 */
export async function fetch7DayFirmsHotspots(
	lat: number,
	lng: number,
	mapKey: string,
): Promise<FireHotspotsResponse> {
	const bbox = buildFirmsBbox(lat, lng);

	// Window 1: Recent 5 days (no date parameter)
	const urlRecent5 = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/${FIRMS_SOURCE}/${bbox}/5`;

	// Window 2: Preceding 2 days starting at (now - 6 days in UTC)
	const d = new Date();
	d.setUTCDate(d.getUTCDate() - 6);
	const startIsoDate = d.toISOString().split('T')[0];
	const urlPrior2 = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/${FIRMS_SOURCE}/${bbox}/2/${startIsoDate}`;

	const fetchWindow = async (url: string): Promise<FireHotspot[]> => {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
			if (!res.ok) {
				console.warn(`FIRMS subrequest failed: ${res.status}`);
				return [];
			}
			const text = await res.text();
			return parseFirmsCsv(text);
		} catch (err) {
			console.warn(`FIRMS subrequest error:`, err);
			return [];
		}
	};

	const [recentRecords, priorRecords] = await Promise.all([
		fetchWindow(urlRecent5),
		fetchWindow(urlPrior2),
	]);

	const combined = deduplicateHotspots([...recentRecords, ...priorRecords]);
	const stats = computeHotspotStats(combined);

	return {
		hotspots: combined,
		...stats,
	};
}
