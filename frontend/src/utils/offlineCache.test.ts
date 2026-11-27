import { describe, expect, it } from 'vitest';
import type { WarningsApiResponse } from '../../../shared/contracts';
import {
	clearAllLocalResidentData,
	loadCachedWarnings,
	saveCachedWarnings,
} from './offlineCache';

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

describe('offlineCache', () => {
	const samplePayload: WarningsApiResponse = {
		version: 1,
		query: { lat: 59.91, lng: 10.75, countryCode: 'NO', checkedAt: '2026-11-27T10:00:00.000Z' },
		coverageStatus: 'active_warnings',
		coverageExplanation: 'Active warning',
		warnings: [
			{
				id: 'w1',
				identifier: '2.49.0.1.578.1',
				sourceId: 'no-metalerts',
				issuerName: 'MET Norway',
				issuerUrl: 'https://www.met.no',
				countryCode: 'NO',
				msgType: 'Alert',
				lifecycleState: 'active',
				category: 'Met',
				severity: 'moderate',
				urgency: 'Expected',
				certainty: 'Likely',
				sentAt: '2026-11-27T09:00:00.000Z',
				effectiveAt: null,
				onsetAt: '2026-11-27T10:00:00.000Z',
				expiresAt: '2026-11-27T18:00:00.000Z',
				missingExpiry: false,
				clockSkewFlag: false,
				matchMethod: 'polygon',
				matchUncertain: false,
				matchNote: 'Inside polygon',
				primaryLanguage: 'no',
				translations: [
					{
						language: 'no',
						headline: 'Kuling',
						event: 'Gale',
						description: 'Strong wind',
						instruction: 'Stay safe',
						areaDesc: 'Oslo',
						web: 'https://www.met.no',
					},
				],
				bulletinUrl: 'https://www.met.no',
				attribution: 'MET Norway',
			},
		],
		sources: [],
	};

	it('distinguishes empty first visit, cached valid, cached expired, and local data removal', async () => {
		const storage = memoryStorage();

		// 1. Empty first visit
		expect(loadCachedWarnings(59.91, 10.75, 'NO', storage).status).toBe('empty_offline');

		// 2. Cached valid
		saveCachedWarnings(59.91, 10.75, 'NO', samplePayload, storage, Date.parse('2026-11-27T11:00:00.000Z'));
		const valid = loadCachedWarnings(59.91, 10.75, 'NO', storage, Date.parse('2026-11-27T12:00:00.000Z'));
		expect(valid.status).toBe('cached_valid');
		expect(valid.expiredWarningIds).toEqual([]);

		// 3. Cached expired
		const expired = loadCachedWarnings(59.91, 10.75, 'NO', storage, Date.parse('2026-11-27T19:00:00.000Z'));
		expect(expired.status).toBe('cached_expired');
		expect(expired.expiredWarningIds).toEqual(['w1']);

		// 4. Local data wipe
		await clearAllLocalResidentData(storage);
		expect(loadCachedWarnings(59.91, 10.75, 'NO', storage).status).toBe('empty_offline');
	});
});
