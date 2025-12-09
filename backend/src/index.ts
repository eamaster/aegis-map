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
	FIRMS_MAP_KEY: string;
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
		const eonetData = await eonetResponse.json() as any;

		// Filter for wildfires and volcanoes using EONET v3 string IDs
		const eonetDisasters = eonetData.events
			.filter((event: any) => {
				const categoryIds = event.categories.map((cat: any) => cat.id);
				// FIX: Use string IDs for v3 API (not numeric v2.1 IDs)
				return categoryIds.includes('wildfires') || categoryIds.includes('volcanoes');
			})
			.map((event: any) => {
				const categoryId = event.categories[0]?.id;
				// FIX: Use string comparison for v3 API
				const type = categoryId === 'wildfires' ? 'fire' : 'volcano';

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
		const usgsData = await usgsResponse.json() as any;

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

		// Log counts for debugging
		console.log(`✅ Fetched ${eonetDisasters.length} EONET disasters (wildfires/volcanoes) and ${earthquakes.length} earthquakes`);

		// Cache the result
		if (c.env.AEGIS_CACHE) {
			await c.env.AEGIS_CACHE.put(cacheKey, JSON.stringify(allDisasters), {
				expirationTtl: cacheTTL,
			});
		}

		return c.json(allDisasters);
	} catch (error) {
		console.error('Error fetching disasters:', error);
		return c.json({ error: 'Failed to fetch disaster data' }, 500 as any);
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
			return c.json({ error: 'No TLE data available' }, 500 as any);
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
		return c.json({ error: 'Failed to fetch TLE data' }, 500 as any);
	}
});

