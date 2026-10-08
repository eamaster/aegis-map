/**
 * AegisMap Backend API
 * Cloudflare Worker with Hono framework
 * Provides disaster data, satellite TLEs, FIRMS hotspots, and Workers AI analysis
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { analyzeErrorResponse, parseAnalyzeRequest, runAnalyze } from './analyze';
import { ALLOWED_ORIGINS, APP_VERSION } from './config';
import { MONITORED_NORAD_IDS } from './satellites';

type Bindings = {
	AEGIS_CACHE: KVNamespace;
	AI: Ai;
	FIRMS_MAP_KEY: string;
	/** Optional server-side model override (must be in SUPPORTED_AI_MODELS). */
	AI_MODEL?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(
	'/*',
	cors({
		origin: (origin) => {
			if (!origin) {
				return ALLOWED_ORIGINS[0];
			}
			return (ALLOWED_ORIGINS as readonly string[]).includes(origin) ? origin : '';
		},
		allowMethods: ['GET', 'POST', 'OPTIONS'],
		allowHeaders: ['Content-Type'],
	}),
);

app.get('/', (c) => {
	return c.json({ status: 'AegisMap API Online', version: APP_VERSION });
});

// Route 1: GET /api/disasters
app.get('/api/disasters', async (c) => {
	const cacheKey = 'disasters';
	const cacheTTL = 600;

	try {
		const cached = await c.env.AEGIS_CACHE?.get(cacheKey);
		if (cached) {
			console.log('Cache hit: disasters');
			return c.json(JSON.parse(cached));
		}

		console.log('Cache miss: fetching disasters from sources');

		const eonetResponse = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open');
		const eonetData = (await eonetResponse.json()) as {
			events: Array<{
				id: string;
				title: string;
				categories: Array<{ id: string }>;
				geometry?: Array<{ coordinates: number[]; date: string }>;
			}>;
		};

		const eonetDisasters = eonetData.events
			.filter((event) => {
				const categoryIds = event.categories.map((cat) => cat.id);
				return categoryIds.includes('wildfires') || categoryIds.includes('volcanoes');
			})
			.map((event) => {
				const categoryId = event.categories[0]?.id;
				const type = categoryId === 'wildfires' ? 'fire' : 'volcano';
				const coords = event.geometry?.[0]?.coordinates;
				if (!coords) return null;

				return {
					id: event.id,
					type,
					title: event.title,
					lng: coords[0],
					lat: coords[1],
					date: event.geometry![0].date,
					severity: 'medium' as const,
				};
			})
			.filter(Boolean);

		const usgsResponse = await fetch(
			'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
		);
		const usgsData = (await usgsResponse.json()) as {
			features: Array<{
				id: string;
				properties: { mag: number; place: string; time: number };
				geometry: { coordinates: number[] };
			}>;
		};

		const earthquakes = usgsData.features.map((feature) => {
			const magnitude = feature.properties.mag;
			let severity: 'low' | 'medium' | 'high' = 'low';
			if (magnitude >= 6.0) severity = 'high';
			else if (magnitude >= 4.5) severity = 'medium';

			return {
				id: feature.id,
				type: 'earthquake' as const,
				title: feature.properties.place,
				lng: feature.geometry.coordinates[0],
				lat: feature.geometry.coordinates[1],
				date: new Date(feature.properties.time).toISOString(),
				severity,
				magnitude,
			};
		});

		const allDisasters = [...eonetDisasters, ...earthquakes];
		console.log(
			`Fetched ${eonetDisasters.length} EONET disasters and ${earthquakes.length} earthquakes`,
		);

		if (c.env.AEGIS_CACHE) {
			await c.env.AEGIS_CACHE.put(cacheKey, JSON.stringify(allDisasters), {
				expirationTtl: cacheTTL,
			});
		}

		return c.json(allDisasters);
	} catch (error) {
		console.error('Error fetching disasters:', error);
		return c.json({ error: 'Failed to fetch disaster data' }, 500);
	}
});

