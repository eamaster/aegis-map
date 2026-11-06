import { beforeEach, describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import {
	DISASTERS_CACHE_TTL_SECONDS,
	FIRMS_GLOBAL_STALE_AFTER_MS,
	GLOBAL_FIRMS_PRODUCTS,
	INVALID_VOLCANO_MODE_ERROR,
	INVALID_WINDOW_ERROR,
	OBSERVATION_WINDOWS,
	VOLCANO_MODES,
} from '../src/config';
import { EONET_QUERIES, USGS_URL } from '../src/disasters';
import { buildFirmsBboxes, buildFirmsCacheKey, planFirmsWindows } from '../src/firms';
import {
	buildFallbackFirmsReport,
	calculateWindowRange,
	FirmsGlobalSnapshot,
	isInWindowRange,
	serializeGlobalFirmsSnapshotSplit,
} from '../src/firmsGlobal';
import { CachedTleRecord, MONITORED_NORAD_IDS, TLE_CACHE_KEY, TLE_LKG_CACHE_KEY, writeTleCache } from '../src/satellites';
import { buildDisastersV2EdgeCacheKey, refreshTlesScheduled } from '../src/index';
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
		expect(kv.puts.map((p) => p.key)).toEqual([TLE_CACHE_KEY, TLE_LKG_CACHE_KEY]);
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
		expect(kv.puts.length).toBeGreaterThanOrEqual(1);
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

describe('GET /api/v2/disasters', () => {
	beforeEach(async () => {
		for (const w of OBSERVATION_WINDOWS) {
			for (const m of VOLCANO_MODES) {
				await caches.default.delete(buildDisastersV2EdgeCacheKey(w, m));
			}
		}
	});

	const json = (data: unknown, status = 200) =>
		new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

	const mockEonet = {
		events: [
			{
				id: 'EONET_W1',
				title: 'Active Wildfire Today',
				categories: [{ id: 'wildfires' }],
				geometry: [{ date: new Date().toISOString(), type: 'Point', coordinates: [-120.0, 38.0] }],
			},
			{
				id: 'EONET_W_OPEN_OLD',
				title: 'Ongoing Wildfire Reported 10 Days Ago',
				categories: [{ id: 'wildfires' }],
				geometry: [
					{
						date: new Date(Date.now() - 10 * 86_400_000).toISOString(),
						type: 'Point',
						coordinates: [-121.0, 39.0],
					},
				],
			},
			{
				id: 'EONET_V1',
				title: 'Historical Volcano Eruption',
				categories: [{ id: 'volcanoes' }],
				geometry: [{ date: '2023-01-01T00:00:00Z', type: 'Point', coordinates: [130.0, 32.0] }],
			},
		],
	};

	const mockUsgs = {
		type: 'FeatureCollection',
		features: [
			{
				id: 'usgs_q1',
				properties: { mag: 5.5, place: 'Recent Quake', time: Date.now() - 3600000 },
				geometry: { type: 'Point', coordinates: [-118.0, 34.0] },
			},
		],
	};

	const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

	const makeCell = (cellId: string, latestAcqTime: string, detectionCount: number) => ({
		cellId,
		lat: 10.25,
		lng: 20.25,
		bounds: [20.0, 10.0, 20.5, 10.5] as [number, number, number, number],
		detectionCount,
		maxFrp: 30,
		avgFrp: 20,
		maxBrightTi4: 340,
		latestAcqTime,
		confidenceCounts: { high: detectionCount, nominal: 0, low: 0, unknown: 0 },
		dayNightCounts: { day: detectionCount, night: 0, unknown: 0 },
		satelliteCounts: { N20: detectionCount },
		intensity: 'medium' as const,
	});

	/** Snapshot generated `ageHours` ago, ingested against its own 24h window. */
	const makeSnapshot = (
		ageHours: number,
		cells: ReturnType<typeof makeCell>[],
		sensorOverrides?: Partial<FirmsGlobalSnapshot['sensors']>,
	): FirmsGlobalSnapshot => {
		const total = cells.reduce((n, c) => n + c.detectionCount, 0);
		return {
			version: 2,
			window: '24h',
			windowRange: calculateWindowRange('24h', new Date(Date.parse(hoursAgo(ageHours)))),
			generatedAt: hoursAgo(ageHours),
			sensors: {
				VIIRS_SNPP_NRT: { status: 'ok', rawRows: 1, acceptedRows: 1 },
				VIIRS_NOAA20_NRT: { status: 'ok', rawRows: 1, acceptedRows: 1 },
				VIIRS_NOAA21_NRT: { status: 'ok', rawRows: 1, acceptedRows: 1 },
				...sensorOverrides,
			},
			accounting: { rawRows: total, malformedRows: 0, outOfWindowRows: 0, duplicateRows: 0, acceptedDetections: total },
			totalDetections: total,
			cells,
		};
	};

	const splitKvInitial = (snapshot: FirmsGlobalSnapshot, useLkgOnly = false): Record<string, string> => {
		const { metaJson, cellsJson } = serializeGlobalFirmsSnapshotSplit(snapshot);
		if (useLkgOnly) {
			return {
				[`firms:global:lkg:meta:v2:${snapshot.window}`]: metaJson,
				[`firms:global:lkg:cells:v2:${snapshot.window}`]: cellsJson,
			};
		}
		return {
			[`firms:global:meta:v2:${snapshot.window}`]: metaJson,
			[`firms:global:cells:v2:${snapshot.window}`]: cellsJson,
		};
	};

	const sampleSnapshot = makeSnapshot(1, [makeCell('cell:10.25:20.25', hoursAgo(3), 3)]);

	it('rejects invalid window and volcanoMode parameters with 400 and derived messages', async () => {
		for (const w of OBSERVATION_WINDOWS) {
			const { result: res } = await withFetch(
				(url) => (isEonet(url) ? json(mockEonet) : json(mockUsgs)),
				() => callWorker(`/api/v2/disasters?window=${w}`, { AEGIS_CACHE: memoryKv().kv, FIRMS_MAP_KEY: '' }),
			);
			expect(res.status).toBe(200);
		}
		const badWindow = await SELF.fetch('http://example.com/api/v2/disasters?window=30d');
		expect(badWindow.status).toBe(400);
		expect(await badWindow.json()).toEqual({ error: INVALID_WINDOW_ERROR });

		for (const m of VOLCANO_MODES) {
			const { result: res } = await withFetch(
				(url) => (isEonet(url) ? json(mockEonet) : json(mockUsgs)),
				() => callWorker(`/api/v2/disasters?volcanoMode=${m}`, { AEGIS_CACHE: memoryKv().kv, FIRMS_MAP_KEY: '' }),
			);
			expect(res.status).toBe(200);
		}
		const badMode = await SELF.fetch('http://example.com/api/v2/disasters?volcanoMode=unknown');
		expect(badMode.status).toBe(400);
		expect(await badMode.json()).toEqual({ error: INVALID_VOLCANO_MODE_ERROR });
	});

	it('includes every configured sensor in fallback FIRMS reports', async () => {
		const unavailableReport = buildFallbackFirmsReport('unavailable');
		expect(Object.keys(unavailableReport.sensors).sort()).toEqual([...GLOBAL_FIRMS_PRODUCTS].sort());
		expect(unavailableReport.status).toBe('unavailable');

		const kv = memoryKv();
		const { result: res } = await withFetch(
			(url) => (isEonet(url) ? json(mockEonet) : json(mockUsgs)),
			() => callWorker('/api/v2/disasters?window=24h', { AEGIS_CACHE: kv.kv, FIRMS_MAP_KEY: '' }),
		);
		const body = (await res.json()) as any;
		expect(Object.keys(body.sources.firms.sensors).sort()).toEqual([...GLOBAL_FIRMS_PRODUCTS].sort());
	});

	it('serves v2 response with split meta/cells from KV and caches assembled response in Edge Cache API', async () => {
		const kv = memoryKv({
			initial: splitKvInitial(sampleSnapshot),
		});

		const { result: res } = await withFetch(
			(url) => (isEonet(url) ? json(mockEonet) : json(mockUsgs)),
			() => callWorker('/api/v2/disasters?window=24h&volcanoMode=context', { AEGIS_CACHE: kv.kv }, ORIGIN),
		);

		expect(res.status).toBe(200);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://hesam.me');
		expect(res.headers.get('X-Disaster-Sources')).toBe('eonet=ok;usgs=ok');
		expect(res.headers.get('X-FIRMS-Status')).toBe('ok');

		const body = (await res.json()) as any;
		expect(body.version).toBe(2);
		expect(body.window).toBe('24h');
		expect(body.summary.namedFires).toBe(2);
		expect(body.summary.fireDetections).toBe(3);
		expect(body.summary.fireCells).toBe(1);
		expect(body.summary.earthquakes).toBe(1);
		expect(body.summary.volcanoes).toBe(1);
		expect(body.sources.firms.windowRange).toEqual(sampleSnapshot.windowRange);

		// EONET wildfires include both in-window and ongoing open wildfires in context mode
		expect(body.wildfires.map((w: any) => w.id)).toEqual(['EONET_W1', 'EONET_W_OPEN_OLD']);
		expect(body.wildfires[0].isHistoricalContext).toBeUndefined();
		expect(body.wildfires[1].isHistoricalContext).toBe(true);
		// FIRMS cell is spliced intact
		expect(body.fireCells[0].cellId).toBe('cell:10.25:20.25');
		expect(isInWindowRange(body.fireCells[0].latestAcqTime, body.windowRange)).toBe(true);
		// Context volcano has historical flag set
		expect(body.volcanoes[0].id).toBe('EONET_V1');
		expect(body.volcanoes[0].isHistoricalContext).toBe(true);

		// Subsequent request is served from caches.default without reading KV or upstream
		kv.gets.length = 0;
		const { result: cachedRes, calls } = await withFetch(
			() => {
				throw new Error('should be served from Edge Cache API');
			},
			() => callWorker('/api/v2/disasters?window=24h&volcanoMode=context', { AEGIS_CACHE: kv.kv }, ORIGIN),
		);
		expect(cachedRes.status).toBe(200);
		expect(cachedRes.headers.get('Access-Control-Allow-Origin')).toBe('https://hesam.me');
		expect(cachedRes.headers.get('X-FIRMS-Status')).toBe('ok');
		expect(calls).toEqual([]);
		expect(kv.gets).toEqual([]);
		const cachedBody = (await cachedRes.json()) as any;
		expect(cachedBody.fireCells[0].cellId).toBe('cell:10.25:20.25');
	});

	it('filters out historical open wildfires and volcanoes in strict mode', async () => {
		const kv = memoryKv();
		const { result: res } = await withFetch(
			(url) => (isEonet(url) ? json(mockEonet) : json(mockUsgs)),
			() => callWorker('/api/v2/disasters?window=24h&volcanoMode=strict', { AEGIS_CACHE: kv.kv }),
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.wildfires.map((w: any) => w.id)).toEqual(['EONET_W1']);
		expect(body.summary.namedFires).toBe(1);
		expect(body.volcanoes).toHaveLength(0);
		expect(body.summary.volcanoes).toBe(0);
	});

	it('reports firms.status=partial when a sensor has status=no_data and serves available cells', async () => {
		const partialSnapshot = makeSnapshot(1, [makeCell('cell:10.25:20.25', hoursAgo(2), 5)], {
			VIIRS_SNPP_NRT: { status: 'no_data', rawRows: 0, acceptedRows: 0, errorReason: 'Empty response' },
		});
		const kv = memoryKv({ initial: splitKvInitial(partialSnapshot) });

		const { result: res } = await withFetch(
			(url) => (isEonet(url) ? json(mockEonet) : json(mockUsgs)),
			() => callWorker('/api/v2/disasters?window=24h', { AEGIS_CACHE: kv.kv }),
		);

		expect(res.status).toBe(200);
		expect(res.headers.get('X-FIRMS-Status')).toBe('partial');
		const body = (await res.json()) as any;
		expect(body.sources.firms.status).toBe('partial');
		expect(body.sources.firms.sensors.VIIRS_SNPP_NRT.status).toBe('no_data');
		expect(body.fireCells).toHaveLength(1);
		expect(body.summary.fireDetections).toBe(5);
	});

	it('reports firms.status=stale when snapshot generatedAt is older than 2x cadence or served from LKG', async () => {
		const staleHours = FIRMS_GLOBAL_STALE_AFTER_MS / 3_600_000 + 1;
		const oldSnapshot = makeSnapshot(staleHours, [makeCell('cell:10.25:20.25', hoursAgo(3), 4)]);
		const kvOld = memoryKv({ initial: splitKvInitial(oldSnapshot) });

		const { result: resOld } = await withFetch(
			(url) => (isEonet(url) ? json(mockEonet) : json(mockUsgs)),
			() => callWorker('/api/v2/disasters?window=24h', { AEGIS_CACHE: kvOld.kv }),
		);
		expect(resOld.status).toBe(200);
		expect(resOld.headers.get('X-FIRMS-Status')).toBe('stale');
		expect(((await resOld.json()) as any).sources.firms.status).toBe('stale');

		await caches.default.delete(buildDisastersV2EdgeCacheKey('24h', 'context'));

		const kvLkg = memoryKv({ initial: splitKvInitial(sampleSnapshot, true) });
		const { result: resLkg } = await withFetch(
			(url) => (isEonet(url) ? json(mockEonet) : json(mockUsgs)),
			() => callWorker('/api/v2/disasters?window=24h', { AEGIS_CACHE: kvLkg.kv }),
		);
		expect(resLkg.status).toBe(200);
		expect(resLkg.headers.get('X-FIRMS-Status')).toBe('stale');
		const bodyLkg = (await resLkg.json()) as any;
		expect(bodyLkg.sources.firms.status).toBe('stale');
		expect(bodyLkg.sources.firms.isLkgFallback).toBe(true);
		expect(bodyLkg.fireCells).toHaveLength(1);
	});

	it('returns firms.status=unavailable without triggering on-demand warm-up when snapshot is missing, and serves cells immediately once seeded', async () => {
		const kv = memoryKv();
		const { result: missingRes, calls: firstCalls } = await withFetch(
			(url) => (isEonet(url) ? json(mockEonet) : json(mockUsgs)),
			() => callWorker('/api/v2/disasters?window=24h', { AEGIS_CACHE: kv.kv, FIRMS_MAP_KEY: 'configured-key' }),
		);

		expect(missingRes.status).toBe(200);
		expect(missingRes.headers.get('X-FIRMS-Status')).toBe('unavailable');
		const missingBody = (await missingRes.json()) as any;
		expect(missingBody.sources.firms.status).toBe('unavailable');
		expect(missingBody.fireCells).toEqual([]);
		// No upstream FIRMS calls or lock writes on GET
		expect(firstCalls.some((c) => c.includes('firms.modaps.eosdis.nasa.gov'))).toBe(false);
		expect(kv.puts.every((p) => !p.key.includes('firms:global'))).toBe(true);

		// Only EONET/USGS are cached under the disasters key, at the full TTL when both are ok.
		const disastersPut = kv.puts.find((p) => p.key === 'disasters:v2:24h:context');
		expect(disastersPut?.options?.expirationTtl).toBe(DISASTERS_CACHE_TTL_SECONDS);
		expect(JSON.parse(disastersPut!.value)).not.toHaveProperty('fireCells');

		// Ingestion job seeds split meta + cells into KV; the very next request serves them immediately.
		for (const [k, v] of Object.entries(splitKvInitial(sampleSnapshot))) {
			kv.store.set(k, v);
		}
		const { result: ready, calls: secondCalls } = await withFetch(
			() => {
				throw new Error('disasters must be served from KV cache');
			},
			() => callWorker('/api/v2/disasters?window=24h', { AEGIS_CACHE: kv.kv, FIRMS_MAP_KEY: 'configured-key' }),
		);
		expect(secondCalls).toEqual([]);
		expect(ready.headers.get('X-FIRMS-Status')).toBe('ok');
		const readyBody = (await ready.json()) as any;
		expect(readyBody.sources.firms.status).toBe('ok');
		expect(readyBody.fireCells).toHaveLength(1);
	});
});