// Route 2.5: GET /api/fire-hotspots
// Fetches NASA FIRMS fire hotspot data
app.get('/api/fire-hotspots', async (c) => {
	const { lat, lng } = c.req.query();

	if (!lat || !lng) {
		return c.json({ error: 'Missing lat/lng parameters' }, 400 as any);
	}

	try {
		// Check if FIRMS_MAP_KEY is configured
		const FIRMS_MAP_KEY = c.env.FIRMS_MAP_KEY;

		if (!FIRMS_MAP_KEY || FIRMS_MAP_KEY === 'YOUR_FIRMS_MAP_KEY_HERE') {
			console.warn('⚠️ FIRMS_MAP_KEY not configured - returning empty data');
			return c.json({
				hotspots: [],
				totalCount: 0,
				highConfidence: 0,
				maxBrightness: 0,
				maxPower: 0,
				message: 'FIRMS API key not configured. Register at https://firms.modaps.eosdis.nasa.gov/api/'
			});
		}

		// Calculate area bounds (±0.5 degrees = ~55km radius)
		const lat1 = parseFloat(lat) - 0.5;
		const lat2 = parseFloat(lat) + 0.5;
		const lon1 = parseFloat(lng) - 0.5;
		const lon2 = parseFloat(lng) + 0.5;

		// FIRMS API: area CSV format (VIIRS satellite, last 7 days)
		const firmsUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/${lon1},${lat1},${lon2},${lat2}/7`;

		console.log(`Fetching FIRMS data from: ${firmsUrl.replace(FIRMS_MAP_KEY, 'REDACTED')}`);

		const response = await fetch(firmsUrl);

		if (!response.ok) {
			console.error(`FIRMS API error: ${response.status} ${response.statusText}`);
			return c.json({ error: 'Failed to fetch fire hotspot data' }, response.status as any);
		}

		const csvText = await response.text();

		// Parse CSV (skip header line)
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

		const hotspots = lines.map(line => {
			const parts = line.split(',');
			return {
				latitude: parseFloat(parts[0]),
				longitude: parseFloat(parts[1]),
				brightness: parseFloat(parts[2]), // Kelvin
				scan: parseFloat(parts[3]),
				track: parseFloat(parts[4]),
				acq_date: parts[5],
				acq_time: parts[6],
				satellite: parts[7],
				confidence: parts[8], // 'l' = low, 'n' = nominal, 'h' = high
				version: parts[9],
				bright_t31: parseFloat(parts[10]), // Background brightness
				frp: parseFloat(parts[11]), // Fire Radiative Power (MW)
				daynight: parts[12],
			};
		});

		// Calculate statistics
		const totalCount = hotspots.length;
		const highConfidence = hotspots.filter(h => h.confidence === 'h').length;
		const maxBrightness = Math.max(...hotspots.map(h => h.brightness));
		const maxPower = Math.max(...hotspots.map(h => h.frp));

		console.log(`✅ FIRMS: ${totalCount} hotspots, ${highConfidence} high confidence, max brightness: ${maxBrightness}K, max power: ${maxPower}MW`);

		return c.json({
			hotspots,
			totalCount,
			highConfidence,
			maxBrightness,
			maxPower,
		});

	} catch (error) {
		console.error('Error fetching FIRMS data:', error);
		return c.json({ error: 'Failed to fetch fire hotspot data' }, 500 as any);
	}
});

// Route 3: POST /api/analyze
// AI-powered satellite coverage analysis using Gemini
app.post('/api/analyze', async (c) => {
	try {
		const body = await c.req.json();
		const { disasterTitle, satelliteName, passTime, cloudCover } = body;

		if (!disasterTitle || !satelliteName || !passTime || cloudCover === undefined) {
			return c.json({ error: 'Missing required fields' }, 400 as any);
		}

		// Call Gemini API - Use current stable models (December 2025)
		const models = [
			'gemini-1.5-flash',     // ✅ Stable, works globally
			'gemini-1.5-pro',       // ✅ Backup if flash unavailable
		];
		const apiVersions = ['v1', 'v1beta']; // Try v1 first, then v1beta

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
		let attempts: string[] = [];

		// Check if API key is set
		if (!c.env.GEMINI_API_KEY) {
			console.error('❌ GEMINI_API_KEY is not set in environment variables');
			return c.json({
				error: 'AI analysis failed',
				details: { error: 'GEMINI_API_KEY environment variable is not configured' },
				message: 'Gemini API key is missing. Please configure GEMINI_API_KEY in Cloudflare Worker secrets.'
			}, 500 as any);
		}

		// Try different model/version combinations
		for (const apiVersion of apiVersions) {
			for (const model of models) {
				try {
					const geminiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${c.env.GEMINI_API_KEY}`;
					const attempt = `${apiVersion}/${model}`;
					attempts.push(attempt);

					console.log(`🔄 Trying Gemini API: ${attempt}`);

					const geminiResponse = await fetch(geminiUrl, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(requestBody),
					});

					const geminiData = await geminiResponse.json() as any;

					// Log the actual API response for debugging
					console.log(`📡 Gemini API response for ${attempt}:`, {
						status: geminiResponse.status,
						ok: geminiResponse.ok,
						hasError: !!geminiData.error,
						errorCode: geminiData.error?.code,
						errorMessage: geminiData.error?.message?.substring(0, 100)
					});

					if (geminiResponse.ok) {
						const rawAnalysis = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
						console.log(`✅ Gemini API response (${apiVersion}/${model}):`, {
							hasCandidates: !!geminiData.candidates,
							candidateCount: geminiData.candidates?.length || 0,
							hasContent: !!geminiData.candidates?.[0]?.content,
							hasParts: !!geminiData.candidates?.[0]?.content?.parts,
							partCount: geminiData.candidates?.[0]?.content?.parts?.length || 0,
							rawAnalysisLength: rawAnalysis?.length || 0,
							rawAnalysisPreview: rawAnalysis?.substring(0, 100) || 'N/A',
							fullResponse: JSON.stringify(geminiData).substring(0, 500)
						});

						if (!rawAnalysis || rawAnalysis.trim().length === 0) {
							console.error(`❌ Gemini returned empty analysis for ${apiVersion}/${model}:`, geminiData);
							continue; // Try next model
						}

						const analysis = rawAnalysis.trim();
						console.log(`✅ Successfully used Gemini model: ${apiVersion}/${model}, analysis length: ${analysis.length}`);
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

					// Special handling for regional restrictions
					if (geminiData.error?.code === 400 && geminiData.error?.message?.includes('location is not supported')) {
						console.error('❌ Regional restriction detected - API not available in your location');
						return c.json({
							error: 'AI analysis unavailable',
							details: { error: 'Gemini API is not available in your region' },
							analysis: `Satellite ${satelliteName} will pass over this disaster at ${new Date(passTime).toLocaleString()}. Cloud cover: ${cloudCover}%. ${cloudCover < 30 ? 'Good imaging conditions expected.' : 'Cloud coverage may affect image quality.'}`
						}, 503 as any); // Return 503 Service Unavailable with fallback analysis
					}

				} catch (error) {
					console.error(`Error calling Gemini API (${apiVersion}/${model}):`, error);
					lastError = error;
					continue;
				}
			}
		}

		// If all models failed, return error
		console.error('❌ All Gemini model attempts failed. Tried models:', attempts);
		console.error('Last error:', lastError);
		return c.json({
			error: 'AI analysis failed',
			details: lastError,
			attempts: attempts,
			message: `Unable to connect to any available Gemini model after trying ${attempts.length} combinations. Please check API key and model availability. Tried: ${attempts.join(', ')}`
		}, 500 as any);
	} catch (error) {
		console.error('Error in AI analysis:', error);
		return c.json({ error: 'Failed to analyze coverage' }, 500 as any);
	}
});

export default app;
