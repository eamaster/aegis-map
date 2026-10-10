import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { EONET_QUERIES, USGS_URL } from '../src/disasters';
import { buildFirmsBboxes, buildFirmsCacheKey, planFirmsWindows } from '../src/firms';
import { CachedTleRecord, MONITORED_NORAD_IDS, TLE_CACHE_KEY, writeTleCache } from '../src/satellites';
import { refreshTlesScheduled } from '../src/index';
import { callWorker, csvResponse, FIRMS_HEADER, makeTle, memoryKv, withFetch } from './helpers';

const ORIGIN = { Origin: 'https://hesam.me' };
const isEonet = (url: string) => EONET_QUERIES.some((q) => q.url === url);
const MAP_KEY = 'route-test-map-key';
// The route plans windows from the real clock, so the fixture row uses today's UTC date.
const ROW = `45.80000,38.00000,340.10,0.39,0.36,${planFirmsWindows(new Date())[0].endDate},1026,N,VIIRS,n,2.0NRT,290.00,7.50,D`;

/** One detection in the recent window, a valid empty prior window. */
const firmsOk = (url: string) => csvResponse(url.includes('/5/') ? [FIRMS_HEADER, ROW].join('\n') : `${FIRMS_HEADER}\n`);

const firmsKeyFor = (lat: number, lng: number) => {
	const [recent, prior] = planFirmsWindows(new Date());
	return buildFirmsCacheKey(buildFirmsBboxes(lat, lng), prior.startDate, recent.endDate);
};

