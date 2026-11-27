/**
 * Place search, coordinate parsing, GPS capture state, jurisdiction separation,
 * and local saved-places storage.
 */
import {
	inferNearestGazetteerCountry,
	searchOfflineGazetteer,
	type GazetteerEntry,
} from '../../../shared/gazetteer';

export interface SelectedPlace {
	id: string;
	label: string;
	lat: number;
	lng: number;
	countryCode: string | null;
	countryName: string | null;
	admin1?: string | null;
	timezone?: string | null;
	source: 'search' | 'offline_gazetteer' | 'manual' | 'gps';
	accuracyMeters?: number | null;
	capturedAt?: string | null;
}

export type PlaceSearchResult = {
	candidates: SelectedPlace[];
	usedOfflineFallback: boolean;
	errorNote?: string;
};

export const SAVED_PLACES_STORAGE_KEY = 'aegis:saved-places:v1';
export const PRESENT_JURISDICTION_STORAGE_KEY = 'aegis:present-jurisdiction:v1';

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/**
 * Parse decimal ("5.9804, 116.0735") or cardinal ("5.98N 116.07E", "33.8S, 151.2E") coordinates.
 */
export function parseFlexibleCoordinates(
	rawInput: string,
): { ok: true; lat: number; lng: number } | { ok: false; reason: string } {
	const cleaned = rawInput.trim();
	if (!cleaned) return { ok: false, reason: 'Enter latitude and longitude.' };

	const cardinalMatch =
		/^\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSns])\s*[,;\s]+\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EWew])\s*$/.exec(
			cleaned,
		);
	if (cardinalMatch) {
		let lat = Number(cardinalMatch[1]);
		let lng = Number(cardinalMatch[3]);
		if (cardinalMatch[2].toUpperCase() === 'S') lat = -Math.abs(lat);
		if (cardinalMatch[4].toUpperCase() === 'W') lng = -Math.abs(lng);
		if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
			return { ok: false, reason: 'Latitude must be in [-90, 90] and longitude in [-180, 180].' };
		}
		return { ok: true, lat, lng };
	}

	const decimalMatch = /^\s*([+-]?\d+(?:\.\d+)?)\s*[,;\s]+\s*([+-]?\d+(?:\.\d+)?)\s*$/.exec(cleaned);
	if (!decimalMatch) {
		return { ok: false, reason: 'Use "lat, lng" decimal degrees (e.g. 5.9804, 116.0735) or cardinal N/S E/W.' };
	}
	const lat = Number(decimalMatch[1]);
	const lng = Number(decimalMatch[2]);
	if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
		return { ok: false, reason: 'Latitude must be in [-90, 90] and longitude in [-180, 180].' };
	}
	return { ok: true, lat, lng };
}

export function gazetteerEntryToPlace(entry: GazetteerEntry): SelectedPlace {
	return {
		id: `gaz:${entry.id}`,
		label: entry.admin1 && entry.admin1 !== entry.name
			? `${entry.name}, ${entry.admin1}, ${entry.country}`
			: `${entry.name}, ${entry.country}`,
		lat: entry.lat,
		lng: entry.lng,
		countryCode: entry.countryCode,
		countryName: entry.country,
		admin1: entry.admin1 ?? null,
		timezone: entry.timezone,
		source: 'offline_gazetteer',
	};
}

export function buildManualPlace(lat: number, lng: number, explicitCountryCode?: string | null): SelectedPlace {
	const nearest = inferNearestGazetteerCountry(lat, lng);
	const countryCode = explicitCountryCode ? explicitCountryCode.toUpperCase() : nearest?.countryCode ?? null;
	const countryName = explicitCountryCode ? explicitCountryCode.toUpperCase() : nearest?.country ?? null;
	return {
		id: `coord:${lat.toFixed(4)}:${lng.toFixed(4)}`,
		label: `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`,
		lat,
		lng,
		countryCode,
		countryName,
		source: 'manual',
		capturedAt: new Date().toISOString(),
	};
}

