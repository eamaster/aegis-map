#!/usr/bin/env node
/**
 * AegisMap Point Verification Script
 * 
 * Automated verification that map points match backend disaster coordinates
 * Uses Playwright in headless mode with no user interaction required
 * 
 * Usage:
 *   npm run verify-map-points
 *   FRONTEND_URL=http://localhost:3000 npm run verify-map-points
 *   API_BASE_URL=http://custom-api.com npm run verify-map-points
 */

import { chromium } from 'playwright';

// Configuration from environment variables
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173/';
const API_BASE_URL = process.env.API_BASE_URL || null;
const TIMEOUT_MS = 30000; // 30 seconds
const EPSILON = 1e-5; // Coordinate comparison epsilon

// ANSI color codes for pretty output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'bright');
  console.log('='.repeat(60));
}

async function main() {
  logSection('🌍 AegisMap Point Verification');
  log(`Frontend URL: ${FRONTEND_URL}`, 'cyan');
  if (API_BASE_URL) {
    log(`API Override:  ${API_BASE_URL}`, 'cyan');
  }
  log(`Timeout:      ${TIMEOUT_MS}ms`, 'cyan');
  log(`Epsilon:      ${EPSILON}`, 'cyan');

  let browser;
  let capturedApiResponse = null;
  const validationErrors = [];
  const results = {
    totalApiRecords: 0,
    totalMapFeatures: 0,
    byType: {},
    coordinateMismatches: [],
    duplicateIds: [],
    invalidCoordinates: [],
    invalidTypes: [],
  };

  try {
    // Launch browser
    logSection('🚀 Launching Browser');
    browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to frontend
    logSection('🌐 Navigating to Frontend');
    log(`Loading ${FRONTEND_URL}...`, 'blue');
    
    // Set up network interception BEFORE navigation
    logSection('🔍 Setting up Network Interception');
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      
      // Intercept /api/disasters request
      if (url.includes('/api/disasters')) {
        log(`Intercepted: ${url}`, 'blue');
        
        // Verify API_BASE_URL if provided
        if (API_BASE_URL && !url.startsWith(API_BASE_URL)) {
          validationErrors.push(
            `API URL mismatch: Expected to start with ${API_BASE_URL}, got ${url}`
          );
        }
        
        try {
          // Continue the request and capture response with timeout
          const response = await route.fetch({ timeout: 60000 }); // 60 second timeout
          const body = await response.json();
          capturedApiResponse = body;
          
          log(`Captured ${body.length} disaster records from API`, 'green');
          
          // Fulfill the request with the captured response
          await route.fulfill({ response });
        } catch (error) {
          log(`Failed to fetch from API: ${error.message}`, 'red');
          // Fulfill with error response so page doesn't hang
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Failed to fetch disasters' })
          });
          // Store error but don't throw - let main script handle it
          capturedApiResponse = null;
        }
      } else {
        // Continue all other requests normally
        await route.continue();
      }
    });
    
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    log('Page loaded', 'green');

    // Wait for window.mapDebug to exist
    logSection('🗺️  Waiting for Map Debug Instance');
    await page.waitForFunction(
      () => window.mapDebug !== undefined,
      { timeout: TIMEOUT_MS }
    );
    log('window.mapDebug found', 'green');

    // Wait for map to be loaded by checking if it can get sources
    log('Waiting for map to be ready...', 'blue');
    await page.waitForFunction(
      () => {
        const map = window.mapDebug;
        if (!map) return false;
        // Check if map has basic functionality (can call getSource)
        try {
          // Map is ready if we can call methods on it
          return typeof map.getSource === 'function';
        } catch {
          return false;
        }
      },
      { timeout: TIMEOUT_MS }
    );
    log('Map is ready', 'green');

    // Wait for API response to be captured (poll for it)
    logSection('📊 Waiting for API Response');
    log('Waiting for /api/disasters request...', 'blue');
    
    const startTime = Date.now();
    while (capturedApiResponse === undefined && (Date.now() - startTime < 90000)) { // 90 second timeout
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (capturedApiResponse === undefined || capturedApiResponse === null) {
      throw new Error(
        'Failed to capture API response.\n' +
        'This usually means the backend is unreachable or timing out.\n' +
        'Try:\n' +
        '  1. Ensure backend is running (npm run dev in backend/)\n' +
        '  2. Configure frontend to use local backend (.env: VITE_API_BASE_URL=http://localhost:8787)\n' +
        '  3. Or use API_BASE_URL env var to verify against a specific backend'
      );
    }

    if (!Array.isArray(capturedApiResponse)) {
      throw new Error(`API response is not an array: ${typeof capturedApiResponse}`);
    }

    log(`Captured ${capturedApiResponse.length} disaster records`, 'green');

    // Count API records by type to know which sources should exist
    const apiCountsByType = {
      fire: 0,
      volcano: 0,
      earthquake: 0,
    };

    capturedApiResponse.forEach(record => {
      if (['fire', 'volcano', 'earthquake'].includes(record.type)) {
        apiCountsByType[record.type]++;
      }
    });

    const typeMapping = {
      fire: 'fires',
      volcano: 'volcanoes',
      earthquake: 'earthquakes',
    };

    // Check which sources should exist
    logSection('📊 Checking GeoJSON Sources');
    
    // Only wait for sources that should exist (API count > 0)
    for (const [apiType, sourceType] of Object.entries(typeMapping)) {
      const apiCount = apiCountsByType[apiType];
      
      if (apiCount > 0) {
        log(`Waiting for source '${sourceType}' (API has ${apiCount} ${apiType}s)...`, 'blue');
        await page.waitForFunction(
          (type) => {
            const map = window.mapDebug;
            return map && map.getSource(type) !== undefined;
          },
          sourceType,
          { timeout: TIMEOUT_MS, polling: 100 }
        );
        log(`Source '${sourceType}' exists`, 'green');
      } else {
        log(`Skipping source '${sourceType}' (API has 0 ${apiType}s)`, 'yellow');
      }
    }

    // Extract map source data (only for sources that should exist)
    logSection('🔬 Extracting Map Source Data');
    const mapSourceData = await page.evaluate((typeMappingObj, apiCountsByTypeObj) => {
      const map = window.mapDebug;
      const data = {
        fires: [],
        volcanoes: [],
        earthquakes: [],
      };

      // Extract data from each source, but only if it should exist
      Object.entries(typeMappingObj).forEach(([apiType, sourceType]) => {
        const apiCount = apiCountsByTypeObj[apiType];
        
        if (apiCount > 0) {
          // Source should exist
          const source = map.getSource(sourceType);
          if (source && source._data && source._data.features) {
            data[sourceType] = source._data.features.map(feature => ({
              id: feature.properties?.id,
              type: feature.properties?.type,
              coordinates: feature.geometry?.coordinates,
              properties: feature.properties,
            }));
          }
        }
        // If apiCount is 0, leave data[sourceType] as empty array
      });

      return data;
    }, typeMapping, apiCountsByType);

    log(`Fires:       ${mapSourceData.fires.length} features`, 'cyan');
    log(`Volcanoes:   ${mapSourceData.volcanoes.length} features`, 'cyan');
    log(`Earthquakes: ${mapSourceData.earthquakes.length} features`, 'cyan');

    // Validation
    logSection('✅ Validating Data');

    results.totalApiRecords = capturedApiResponse.length;
    log(`Total API records: ${results.totalApiRecords}`, 'blue');

    // Group API records by type for validation (fresh, not duplicated)
    const apiByType = {
      fire: [],
      volcano: [],
      earthquake: [],
    };

    // Validate each record
    capturedApiResponse.forEach(record => {
      // Validate type
      if (!['fire', 'volcano', 'earthquake'].includes(record.type)) {
        validationErrors.push(
          `Invalid type "${record.type}" for record ${record.id}`
        );
        results.invalidTypes.push({ id: record.id, type: record.type });
      } else {
        apiByType[record.type].push(record);
      }

      // Validate coordinates
      const lat = parseFloat(record.lat);
      const lng = parseFloat(record.lng);

      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        validationErrors.push(
          `Invalid coordinates for ${record.id}: lat=${lat}, lng=${lng}`
        );
        results.invalidCoordinates.push({ id: record.id, lat, lng });
      }
    });

    // Check for duplicate IDs
    const idSet = new Set();
    const duplicates = new Set();
    capturedApiResponse.forEach(record => {
      if (idSet.has(record.id)) {
        duplicates.add(record.id);
      }
      idSet.add(record.id);
    });

    if (duplicates.size > 0) {
      results.duplicateIds = Array.from(duplicates);
      validationErrors.push(
        `Found ${duplicates.size} duplicate IDs: ${Array.from(duplicates).slice(0, 5).join(', ')}${duplicates.size > 5 ? '...' : ''}`
      );
    }

    // Validate counts per type
    for (const [apiType, sourceType] of Object.entries(typeMapping)) {
      const apiCount = apiByType[apiType].length;
      const mapCount = mapSourceData[sourceType].length;

      results.byType[apiType] = {
        apiCount,
        mapCount,
        match: apiCount === mapCount,
      };

      log(`${apiType}: API=${apiCount}, Map=${mapCount}`, apiCount === mapCount ? 'green' : 'red');

      if (apiCount !== mapCount) {
        validationErrors.push(
          `Count mismatch for ${apiType}: API has ${apiCount}, map has ${mapCount}`
        );
      }
    }

    // Validate individual coordinates
    log('\nValidating individual coordinates...', 'blue');
    
    for (const [apiType, sourceType] of Object.entries(typeMapping)) {
      const apiRecords = apiByType[apiType];
      const mapFeatures = mapSourceData[sourceType];

      // Create lookup map for map features by ID
      const mapFeaturesById = new Map();
      mapFeatures.forEach(feature => {
        mapFeaturesById.set(feature.id, feature);
      });

      // Check each API record
      apiRecords.forEach(apiRecord => {
        const mapFeature = mapFeaturesById.get(apiRecord.id);

        if (!mapFeature) {
          validationErrors.push(
            `Missing map feature for ${apiType} ${apiRecord.id}`
          );
          results.coordinateMismatches.push({
            id: apiRecord.id,
            type: apiType,
            expected: { lat: apiRecord.lat, lng: apiRecord.lng },
            actual: null,
            error: 'Missing from map',
          });
          return;
        }

        // Compare coordinates
        const [mapLng, mapLat] = mapFeature.coordinates;
        const latDiff = Math.abs(apiRecord.lat - mapLat);
        const lngDiff = Math.abs(apiRecord.lng - mapLng);

        if (latDiff > EPSILON || lngDiff > EPSILON) {
          validationErrors.push(
            `Coordinate mismatch for ${apiRecord.id}: ` +
            `expected (${apiRecord.lng}, ${apiRecord.lat}), ` +
            `got (${mapLng}, ${mapLat}), ` +
            `diff=(${lngDiff.toExponential(2)}, ${latDiff.toExponential(2)})`
          );
          results.coordinateMismatches.push({
            id: apiRecord.id,
            type: apiType,
            expected: { lat: apiRecord.lat, lng: apiRecord.lng },
            actual: { lat: mapLat, lng: mapLng },
            diff: { lat: latDiff, lng: lngDiff },
          });
        }
      });

      // Check for extra map features not in API (only if they have an id property)
      mapFeatures.forEach(mapFeature => {
        // Only validate features that have an ID (disaster features)
        if (mapFeature.id) {
          const apiRecord = apiRecords.find(r => r.id === mapFeature.id);
          if (!apiRecord) {
            validationErrors.push(
              `Extra map feature not in API: ${apiType} ${mapFeature.id}`
            );
          }
        }
      });
    }

    results.totalMapFeatures = 
      mapSourceData.fires.length + 
      mapSourceData.volcanoes.length + 
      mapSourceData.earthquakes.length;

  } catch (error) {
    logSection('❌ ERROR');
    log(error.message, 'red');
    log(error.stack, 'red');
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  // Print results
  logSection('📋 VERIFICATION RESULTS');

  console.log('\n' + colors.bright + 'Summary:' + colors.reset);
  console.log(`  Total API Records:    ${results.totalApiRecords}`);
  console.log(`  Total Map Features:   ${results.totalMapFeatures}`);
  console.log(`  Validation Errors:    ${validationErrors.length}`);

  console.log('\n' + colors.bright + 'Counts by Type:' + colors.reset);
  for (const [type, counts] of Object.entries(results.byType)) {
    const icon = type === 'fire' ? '🔥' : type === 'volcano' ? '🌋' : '🌍';
    const status = counts.match ? '✓' : '✗';
    const color = counts.match ? 'green' : 'red';
    log(`  ${icon} ${type.padEnd(10)} API: ${counts.apiCount.toString().padStart(3)}, Map: ${counts.mapCount.toString().padStart(3)} ${status}`, color);
  }

  if (results.invalidCoordinates.length > 0) {
    console.log('\n' + colors.bright + 'Invalid Coordinates:' + colors.reset);
    results.invalidCoordinates.slice(0, 10).forEach(item => {
      log(`  ${item.id}: lat=${item.lat}, lng=${item.lng}`, 'red');
    });
    if (results.invalidCoordinates.length > 10) {
      log(`  ... and ${results.invalidCoordinates.length - 10} more`, 'yellow');
    }
  }

  if (results.invalidTypes.length > 0) {
    console.log('\n' + colors.bright + 'Invalid Types:' + colors.reset);
    results.invalidTypes.slice(0, 10).forEach(item => {
      log(`  ${item.id}: type="${item.type}"`, 'red');
    });
    if (results.invalidTypes.length > 10) {
      log(`  ... and ${results.invalidTypes.length - 10} more`, 'yellow');
    }
  }

  if (results.duplicateIds.length > 0) {
    console.log('\n' + colors.bright + 'Duplicate IDs:' + colors.reset);
    results.duplicateIds.slice(0, 10).forEach(id => {
      log(`  ${id}`, 'red');
    });
    if (results.duplicateIds.length > 10) {
      log(`  ... and ${results.duplicateIds.length - 10} more`, 'yellow');
    }
  }

  if (results.coordinateMismatches.length > 0) {
    console.log('\n' + colors.bright + 'Coordinate Mismatches:' + colors.reset);
    results.coordinateMismatches.slice(0, 10).forEach(item => {
      if (item.actual) {
        log(
          `  ${item.id} (${item.type}): ` +
          `expected (${item.expected.lng}, ${item.expected.lat}), ` +
          `got (${item.actual.lng}, ${item.actual.lat}), ` +
          `diff=(${item.diff.lng.toExponential(2)}, ${item.diff.lat.toExponential(2)})`,
          'red'
        );
      } else {
        log(`  ${item.id} (${item.type}): ${item.error}`, 'red');
      }
    });
    if (results.coordinateMismatches.length > 10) {
      log(`  ... and ${results.coordinateMismatches.length - 10} more`, 'yellow');
    }
  }

  // Final verdict
  logSection(validationErrors.length === 0 ? '✅ PASS' : '❌ FAIL');

  if (validationErrors.length === 0) {
    log('All validations passed! Map points match backend disaster coordinates.', 'green');
    process.exit(0);
  } else {
    log(`Found ${validationErrors.length} validation error(s).`, 'red');
    console.log('\n' + colors.bright + 'Error Details:' + colors.reset);
    validationErrors.slice(0, 20).forEach((error, i) => {
      log(`  ${i + 1}. ${error}`, 'red');
    });
    if (validationErrors.length > 20) {
      log(`  ... and ${validationErrors.length - 20} more errors`, 'yellow');
    }
    process.exit(1);
  }
}

main().catch(err => {
  log('\n❌ FATAL ERROR', 'red');
  log(err.message, 'red');
  console.error(err);
  process.exit(1);
});