describe('GET /api/fire-hotspots', () => {
	it('returns 400 for missing, prefix-numeric, and out-of-range coordinates', async () => {
		const missing = await SELF.fetch('http://example.com/api/fire-hotspots?lat=45.0');
		expect(missing.status).toBe(400);
		const prefix = await SELF.fetch('http://example.com/api/fire-hotspots?lat=45garbage&lng=10');
		expect(prefix.status).toBe(400);
		const range = await SELF.fetch('http://example.com/api/fire-hotspots?lat=95.0&lng=10.0');
		expect(range.status).toBe(400);
	});

	it('keeps CORS headers on validation errors', async () => {
		const res = await SELF.fetch('http://example.com/api/fire-hotspots?lat=invalid&lng=10.0', { headers: ORIGIN });
		expect(res.status).toBe(400);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://hesam.me');
	});

	it('reports a missing MAP_KEY as 503 not-configured, not as empty data', async () => {
		const kv = memoryKv();
		const res = await callWorker('/api/fire-hotspots?lat=45.72&lng=37.95', { AEGIS_CACHE: kv.kv, FIRMS_MAP_KEY: '' });
		expect(res.status).toBe(503);
		expect(await res.json()).toMatchObject({ code: 'firms_not_configured' });
	});

	it('returns 502 and caches nothing when both windows fail', async () => {
		const kv = memoryKv();
		const { result: res } = await withFetch(
			() => new Response('bad gateway', { status: 502 }),
			() => callWorker('/api/fire-hotspots?lat=45.72&lng=37.95', { AEGIS_CACHE: kv.kv, FIRMS_MAP_KEY: MAP_KEY }),
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { code: string; coverage: { status: string } };
		expect(body.code).toBe('firms_unavailable');
		expect(body.coverage.status).toBe('unavailable');
		expect(kv.puts).toEqual([]);
	});

	it('returns 502 for malformed 200 responses', async () => {
		const kv = memoryKv();
		const { result: res } = await withFetch(
			() => new Response('<html><body>Error</body></html>', { status: 200 }),
			() => callWorker('/api/fire-hotspots?lat=45.72&lng=37.95', { AEGIS_CACHE: kv.kv, FIRMS_MAP_KEY: MAP_KEY }),
		);
		expect(res.status).toBe(502);
		expect(kv.puts).toEqual([]);
	});

	it('labels one failed window as partial and does not cache it', async () => {
		const kv = memoryKv();
		const { result: res } = await withFetch(
			(url) => (url.includes('/2/') ? new Response('', { status: 500 }) : csvResponse([FIRMS_HEADER, ROW].join('\n'))),
			() => callWorker('/api/fire-hotspots?lat=45.72&lng=37.95', { AEGIS_CACHE: kv.kv, FIRMS_MAP_KEY: MAP_KEY }),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { totalCount: number; coverage: { status: string; missingDates: string[] } };
		expect(body.coverage.status).toBe('partial');
		expect(body.coverage.missingDates).toHaveLength(2);
		expect(body.totalCount).toBe(1);
		expect(kv.puts).toEqual([]);
	});

	it('caches complete header-only results under the versioned bbox/window key', async () => {
		const kv = memoryKv();
		const { result: res, calls } = await withFetch(
			() => csvResponse(`${FIRMS_HEADER}\n`),
			() => callWorker('/api/fire-hotspots?lat=45.72&lng=37.95', { AEGIS_CACHE: kv.kv, FIRMS_MAP_KEY: MAP_KEY }, ORIGIN),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://hesam.me');
		const body = (await res.json()) as { totalCount: number; source: string; coverage: { status: string } };
		expect(body).toMatchObject({ totalCount: 0, source: 'VIIRS_SNPP_NRT', coverage: { status: 'complete' } });
		expect(calls).toHaveLength(2);
		expect(kv.puts.map((p) => p.key)).toEqual([firmsKeyFor(45.72, 37.95)]);

		const { result: again, calls: againCalls } = await withFetch(
			() => {
				throw new Error('should be served from cache');
			},
			() => callWorker('/api/fire-hotspots?lat=45.72&lng=37.95', { AEGIS_CACHE: kv.kv, FIRMS_MAP_KEY: MAP_KEY }),
		);
		expect(again.status).toBe(200);
		expect(againCalls).toEqual([]);
	});

	it('ignores legacy cache entries (pre-v4 failed-empty responses)', async () => {
		const legacy = JSON.stringify({ hotspots: [], totalCount: 0, highConfidence: 0, maxBrightness: 0, maxPower: 0 });
		const kv = memoryKv({ initial: { 'firms:45.72:37.95': legacy, [firmsKeyFor(45.72, 37.95)]: legacy } });
		const { result: res, calls } = await withFetch(firmsOk, () =>
			callWorker('/api/fire-hotspots?lat=45.72&lng=37.95', { AEGIS_CACHE: kv.kv, FIRMS_MAP_KEY: MAP_KEY }),
		);
		expect(calls).toHaveLength(2);
		const body = (await res.json()) as { totalCount: number; coverage: { status: string }; hotspots: Array<{ latitude: number; frp: number }> };
		expect(body.coverage.status).toBe('complete');
		expect(body.totalCount).toBe(1);
		expect(body.hotspots[0]).toMatchObject({ latitude: 45.8, frp: 7.5 });
	});

	it('still returns upstream data when KV get and put reject', async () => {
		const kv = memoryKv({ failGet: true, failPut: true });
		const { result: res } = await withFetch(firmsOk, () =>
			callWorker('/api/fire-hotspots?lat=45.72&lng=37.95', { AEGIS_CACHE: kv.kv, FIRMS_MAP_KEY: MAP_KEY }),
		);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { coverage: { status: string } }).coverage.status).toBe('complete');
		expect(kv.puts).toHaveLength(1);
	});
});

describe('GET /api/tles', () => {
	const names: Record<number, string> = {
		39084: 'LANDSAT 8',
		49260: 'LANDSAT 9',
		40697: 'SENTINEL-2A',
		42063: 'SENTINEL-2B',
		25994: 'TERRA',
		27424: 'AQUA',
	};
	const tleFor = (url: string) => {
		const id = Number(new URL(url).searchParams.get('CATNR'));
		return makeTle(id, names[id], new Date(Date.now() - 3 * 60 * 60 * 1000)).join('\n');
	};

	it('serves validated text/plain TLEs with complete freshness headers', async () => {
		const kv = memoryKv();
		const { result: res } = await withFetch(
			(url) => new Response(tleFor(url)),
			() => callWorker('/api/tles', { AEGIS_CACHE: kv.kv }, ORIGIN),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toContain('text/plain');
		expect(res.headers.get('X-TLE-Status')).toBe('complete');
		expect(res.headers.get('X-TLE-Missing')).toBe('');
		expect(res.headers.get('X-TLE-Refreshed')?.split(',')).toHaveLength(MONITORED_NORAD_IDS.length);
		expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-TLE-Status');
		const lines = (await res.text()).split('\n');
		expect(lines).toHaveLength(18);
		expect(kv.puts.map((p) => p.key)).toEqual([TLE_CACHE_KEY]);
	});

	it('reports partial upstream success through headers', async () => {
		const kv = memoryKv();
		const { result: res } = await withFetch(
			(url) => (url.includes('CATNR=42063') ? new Response('', { status: 500 }) : new Response(tleFor(url))),
			() => callWorker('/api/tles', { AEGIS_CACHE: kv.kv }),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('X-TLE-Status')).toBe('partial');
		expect(res.headers.get('X-TLE-Missing')).toBe('42063');
		expect((await res.text()).split('\n')).toHaveLength(15);
	});

	it('serves upstream elements when KV get and put reject', async () => {
		const kv = memoryKv({ failGet: true, failPut: true });
		const { result: res } = await withFetch(
			(url) => new Response(tleFor(url)),
			() => callWorker('/api/tles', { AEGIS_CACHE: kv.kv }),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('X-TLE-Status')).toBe('complete');
		expect(kv.puts).toHaveLength(1);
	});

	it('retains valid cached elements past the refresh point and labels them retained, not refreshed', async () => {
		const now = Date.now();
		const records = new Map<number, CachedTleRecord>();
		for (const id of MONITORED_NORAD_IDS) {
			const epoch = new Date(now - 24 * 60 * 60 * 1000);
			const [name, line1, line2] = makeTle(id, names[id], epoch);
			records.set(id, { noradId: id, name, line1, line2, epoch: epoch.toISOString(), fetchedAt: new Date(now - 13 * 60 * 60 * 1000).toISOString() });
		}
		const kv = memoryKv({ initial: { [TLE_CACHE_KEY]: writeTleCache(records, null) } });
		const { result: res, calls } = await withFetch(
			() => new Response('', { status: 503 }),
			() => callWorker('/api/tles', { AEGIS_CACHE: kv.kv }),
		);
		expect(res.status).toBe(200);
		expect(calls).toHaveLength(MONITORED_NORAD_IDS.length);
		expect(res.headers.get('X-TLE-Refreshed')).toBe('');
		expect(res.headers.get('X-TLE-Retained')?.split(',')).toHaveLength(MONITORED_NORAD_IDS.length);
		expect(Date.parse(res.headers.get('X-TLE-Oldest-Epoch') ?? '')).toBeGreaterThan(now - 2 * 24 * 60 * 60 * 1000);
	});

	it('returns 502 when no valid elements exist (corrupt cache, provider failure)', async () => {
		const kv = memoryKv({ initial: { [TLE_CACHE_KEY]: 'LANDSAT 8\n1 garbage\n2 garbage' } });
		const { result: res } = await withFetch(
			() => new Response('No GP data found'),
			() => callWorker('/api/tles', { AEGIS_CACHE: kv.kv }),
		);
		expect(res.status).toBe(502);
		expect(res.headers.get('X-TLE-Status')).toBe('unavailable');
	});

	it('explains an all-timeout failure and the following backoff with a stable code and Retry-After', async () => {
		const kv = memoryKv();
		const { result: res } = await withFetch(
			() => {
				throw new DOMException('timed out', 'TimeoutError');
			},
			() => callWorker('/api/tles', { AEGIS_CACHE: kv.kv }, ORIGIN),
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toMatchObject({ code: 'tle_unavailable', upstreamAttempted: true, failed: [...MONITORED_NORAD_IDS].sort((a, b) => a - b) });
		expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(890);
		expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');

		const { result: held, calls } = await withFetch(
			() => {
				throw new Error('backoff must hold upstream');
			},
			() => callWorker('/api/tles', { AEGIS_CACHE: kv.kv }),
		);
		expect(calls).toEqual([]);
		expect(held.status).toBe(502);
		expect(await held.json()).toMatchObject({ code: 'tle_unavailable', upstreamAttempted: false, failed: [] });
		expect(Number(held.headers.get('Retry-After'))).toBeLessThanOrEqual(900);
	});
});

describe('scheduled TLE refresh', () => {
	it('refreshes the shared cache through the same service', async () => {
		const kv = memoryKv();
		const { calls } = await withFetch(
			(url) => {
				const id = Number(new URL(url).searchParams.get('CATNR'));
				const names: Record<number, string> = { 39084: 'LANDSAT 8', 49260: 'LANDSAT 9', 40697: 'SENTINEL-2A', 42063: 'SENTINEL-2B', 25994: 'TERRA', 27424: 'AQUA' };
				return new Response(makeTle(id, names[id], new Date(Date.now() - 3 * 60 * 60 * 1000)).join('\n'));
			},
			() => refreshTlesScheduled({ AEGIS_CACHE: kv.kv }),
		);
		expect(calls).toHaveLength(MONITORED_NORAD_IDS.length);
		expect(Object.keys(JSON.parse(kv.puts[0].value).records)).toHaveLength(MONITORED_NORAD_IDS.length);
	});
});

describe('GET /api/disasters', () => {
	const eonet = {
		events: [
			{
				id: 'EONET_1',
				title: 'Test Fire',
				categories: [{ id: 'wildfires' }],
				geometry: [{ date: '2026-10-05T12:00:00Z', type: 'Point', coordinates: [-110, 35] }],
			},
		],
	};
	const usgs = {
		type: 'FeatureCollection',
		features: [
			{ id: 'us1', properties: { mag: 5, place: 'Somewhere', time: 1728500000000 }, geometry: { type: 'Point', coordinates: [0, 0, 10] } },
		],
	};
	const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

	it('keeps the array body and exposes complete source status headers', async () => {
		const kv = memoryKv();
		const { result: res } = await withFetch(
			(url) => (isEonet(url) ? json(eonet) : url === USGS_URL ? json(usgs) : json({}, 404)),
			() => callWorker('/api/disasters', { AEGIS_CACHE: kv.kv }, ORIGIN),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('X-Disaster-Sources')).toBe('eonet=ok;usgs=ok');
		expect(res.headers.get('X-Disaster-Partial')).toBe('false');
		expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Disaster-Sources');
		const body = (await res.json()) as Array<{ id: string; lat: number; lng: number }>;
		expect(body.map((d) => d.id).sort()).toEqual(['EONET_1', 'us1']);
		expect(body.find((d) => d.id === 'us1')).toMatchObject({ lat: 0, lng: 0 });
		expect(kv.puts[0].options?.expirationTtl).toBe(600);
	});

	it('reports partial source failure through headers and caches it briefly', async () => {
		const kv = memoryKv();
		const { result: res } = await withFetch(
			(url) => (isEonet(url) ? json(eonet) : json({ type: 'FeatureCollection' })),
			() => callWorker('/api/disasters', { AEGIS_CACHE: kv.kv }),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('X-Disaster-Sources')).toBe('eonet=ok;usgs=malformed');
		expect(res.headers.get('X-Disaster-Partial')).toBe('true');
		expect(kv.puts[0].options?.expirationTtl).toBe(60);

		const { result: cached, calls } = await withFetch(
			() => {
				throw new Error('should be cached');
			},
			() => callWorker('/api/disasters', { AEGIS_CACHE: kv.kv }),
		);
		expect(calls).toEqual([]);
		expect(cached.headers.get('X-Disaster-Partial')).toBe('true');
	});

	it('serves only cache documents consistent with the source-status schema', async () => {
		const ok = { status: 'ok', count: 1, rejected: 0 };
		const failed = { status: 'failed', count: 0, rejected: 0 };
		const doc = (overrides: Record<string, unknown>) =>
			JSON.stringify({
				version: 2,
				disasters: [{ id: 'cached', type: 'fire', title: 'C', lat: 1, lng: 2, date: '2026-10-01T00:00:00.000Z', severity: 'medium' }],
				sources: { eonet: ok, usgs: ok },
				partial: false,
				fetchedAt: '2026-10-10T00:00:00.000Z',
				...overrides,
			});
		const rejectedDocs = [
			doc({ sources: { eonet: { status: 'great', count: 1, rejected: 0 }, usgs: ok } }),
			doc({ sources: { eonet: { status: 'ok' }, usgs: ok } }),
			doc({ sources: { eonet: failed, usgs: failed }, partial: true, disasters: [] }),
			doc({ sources: { eonet: failed, usgs: ok }, partial: false }),
			doc({ fetchedAt: 'yesterday' }),
			doc({ version: 1 }),
		];
		for (const raw of rejectedDocs) {
			const kv = memoryKv({ initial: { 'disasters:v2': raw } });
			const { calls } = await withFetch(
				(url) => (isEonet(url) ? json(eonet) : json(usgs)),
				() => callWorker('/api/disasters', { AEGIS_CACHE: kv.kv }),
			);
			expect(calls.length, raw).toBe(EONET_QUERIES.length + 1);
		}

		const kv = memoryKv({ initial: { 'disasters:v2': doc({}) } });
		const { result: res, calls } = await withFetch(
			() => {
				throw new Error('should be cached');
			},
			() => callWorker('/api/disasters', { AEGIS_CACHE: kv.kv }),
		);
		expect(calls).toEqual([]);
		expect(res.headers.get('X-Disaster-Fetched-At')).toBe('2026-10-10T00:00:00.000Z');
		expect(((await res.json()) as Array<{ id: string }>)[0].id).toBe('cached');
	});

	it('returns 502 with source status when both sources fail, and survives rejected KV', async () => {
		const kv = memoryKv({ failGet: true, failPut: true });
		const { result: res } = await withFetch(
			() => json({}, 503),
			() => callWorker('/api/disasters', { AEGIS_CACHE: kv.kv }),
		);
		expect(res.status).toBe(502);
		expect(res.headers.get('X-Disaster-Sources')).toBe('eonet=failed;usgs=failed');
		expect(kv.puts).toEqual([]);
	});

	it('supports OPTIONS preflight for /api/disasters', async () => {
		const res = await SELF.fetch('http://example.com/api/disasters', {
			method: 'OPTIONS',
			headers: { ...ORIGIN, 'Access-Control-Request-Method': 'GET' },
		});
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://hesam.me');
	});
});
