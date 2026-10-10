import { describe, it, expect } from 'vitest';
import {
	computeTleChecksum,
	loadMonitoredTles,
	MONITORED_NORAD_IDS,
	parseProviderTle,
	parseTleEpoch,
	readTleCache,
	serializeTles,
	TLE_CACHE_KEY,
	TLE_FETCH_TIMEOUT_MS,
	TLE_REFRESH_BACKOFF_MS,
	TLE_SCHEDULED_REFRESH_AFTER_MS,
	validateTleRecord,
	writeTleCache,
	CachedTleRecord,
} from '../src/satellites';
import { makeTle, memoryKv, withChecksum } from './helpers';

const L8_1 = '1 39084U 13008A   26282.90944219  .00000228  00000+0  60785-4 0  9995';
const L8_2 = '2 39084  98.2190 351.6114 0001302  94.7208 265.4139 14.57110728714606';
const NOW = new Date('2026-10-10T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const NAMES: Record<number, string> = {
	39084: 'LANDSAT 8',
	49260: 'LANDSAT 9',
	40697: 'SENTINEL-2A',
	42063: 'SENTINEL-2B',
	25994: 'TERRA',
	27424: 'AQUA',
};

function tleText(id: number, epoch = new Date(NOW.getTime() - 6 * HOUR)): string {
	return makeTle(id, NAMES[id], epoch).join('\r\n') + '\r\n';
}

function cachedDoc(fetchedAt: Date, ids: readonly number[] = MONITORED_NORAD_IDS, epoch = new Date(NOW.getTime() - 20 * HOUR)): string {
	const records = new Map<number, CachedTleRecord>();
	for (const id of ids) {
		const [name, line1, line2] = makeTle(id, NAMES[id], epoch);
		records.set(id, { noradId: id, name, line1, line2, epoch: epoch.toISOString(), fetchedAt: fetchedAt.toISOString() });
	}
	return writeTleCache(records, null);
}

function celestrak(handler: (id: number) => Response | Promise<Response>) {
	const calls: number[] = [];
	const fetchImpl = async (url: string) => {
		const id = Number(new URL(url).searchParams.get('CATNR'));
		calls.push(id);
		return handler(id);
	};
	return { fetchImpl, calls };
}

/** Exact bytes returned by CelesTrak gp.php?CATNR=25994&FORMAT=tle on 2026-10-10 (HTTP 200, text/plain). */
const CAPTURED_TERRA =
	'TERRA                   \r\n1 25994U 99068A   26282.93987331  .00000272  00000+0  64302-4 0  9993\r\n2 25994  97.9326 327.8638 0001614 190.9180 292.5402 14.61172684426369\r\n';

describe('captured CelesTrak response', () => {
	it('is accepted by the production validator', () => {
		const result = parseProviderTle(CAPTURED_TERRA, 25994, new Date('2026-10-10T09:40:00Z'));
		expect(result.valid).toBe(true);
		expect(result.record).toMatchObject({ noradId: 25994, name: 'TERRA', epoch: '2026-10-09T22:33:25.053Z' });
	});

	it('rejects a provider error page and the wrong object', () => {
		expect(parseProviderTle('No GP data found', 25994, NOW).valid).toBe(false);
		expect(parseProviderTle('<html><body>Service Unavailable</body></html>', 25994, NOW).valid).toBe(false);
		expect(parseProviderTle(CAPTURED_TERRA, 27424, NOW).reason).toBe('Expected NORAD 27424, got 25994');
	});
});

describe('TLE checksum and epoch', () => {
	it('matches published NORAD checksums', () => {
		expect(computeTleChecksum(L8_1)).toBe(5);
		expect(computeTleChecksum(L8_2)).toBe(6);
		expect(computeTleChecksum('1 40697U 15028A   26282.89996329 -.00000069  00000+0 -96827-5 0  9990')).toBe(0);
	});

	it('parses the line-1 epoch as UTC', () => {
		expect(parseTleEpoch(L8_1)?.toISOString()).toBe('2026-10-09T21:49:35.805Z');
		expect(parseTleEpoch(L8_1.slice(0, 18) + '26400.00000000' + L8_1.slice(32))).toBeNull();
		expect(parseTleEpoch(L8_1.slice(0, 18) + '26ABC.00000000' + L8_1.slice(32))).toBeNull();
	});
});

