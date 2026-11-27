import { apiUrl } from '../config/api';
import type { WarningsApiResponse } from '../../../shared/contracts';
import { loadCachedWarnings, saveCachedWarnings, type OfflineWarningsState } from './offlineCache';

export interface WarningsFetchResult {
	data: WarningsApiResponse | null;
	offlineState: OfflineWarningsState;
	networkError: string | null;
}

export async function fetchOfficialWarnings(options: {
	lat: number;
	lng: number;
	countryCode: string | null;
	signal?: AbortSignal;
}): Promise<WarningsFetchResult> {
	const params = new URLSearchParams({
		lat: String(options.lat),
		lng: String(options.lng),
	});
	if (options.countryCode) {
		params.set('country', options.countryCode);
	}
	const url = apiUrl(`/api/v1/warnings?${params.toString()}`);

	try {
		const res = await fetch(url, { signal: options.signal });
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}
		const payload = (await res.json()) as WarningsApiResponse;
		if (!payload || payload.version !== 1 || !Array.isArray(payload.warnings) || !Array.isArray(payload.sources)) {
			throw new Error('Malformed warnings response');
		}
		saveCachedWarnings(options.lat, options.lng, options.countryCode, payload);
		return {
			data: payload,
			offlineState: {
				status: 'live',
				entry: {
					cacheKey: '',
					cachedAt: payload.query.checkedAt,
					payload,
				},
				expiredWarningIds: [],
			},
			networkError: null,
		};
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			throw err;
		}
		const cached = loadCachedWarnings(options.lat, options.lng, options.countryCode);
		return {
			data: cached.entry?.payload ?? null,
			offlineState: cached,
			networkError: err instanceof Error ? err.message : 'Network unavailable',
		};
	}
}
