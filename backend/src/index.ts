/**
 * AegisMap Backend API
 * Cloudflare Worker with Hono framework
 * Provides disaster data, satellite TLEs, FIRMS hotspots, and Workers AI analysis
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { analyzeErrorResponse, parseAnalyzeRequest, runAnalyze } from './analyze';
import {
	API_CAPABILITIES,
	APP_VERSION,
	buildDisastersV2CacheKey,
	DEFAULT_OBSERVATION_WINDOW,
	DEFAULT_VOLCANO_MODE,
	DISASTERS_CACHE_KEY,
	DISASTERS_CACHE_TTL_SECONDS,
	DISASTERS_PARTIAL_CACHE_TTL_SECONDS,
	DISASTERS_V2_EDGE_CACHE_TTL_SECONDS,
	GlobalFirmsProduct,
	INVALID_VOLCANO_MODE_ERROR,
	INVALID_WINDOW_ERROR,
	isObservationWindow,
	isVolcanoMode,
	ObservationWindow,
	reflectCorsOrigin,
	resolveAllowedOrigins,
	VolcanoMode,
} from './config';
import {
	DisasterRecord,
	DisasterSourceStatus,
	DisasterSources,
	DisasterUpstreamError,
	DisastersV2CategorizedResult,
	fetchDisasters,
	fetchDisastersV2Categorized,
	formatDisasterSourcesHeader,
} from './disasters';
import {
	buildFirmsBboxes,
	buildFirmsCacheKey,
	fetch7DayFirmsHotspots,
	FIRMS_CACHE_TTL_SECONDS,
	isUsableCachedFirms,
	parseCoordinateQuery,
	planFirmsWindows,
} from './firms';
import {
	buildFallbackFirmsReport,
	FirmsReportStatus,
	loadGlobalFirmsMeta,
	SensorCoverageReport,
	WindowRange,
} from './firmsGlobal';
import { loadMonitoredTles, serializeTles, TLE_SCHEDULED_REFRESH_AFTER_MS } from './satellites';

type Bindings = {
	AEGIS_CACHE: KVNamespace;
	AI: Ai;
	FIRMS_MAP_KEY: string;
	/** Optional server-side model override (must be in SUPPORTED_AI_MODELS). */
	AI_MODEL?: string;
	/** Optional comma-separated extra browser origins (merged with defaults). */
	CORS_ORIGINS?: string;
};

/** Metadata headers browsers may read cross-origin. */
const EXPOSED_HEADERS = [
	'X-Disaster-Sources',
	'X-Disaster-Partial',
	'X-Disaster-Fetched-At',
	'X-FIRMS-Status',
	'X-FIRMS-Generated-At',
	'X-TLE-Status',
	'X-TLE-Missing',
	'X-TLE-Refreshed',
	'X-TLE-Retained',
	'X-TLE-Revalidating',
	'X-TLE-Oldest-Epoch',
	'Retry-After',
];

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', async (c, next) => {
	const allowed = resolveAllowedOrigins(c.env.CORS_ORIGINS);
	const middleware = cors({
		origin: (origin) => reflectCorsOrigin(origin, allowed) ?? '',
		allowMethods: ['GET', 'POST', 'OPTIONS'],
		allowHeaders: ['Content-Type'],
		exposeHeaders: EXPOSED_HEADERS,
	});
	return middleware(c, next);
});

app.get('/', (c) => {
	return c.json({ status: 'AegisMap API Online', version: APP_VERSION, capabilities: API_CAPABILITIES });
});

interface DisastersCacheDocument {
	version: 2;
	disasters: DisasterRecord[];
	sources: DisasterSources;
	partial: boolean;
	fetchedAt: string;
}

function isCachedSourceStatus(value: unknown): boolean {
	const s = value as Partial<DisasterSourceStatus> | null;
	return (
		!!s &&
		(s.status === 'ok' || s.status === 'failed' || s.status === 'malformed') &&
		Number.isInteger(s.count) &&
		Number.isInteger(s.rejected)
	);
}

