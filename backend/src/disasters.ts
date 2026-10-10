/**
 * Disaster Data Adapters (NASA EONET v3 + USGS Earthquakes)
 * Provides normalized, validated disaster records with partial-failure isolation.
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

export interface EonetRawEvent {
	id: string;
	title: string;
	categories: Array<{ id: string; title?: string }>;
	geometry?: Array<{
		date: string;
		type?: string;
		coordinates: any;
	}>;
}

export interface UsgsRawFeature {
	id: string;
	properties: {
		mag: number | null;
		place: string | null;
		time: number;
		updated?: number;
	};
	geometry: {
		coordinates: number[];
	};
}

/**
 * Extract representative [lng, lat] coordinates from EONET geometry.
 * Correctly handles both Point and Polygon geometries.
 */
export function extractEonetCoordinates(geom: {
	type?: string;
	coordinates: any;
}): { lng: number; lat: number } | null {
	if (!geom || !geom.coordinates) return null;

	const geomType = geom.type || (Array.isArray(geom.coordinates[0]) ? 'Polygon' : 'Point');

	if (geomType === 'Point' && Array.isArray(geom.coordinates)) {
		const lng = Number(geom.coordinates[0]);
		const lat = Number(geom.coordinates[1]);
		if (Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
			return { lng, lat };
		}
		return null;
	}

	if (geomType === 'Polygon' && Array.isArray(geom.coordinates) && Array.isArray(geom.coordinates[0])) {
		// Outer ring of polygon coordinates
		const ring = geom.coordinates[0];
		let sumLng = 0;
		let sumLat = 0;
		let count = 0;

		for (const pt of ring) {
			if (Array.isArray(pt) && pt.length >= 2) {
				const lng = Number(pt[0]);
				const lat = Number(pt[1]);
				if (Number.isFinite(lng) && Number.isFinite(lat)) {
					sumLng += lng;
					sumLat += lat;
					count++;
				}
			}
		}

		if (count > 0) {
			const avgLng = sumLng / count;
			const avgLat = sumLat / count;
			if (Math.abs(avgLat) <= 90 && Math.abs(avgLng) <= 180) {
				return { lng: avgLng, lat: avgLat };
			}
		}
	}

	return null;
}

/**
 * Normalize raw EONET events into DisasterRecord items.
 * Evaluates all categories (not just categories[0]) and selects latest geometry observation.
 */
export function normalizeEonetEvents(events: readonly EonetRawEvent[]): DisasterRecord[] {
	const results: DisasterRecord[] = [];

	for (const event of events) {
		if (!event.categories || !Array.isArray(event.categories)) continue;

		const categoryIds = event.categories.map((c) => c.id);
		const hasWildfire = categoryIds.includes('wildfires');
		const hasVolcano = categoryIds.includes('volcanoes');

		if (!hasWildfire && !hasVolcano) continue;

		const type: 'fire' | 'volcano' = hasWildfire ? 'fire' : 'volcano';

		if (!event.geometry || !Array.isArray(event.geometry) || event.geometry.length === 0) {
			continue;
		}

		// Sort geometries by date ascending to pick the most recent observation
		const sorted = [...event.geometry].sort(
			(a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
		);
		const latest = sorted[sorted.length - 1];

		const coords = extractEonetCoordinates(latest);
		if (!coords) continue;

		results.push({
			id: event.id,
			type,
			title: event.title || (type === 'fire' ? 'Wildfire Event' : 'Volcano Event'),
			lng: coords.lng,
			lat: coords.lat,
			date: latest.date,
			severity: 'medium',
		});
	}

	return results;
}

/**
 * Normalize USGS earthquake GeoJSON features into DisasterRecord items.
 * Preserves zero magnitude and correctly handles null/unknown magnitude.
 */
export function normalizeUsgsFeatures(features: readonly UsgsRawFeature[]): DisasterRecord[] {
	const results: DisasterRecord[] = [];

	for (const feature of features) {
		if (!feature.geometry || !Array.isArray(feature.geometry.coordinates)) continue;

		const coords = feature.geometry.coordinates;
		if (coords.length < 2) continue;

		const lng = Number(coords[0]);
		const lat = Number(coords[1]);

		if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
			continue;
		}

		const rawMag = feature.properties?.mag;
		const hasMag = typeof rawMag === 'number' && Number.isFinite(rawMag);
		const magnitude = hasMag ? rawMag : undefined;

		let severity: DisasterSeverity = 'low';
		if (hasMag) {
			if (rawMag >= 6.0) severity = 'high';
			else if (rawMag >= 4.5) severity = 'medium';
		}

		const place = feature.properties?.place?.trim() || 'Unspecified location';
		const date = Number.isFinite(feature.properties?.time)
			? new Date(feature.properties.time).toISOString()
			: new Date().toISOString();

		results.push({
			id: feature.id || `usgs-${lat}-${lng}-${date}`,
			type: 'earthquake',
			title: place,
			lng,
			lat,
			date,
			severity,
			...(magnitude !== undefined ? { magnitude } : {}),
		});
	}

	return results;
}

/**
 * Fetch and combine disasters from EONET and USGS with partial-failure isolation.
 */
export async function fetchDisasters(): Promise<{
	disasters: DisasterRecord[];
	eonetCount: number;
	usgsCount: number;
	partialFailure?: boolean;
}> {
	// Bounded EONET v3 query: open events in recent 60 days
	const eonetUrl =
		'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires,volcanoes&days=60';
	const usgsUrl =
		'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';

	const fetchEonet = async (): Promise<DisasterRecord[]> => {
		const res = await fetch(eonetUrl, { signal: AbortSignal.timeout(15000) });
		if (!res.ok) throw new Error(`EONET API HTTP ${res.status}`);
		const data = (await res.json()) as { events?: EonetRawEvent[] };
		return normalizeEonetEvents(data.events || []);
	};

	const fetchUsgs = async (): Promise<DisasterRecord[]> => {
		const res = await fetch(usgsUrl, { signal: AbortSignal.timeout(8000) });
		if (!res.ok) throw new Error(`USGS API HTTP ${res.status}`);
		const data = (await res.json()) as { features?: UsgsRawFeature[] };
		return normalizeUsgsFeatures(data.features || []);
	};

	const [eonetSettled, usgsSettled] = await Promise.allSettled([fetchEonet(), fetchUsgs()]);

	const eonetRecords = eonetSettled.status === 'fulfilled' ? eonetSettled.value : [];
	const usgsRecords = usgsSettled.status === 'fulfilled' ? usgsSettled.value : [];

	if (eonetSettled.status === 'rejected') {
		console.warn('EONET fetch failed:', eonetSettled.reason);
	}
	if (usgsSettled.status === 'rejected') {
		console.warn('USGS fetch failed:', usgsSettled.reason);
	}

	if (eonetRecords.length === 0 && usgsRecords.length === 0) {
		if (eonetSettled.status === 'rejected' && usgsSettled.status === 'rejected') {
			throw new Error('Both EONET and USGS upstream services failed');
		}
	}

	// Deduplicate by ID
	const map = new Map<string, DisasterRecord>();
	for (const d of [...eonetRecords, ...usgsRecords]) {
		map.set(d.id, d);
	}

	return {
		disasters: Array.from(map.values()),
		eonetCount: eonetRecords.length,
		usgsCount: usgsRecords.length,
		partialFailure: eonetSettled.status === 'rejected' || usgsSettled.status === 'rejected',
	};
}
