/**
 * Two-stage coarse-first geolocation helper for both desktop Wi-Fi/IP providers and mobile GPS,
 * plus border/distance uncertainty checks so official warning queries never overclaim country
 * authority near international borders or remote ocean/desert points.
 */
import { OFFLINE_GAZETTEER, type GazetteerEntry } from '../../../shared/gazetteer';
import { formatCoordinatesLtr, type SelectedPlace } from './places';

export interface GeolocationFix {
	latitude: number;
	longitude: number;
	accuracy: number;
	timestamp: number;
	stage: 'coarse' | 'precise';
}

export type GeolocationFailureCode = 'insecure_context' | 'unsupported' | 'permission_denied' | 'timeout' | 'unavailable';

export type GeolocationAcquireResult =
	| { ok: true; fix: GeolocationFix }
	| { ok: false; code: GeolocationFailureCode };

function requestPositionOnce(
	geo: Pick<Geolocation, 'getCurrentPosition'>,
	stage: 'coarse' | 'precise',
	options: PositionOptions,
): Promise<{ ok: true; fix: GeolocationFix } | { ok: false; code: 'permission_denied' | 'timeout' | 'unavailable' }> {
	return new Promise((resolve) => {
		geo.getCurrentPosition(
			(pos) => {
				resolve({
					ok: true,
					fix: {
						latitude: pos.coords.latitude,
						longitude: pos.coords.longitude,
						accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : 10_000,
						timestamp: pos.timestamp || Date.now(),
						stage,
					},
				});
			},
			(err) => {
				if (err.code === 1) resolve({ ok: false, code: 'permission_denied' });
				else if (err.code === 3) resolve({ ok: false, code: 'timeout' });
				else resolve({ ok: false, code: 'unavailable' });
			},
			options,
		);
	});
}

export async function acquireUserLocation(options: {
	geo?: Pick<Geolocation, 'getCurrentPosition'> | null;
	isSecureContext?: boolean;
	skipRefinement?: boolean;
	coarseTimeoutMs?: number;
	preciseTimeoutMs?: number;
	onCoarseFix?: (fix: GeolocationFix) => void;
} = {}): Promise<GeolocationAcquireResult> {
	const secure = options.isSecureContext ?? (typeof window === 'undefined' || window.isSecureContext !== false);
	if (!secure) {
		return { ok: false, code: 'insecure_context' };
	}
	const geo =
		options.geo !== undefined
			? options.geo
			: typeof navigator !== 'undefined' && 'geolocation' in navigator
				? navigator.geolocation
				: null;
	if (!geo || typeof geo.getCurrentPosition !== 'function') {
		return { ok: false, code: 'unsupported' };
	}

	const coarseRes = await requestPositionOnce(geo, 'coarse', {
		enableHighAccuracy: false,
		timeout: options.coarseTimeoutMs ?? 6000,
		maximumAge: 300_000,
	});

	if (coarseRes.ok) {
		if (coarseRes.fix.accuracy <= 5000 || options.skipRefinement) {
			return coarseRes;
		}
		options.onCoarseFix?.(coarseRes.fix);
		const preciseRes = await requestPositionOnce(geo, 'precise', {
			enableHighAccuracy: true,
			timeout: options.preciseTimeoutMs ?? 9000,
			maximumAge: 0,
		});
		if (preciseRes.ok && preciseRes.fix.accuracy < coarseRes.fix.accuracy) {
			return preciseRes;
		}
		return coarseRes;
	}

	if (coarseRes.code === 'permission_denied') {
		return coarseRes;
	}

	// Stage 1 failed without denial (e.g. desktop OS returned POSITION_UNAVAILABLE on coarse): try high-accuracy fallback once
	const fallbackRes = await requestPositionOnce(geo, 'precise', {
		enableHighAccuracy: true,
		timeout: options.preciseTimeoutMs ?? 10_000,
		maximumAge: 0,
	});
	return fallbackRes;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const rad = Math.PI / 180;
	const dLat = (lat2 - lat1) * rad;
	const dLng = (lng2 - lng1) * rad;
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
	return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function resolveGpsPlaceWithUncertainty(
	latitude: number,
	longitude: number,
	accuracyMeters: number | null,
	timestampMs: number,
): { place: SelectedPlace; countryUncertain: boolean; nearestHintCountry: string | null } {
	const ranked: Array<{ entry: GazetteerEntry; km: number }> = OFFLINE_GAZETTEER.map((entry) => ({
		entry,
		km: haversineKm(latitude, longitude, entry.lat, entry.lng),
	})).sort((a, b) => a.km - b.km);

	const nearest = ranked[0] ?? null;
	const secondDiffCountry = nearest
		? ranked.find((item) => item.entry.countryCode !== nearest.entry.countryCode) ?? null
		: null;

	const tooFarFromAnchor = !nearest || nearest.km > 250;
	const nearInternationalBorder = Boolean(
		nearest && secondDiffCountry && secondDiffCountry.km - nearest.km <= 60,
	);
	const extremeCoarseAccuracy = accuracyMeters !== null && accuracyMeters > 25_000;

	const countryUncertain = tooFarFromAnchor || nearInternationalBorder || extremeCoarseAccuracy;
	const resolvedCountryCode = countryUncertain || !nearest ? null : nearest.entry.countryCode;
	const resolvedCountryName = countryUncertain || !nearest ? null : nearest.entry.country;
	const nearestHintCountry = nearest && nearest.km <= 250 ? nearest.entry.country : null;

	const place: SelectedPlace = {
		id: `gps:${latitude.toFixed(4)}:${longitude.toFixed(4)}`,
		label: `${resolvedCountryName ? `${resolvedCountryName} · ` : ''}${formatCoordinatesLtr(latitude, longitude)}`,
		lat: latitude,
		lng: longitude,
		countryCode: resolvedCountryCode,
		countryName: resolvedCountryName,
		source: 'gps',
		accuracyMeters: accuracyMeters !== null && Number.isFinite(accuracyMeters) ? Math.round(accuracyMeters) : null,
		capturedAt: new Date(timestampMs || Date.now()).toISOString(),
	};

	return { place, countryUncertain, nearestHintCountry };
}
