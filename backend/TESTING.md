# Backend Testing Guide

## FIRMS Hotspot Verification

### Purpose

The FIRMS verification script compares our backend API (`/api/fire-hotspots`) against the direct NASA FIRMS API to identify discrepancies in fire hotspot data.

### Prerequisites

1. **FIRMS API Key**: Register at https://firms.modaps.eosdis.nasa.gov/api/
2. **Local Backend Running**: `npm run dev` in the backend directory
3. **Environment Variable**: Set `FIRMS_MAP_KEY`

### Running Verification

**Option 1: Test Sampled Disasters** (Default)

```bash
# Test 10 random fire events from /api/disasters
FIRMS_MAP_KEY=your_key_here npm run verify:firms

# Custom sample count
SAMPLE_COUNT=20 FIRMS_MAP_KEY=your_key_here npm run verify:firms
```

**Option 2: Test Specific Location**

```bash
# Test single coordinates
FIRMS_MAP_KEY=your_key_here node backend/scripts/verify-firms-hotspots.mjs --lat 40 --lng -120
```

**Option 3: Custom Configuration**

```bash
# All environment variables
API_BASE_URL=http://localhost:8787 \
FIRMS_MAP_KEY=your_key_here \
SAMPLE_COUNT=15 \
BBOX_DEG=0.5 \
DAYS=7 \
npm run verify:firms
```

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `API_BASE_URL` | `http://localhost:8787` | Backend API base URL |
| `FIRMS_MAP_KEY` | **(required)** | Your FIRMS API key |
| `SAMPLE_COUNT` | `10` | Number of disasters to test |
| `BBOX_DEG` | `0.5` | Bounding box size (degrees) |
| `DAYS` | `7` | Days of historical data |

### Exit Codes

- **0**: All tests passed
- **1**: One or more tests failed (mismatch detected)
- **2**: Configuration error (missing FIRMS_MAP_KEY)

### Example Output

```
🔥 FIRMS Hotspot Verification Script

Configuration:
  API Base URL: http://localhost:8787
  BBox Degrees: ±0.5°
  Days: 7
  Sample Count: 10

✅ FIRMS_MAP_KEY: 12345678...

📡 Fetching disaster list from our API...

Found 45 fire events. Testing 10 samples...

[1/10] Testing: California Wildfire (EONET_12345)
         Location: (34.05, -118.24)

  Our API:     5 hotspots (3 high confidence)
               Max: 328.7K brightness, 52.3MW power
  FIRMS URL:   https://firms.modaps.eosdis.nasa.gov/api/area/csv/REDACTED/...
  FIRMS Direct: 5 hotspots (3 high confidence)
               Max: 328.7K brightness, 52.3MW power
  ✅ MATCH

────────────────────────────────────────────────────────────

📊 VERIFICATION SUMMARY:

  Total Tests:  10
  ✅ Passed:     10
  ❌ Failed:     0
  Success Rate: 100.0%
```

## Unit Tests

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test firmsParser.test.ts
```

### Test Coverage

The test suite covers:
- **Empty CSV**: Header only, no data
- **Single Hotspot**: Minimal data parsing
- **Multiple Hotspots**: Batch parsing
- **High Confidence Counting**: 'h' and 'high' detection
- **Max Brightness**: Correct field (`bright_ti4`)
- **Max Power**: Correct field (`frp`)
- **Numeric Parsing**: Type validation
- **Confidence Variations**: All levels (h, high, n, l)

### Test Fixtures

Located in `backend/test/fixtures/`:
- `firms-empty.csv` - Header only
- `firms-single.csv` - Single hotspot
- `firms-sample.csv` - 5 hotspots with varied confidence levels

## Security Notes

⚠️ **NEVER commit `.dev.vars` or expose FIRMS_MAP_KEY in code**

- Store key in `backend/.dev.vars` (gitignored)
- Use environment variables for CI/CD
- Redact keys in logs and output

## Troubleshooting

### "FIRMS API key not configured"

**Problem**: Backend returns empty hotspots with this message.

**Solution**: 
1. Verify `backend/.dev.vars` contains: `FIRMS_MAP_KEY=your_actual_key`
2. Restart backend: `npm run dev`
3. Check key is valid at https://firms.modaps.eosdis.nasa.gov/api/

### Verification Shows Mismatches

**Possible Causes**:
1. **CSV Parsing Bug**: Check parsing logic matches FIRMS CSV format
2. **BBox Mismatch**: Verify `BBOX_DEG` matches backend logic (0.5°)
3. **Time Window**: Ensure `DAYS` parameter matches (7 days)
4. **Dataset**: Confirm using `VIIRS_SNPP_NRT` (not MODIS)

**Debug Steps**:
1. Run verification with `--lat --lng` to test specific location
2. Check "First 2 FIRMS CSV lines" in mismatch output
3. Manually call FIRMS API with same parameters
4. Compare CSV structure

### No Active Fires Found

**Possible Reasons**:
- Genuinely no fires in the queried bbox/timeframe
- FIRMS API rate limiting (max 5000 requests/10min)
- Invalid coordinates (out of range)

**Verification**:
Visit https://firms.modaps.eosdis.nasa.gov/map/ to visually confirm fire activity