function readDisastersCache(raw: string | null): DisastersCacheDocument | null {
	if (!raw) return null;
	try {
		const doc = JSON.parse(raw) as Partial<DisastersCacheDocument>;
		if (
			doc.version === 2 &&
			Array.isArray(doc.disasters) &&
			isCachedSourceStatus(doc.sources?.eonet) &&
			isCachedSourceStatus(doc.sources?.usgs) &&
			// A document with no successful source must still carry records (partial EONET).
			(doc.sources!.eonet.status === 'ok' || doc.sources!.usgs.status === 'ok' || doc.disasters.length > 0) &&
			doc.partial === (doc.sources!.eonet.status !== 'ok' || doc.sources!.usgs.status !== 'ok') &&
			typeof doc.fetchedAt === 'string' &&
			Number.isFinite(Date.parse(doc.fetchedAt))
		) {
			return doc as DisastersCacheDocument;
		}
	} catch {
		// fall through: unreadable cache is ignored
	}
	return null;
}

function disasterHeaders(doc: Pick<DisastersCacheDocument, 'sources' | 'partial' | 'fetchedAt'>): Record<string, string> {
	return {
		'X-Disaster-Sources': formatDisasterSourcesHeader(doc.sources),
		'X-Disaster-Partial': String(doc.partial),
		'X-Disaster-Fetched-At': doc.fetchedAt,
	};
}

// Provider routes do not coalesce concurrent cache misses: simultaneous
// misses each fetch upstream (KV is eventually consistent, and sharing one
// isolate-level promise across requests would tie them to the first
// request's lifetime). Upstream volume is bounded by the cache TTLs instead.

// Route 1: GET /api/disasters
// Body stays a plain array for existing consumers; source status is in headers.
app.get('/api/disasters', async (c) => {
	let cachedRaw: string | null = null;
	try {
		cachedRaw = (await c.env.AEGIS_CACHE?.get(DISASTERS_CACHE_KEY)) ?? null;
	} catch (cacheErr) {
		console.warn('Cache read error for disasters:', cacheErr instanceof Error ? cacheErr.name : 'Error');
	}
	const cached = readDisastersCache(cachedRaw);
	if (cached) {
		return c.json(cached.disasters, 200, disasterHeaders(cached));
	}

	try {
		const result = await fetchDisasters();
		const doc: DisastersCacheDocument = {
			version: 2,
			disasters: result.disasters,
			sources: result.sources,
			partial: result.partial,
			fetchedAt: new Date().toISOString(),
		};
		console.log(
			`Disasters: eonet=${result.sources.eonet.status}(${result.sources.eonet.count}) usgs=${result.sources.usgs.status}(${result.sources.usgs.count})`,
		);

		if (c.env.AEGIS_CACHE) {
			try {
				await c.env.AEGIS_CACHE.put(DISASTERS_CACHE_KEY, JSON.stringify(doc), {
					expirationTtl: result.partial ? DISASTERS_PARTIAL_CACHE_TTL_SECONDS : DISASTERS_CACHE_TTL_SECONDS,
				});
			} catch (putErr) {
				console.warn('Cache write error for disasters:', putErr instanceof Error ? putErr.name : 'Error');
			}
		}

		return c.json(doc.disasters, 200, disasterHeaders(doc));
	} catch (error) {
		if (error instanceof DisasterUpstreamError) {
			return c.json({ error: 'Failed to fetch disaster data', sources: error.sources }, 502, {
				'X-Disaster-Sources': formatDisasterSourcesHeader(error.sources),
			});
		}
		console.error('Error fetching disasters:', error instanceof Error ? error.name : 'Error');
		return c.json({ error: 'Failed to fetch disaster data' }, 502);
	}
});

export function buildDisastersV2EdgeCacheKey(window: ObservationWindow, volcanoMode: VolcanoMode): Request {
	return new Request(`https://cache.aegis-map.internal/api/v2/disasters?window=${window}&volcanoMode=${volcanoMode}`, {
		method: 'GET',
	});
}