describe('TLE record validation', () => {
	it('accepts a correct record for the requested NORAD ID', () => {
		const res = validateTleRecord(['LANDSAT 8', L8_1, L8_2], { expectedNoradId: 39084, now: NOW });
		expect(res.valid).toBe(true);
		expect(res.record).toMatchObject({ noradId: 39084, name: 'LANDSAT 8', epoch: '2026-10-09T21:49:35.805Z' });
	});

	it('rejects a record for a different NORAD ID than requested', () => {
		const res = validateTleRecord(['LANDSAT 8', L8_1, L8_2], { expectedNoradId: 49260, now: NOW });
		expect(res).toMatchObject({ valid: false });
		expect(res.reason).toContain('Expected NORAD 49260');
	});

	it('requires exactly 69-column element lines with a column-69 checksum', () => {
		expect(validateTleRecord(['LANDSAT 8', L8_1.slice(0, 68), L8_2], { now: NOW }).valid).toBe(false);
		expect(validateTleRecord(['LANDSAT 8', `${L8_1}0`, L8_2], { now: NOW }).valid).toBe(false);
		expect(validateTleRecord(['LANDSAT 8', `${L8_1.slice(0, 68)}9`, L8_2], { now: NOW }).valid).toBe(false);
		expect(validateTleRecord(['LANDSAT 8', `${L8_1.slice(0, 68)}X`, L8_2], { now: NOW }).valid).toBe(false);
	});

	it('rejects mismatched pairs, swapped lines, missing names, and extra records', () => {
		const otherLine2 = withChecksum(`2 49260${L8_2.slice(7, 68)}`);
		expect(validateTleRecord(['X', L8_1, otherLine2], { now: NOW }).valid).toBe(false);
		expect(validateTleRecord(['X', L8_2, L8_1], { now: NOW }).valid).toBe(false);
		expect(validateTleRecord(['', L8_1, L8_2], { now: NOW }).valid).toBe(false);
		expect(validateTleRecord([L8_1, L8_2], { now: NOW }).valid).toBe(false);
		expect(parseProviderTle(['LANDSAT 8', L8_1, L8_2, 'LANDSAT 8', L8_1, L8_2].join('\n'), 39084, NOW).valid).toBe(false);
		expect(parseProviderTle('No GP data found', 39084, NOW).valid).toBe(false);
	});

	it('applies the epoch age policy (7 days old max, no far-future epochs)', () => {
		const old = makeTle(39084, 'LANDSAT 8', new Date(NOW.getTime() - 8 * 24 * HOUR));
		const future = makeTle(39084, 'LANDSAT 8', new Date(NOW.getTime() + 2 * 24 * HOUR));
		const recent = makeTle(39084, 'LANDSAT 8', new Date(NOW.getTime() - 6 * 24 * HOUR));
		expect(validateTleRecord(old, { now: NOW }).reason).toContain('older than 7 days');
		expect(validateTleRecord(future, { now: NOW }).reason).toContain('future');
		expect(validateTleRecord(recent, { now: NOW }).valid).toBe(true);
	});
});

