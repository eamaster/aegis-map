/**
 * Geographic matching for CAP polygons/circles/geocodes and non-CAP area descriptions.
 * Coordinates inside this module always use [lng, lat] for GeoJSON rings.
 */

import type { CapArea } from './capParser';

const EARTH_RADIUS_KM = 6371;
const BOUNDARY_TOLERANCE_KM = 0.15; // 150 m boundary tolerance for points sitting on polygon edges

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	let dLngDeg = lng2 - lng1;
	while (dLngDeg > 180) dLngDeg -= 360;
	while (dLngDeg < -180) dLngDeg += 360;
	const dLng = toRad(dLngDeg);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function unwrapRingLongitudesNear(ring: ReadonlyArray<[number, number]>, refLng: number): Array<[number, number]> {
	return ring.map(([lng, lat]) => {
		let adj = lng;
		while (adj - refLng > 180) adj -= 360;
		while (adj - refLng < -180) adj += 360;
		return [adj, lat];
	});
}

function pointToSegmentDistanceKm(
	lat: number,
	lng: number,
	a: [number, number],
	b: [number, number],
): number {
	const [ax, ay] = a;
	const [bx, by] = b;
	const dx = bx - ax;
	const dy = by - ay;
	const lenSq = dx * dx + dy * dy;
	let t = 0;
	if (lenSq > 0) {
		t = Math.max(0, Math.min(1, ((lng - ax) * dx + (lat - ay) * dy) / lenSq));
	}
	const projLng = ax + t * dx;
	const projLat = ay + t * dy;
	return haversineKm(lat, lng, projLat, projLng);
}

/** Ray-casting point-in-polygon with antimeridian unwrapping and boundary tolerance. */
export function pointInPolygonRing(lat: number, lng: number, rawRing: ReadonlyArray<[number, number]>): boolean {
	if (rawRing.length < 3) return false;
	const ring = unwrapRingLongitudesNear(rawRing, lng);

	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];

		if (pointToSegmentDistanceKm(lat, lng, ring[i], ring[j]) <= BOUNDARY_TOLERANCE_KM) {
			return true;
		}

		const intersect =
			yi > lat !== yj > lat &&
			lng < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}

export interface GeoMatchResult {
	matched: boolean;
	method: 'polygon' | 'circle' | 'geocode' | 'area_name' | 'country_only';
	uncertain: boolean;
	note: string;
}