// Route 1.5: GET /api/v2/disasters
// Rich disaster catalog with strict window partitioning, separate satellite thermal cells,
// and volcano context mode.
// Reads split FIRMS `meta` (parsed) and `cells` (raw JSON string) from KV without
// parsing the multi-MB cells array on the Worker, and caches the assembled response
// in the Cloudflare Cache API (~5 min).
app.get('/api/v2/disasters', async (c) => {
	const rawWindow = c.req.query('window') ?? DEFAULT_OBSERVATION_WINDOW;
	if (!isObservationWindow(rawWindow)) {
		return c.json({ error: INVALID_WINDOW_ERROR }, 400);
	}
	const window = rawWindow;

	const rawVolcanoMode = c.req.query('volcanoMode') ?? DEFAULT_VOLCANO_MODE;
	if (!isVolcanoMode(rawVolcanoMode)) {
		return c.json({ error: INVALID_VOLCANO_MODE_ERROR }, 400);
	}
	const volcanoMode = rawVolcanoMode;

	// 0. Check Cloudflare Edge Cache API first
	const edgeCache = typeof caches !== 'undefined' ? caches.default : undefined;
	const edgeCacheKey = buildDisastersV2EdgeCacheKey(window, volcanoMode);
	if (edgeCache) {
		try {
			const cachedRes = await edgeCache.match(edgeCacheKey);
			if (cachedRes) {
				const cachedHeaders: Record<string, string> = {
					'Content-Type': cachedRes.headers.get('Content-Type') ?? 'application/json; charset=utf-8',
				};
				for (const h of [
					'X-Disaster-Sources',
					'X-Disaster-Partial',
					'X-Disaster-Fetched-At',
					'X-FIRMS-Status',
					'X-FIRMS-Generated-At',
				]) {
					const val = cachedRes.headers.get(h);
					if (val !== null) cachedHeaders[h] = val;
				}
				return c.newResponse(cachedRes.body, 200, cachedHeaders);
			}
		} catch (cacheErr) {
			console.warn('Edge cache read error for v2 disasters:', cacheErr instanceof Error ? cacheErr.name : 'Error');
		}
	}

	// 1. Load split FIRMS global metadata + raw cells JSON from KV (zero upstream calls, zero multi-MB JSON.parse)
	const firmsResult = await loadGlobalFirmsMeta(c.env.AEGIS_CACHE, window);

	let firmsReport: {
		status: FirmsReportStatus;
		generatedAt: string;
		isLkgFallback?: boolean;
		/** Window the snapshot was ingested against (may lag the response windowRange). */
		windowRange?: WindowRange;
		sensors: Record<GlobalFirmsProduct, SensorCoverageReport>;
		accounting: {
			rawRows: number;
			malformedRows: number;
			outOfWindowRows: number;
			duplicateRows: number;
			acceptedDetections: number;
		};
	};

	if (firmsResult) {
		firmsReport = {
			status: firmsResult.status,
			generatedAt: firmsResult.meta.generatedAt,
			isLkgFallback: firmsResult.isLkg,
			windowRange: firmsResult.meta.windowRange,
			sensors: firmsResult.meta.sensors,
			accounting: firmsResult.meta.accounting,
		};
	} else {
		firmsReport = buildFallbackFirmsReport('unavailable');
	}

	// 2. Load EONET + USGS disasters (cached in KV for 10 min)
	const disastersCacheKey = buildDisastersV2CacheKey(window, volcanoMode);
	let disasterResult: DisastersV2CategorizedResult | null = null;
	try {
		const cachedRaw = await c.env.AEGIS_CACHE?.get(disastersCacheKey);
		if (cachedRaw) {
			disasterResult = JSON.parse(cachedRaw);
		}
	} catch (cacheErr) {
		console.warn('Cache read error for v2 disasters:', cacheErr instanceof Error ? cacheErr.name : 'Error');
	}

	if (!disasterResult) {
		try {
			disasterResult = await fetchDisastersV2Categorized({ window, volcanoMode });
			if (c.env.AEGIS_CACHE) {
				try {
					await c.env.AEGIS_CACHE.put(disastersCacheKey, JSON.stringify(disasterResult), {
						expirationTtl: disasterResult.partial ? DISASTERS_PARTIAL_CACHE_TTL_SECONDS : DISASTERS_CACHE_TTL_SECONDS,
					});
				} catch (putErr) {
					console.warn('Cache write error for v2 disasters:', putErr instanceof Error ? putErr.name : 'Error');
				}
			}
		} catch (error) {
			if (error instanceof DisasterUpstreamError) {
				return c.json({ error: 'Failed to fetch disaster data', sources: error.sources }, 502, {
					'X-Disaster-Sources': formatDisasterSourcesHeader(error.sources),
				});
			}
			console.error('Error fetching v2 disasters:', error instanceof Error ? error.name : 'Error');
			return c.json({ error: 'Failed to fetch disaster data' }, 502);
		}
	}

	// 3. Splice raw pre-filtered FIRMS cells JSON string directly into the response body
	const windowRange = disasterResult.windowRange;
	const cellsJson = firmsResult ? firmsResult.cellsJson : '[]';
	const fireDetections = firmsResult ? firmsResult.meta.totalDetections : 0;
	const fireCellCount = firmsResult ? firmsResult.meta.cellCount : 0;
	const fetchedAt = new Date().toISOString();

	const prefix = JSON.stringify({
		version: 2 as const,
		window,
		windowRange,
		summary: {
			namedFires: disasterResult.wildfires.length,
			fireDetections,
			fireCells: fireCellCount,
			earthquakes: disasterResult.earthquakes.length,
			volcanoes: disasterResult.volcanoes.length,
		},
		wildfires: disasterResult.wildfires,
	});
	const suffix = JSON.stringify({
		earthquakes: disasterResult.earthquakes,
		volcanoes: disasterResult.volcanoes,
		sources: {
			eonet: disasterResult.sources.eonet,
			usgs: disasterResult.sources.usgs,
			firms: firmsReport,
		},
		fetchedAt,
	});
	const responseBody = `${prefix.slice(0, -1)},"fireCells":${cellsJson},${suffix.slice(1)}`;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json; charset=utf-8',
		...disasterHeaders({ sources: disasterResult.sources, partial: disasterResult.partial, fetchedAt }),
		'X-FIRMS-Status': firmsReport.status,
		'X-FIRMS-Generated-At': firmsReport.generatedAt,
	};

	if (edgeCache && firmsResult && !disasterResult.partial) {
		const cacheResponse = new Response(responseBody, {
			status: 200,
			headers: {
				...headers,
				'Cache-Control': `public, max-age=${DISASTERS_V2_EDGE_CACHE_TTL_SECONDS}`,
			},
		});
		let waitUntil: ((promise: Promise<unknown>) => void) | undefined;
		try {
			waitUntil = c.executionCtx.waitUntil.bind(c.executionCtx);
		} catch {
			waitUntil = undefined;
		}
		const putPromise = edgeCache.put(edgeCacheKey, cacheResponse).catch((err) => {
			console.warn('Edge cache write error for v2 disasters:', err instanceof Error ? err.name : 'Error');
		});
		if (waitUntil) {
			waitUntil(putPromise);
		} else {
			await putPromise;
		}
	}

	return c.newResponse(responseBody, 200, headers);
});

