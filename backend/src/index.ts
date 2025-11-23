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
	const cacheKey = 'tles_v2';
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
		const satellites = [39084, 49260, 40697, 42063, 25994, 27424];

		console.log(`Fetching TLEs for ${satellites.length} satellites...`);

		const tlePromises = satellites.map(async (catNr) => {
			try {
				const response = await fetch(
					`https://celestrak.org/NORAD/elements/gp.php?CATNR=${catNr}&FORMAT=tle`
				);
				if (!response.ok) {
					console.error(`Failed to fetch TLE for ${catNr}: ${response.status} ${response.statusText}`);
					return null;
				}
				const text = await response.text();
				// Validate that we got actual TLE data (should have 3 lines minimum)
				if (!text || text.trim().length === 0 || text.trim().split('\n').filter(l => l.trim()).length < 3) {
					console.warn(`Invalid TLE data for ${catNr}: received ${text?.length || 0} chars, ${text?.split('\n').length || 0} lines`);
					return null;
				}
				console.log(`✅ Fetched valid TLE for ${catNr}: ${text.trim().split('\n').length} lines`);
				return text.trim(); // Remove trailing whitespace
			} catch (error) {
				console.error(`Error fetching TLE for ${catNr}:`, error);
				return null;
			}
		});

		const results = await Promise.all(tlePromises);
		// Filter out null/empty strings and join with newlines to separate TLEs
		const validTLEs = results.filter(tle => tle !== null && tle !== undefined && tle.trim().length > 0);
		
		if (validTLEs.length === 0) {
			console.error('No valid TLEs fetched from CelesTrak');
			return c.json({ error: 'No TLE data available' }, 500);
		}
		
		const tleData = validTLEs.join('\n'); // Combine all TLEs with newlines between them
		
		console.log(`Fetched ${validTLEs.length} valid TLE sets, total length: ${tleData.length}`);

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

		// Call Gemini API - Try multiple model names for compatibility
		// Try Gemini 3 Preview Pro models first, then fallback to stable models
		const models = [
			'gemini-3.0-pro-preview',      // Gemini 3 Preview Pro (if available)
			'gemini-3-pro-preview',        // Alternative naming
			'gemini-pro-3.0-preview',      // Alternative naming
			'gemini-exp-1206',             // Experimental/preview naming
			'gemini-1.5-pro-latest',       // Latest stable 1.5 Pro
			'gemini-1.5-pro',              // Stable 1.5 Pro
			'gemini-pro',                  // Latest Pro model
		];
		const apiVersions = ['v1', 'v1beta'];
		
		const prompt = `You are an expert satellite imagery analyst. A disaster "${disasterTitle}" will be overpassed by satellite "${satelliteName}" at ${passTime}. Local cloud cover is ${cloudCover}%. 

Reason step-by-step:
1. Will this pass yield useful optical imagery given the cloud cover?
2. If not, can we rely on thermal/radar sensors from this satellite?

Provide a concise 2-sentence summary for a first responder. Be direct and actionable.`;

		const requestBody = {
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
		};

		let lastError: any = null;
		
		// Try different model/version combinations
		for (const apiVersion of apiVersions) {
			for (const model of models) {
				try {
					const geminiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${c.env.GEMINI_API_KEY}`;
					
					console.log(`Trying Gemini API: ${apiVersion}/${model}`);
					
					const geminiResponse = await fetch(geminiUrl, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(requestBody),
					});

					const geminiData = await geminiResponse.json();

					if (geminiResponse.ok) {
						const analysis = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Analysis unavailable';
						console.log(`✅ Successfully used Gemini model: ${apiVersion}/${model}`);
						return c.json({ analysis });
					}
					
					// If 404, try next model
					if (geminiResponse.status === 404) {
						console.warn(`Model ${apiVersion}/${model} not found, trying next...`);
						lastError = geminiData;
						continue;
					}
					
					// For other errors, log and try next
					console.error(`Gemini API error (${apiVersion}/${model}):`, geminiData);
					lastError = geminiData;
					
				} catch (error) {
					console.error(`Error calling Gemini API (${apiVersion}/${model}):`, error);
					lastError = error;
					continue;
				}
			}
		}

		// If all models failed, return error
		console.error('All Gemini model attempts failed. Last error:', lastError);
		return c.json({ 
			error: 'AI analysis failed', 
			details: lastError,
			message: 'Unable to connect to any available Gemini model. Please check API key and model availability.'
		}, 500);
	} catch (error) {
		console.error('Error in AI analysis:', error);
		return c.json({ error: 'Failed to analyze coverage' }, 500);
	}
});

export default app;
