/**
 * AegisMap Backend API
 * Cloudflare Worker with Hono framework
 * Provides disaster data, satellite TLEs, FIRMS hotspots, and Workers AI analysis
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { analyzeErrorResponse, parseAnalyzeRequest, runAnalyze } from './analyze';
import { APP_VERSION, reflectCorsOrigin, resolveAllowedOrigins } from './config';
import { fetchDisasters } from './disasters';
import {
	fetch7DayFirmsHotspots,
	FIRMS_CACHE_TTL_SECONDS,
	validateCoordinates,
} from './firms';
import {
	mergeTles,
	MONITORED_NORAD_IDS,
	ParsedTleRecord,
	validateTleRecord,
} from './satellites';

type Bindings = {
	AEGIS_CACHE: KVNamespace;
	AI: Ai;
	FIRMS_MAP_KEY: string;
	/** Optional server-side model override (must be in SUPPORTED_AI_MODELS). */
	AI_MODEL?: string;
	/** Optional comma-separated extra browser origins (merged with defaults). */
	CORS_ORIGINS?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', async (c, next) => {
	const allowed = resolveAllowedOrigins(c.env.CORS_ORIGINS);
	const middleware = cors({
		origin: (origin) => reflectCorsOrigin(origin, allowed) ?? '',
		allowMethods: ['GET', 'POST', 'OPTIONS'],
		allowHeaders: ['Content-Type'],
	});
	return middleware(c, next);
});

app.get('/', (c) => {
	return c.json({ status: 'AegisMap API Online', version: APP_VERSION });
});

// Route 1: GET /api/disasters
app.get('/api/disasters', async (c) => {
	const cacheKey = 'disasters';
	const cacheTTL = 600;

	let cached: string | null = null;
	try {
		cached = await c.env.AEGIS_CACHE?.get(cacheKey);
		if (cached) {
			console.log('Cache hit: disasters');
			return c.json(JSON.parse(cached));
		}
	} catch (cacheErr) {
		console.warn('Cache read error for disasters:', cacheErr);
	}

	console.log('Cache miss: fetching disasters from sources');
	try {
		const { disasters, eonetCount, usgsCount } = await fetchDisasters();
		console.log(`Fetched ${eonetCount} EONET events and ${usgsCount} USGS earthquakes`);

		if (c.env.AEGIS_CACHE && disasters.length > 0) {
			try {
				await c.env.AEGIS_CACHE.put(cacheKey, JSON.stringify(disasters), {
					expirationTtl: cacheTTL,
				});
			} catch (putErr) {
				console.warn('Cache write error for disasters:', putErr);
			}
		}

		return c.json(disasters);
	} catch (error) {
		console.error('Error fetching disasters:', error);
		if (cached) {
			console.log('Serving stale cached disasters after upstream failure');
			return c.json(JSON.parse(cached));
		}
		return c.json({ error: 'Failed to fetch disaster data' }, 502);
	}
});