describe('TLE cache validation', () => {
	it('drops corrupt JSON, wrong-version documents, and invalid or mis-keyed records', () => {
		expect(readTleCache('not json', NOW)).toMatchObject({ dropped: 1 });
		expect(readTleCache(JSON.stringify({ version: 2, records: {} }), NOW).records.size).toBe(0);
		expect(readTleCache(['LANDSAT 8', L8_1, L8_2].join('\n'), NOW).records.size).toBe(0);

		const doc = JSON.parse(cachedDoc(NOW, [39084, 40697]));
		doc.records['49260'] = doc.records['39084'];
		const s2a = doc.records['40697'].line1 as string;
		doc.records['40697'].line1 = s2a.slice(0, 20) + (s2a[20] === '9' ? '8' : '9') + s2a.slice(21);
		doc.records['12345'] = doc.records['39084'];
		const read = readTleCache(JSON.stringify(doc), NOW);
		expect([...read.records.keys()]).toEqual([39084]);
		expect(read.dropped).toBe(3);
	});

	it('drops cached records whose epoch has aged past the policy', () => {
		const raw = cachedDoc(new Date(NOW.getTime() - HOUR), [39084], new Date(NOW.getTime() - 8 * 24 * HOUR));
		expect(readTleCache(raw, NOW).records.size).toBe(0);
	});
});