export async function searchPlaces(
	query: string,
	options: { language?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<PlaceSearchResult> {
	const trimmed = query.trim();
	if (!trimmed) {
		return { candidates: [], usedOfflineFallback: false };
	}

	const coordCheck = parseFlexibleCoordinates(trimmed);
	if (coordCheck.ok) {
		return {
			candidates: [buildManualPlace(coordCheck.lat, coordCheck.lng)],
			usedOfflineFallback: false,
		};
	}

	const doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
	const lang = options.language === 'fa' || options.language === 'ms' ? options.language : 'en';
	const url = `${GEOCODE_URL}?name=${encodeURIComponent(trimmed)}&count=8&language=${lang}&format=json`;

	try {
		const res = await doFetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 6000) });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = (await res.json()) as {
			results?: Array<{
				id?: number;
				name?: string;
				latitude?: number;
				longitude?: number;
				country_code?: string;
				country?: string;
				admin1?: string;
				timezone?: string;
			}>;
		};
		const results = Array.isArray(body.results) ? body.results : [];
		const candidates: SelectedPlace[] = results
			.filter(
				(r) =>
					typeof r.name === 'string' &&
					typeof r.latitude === 'number' &&
					typeof r.longitude === 'number' &&
					Number.isFinite(r.latitude) &&
					Number.isFinite(r.longitude),
			)
			.map((r) => ({
				id: `om:${r.id ?? `${r.latitude}:${r.longitude}`}`,
				label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
				lat: r.latitude!,
				lng: r.longitude!,
				countryCode: typeof r.country_code === 'string' ? r.country_code.toUpperCase() : null,
				countryName: typeof r.country === 'string' ? r.country : null,
				admin1: typeof r.admin1 === 'string' ? r.admin1 : null,
				timezone: typeof r.timezone === 'string' ? r.timezone : null,
				source: 'search',
			}));

		if (candidates.length > 0) {
			return { candidates, usedOfflineFallback: false };
		}
		// If live geocoder returns empty, augment with offline directory matches if any
		const offline = searchOfflineGazetteer(trimmed).map(gazetteerEntryToPlace);
		return {
			candidates: offline,
			usedOfflineFallback: offline.length > 0,
		};
	} catch {
		const offline = searchOfflineGazetteer(trimmed).map(gazetteerEntryToPlace);
		return {
			candidates: offline,
			usedOfflineFallback: true,
			errorNote: 'Live geocoding unavailable',
		};
	}
}

export function loadSavedPlaces(storage?: Pick<Storage, 'getItem'> | null): SelectedPlace[] {
	const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
	if (!target) return [];
	try {
		const raw = target.getItem(SAVED_PLACES_STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(p): p is SelectedPlace =>
				Boolean(p) &&
				typeof p.id === 'string' &&
				typeof p.label === 'string' &&
				typeof p.lat === 'number' &&
				typeof p.lng === 'number' &&
				Number.isFinite(p.lat) &&
				Number.isFinite(p.lng),
		);
	} catch {
		return [];
	}
}

export function savePlacesList(places: SelectedPlace[], storage?: Pick<Storage, 'setItem'> | null): void {
	const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
	if (!target) return;
	try {
		target.setItem(SAVED_PLACES_STORAGE_KEY, JSON.stringify(places.slice(0, 20)));
	} catch {
		// Ignore storage quota errors
	}
}

export function upsertSavedPlace(
	place: SelectedPlace,
	storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
): SelectedPlace[] {
	const existing = loadSavedPlaces(storage);
	const deduped = existing.filter(
		(p) =>
			p.id !== place.id &&
			!(Math.abs(p.lat - place.lat) < 0.001 && Math.abs(p.lng - place.lng) < 0.001),
	);
	const next = [place, ...deduped].slice(0, 20);
	savePlacesList(next, storage);
	return next;
}

export function deleteSavedPlace(
	placeId: string,
	storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
): SelectedPlace[] {
	const next = loadSavedPlaces(storage).filter((p) => p.id !== placeId);
	savePlacesList(next, storage);
	return next;
}

export function formatCoordinatesLtr(lat: number, lng: number): string {
	const ns = lat >= 0 ? 'N' : 'S';
	const ew = lng >= 0 ? 'E' : 'W';
	return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew}`;
}