// Route 2: GET /api/tles
app.get('/api/tles', async (c) => {
	const cacheKey = 'tles_v2';
	const cacheTTL = 43200; // 12 hours

	let cached: string | null = null;
	try {
		cached = await c.env.AEGIS_CACHE?.get(cacheKey);
		if (cached && cached.trim().length > 0) {
			console.log('Cache hit: TLEs');
			return c.text(cached, 200, {
				'Content-Type': 'text/plain; charset=utf-8',
			});
		}
	} catch (cacheErr) {
		console.warn('Cache read error for TLEs:', cacheErr);
	}

	console.log('Cache miss: fetching TLEs from CelesTrak');
	try {
		const satellites = [...MONITORED_NORAD_IDS];

		const tlePromises = satellites.map(async (catNr): Promise<ParsedTleRecord | null> => {
			try {
				const response = await fetch(
					`https://celestrak.org/NORAD/elements/gp.php?CATNR=${catNr}&FORMAT=tle`,
					{
						headers: {
							'User-Agent': 'AegisMap/1.2 (Satellite-Monitor)',
						},
						signal: AbortSignal.timeout(6000),
					},
				);
				if (!response.ok) {
					console.warn(`Failed to fetch TLE for ${catNr}: ${response.status}`);
					return null;
				}
				const text = await response.text();
				const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
				const validation = validateTleRecord(lines);
				if (!validation.valid || !validation.record) {
					console.warn(`Invalid TLE data for ${catNr}: ${validation.reason}`);
					return null;
				}
				return validation.record;
			} catch (fetchErr) {
				console.warn(`Error fetching TLE for ${catNr}:`, fetchErr);
				return null;
			}
		});

		const results = await Promise.all(tlePromises);
		const freshRecords = results.filter((r): r is ParsedTleRecord => r !== null);

		const mergedTleData = mergeTles(cached, freshRecords);

		if (!mergedTleData || mergedTleData.trim().length === 0) {
			return c.json({ error: 'No TLE data available from upstream provider' }, 502);
		}

		if (c.env.AEGIS_CACHE && freshRecords.length > 0) {
			try {
				await c.env.AEGIS_CACHE.put(cacheKey, mergedTleData, {
					expirationTtl: cacheTTL,
				});
			} catch (putErr) {
				console.warn('Cache write error for TLEs:', putErr);
			}
		}

		return c.text(mergedTleData, 200, {
			'Content-Type': 'text/plain; charset=utf-8',
		});
	} catch (error) {
		console.error('Error in /api/tles:', error);
		if (cached && cached.trim().length > 0) {
			return c.text(cached, 200, {
				'Content-Type': 'text/plain; charset=utf-8',
			});
		}
		return c.json({ error: 'Failed to fetch TLE data' }, 502);
	}
});

// Route 2.5: GET /api/fire-hotspots
app.get('/api/fire-hotspots', async (c) => {
	const { lat, lng } = c.req.query();

	if (!lat || !lng) {
		return c.json({ error: 'Missing lat or lng query parameter' }, 400);
	}

	const latNum = Number.parseFloat(lat);
	const lngNum = Number.parseFloat(lng);

	const validation = validateCoordinates(latNum, lngNum);
	if (!validation.valid) {
		return c.json({ error: validation.reason || 'Invalid coordinates' }, 400);
	}

	const FIRMS_MAP_KEY = c.env.FIRMS_MAP_KEY;
	if (!FIRMS_MAP_KEY || FIRMS_MAP_KEY === 'YOUR_FIRMS_MAP_KEY_HERE') {
		console.warn('FIRMS_MAP_KEY not configured - returning empty data');
		return c.json({
			hotspots: [],
			totalCount: 0,
			highConfidence: 0,
			maxBrightness: 0,
			maxPower: 0,
			message:
				'FIRMS API key not configured. Register at https://firms.modaps.eosdis.nasa.gov/api/',
		});
	}

	const cacheKey = `firms:${latNum.toFixed(2)}:${lngNum.toFixed(2)}`;

	try {
		const cached = await c.env.AEGIS_CACHE?.get(cacheKey);
		if (cached) {
			return c.json(JSON.parse(cached));
		}
	} catch (cacheErr) {
		console.warn('Cache read error for FIRMS hotspots:', cacheErr);
	}

	try {
		const result = await fetch7DayFirmsHotspots(latNum, lngNum, FIRMS_MAP_KEY);

		if (c.env.AEGIS_CACHE) {
			try {
				await c.env.AEGIS_CACHE.put(cacheKey, JSON.stringify(result), {
					expirationTtl: FIRMS_CACHE_TTL_SECONDS,
				});
			} catch (putErr) {
				console.warn('Cache write error for FIRMS hotspots:', putErr);
			}
		}

		return c.json(result);
	} catch (error) {
		console.error('Error fetching FIRMS hotspots:', error);
		return c.json({ error: 'Failed to fetch fire hotspot data' }, 502);
	}
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
