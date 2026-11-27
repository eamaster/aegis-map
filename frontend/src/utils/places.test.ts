import { describe, expect, it } from 'vitest';
import {
	deleteSavedPlace,
	loadSavedPlaces,
	parseFlexibleCoordinates,
	searchPlaces,
	upsertSavedPlace,
} from './places';

function memoryStorage(): Storage {
	const store = new Map<string, string>();
	return {
		get length() {
			return store.size;
		},
		clear() {
			store.clear();
		},
		getItem(key: string) {
			return store.get(key) ?? null;
		},
		key(index: number) {
			return Array.from(store.keys())[index] ?? null;
		},
		removeItem(key: string) {
			store.delete(key);
		},
		setItem(key: string, value: string) {
			store.set(key, value);
		},
	};
}

describe('places utilities', () => {
	it('parses decimal and cardinal coordinates and rejects out-of-range values', () => {
		expect(parseFlexibleCoordinates('5.9804, 116.0735')).toEqual({ ok: true, lat: 5.9804, lng: 116.0735 });
		expect(parseFlexibleCoordinates('33.8688S 151.2093E')).toEqual({ ok: true, lat: -33.8688, lng: 151.2093 });
		expect(parseFlexibleCoordinates('95, 10').ok).toBe(false);
		expect(parseFlexibleCoordinates('hello').ok).toBe(false);
	});

	it('falls back to built-in offline gazetteer when geocoding fails (including East Malaysia, Norway, Iran, India)', async () => {
		const res = await searchPlaces('Kota Kinabalu', {
			fetchImpl: async () => {
				throw new Error('offline');
			},
		});
		expect(res.usedOfflineFallback).toBe(true);
		expect(res.candidates.length).toBeGreaterThan(0);
		expect(res.candidates[0].countryCode).toBe('MY');
		expect(res.candidates[0].admin1).toBe('Sabah');

		const ambig = await searchPlaces('George Town', {
			fetchImpl: async () => {
				throw new Error('offline');
			},
		});
		expect(ambig.usedOfflineFallback).toBe(true);
		expect(ambig.candidates[0].countryCode).toBe('MY');
	});

	it('saves and deletes multiple places locally', () => {
		const storage = memoryStorage();
		upsertSavedPlace(
			{
				id: 'p1',
				label: 'Oslo, Norway',
				lat: 59.91,
				lng: 10.75,
				countryCode: 'NO',
				countryName: 'Norway',
				source: 'search',
			},
			storage,
		);
		upsertSavedPlace(
			{
				id: 'p2',
				label: 'Kuching, Sarawak, Malaysia',
				lat: 1.55,
				lng: 110.35,
				countryCode: 'MY',
				countryName: 'Malaysia',
				source: 'offline_gazetteer',
			},
			storage,
		);
		expect(loadSavedPlaces(storage)).toHaveLength(2);
		deleteSavedPlace('p1', storage);
		const remaining = loadSavedPlaces(storage);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].id).toBe('p2');
	});
});