// Route 2: GET /api/tles
// text/plain TLE body (compatible); freshness/partial status in X-TLE-* headers.
app.get('/api/tles', async (c) => {
	// Stale-while-revalidate needs ctx.waitUntil; absent (no execution context) the refresh is awaited inline.
	let waitUntil: ((promise: Promise<unknown>) => void) | undefined;
	try {
		waitUntil = c.executionCtx.waitUntil.bind(c.executionCtx);
	} catch {
		waitUntil = undefined;
	}
	const result = await loadMonitoredTles(c.env.AEGIS_CACHE, { waitUntil });

	if (result.records.size === 0) {
		const retryAfterSeconds = result.nextAttemptAt
			? Math.max(1, Math.ceil((Date.parse(result.nextAttemptAt) - Date.now()) / 1000))
			: null;
		return c.json(
			{
				error: 'No valid orbital elements are available',
				code: 'tle_unavailable',
				missing: result.missing,
				failed: result.failed,
				upstreamAttempted: result.failed.length > 0 || result.refreshed.length > 0,
				retryAfterSeconds,
			},
			502,
			{
				'X-TLE-Status': 'unavailable',
				'X-TLE-Missing': result.missing.join(','),
				...(retryAfterSeconds !== null ? { 'Retry-After': String(retryAfterSeconds) } : {}),
			},
		);
	}

	const epochs = [...result.records.values()].map((r) => Date.parse(r.epoch));
	const oldest = new Date(Math.min(...epochs)).toISOString();

	return c.text(serializeTles(result.records), 200, {
		'Content-Type': 'text/plain; charset=utf-8',
		'X-TLE-Status': result.status,
		'X-TLE-Missing': result.missing.join(','),
		'X-TLE-Refreshed': result.refreshed.join(','),
		'X-TLE-Retained': result.retained.join(','),
		'X-TLE-Revalidating': String(result.revalidating),
		'X-TLE-Oldest-Epoch': oldest,
	});
});

