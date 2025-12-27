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

/**
 * Gemini API Configuration
 * Using Gemini 3.0 Flash (December 2025) with stable fallbacks
 * Models are tried in order until one succeeds
 */
const GEMINI_CONFIG = {
	models: [
		'gemini-3-flash-preview',        // ✅ Latest GA (Dec 2025) - frontier intelligence
		'gemini-2.5-flash',              // ✅ Stable production (Sept 2025)
		'gemini-2.5-flash-lite',         // ✅ Cost-optimized fallback
		'gemini-2.0-flash',              // ✅ Legacy support (Feb 2025)
	],
	apiVersion: 'v1beta',             // v1beta required for Gemini 3.0 models
	cacheVersion: 'v3',                // Increment to invalidate truncated 500-token responses
	appVersion: '1.1.0',               // Bumped from 1.0.0
} as const;

// Enable CORS for frontend
app.use('/*', cors());

// Health check
app.get('/', (c) => {
	return c.json({ status: 'AegisMap API Online', version: GEMINI_CONFIG.appVersion });
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

		// ✅ CORRECTED: Parse VIIRS CSV format with correct field names
		// CSV columns: latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight
		const hotspots = lines.map(line => {
			const parts = line.split(',');
			return {
				latitude: parseFloat(parts[0]),
				longitude: parseFloat(parts[1]),
				bright_ti4: parseFloat(parts[2]), // ✅ FIXED: VIIRS I-4 brightness temperature (Kelvin)
				scan: parseFloat(parts[3]),
				track: parseFloat(parts[4]),
				acq_date: parts[5],
				acq_time: parts[6],
				satellite: parts[7],
				confidence: parts[8], // 'l' = low, 'n' = nominal, 'h' = high
				version: parts[9],
				bright_ti5: parseFloat(parts[10]), // ✅ VIIRS I-5 brightness (background)
				frp: parseFloat(parts[11]), // Fire Radiative Power (MW)
				daynight: parts[12],
			};
		});

		// Calculate statistics
		const totalCount = hotspots.length;
		const highConfidence = hotspots.filter(h => h.confidence === 'h' || h.confidence === 'high').length;
		const maxBrightness = Math.max(...hotspots.map(h => h.bright_ti4)); // ✅ FIXED: Use bright_ti4
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
// AI-powered satellite coverage analysis using Gemini (WITH SMART CACHING)
app.post('/api/analyze', async (c) => {
	try {
		const body = await c.req.json();
		const { disasterTitle, satelliteName, passTime, cloudCover } = body;

		if (!disasterTitle || !satelliteName || !passTime || cloudCover === undefined) {
			return c.json({ error: 'Missing required fields' }, 400 as any);
		}

		// ✅ SMART CACHE KEY GENERATION
		const disasterType = disasterTitle.toLowerCase().includes('fire') ? 'fire' :
			disasterTitle.toLowerCase().includes('volcano') ? 'volcano' :
				disasterTitle.toLowerCase().includes('earthquake') ? 'earthquake' : 'disaster';

		const satelliteType = satelliteName.toUpperCase().includes('LANDSAT') ? 'LANDSAT' :
			satelliteName.toUpperCase().includes('SENTINEL') ? 'SENTINEL' :
				satelliteName.toUpperCase().includes('TERRA') ? 'TERRA' :
					satelliteName.toUpperCase().includes('AQUA') ? 'AQUA' :
						satelliteName.replace(/[^A-Z0-9]/gi, '').substring(0, 10);

		// Bucket cloud cover by 5% intervals
		const cloudBucket = Math.floor(cloudCover / 5) * 5;

		// Create cache key
		const cacheKey = `gemini_${GEMINI_CONFIG.cacheVersion}:${disasterType}:${satelliteType}:${cloudBucket}`;

		console.log(`🔍 Cache lookup: ${cacheKey}`);

		// ✅ CHECK CACHE FIRST
		if (c.env.AEGIS_CACHE) {
			const cached = await c.env.AEGIS_CACHE.get(cacheKey);
			if (cached) {
				console.log(`✅ CACHE HIT: Returning cached analysis`);

				// Personalize cached template
				const passDate = new Date(passTime);
				const timeStr = passDate.toLocaleTimeString('en-US', {
					hour: '2-digit',
					minute: '2-digit',
					timeZone: 'UTC'
				}) + ' UTC';

				const personalizedAnalysis = cached
					.replace(/SATELLITE_NAME/g, satelliteName)
					.replace(/DISASTER_TITLE/g, `"${disasterTitle}"`)
					.replace(/PASS_TIME/g, timeStr)
					.replace(/CLOUD_COVER/g, cloudCover.toString());

				return c.json({
					analysis: personalizedAnalysis,
					cached: true
				});
			}
		}

		console.log(`❌ CACHE MISS: Calling Gemini API`);

		// Check if API key is set FIRST
		if (!c.env.GEMINI_API_KEY) {
			console.error('❌ GEMINI_API_KEY is not set in environment variables');
			// Return fallback analysis instead of error
			return c.json({
				analysis: `Satellite ${satelliteName} will pass over "${disasterTitle}" at ${new Date(passTime).toLocaleString()}. Cloud cover: ${cloudCover}%. ${cloudCover < 30 ? 'Excellent imaging conditions expected with clear skies.' : cloudCover < 60 ? 'Moderate cloud coverage may partially affect image quality.' : 'Heavy cloud coverage will significantly limit optical imagery quality.'}`
			});
		}

		// Use Gemini 3.0 Flash with stable fallbacks
		const models = GEMINI_CONFIG.models;
		const apiVersions = [GEMINI_CONFIG.apiVersion];

		const prompt = `You are a satellite imagery analyst. A disaster "${disasterTitle}" will be observed by satellite "${satelliteName}" at ${new Date(passTime).toLocaleString()} UTC. Cloud cover: ${cloudCover}%.

Assess: Will this pass provide useful imagery? Consider optical limitations and alternative sensors.

Provide exactly 2 sentences for emergency responders. Be concise and actionable.`;

		const requestBody = {
			contents: [
				{
					role: "user",
					parts: [{ text: prompt }],
				},
			],
			generation_config: {
				temperature: 0.7,
				max_output_tokens: 2048,  // High limit for Gemini 3 thinking tokens (60+) + full response
				top_p: 0.9,
				top_k: 40,
			},
		};

		let lastError: any = null;
		let attempts: string[] = [];

		// Try different model/version combinations
		for (const apiVersion of apiVersions) {
			for (const model of models) {
				const attempt = `${apiVersion}/${model}`;
				try {
					const geminiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${c.env.GEMINI_API_KEY}`;
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

					// Enhanced logging
					console.log(`📡 Gemini API response for ${attempt}:`, {
						status: geminiResponse.status,
						ok: geminiResponse.ok,
						hasError: !!geminiData.error,
						errorCode: geminiData.error?.code,
						errorMessage: geminiData.error?.message?.substring(0, 200),
						hasCandidates: !!geminiData.candidates,
					});

					if (geminiResponse.ok) {
						const rawAnalysis = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

						if (!rawAnalysis || rawAnalysis.trim().length === 0) {
							console.warn(`⚠️ Empty analysis from ${attempt}, trying next model...`);
							continue;
						}

						const analysis = rawAnalysis.trim();
						console.log(`✅ SUCCESS with ${attempt}: ${analysis.length} chars`);

						// ✅ CREATE CACHEABLE TEMPLATE
						const passDate = new Date(passTime);
						const timeStr = passDate.toLocaleTimeString('en-US', {
							hour: '2-digit',
							minute: '2-digit',
							timeZone: 'UTC'
						}) + ' UTC';

						const template = analysis
							.replace(new RegExp(satelliteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'SATELLITE_NAME')
							.replace(new RegExp(`"${disasterTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'), 'DISASTER_TITLE')
							.replace(new RegExp(timeStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'PASS_TIME')
							.replace(new RegExp(`\\b${cloudCover}%`, 'g'), 'CLOUD_COVER%');

						// ✅ CACHE THE TEMPLATE
						if (c.env.AEGIS_CACHE) {
							await c.env.AEGIS_CACHE.put(cacheKey, template, {
								expirationTtl: 7200 // 2 hours
							});
							console.log(`✅ Cached template: ${cacheKey}`);
						}

						return c.json({
							analysis,
							cached: false
						});
					}

					// Handle specific error codes
					if (geminiResponse.status === 404) {
						console.warn(`⚠️ Model ${attempt} not found (404), trying next...`);
						lastError = geminiData;
						continue;
					}

					if (geminiResponse.status === 400) {
						const errorMsg = geminiData.error?.message || '';

						// Regional restrictions
						if (errorMsg.includes('location is not supported')) {
							console.error('❌ Regional restriction - Gemini API unavailable in your region');
							return c.json({
								analysis: `Satellite ${satelliteName} will pass over this disaster at ${new Date(passTime).toLocaleString()} UTC. Cloud cover: ${cloudCover}%. ${cloudCover < 30 ? 'Clear conditions expected - excellent for optical imagery.' : cloudCover < 60 ? 'Partial cloud cover may affect optical quality. Thermal sensors recommended.' : 'Heavy clouds will obscure optical imagery. Rely on SAR or thermal sensors.'}`
							});
						}

						// Invalid API key
						if (errorMsg.includes('API key not valid')) {
							console.error('❌ Invalid API key');
							return c.json({
								analysis: `Satellite ${satelliteName} scheduled to pass at ${new Date(passTime).toLocaleString()} UTC. Cloud cover: ${cloudCover}%. Manual analysis required.`
							});
						}
					}

					// Log error and continue to next model
					console.error(`❌ Error from ${attempt}:`, geminiData.error);
					lastError = geminiData;

				} catch (fetchError) {
					console.error(`❌ Fetch error for ${attempt}:`, fetchError);
					lastError = fetchError;
					continue;
				}
			}
		}

		// If all models failed, return fallback analysis instead of error
		console.error('❌ All Gemini attempts failed. Attempts:', attempts);
		console.error('Last error:', lastError);

		// Return fallback analysis based on cloud cover
		return c.json({
			analysis: `Satellite ${satelliteName} will observe "${disasterTitle}" at ${new Date(passTime).toLocaleString()} UTC. Cloud cover: ${cloudCover}%. ${cloudCover < 30 ? 'Clear skies favor high-quality optical imagery.' : cloudCover < 60 ? 'Moderate clouds may reduce optical quality. Thermal sensors available.' : 'Heavy cloud coverage limits optical imaging. SAR or thermal data recommended.'}`
		});

	} catch (error) {
		console.error('❌ Unexpected error in /api/analyze:', error);
		return c.json({
			analysis: 'Analysis temporarily unavailable. Satellite pass detected.'
		});
	}
});

// Diagnostic Route: GET /api/test-gemini
app.get('/api/test-gemini', async (c) => {
	try {
		console.log('🧪 Testing Gemini API...');

		// Check if key exists
		if (!c.env.GEMINI_API_KEY) {
			return c.json({
				error: 'GEMINI_API_KEY not set in environment',
				envKeys: Object.keys(c.env || {})
			}, 500 as any);
		}

		// Test API call with latest Gemini 3 Flash model
		const testUrl = `https://generativelanguage.googleapis.com/${GEMINI_CONFIG.apiVersion}/models/${GEMINI_CONFIG.models[0]}:generateContent?key=${c.env.GEMINI_API_KEY}`;

		const response = await fetch(testUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				contents: [{
					parts: [{ text: "Say 'API Working' in 2 words" }]
				}]
			})
		});

		const data = await response.json() as any;

		return c.json({
			status: response.status,
			ok: response.ok,
			keyLength: c.env.GEMINI_API_KEY.length,
			keyPrefix: c.env.GEMINI_API_KEY.substring(0, 10) + '...',
			response: data
		});

	} catch (error) {
		return c.json({
			error: 'Test failed',
			message: error instanceof Error ? error.message : String(error)
		}, 500 as any);
	}
});

export default app;