describe('loadMonitoredTles cache policy', () => {
	it('fetches every monitored satellite on a cold cache and stores the validated set', async () => {
		const kv = memoryKv();
		const { fetchImpl, calls } = celestrak((id) => new Response(tleText(id)));
		const result = await loadMonitoredTles(kv.kv, { now: NOW, fetchImpl });
		expect(result.status).toBe('complete');
		expect(calls.sort()).toEqual([...MONITORED_NORAD_IDS].sort());
		expect(result.refreshed).toEqual([...MONITORED_NORAD_IDS].sort((a, b) => a - b));
		expect(kv.puts).toHaveLength(1);
		expect(kv.puts[0].key).toBe(TLE_CACHE_KEY);
		const text = serializeTles(result.records);
		expect(text.split('\n')).toHaveLength(18);
		expect(text.split('\n').filter((l) => /^[12] /.test(l)).every((l) => l.length === 69)).toBe(true);
	});

	it('reports partial upstream success with the missing IDs and records the failed attempt', async () => {
		const kv = memoryKv();
		const { fetchImpl } = celestrak((id) =>
			id === 49260 ? new Response('Internal Server Error', { status: 500 }) : id === 27424 ? new Response(tleText(39084)) : new Response(tleText(id)),
		);
		const result = await loadMonitoredTles(kv.kv, { now: NOW, fetchImpl });
		expect(result.status).toBe('partial');
		expect(result.missing).toEqual([49260, 27424]);
		expect(result.failed).toEqual([27424, 49260]);
		expect(JSON.parse(kv.puts[0].value).lastFailedRefreshAt).toBe(NOW.toISOString());
	});

	it('serves a fresh cache without upstream requests', async () => {
		const kv = memoryKv({ initial: { [TLE_CACHE_KEY]: cachedDoc(new Date(NOW.getTime() - 2 * HOUR)) } });
		const { fetchImpl, calls } = celestrak(() => {
			throw new Error('should not fetch');
		});
		const result = await loadMonitoredTles(kv.kv, { now: NOW, fetchImpl });
		expect(result).toMatchObject({ status: 'complete', refreshed: [], retained: [] });
		expect(calls).toEqual([]);
	});

	it('retains valid cached elements past the refresh point when refresh fails, then backs off', async () => {
		const kv = memoryKv({ initial: { [TLE_CACHE_KEY]: cachedDoc(new Date(NOW.getTime() - 13 * HOUR)) } });
		const failing = celestrak(() => new Response('', { status: 503 }));
		const first = await loadMonitoredTles(kv.kv, { now: NOW, fetchImpl: failing.fetchImpl });
		expect(first.status).toBe('complete');
		expect(first.refreshed).toEqual([]);
		expect(first.retained).toHaveLength(MONITORED_NORAD_IDS.length);
		expect(failing.calls).toHaveLength(MONITORED_NORAD_IDS.length);

		const second = await loadMonitoredTles(kv.kv, { now: new Date(NOW.getTime() + 5 * 60 * 1000), fetchImpl: failing.fetchImpl });
		expect(second.backoffActive).toBe(true);
		expect(second.retained).toHaveLength(MONITORED_NORAD_IDS.length);
		expect(failing.calls).toHaveLength(MONITORED_NORAD_IDS.length);
	});

	it('replaces a corrupt cache entry with validated upstream data', async () => {
		const kv = memoryKv({ initial: { [TLE_CACHE_KEY]: '{"version":3,"records":{"39084":{"name":"X","line1":"garbage","line2":"garbage","fetchedAt":"2026-10-10T11:00:00Z"}}}' } });
		const { fetchImpl, calls } = celestrak((id) => new Response(tleText(id)));
		const result = await loadMonitoredTles(kv.kv, { now: NOW, fetchImpl });
		expect(calls).toContain(39084);
		expect(result.records.get(39084)?.line1).toHaveLength(69);
	});

	it('reproduces the production failure: every fetch times out, an empty cache with backoff is stored', async () => {
		const kv = memoryKv();
		const timeouts = celestrak(() => {
			throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
		});
		const first = await loadMonitoredTles(kv.kv, { now: NOW, fetchImpl: timeouts.fetchImpl });
		expect(first.records.size).toBe(0);
		expect(first.failed).toEqual([...MONITORED_NORAD_IDS].sort((a, b) => a - b));
		expect(first.nextAttemptAt).toBe(new Date(NOW.getTime() + TLE_REFRESH_BACKOFF_MS).toISOString());
		expect(JSON.parse(kv.puts[0].value)).toEqual({ version: 3, records: {}, lastFailedRefreshAt: NOW.toISOString() });

		const held = await loadMonitoredTles(kv.kv, { now: new Date(NOW.getTime() + 5 * 60 * 1000), fetchImpl: timeouts.fetchImpl });
		expect(held).toMatchObject({ backoffActive: true, failed: [], nextAttemptAt: first.nextAttemptAt });
		expect(timeouts.calls).toHaveLength(MONITORED_NORAD_IDS.length);

		const recovered = celestrak((id) => new Response(tleText(id)));
		const later = await loadMonitoredTles(kv.kv, { now: new Date(NOW.getTime() + TLE_REFRESH_BACKOFF_MS + 1000), fetchImpl: recovered.fetchImpl });
		expect(later).toMatchObject({ status: 'complete', backoffActive: false, nextAttemptAt: null });
		expect(recovered.calls).toHaveLength(MONITORED_NORAD_IDS.length);
	});

	it('uses a fetch timeout longer than the observed CelesTrak latency', () => {
		expect(TLE_FETCH_TIMEOUT_MS).toBeGreaterThan(14_300);
	});

	it('scheduled refresh renews records the request path still treats as fresh', async () => {
		const doc = cachedDoc(new Date(NOW.getTime() - 6 * HOUR));
		const requestPath = celestrak(() => {
			throw new Error('should not fetch');
		});
		const viaRequest = await loadMonitoredTles(memoryKv({ initial: { [TLE_CACHE_KEY]: doc } }).kv, { now: NOW, fetchImpl: requestPath.fetchImpl });
		expect(viaRequest.refreshed).toEqual([]);

		const scheduled = celestrak((id) => new Response(tleText(id)));
		const viaCron = await loadMonitoredTles(memoryKv({ initial: { [TLE_CACHE_KEY]: doc } }).kv, {
			now: NOW,
			fetchImpl: scheduled.fetchImpl,
			refreshAfterMs: TLE_SCHEDULED_REFRESH_AFTER_MS,
		});
		expect(viaCron.refreshed).toHaveLength(MONITORED_NORAD_IDS.length);
	});

	it('still serves upstream data when KV get and put reject', async () => {
		const kv = memoryKv({ failGet: true, failPut: true });
		const { fetchImpl } = celestrak((id) => new Response(tleText(id)));
		const result = await loadMonitoredTles(kv.kv, { now: NOW, fetchImpl });
		expect(result.status).toBe('complete');
		expect(kv.puts).toHaveLength(1);
	});
});
