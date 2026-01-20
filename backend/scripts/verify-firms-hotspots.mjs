#!/usr/bin/env node
/**
 * FIRMS Hotspot Data Verification Script
 * 
 * Compares our backend API endpoint vs direct FIRMS API calls
 * to identify discrepancies in fire hotspot data.
 * 
 * Usage:
 *   # Compare sampled disasters
 *   FIRMS_MAP_KEY=xxx node backend/scripts/verify-firms-hotspots.mjs
 * 
 *   # Test single location
 *   FIRMS_MAP_KEY=xxx node backend/scripts/verify-firms-hotspots.mjs --lat 40 --lng -120
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
const FIRMS_MAP_KEY = process.env.FIRMS_MAP_KEY;
const SAMPLE_COUNT = parseInt(process.env.SAMPLE_COUNT || '10', 10);
const BBOX_DEG = parseFloat(process.env.BBOX_DEG || '0.5');
const DAYS = parseInt(process.env.DAYS || '7', 10);

// Parse CLI args
const args = process.argv.slice(2);
const singleLat = args.includes('--lat') ? parseFloat(args[args.indexOf('--lat') + 1]) : null;
const singleLng = args.includes('--lng') ? parseFloat(args[args.indexOf('--lng') + 1]) : null;

async function main() {
    console.log('🔥 FIRMS Hotspot Verification Script\\n');
    console.log(`Configuration:`);
    console.log(`  API Base URL: ${API_BASE_URL}`);
    console.log(`  BBox Degrees: ±${BBOX_DEG}°`);
    console.log(`  Days: ${DAYS}`);
    console.log(`  Sample Count: ${SAMPLE_COUNT}\\n`);

    // Check FIRMS key
    if (!FIRMS_MAP_KEY || FIRMS_MAP_KEY === 'YOUR_FIRMS_MAP_KEY_HERE') {
        console.error('❌ FIRMS_MAP_KEY environment variable not set or invalid');
        console.error('   Register at: https://firms.modaps.eosdis.nasa.gov/api/\\n');
        process.exit(2);
    }

    console.log(`✅ FIRMS_MAP_KEY: ${FIRMS_MAP_KEY.substring(0, 8)}...\\n`);

    let testsRun = 0;
    let testsPassed = 0;
    let testsFailed = 0;

    try {
        // Single location mode
        if (singleLat !== null && singleLng !== null) {
            console.log(`📍 Testing single location: (${singleLat}, ${singleLng})\\n`);
            const result = await compareLocation(singleLat, singleLng);
            testsRun = 1;
            if (result.match) {
                testsPassed = 1;
                console.log('\\n✅ MATCH: Counts are identical\\n');
            } else {
                testsFailed = 1;
                console.log('\\n❌ MISMATCH: See details above\\n');
            }
        }
        // Sample disasters mode
        else {
            console.log('📡 Fetching disaster list from our API...\\n');

            const disastersResp = await fetch(`${API_BASE_URL}/api/disasters`);
            if (!disastersResp.ok) {
                throw new Error(`Failed to fetch disasters: ${disastersResp.status} ${disastersResp.statusText}`);
            }

            const disasters = await disastersResp.json();
            const fires = disasters.filter(d => d.type === 'fire');

            if (fires.length === 0) {
                console.log('⚠️ No fire disasters found from /api/disasters');
                console.log('   This may indicate no active fires or a data source issue.\\n');
                process.exit(0);
            }

            console.log(`Found ${fires.length} fire events. Testing ${Math.min(SAMPLE_COUNT, fires.length)} samples...\\n`);

            const sampled = fires.slice(0, SAMPLE_COUNT);

            for (let i = 0; i < sampled.length; i++) {
                const fire = sampled[i];
                console.log(`[${i + 1}/${sampled.length}] Testing: ${fire.title} (${fire.id})`);
                console.log(`         Location: (${fire.lat}, ${fire.lng})\\n`);

                const result = await compareLocation(fire.lat, fire.lng, fire);
                testsRun++;

                if (result.match) {
                    testsPassed++;
                } else {
                    testsFailed++;
                }

                console.log('─'.repeat(60) + '\\n');
            }
        }

        // Summary
        console.log('\\n📊 VERIFICATION SUMMARY:\\n');
        console.log(`  Total Tests:  ${testsRun}`);
        console.log(`  ✅ Passed:     ${testsPassed}`);
        console.log(`  ❌ Failed:     ${testsFailed}`);
        console.log(`  Success Rate: ${((testsPassed / testsRun) * 100).toFixed(1)}%\\n`);

        process.exit(testsFailed > 0 ? 1 : 0);

    } catch (error) {
        console.error('\\n❌ Fatal error:', error.message);
        if (error.stack) console.error(error.stack);
        process.exit(2);
    }
}

/**
 * Compare hotspot counts for a single location
 */
