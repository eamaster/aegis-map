# AegisMap Point Verification

Automated verification that AegisMap map points match backend disaster coordinates.

## Overview

This verification script uses Playwright in headless mode to:
- Launch the frontend application in Chromium
- Intercept the `/api/disasters` network request and capture the response
- Wait for the Mapbox map instance (`window.mapDebug`) to be ready
- Extract the actual rendered GeoJSON source data from the map
- Validate that every disaster in the API matches the map coordinates exactly

**No user actions required** - fully automated headless verification.

## Requirements

- Node.js 18+
- Playwright (automatically installed as dev dependency)
- Frontend and backend servers must be running

## Installation

Playwright is already installed as a dev dependency. To install the Chromium browser:

```bash
npx playwright install chromium
```

## Usage

### Basic Usage

With both frontend and backend running locally:

```bash
npm run verify-map-points
```

### Custom Frontend URL

```bash
FRONTEND_URL=http://localhost:3000 npm run verify-map-points
```

### Custom API Base URL

If you want to verify that requests go to a specific API endpoint:

```bash
API_BASE_URL=https://my-backend.com npm run verify-map-points
```

### Combined

```bash
FRONTEND_URL=http://localhost:3000 API_BASE_URL=http://localhost:8787 npm run verify-map-points
```

## What It Validates

### 1. API Response Validation
- ✅ All disaster records have valid coordinate ranges: `lat ∈ [-90, 90]`, `lng ∈ [-180, 180]`
- ✅ All disaster types are one of: `fire`, `volcano`, `earthquake`
- ✅ No duplicate IDs in the API response
- ✅ Optional: API requests go to the expected base URL (if `API_BASE_URL` is set)

### 2. Map Source Validation
- ✅ All three GeoJSON sources exist: `fires`, `volcanoes`, `earthquakes`
- ✅ Source data can be extracted from `window.mapDebug`

### 3. Data Parity Validation
- ✅ Count of map features equals count of API disasters per type
- ✅ Every API disaster ID exists as a map feature
- ✅ Every map feature ID exists in the API response
- ✅ Coordinates match within epsilon `1e-5` (0.00001 degrees ≈ 1 meter)

## Output

### Success Example

```
============================================================
✅ PASS
============================================================
All validations passed! Map points match backend disaster coordinates.

Summary:
  Total API Records:    5792
  Total Map Features:   5792
  Validation Errors:    0

Counts by Type:
  🔥 fire       API: 5684, Map: 5684 ✓
  🌋 volcano    API:  44, Map:  44 ✓
  🌍 earthquake API:  64, Map:  64 ✓
```

### Failure Example

```
============================================================
❌ FAIL
============================================================
Found 3 validation error(s).

Counts by Type:
  🔥 fire       API: 5684, Map: 5682 ✗
  🌋 volcano    API:  44, Map:  44 ✓
  🌍 earthquake API:  64, Map:  64 ✓

Coordinate Mismatches:
  EONET_1234 (fire): expected (120.5, 35.2), got (120.5001, 35.2), diff=(1.00e-4, 0.00e+0)
  
Error Details:
  1. Count mismatch for fire: API has 5684, map has 5682
  2. Coordinate mismatch for EONET_1234: expected (120.5, 35.2), got (120.5001, 35.2)
  3. Missing map feature for fire EONET_5678
```

## Exit Codes

- **0**: All validations passed
- **1**: Validation errors detected or script error

## Technical Details

### How It Works

1. **Launch Browser**: Starts Chromium in headless mode with sandboxing disabled for CI/CD compatibility
2. **Network Interception**: Sets up Playwright route interception to capture the `/api/disasters` request
3. **Page Load**: Navigates to the frontend URL and waits for DOM content loaded
4. **Map Ready Check**: Waits for `window.mapDebug` to exist and be functional
5. **Source Extraction**: Reads `map.getSource(type)._data.features` for each disaster type
6. **Validation**: Compares API response with map source data point-by-point

### Known Code Facts

From the codebase analysis:

- **Frontend**: Loads disasters from `GET ${API_BASE}/api/disasters` where `API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787'`
- **Backend `/api/disasters`** merges:
  - NASA EONET v3 events (status=open) filtered to categories `wildfires` and `volcanoes`
  - USGS earthquakes feed `2.5_day.geojson`
- **Map Debug**: Mapbox map instance exposed as `window.mapDebug = map.current`
- **GeoJSON Sources**: Three sources named `fires`, `volcanoes`, `earthquakes`
- **Data Mapping**:
  - EONET wildfires → `{ id, type: 'fire', lng: coords[0], lat: coords[1] }`
  - EONET volcanoes → `{ id, type: 'volcano', lng: coords[0], lat: coords[1] }`
  - USGS earthquakes → `{ id, type: 'earthquake', lng: coords[0], lat: coords[1] }`

### Configuration

Edit `scripts/verify-map-points.mjs` to change:

```javascript
const TIMEOUT_MS = 30000; // 30 seconds - increase for slow networks
const EPSILON = 1e-5;     // Coordinate comparison tolerance
```

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Verify Map Points
  run: |
    npm run verify-map-points
  env:
    FRONTEND_URL: http://localhost:5173
```

### GitLab CI Example

```yaml
verify:
  script:
    - npm run verify-map-points
  variables:
    FRONTEND_URL: "http://localhost:5173"
```

## Troubleshooting

### "Timeout waiting for map"

- Increase `TIMEOUT_MS` in the script
- Check that the frontend is accessible at the specified URL
- Verify Mapbox token is set in frontend `.env`

### "Failed to capture API response"

- Ensure backend is running and accessible
- Check that `API_BASE` is configured correctly in `frontend/src/config/api.ts`
- Verify CORS is enabled on the backend

### "Coordinate mismatch"

- Check that frontend and backend are using the same data sources
- Verify no coordinate transformations are being applied
- Check the epsilon value is appropriate for your use case

### "Browser launch failed"

```bash
# Install Chromium
npx playwright install chromium

# Or install all browsers
npx playwright install
```

## License

Same as AegisMap project (see root LICENSE file)