// Route 2.5: GET /api/fire-hotspots
app.get('/api/fire-hotspots', async (c) => {
	const parsed = parseCoordinateQuery(c.req.query('lat'), c.req.query('lng'));
	if (!parsed.ok) {
		return c.json({ error: parsed.reason }, 400);
	}

	const FIRMS_MAP_KEY = c.env.FIRMS_MAP_KEY;
	if (!FIRMS_MAP_KEY || FIRMS_MAP_KEY === 'YOUR_FIRMS_MAP_KEY_HERE') {
		console.warn('FIRMS_MAP_KEY not configured');
		return c.json(
			{ error: 'FIRMS API key not configured on server', code: 'firms_not_configured' },
			503,
		);
	}

	const now = new Date();
	const windows = planFirmsWindows(now);
	const bboxes = buildFirmsBboxes(parsed.lat, parsed.lng);
	const cacheKey = buildFirmsCacheKey(bboxes, windows[1].startDate, windows[0].endDate);

	try {
		const cachedRaw = await c.env.AEGIS_CACHE?.get(cacheKey);
		if (cachedRaw) {
			const cached: unknown = JSON.parse(cachedRaw);
			if (isUsableCachedFirms(cached)) return c.json(cached);
		}
	} catch (cacheErr) {
		console.warn('Cache read error for FIRMS hotspots:', cacheErr instanceof Error ? cacheErr.name : 'Error');
	}

	const result = await fetch7DayFirmsHotspots(parsed.lat, parsed.lng, FIRMS_MAP_KEY, { now });

	if (result.coverage.status === 'unavailable') {
		return c.json(
			{
				error: 'NASA FIRMS did not return usable data for the requested window',
				code: 'firms_unavailable',
				coverage: result.coverage,
				source: result.source,
				bboxes: result.bboxes,
			},
			502,
		);
	}

	if (result.coverage.status === 'complete' && c.env.AEGIS_CACHE) {
		try {
			await c.env.AEGIS_CACHE.put(cacheKey, JSON.stringify(result), {
				expirationTtl: FIRMS_CACHE_TTL_SECONDS,
			});
		} catch (putErr) {
			console.warn('Cache write error for FIRMS hotspots:', putErr instanceof Error ? putErr.name : 'Error');
		}
	}

	return c.json(result);
});

// Route 3: POST /api/analyze — Workers AI (single production path)
app.post('/api/analyze', async (c) => {
	try {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json(
				{
					error: 'analysis_unavailable',
					code: 'invalid_request',
					message: 'Malformed JSON body',
				},
				400,
			);
		}

		const req = parseAnalyzeRequest(body);
		const result = await runAnalyze(req, c.env);
		return c.json(result);
	} catch (error) {
		const mapped = analyzeErrorResponse(error);
		return c.json(mapped.body, mapped.status as 400);
	}
});

/** Cron Trigger: refresh orbital elements outside user requests (same cache policy). */
export async function refreshTlesScheduled(env: Pick<Bindings, 'AEGIS_CACHE'>): Promise<void> {
	const result = await loadMonitoredTles(env.AEGIS_CACHE, { refreshAfterMs: TLE_SCHEDULED_REFRESH_AFTER_MS });
	console.log(
		`Scheduled TLE refresh: status=${result.status} refreshed=${result.refreshed.join(',') || '-'} failed=${result.failed.join(',') || '-'} missing=${result.missing.join(',') || '-'} backoff=${result.backoffActive}`,
	);
}

export default {
	fetch: app.fetch,
	async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
		ctx.waitUntil(refreshTlesScheduled(env));
	},
} satisfies ExportedHandler<Bindings>;
