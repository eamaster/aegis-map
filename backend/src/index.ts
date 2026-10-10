/**
 * AegisMap Backend API
 * Cloudflare Worker with Hono framework
 * Provides disaster data, satellite TLEs, FIRMS hotspots, and Workers AI analysis
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { analyzeErrorResponse, parseAnalyzeRequest, runAnalyze } from './analyze';
import { API_CAPABILITIES, APP_VERSION, reflectCorsOrigin, resolveAllowedOrigins } from './config';
import {
	DisasterRecord,
	DisasterSourceStatus,
	DisasterSources,
	DisasterUpstreamError,
	fetchDisasters,
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
import { loadMonitoredTles, serializeTles } from './satellites';

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
	'X-TLE-Status',
	'X-TLE-Missing',
	'X-TLE-Refreshed',
	'X-TLE-Retained',
	'X-TLE-Oldest-Epoch',
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

const DISASTERS_CACHE_KEY = 'disasters:v2';
const DISASTERS_CACHE_TTL_SECONDS = 600;
/** Partial results are cached briefly so a recovered source is picked up soon. */
const DISASTERS_PARTIAL_CACHE_TTL_SECONDS = 60;

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
			// A cache never holds a document in which both sources failed.
			(doc.sources!.eonet.status === 'ok' || doc.sources!.usgs.status === 'ok') &&
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

// Route 2: GET /api/tles
// text/plain TLE body (compatible); freshness/partial status in X-TLE-* headers.
app.get('/api/tles', async (c) => {
	const result = await loadMonitoredTles(c.env.AEGIS_CACHE);

	if (result.records.size === 0) {
		return c.json(
			{ error: 'No valid TLE data available', missing: result.missing, failed: result.failed },
			502,
			{ 'X-TLE-Status': 'unavailable' },
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

export default app;
