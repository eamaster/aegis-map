/**
 * AegisMap Backend API
 * Cloudflare Worker with Hono framework
 * Provides disaster data, satellite TLEs, and AI coverage analysis
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
	AEGIS_CACHE: KVNamespace;
	GEMINI_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Enable CORS for frontend
app.use('/*', cors());

// Health check
app.get('/', (c) => {
	return c.json({ status: 'AegisMap API Online', version: '1.0.0' });
});

// Route 1: GET /api/disasters
// Fetches and merges disaster data from NASA EONET and USGS
app.get('/api/disasters', async (c) => {
	const cacheKey = 'disasters';
	const cacheTTL = 600; // 10 minutes

	try {
		// Check KV cache first
		const cached = await c.env.AEGIS_CACHE?.get(cacheKey);
		if (cached) {
			console.log('Cache hit: disasters');
			return c.json(JSON.parse(cached));
		}

		console.log('Cache miss: fetching disasters from sources');

		// Fetch NASA EONET data (wildfires & volcanoes)
		const eonetResponse = await fetch(
			'https://eonet.gsfc.nasa.gov/api/v3/events?status=open'
		);
		const eonetData = await eonetResponse.json();

		// Filter for wildfires (id 8) and volcanoes (id 12)
		const eonetDisasters = eonetData.events
			.filter((event: any) => {
				const categoryIds = event.categories.map((cat: any) => cat.id);
				return categoryIds.includes(8) || categoryIds.includes(12);
			})
			.map((event: any) => {
				const categoryId = event.categories[0]?.id;
				const type = categoryId === 8 ? 'fire' : 'volcano';

				// Get first coordinate
				const coords = event.geometry?.[0]?.coordinates;
				if (!coords) return null;

				return {
					id: event.id,
					type,
					title: event.title,
					lng: coords[0],
					lat: coords[1],
					date: event.geometry[0].date,
					severity: 'medium', // NASA doesn't provide severity
				};
			})
			.filter(Boolean);

		// Fetch USGS earthquake data
		const usgsResponse = await fetch(
			'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'
		);
		const usgsData = await usgsResponse.json();

		const earthquakes = usgsData.features.map((feature: any) => {
			const magnitude = feature.properties.mag;
			let severity = 'low';
			if (magnitude >= 6.0) severity = 'high';
			else if (magnitude >= 4.5) severity = 'medium';

			return {
				id: feature.id,
				type: 'earthquake',
				title: feature.properties.place,
				lng: feature.geometry.coordinates[0],
				lat: feature.geometry.coordinates[1],
				date: new Date(feature.properties.time).toISOString(),
				severity,
				magnitude,
			};
		});

		// Merge all disasters
		const allDisasters = [...eonetDisasters, ...earthquakes];

		// Cache the result
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
// Fetches satellite TLE data from CelesTrak
app.get('/api/tles', async (c) => {
	const cacheKey = 'tles';
	const cacheTTL = 43200; // 12 hours

	try {
		// Check cache
		const cached = await c.env.AEGIS_CACHE?.get(cacheKey);
		if (cached) {
			console.log('Cache hit: TLEs');
			return c.text(cached);
		}

		console.log('Cache miss: fetching TLEs from CelesTrak');

		// Fetch TLEs for disaster monitoring satellites
		// Landsat-8 (39084), Landsat-9 (49260), Sentinel-2A (40697), 
		// Sentinel-2B (42063), Terra (25994), Aqua (27424)
		const response = await fetch(
			'https://celestrak.org/NORAD/elements/gp.php?CATNR=39084,49260,40697,42063,25994,27424&FORMAT=tle'
		);
		const tleData = await response.text();

		// Cache the TLE data
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

// Route 3: POST /api/analyze
// AI-powered satellite coverage analysis using Gemini
app.post('/api/analyze', async (c) => {
	try {
		const body = await c.req.json();
		const { disasterTitle, satelliteName, passTime, cloudCover } = body;

		if (!disasterTitle || !satelliteName || !passTime || cloudCover === undefined) {
			return c.json({ error: 'Missing required fields' }, 400);
		}

		// Call Gemini API
		const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-pro-preview:generateContent?key=${c.env.GEMINI_API_KEY}`;

		const prompt = `You are an expert satellite imagery analyst. A disaster "${disasterTitle}" will be overpassed by satellite "${satelliteName}" at ${passTime}. Local cloud cover is ${cloudCover}%. 

Reason step-by-step:
1. Will this pass yield useful optical imagery given the cloud cover?
2. If not, can we rely on thermal/radar sensors from this satellite?

Provide a concise 2-sentence summary for a first responder. Be direct and actionable.`;

		const geminiResponse = await fetch(geminiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				contents: [
					{
						parts: [
							{
								text: prompt,
							},
						],
					},
				],
				generationConfig: {
					temperature: 0.7,
					maxOutputTokens: 200,
				},
			}),
		});

		const geminiData = await geminiResponse.json();

		if (!geminiResponse.ok) {
			console.error('Gemini API error:', geminiData);
			return c.json({ error: 'AI analysis failed', details: geminiData }, 500);
		}

		const analysis = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Analysis unavailable';

		return c.json({ analysis });
	} catch (error) {
		console.error('Error in AI analysis:', error);
		return c.json({ error: 'Failed to analyze coverage' }, 500);
	}
});

export default app;