// Route 2: GET /api/tles
app.get('/api/tles', async (c) => {
	const cacheKey = 'tles_v2';
	const cacheTTL = 43200;

	try {
		const cached = await c.env.AEGIS_CACHE?.get(cacheKey);
		if (cached) {
			console.log('Cache hit: TLEs');
			return c.text(cached);
		}

		console.log('Cache miss: fetching TLEs from CelesTrak');
		const satellites = [...MONITORED_NORAD_IDS];

		const tlePromises = satellites.map(async (catNr) => {
			try {
				const response = await fetch(
					`https://celestrak.org/NORAD/elements/gp.php?CATNR=${catNr}&FORMAT=tle`,
				);
				if (!response.ok) {
					console.error(`Failed to fetch TLE for ${catNr}: ${response.status}`);
					return null;
				}
				const text = await response.text();
				if (
					!text ||
					text.trim().length === 0 ||
					text.trim().split('\n').filter((l) => l.trim()).length < 3
				) {
					console.warn(`Invalid TLE data for ${catNr}`);
					return null;
				}
				return text.trim();
			} catch (error) {
				console.error(`Error fetching TLE for ${catNr}:`, error);
				return null;
			}
		});

		const results = await Promise.all(tlePromises);
		const validTLEs = results.filter(
			(tle): tle is string => tle !== null && tle !== undefined && tle.trim().length > 0,
		);

		if (validTLEs.length === 0) {
			return c.json({ error: 'No TLE data available' }, 500);
		}

		const tleData = validTLEs.join('\n');

		if (c.env.AEGIS_CACHE) {
			await c.env.AEGIS_CACHE.put(cacheKey, tleData, {
				expirationTtl: cacheTTL,
			});
		}

		return c.text(tleData);
	} catch (error) {
		console.error('Error fetching TLEs:', error);
		return c.json({ error: 'Failed to fetch TLE data' }, 500);
	}
});

// Route 2.5: GET /api/fire-hotspots
app.get('/api/fire-hotspots', async (c) => {
	const { lat, lng } = c.req.query();

	if (!lat || !lng) {
		return c.json({ error: 'Missing lat/lng parameters' }, 400);
	}

	try {
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

		const lat1 = parseFloat(lat) - 0.5;
		const lat2 = parseFloat(lat) + 0.5;
		const lon1 = parseFloat(lng) - 0.5;
		const lon2 = parseFloat(lng) + 0.5;

		const firmsUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/${lon1},${lat1},${lon2},${lat2}/7`;
		console.log(`Fetching FIRMS data from: ${firmsUrl.replace(FIRMS_MAP_KEY, 'REDACTED')}`);

		const response = await fetch(firmsUrl);
		if (!response.ok) {
			console.error(`FIRMS API error: ${response.status} ${response.statusText}`);
			return c.json({ error: 'Failed to fetch fire hotspot data' }, response.status as 400);
		}

		const csvText = await response.text();
		const lines = csvText.trim().split('\n').slice(1);

		if (lines.length === 0 || lines[0].trim() === '') {
			return c.json({
				hotspots: [],
				totalCount: 0,
				highConfidence: 0,
				maxBrightness: 0,
				maxPower: 0,
			});
		}

		const hotspots = lines.map((line) => {
			const parts = line.split(',');
			return {
				latitude: parseFloat(parts[0]),
				longitude: parseFloat(parts[1]),
				bright_ti4: parseFloat(parts[2]),
				scan: parseFloat(parts[3]),
				track: parseFloat(parts[4]),
				acq_date: parts[5],
				acq_time: parts[6],
				satellite: parts[7],
				confidence: parts[8],
				version: parts[9],
				bright_ti5: parseFloat(parts[10]),
				frp: parseFloat(parts[11]),
				daynight: parts[12],
			};
		});

		const totalCount = hotspots.length;
		const highConfidence = hotspots.filter(
			(h) => h.confidence === 'h' || h.confidence === 'high',
		).length;
		const maxBrightness = Math.max(...hotspots.map((h) => h.bright_ti4));
		const maxPower = Math.max(...hotspots.map((h) => h.frp));

		return c.json({
			hotspots,
			totalCount,
			highConfidence,
			maxBrightness,
			maxPower,
		});
	} catch (error) {
		console.error('Error fetching FIRMS data:', error);
		return c.json({ error: 'Failed to fetch fire hotspot data' }, 500);
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