async function compareLocation(lat, lng, eventInfo = null) {
    try {
        // 1. Call our API
        const ourUrl = `${API_BASE_URL}/api/fire-hotspots?lat=${lat}&lng=${lng}`;
        const ourResp = await fetch(ourUrl);

        if (!ourResp.ok) {
            throw new Error(`Our API failed: ${ourResp.status} ${ourResp.statusText}`);
        }

        const ourData = await ourResp.json();

        // Check for configuration message
        if (ourData.message && ourData.message.includes('FIRMS API key not configured')) {
            console.log('⚠️ Our API: FIRMS key not configured in backend');
            return { match: false, reason: 'config_error' };
        }

        const ourCount = ourData.totalCount || 0;
        const ourHighConf = ourData.highConfidence || 0;
        const ourMaxBright = ourData.maxBrightness || 0;
        const ourMaxPower = ourData.maxPower || 0;

        console.log(`  Our API:     ${ourCount} hotspots (${ourHighConf} high confidence)`);
        console.log(`               Max: ${ourMaxBright.toFixed(1)}K brightness, ${ourMaxPower.toFixed(1)}MW power`);

        // 2. Call FIRMS directly
        const lat1 = lat - BBOX_DEG;
        const lat2 = lat + BBOX_DEG;
        const lon1 = lng - BBOX_DEG;
        const lon2 = lng + BBOX_DEG;

        const firmsUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/${lon1},${lat1},${lon2},${lat2}/${DAYS}`;

        console.log(`  FIRMS URL:   ${firmsUrl.replace(FIRMS_MAP_KEY, 'REDACTED')}`);

        const firmsResp = await fetch(firmsUrl);

        if (!firmsResp.ok) {
            throw new Error(`FIRMS API failed: ${firmsResp.status} ${firmsResp.statusText}`);
        }

        const csvText = await firmsResp.text();
        const lines = csvText.trim().split('\\n');

        // First line is header
        const header = lines[0];
        const dataLines = lines.slice(1).filter(l => l.trim() !== '');

        const firmsCount = dataLines.length;

        // Parse CSV for stats
        let firmsHighConf = 0;
        let firmsMaxBright = 0;
        let firmsMaxPower = 0;

        if (firmsCount > 0) {
            dataLines.forEach(line => {
                const parts = line.split(',');
                // CSV format: latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight
                const confidence = parts[8];
                const bright_ti4 = parseFloat(parts[2]);
                const frp = parseFloat(parts[11]);

                if (confidence === 'h' || confidence === 'high') firmsHighConf++;
                if (bright_ti4 > firmsMaxBright) firmsMaxBright = bright_ti4;
                if (frp > firmsMaxPower) firmsMaxPower = frp;
            });
        }

        console.log(`  FIRMS Direct: ${firmsCount} hotspots (${firmsHighConf} high confidence)`);
        console.log(`               Max: ${firmsMaxBright.toFixed(1)}K brightness, ${firmsMaxPower.toFixed(1)}MW power`);

        // 3. Compare
        const match = ourCount === firmsCount;

        if (!match) {
            console.log(`\\n  ❌ MISMATCH DETECTED:`);
            console.log(`     Our API:  ${ourCount} hotspots`);
            console.log(`     FIRMS:    ${firmsCount} hotspots`);
            console.log(`     Delta:    ${firmsCount - ourCount} (expected - actual)`);

            if (firmsCount > 0 && dataLines.length > 0) {
                console.log(`\\n  First 2 FIRMS CSV lines (for debugging):`);
                console.log(`  Header: ${header}`);
                console.log(`  Line 1: ${dataLines[0]}`);
                if (dataLines.length > 1) {
                    console.log(`  Line 2: ${dataLines[1]}`);
                }
            }

            return { match: false, ourCount, firmsCount, delta: firmsCount - ourCount };
        }

        console.log(`  ✅ MATCH`);
        return { match: true, count: ourCount };

    } catch (error) {
        console.log(`  ❌ ERROR: ${error.message}`);
        return { match: false, error: error.message };
    }
}

main();