/** Match a point against CAP areas (polygons, circles, geocodes, and optional textual area names). */
export function matchPointToCapAreas(
	lat: number,
	lng: number,
	areas: readonly CapArea[],
	options: { expectedTokens?: readonly string[]; countryCode?: string | null } = {},
): GeoMatchResult {
	let hasAnyGeometry = false;

	for (const area of areas) {
		for (const ring of area.polygons) {
			hasAnyGeometry = true;
			if (pointInPolygonRing(lat, lng, ring)) {
				return {
					matched: true,
					method: 'polygon',
					uncertain: false,
					note: area.areaDesc ? `Inside official polygon (${area.areaDesc})` : 'Inside official warning polygon',
				};
			}
		}

		for (const circle of area.circles) {
			hasAnyGeometry = true;
			const dist = haversineKm(lat, lng, circle.lat, circle.lng);
			if (dist <= circle.radiusKm) {
				const uncertain = circle.radiusKm > 0 && dist >= circle.radiusKm * 0.9;
				return {
					matched: true,
					method: 'circle',
					uncertain,
					note: `Within ${circle.radiusKm} km warning circle (${dist.toFixed(1)} km from center)`,
				};
			}
		}
	}

	if (hasAnyGeometry) {
		return {
			matched: false,
			method: 'polygon',
			uncertain: false,
			note: 'Outside official alert geometry',
		};
	}

	// Zone-only CAP alerts without geometry: check geocodes / areaDesc tokens
	const tokens = (options.expectedTokens ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
	for (const area of areas) {
		for (const geo of area.geocodes) {
			if (tokens.some((tok) => geo.value.toLowerCase().includes(tok))) {
				return {
					matched: true,
					method: 'geocode',
					uncertain: true,
					note: `Matched zone geocode (${geo.valueName}:${geo.value}); no polygon supplied`,
				};
			}
		}
		const descLower = area.areaDesc.toLowerCase();
		if (tokens.length > 0 && tokens.some((tok) => descLower.includes(tok))) {
			return {
				matched: true,
				method: 'area_name',
				uncertain: true,
				note: `Matched area description (${area.areaDesc}); no polygon geometry supplied`,
			};
		}
	}

	// National or zone-only alert where polygon/geocode could not be resolved to point
	if (areas.length > 0 && tokens.length === 0) {
		return {
			matched: true,
			method: 'country_only',
			uncertain: true,
			note: `Zone-only alert (${areas.map((a) => a.areaDesc).filter(Boolean).join(', ') || options.countryCode || 'national'}); verify affected districts in text`,
		};
	}

	return {
		matched: false,
		method: 'area_name',
		uncertain: true,
		note: 'Zone-only alert did not match local area tokens',
	};
}

/**
 * Coarse Malaysian state/region bounding anchors used to match MET Malaysia bilingual
 * textual warnings (`api.data.gov.my/weather/warning`) to Peninsular, Sabah, Sarawak, Labuan, and waters.
 */
const MALAYSIA_REGION_ANCHORS: ReadonlyArray<{
	tokens: readonly string[];
	minLat: number;
	maxLat: number;
	minLng: number;
	maxLng: number;
}> = [
	{ tokens: ['sabah', 'kota kinabalu', 'sandakan', 'tawau', 'kudat', 'west coast', 'interior'], minLat: 4.0, maxLat: 7.5, minLng: 115.0, maxLng: 119.5 },
	{ tokens: ['sarawak', 'kuching', 'miri', 'sibu', 'bintulu', 'limbang'], minLat: 0.8, maxLat: 5.0, minLng: 109.5, maxLng: 115.7 },
	{ tokens: ['labuan'], minLat: 5.15, maxLat: 5.4, minLng: 115.1, maxLng: 115.35 },
	{ tokens: ['perlis', 'kedah', 'langkawi', 'penang', 'pulau pinang', 'perak'], minLat: 3.6, maxLat: 6.75, minLng: 99.6, maxLng: 101.8 },
	{ tokens: ['kelantan', 'terengganu', 'pahang', 'tioman'], minLat: 2.4, maxLat: 6.3, minLng: 101.4, maxLng: 104.3 },
	{ tokens: ['selangor', 'kuala lumpur', 'putrajaya', 'negeri sembilan', 'melaka', 'johor'], minLat: 1.2, maxLat: 3.85, minLng: 100.7, maxLng: 104.5 },
	{ tokens: ['malaysian waters', 'perairan malaysia', 'straits of melaka', 'selat melaka', 'south china sea', 'laut china selatan', 'sulu', 'reef'], minLat: 0.5, maxLat: 8.5, minLng: 98.0, maxLng: 120.5 },
];

export function matchMalaysiaWarningText(
	lat: number,
	lng: number,
	combinedText: string,
): GeoMatchResult {
	const lower = combinedText.toLowerCase();
	const matchedRegions: string[] = [];

	for (const region of MALAYSIA_REGION_ANCHORS) {
		const insideBox =
			lat >= region.minLat &&
			lat <= region.maxLat &&
			lng >= region.minLng &&
			lng <= region.maxLng;
		if (!insideBox) continue;
		const hitToken = region.tokens.find((tok) => lower.includes(tok));
		if (hitToken) {
			matchedRegions.push(hitToken);
		}
	}

	if (matchedRegions.length > 0) {
		return {
			matched: true,
			method: 'area_name',
			uncertain: true,
			note: `Textual region match (${matchedRegions[0]}) — MET Malaysia open API publishes named states/waters without polygon geometry`,
		};
	}

	// If warning covers nationwide / general Malaysia without specific state tokens
	if (lower.includes('malaysia') && !MALAYSIA_REGION_ANCHORS.some((r) => r.tokens.some((t) => lower.includes(t)))) {
		return {
			matched: true,
			method: 'country_only',
			uncertain: true,
			note: 'National MET Malaysia notice; verify affected state in text',
		};
	}

	return {
		matched: false,
		method: 'area_name',
		uncertain: true,
		note: 'Warning text targets other Malaysian states/waters',
	};
}
