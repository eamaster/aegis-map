# 🌍 AegisMap - Real-Time Disaster Monitoring & Satellite Intelligence Platform

> **Professional-grade disaster situational awareness with satellite pass predictions, AI-powered coverage analysis, and fire hotspot tracking.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)
![React](https://img.shields.io/badge/React-19.2-61DAFB)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020)

**[Live Demo](https://eamaster.github.io/aegis-map/)** • [Report Bug](https://github.com/eamaster/aegis-map/issues) • [Request Feature](https://github.com/eamaster/aegis-map/issues)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Automated Verification](#automated-verification)
- [API Reference](#api-reference)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

---

## 🎯 Overview

**AegisMap** is an advanced disaster monitoring and satellite intelligence platform designed for emergency response teams, researchers, and disaster management professionals. It combines real-time disaster data from multiple authoritative sources with sophisticated satellite orbital mechanics to predict optimal imaging opportunities and provide AI-powered coverage analysis.

### What Makes AegisMap Unique?

- **🛰️ Real-Time Orbital Predictions**: Calculate next satellite overpass times using SGP4 propagation
- **🤖 AI-Powered Analysis**: Cloudflare Workers AI evaluates imaging feasibility from pass metadata, cloud cover, and known sensor capabilities
- **🔥 Live Fire Hotspot Tracking**: NASA FIRMS data integration with thermal intensity visualization
- **🌦️ Weather-Aware**: Automatic cloud forecast integration for pass quality assessment
- **📊 Multi-Source Data Fusion**: Combines NASA EONET, USGS, and FIRMS data streams
- **💾 Smart Caching**: Intelligent response caching reduces API costs and improves performance

---

## ✨ Key Features

### 1. **Comprehensive Disaster Monitoring**
- **Wildfires**: NASA EONET + NASA FIRMS fire hotspot data (thermal intensity, confidence levels)
- **Earthquakes**: USGS real-time seismic activity (magnitude ≥2.5)
- **Volcanoes**: NASA EONET volcanic activity tracking
- **Auto-Refresh**: 10-minute cache TTL with KV storage

### 2. **Satellite Pass Predictions**
- **6 Satellite Constellations** monitored:
  - Landsat-8 & Landsat-9 (30m optical + thermal)
  - Sentinel-2A & Sentinel-2B (10m optical)
  - Terra & Aqua (MODIS sensors)
- **Precision Calculations**:
  - SGP4 orbital propagation
  - Minimum elevation filter (>25°)
  - 24-hour forecast window
  - Real-time countdown timers

### 3. **AI Coverage Analysis**
- **Powered by**: Cloudflare Workers AI (default `@cf/meta/llama-3.1-8b-instruct-fp8`)
- **Smart Caching System**:
  - Final assessments cached by normalized inputs (model, prompt version, type, satellite, pass, cloud)
  - 2-hour TTL; failures and unavailable states are not cached as AI
  - Uses Workers AI free Neurons allocation (10,000/day) when within limits
- **Analysis Includes**:
  - Optical vs. thermal suitability grounded in the monitored fleet
  - Honest handling of unknown cloud cover and unknown sensors
  - Two-sentence metadata guidance (not pixel-level image analysis)

### 4. **Advanced Map Visualization**
- **Mapbox GL JS** with dark/light theme support
- **NASA GIBS Integration**: Thermal satellite imagery overlays
- **Interactive Layers**:
  - Pulsing animations for high-severity events
  - Custom disaster markers (fires, earthquakes, volcanoes)
  - Fire hotspot heatmaps with intensity gradients
- **Safe Mode Architecture**: useRef-based implementation prevents unnecessary map reloads

### 5. **Professional UI/UX**
- **Responsive Design**: Mobile-first with desktop optimizations
- **Dark/Light Themes**: Automatic system preference detection
- **Glassmorphism Effects**: Modern, premium aesthetic
- **Tutorial Overlay**: Interactive onboarding (press `?`)
- **Debug Panel**: Real-time system diagnostics

---

## 🛠️ Tech Stack

### Frontend
| Technology | Version | Purpose |
|-----------|---------|---------|
| **React** | 19.2.0 | UI framework |
| **Vite** | 7.2.4 | Build tool & dev server |
| **TypeScript** | 5.9.3 | Type safety |
| **Tailwind CSS** | 4.1.17 | Styling framework |
| **Mapbox GL JS** | 3.16.0 | Map rendering engine |
| **Satellite.js** | 6.0.1 | Orbital mechanics (SGP4) |
| **date-fns** | 4.1.0 | Date manipulation |
| **Lucide React** | 0.554.0 | Icon library |
| **React Hot Toast** | 2.6.0 | Notifications |

### Backend
| Technology | Version | Purpose |
|-----------|---------|---------|
| **Cloudflare Workers** | Latest | Serverless runtime |
| **Hono** | 4.10.6 | Web framework |
| **Cloudflare KV** | N/A | Edge caching layer |
| **Wrangler** | 4.50.0 | Deployment CLI |

### External APIs
| Service | Purpose | Cost | Rate Limits |
|---------|---------|------|-------------|
| **NASA EONET** | Wildfire & volcano events | FREE | No hard limit |
| **USGS Earthquakes** | Seismic activity | FREE | No hard limit |
| **NASA FIRMS** | Fire hotspot detection | FREE | 5000 req/10min |
| **CelesTrak** | Satellite TLE data | FREE | Fair use |
| **Open-Meteo** | Weather forecasts | FREE | 10,000 req/day |
| **NASA GIBS** | Satellite imagery tiles | FREE | Fair use |
| **Mapbox** | Base maps | FREE | 50k loads/month |
| **Cloudflare Workers AI** | AI analysis | Free allocation (10k Neurons/day) | Account limits |

---

## 🏗️ Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                       FRONTEND (React)                      │
│  ┌────────────┐  ┌─────────────┐  ┌───────────────────┐     │
│  │  MapBoard  │  │   Sidebar   │  │  TutorialOverlay  │     │
│  │  (Mapbox)  │  │  (Analysis) │  │   (Onboarding)    │     │
│  └────────────┘  └─────────────┘  └───────────────────┘     │
│         │               │                                   │
│         └───────────────┴──── Orbital Engine (Client-side)  │
│                         │                                   │
└─────────────────────────┼───────────────────────────────────┘
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              BACKEND (Cloudflare Workers + KV)              │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────┐     │
│  │ GET /disasters│  │ GET /tles     │  │ POST /analyze│     │
│  │ (10min cache) │  │ (12hr cache)  │  │ (AI + cache) │     │
│  └───────────────┘  └───────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
         │                  │                    │
         ▼                  ▼                    ▼
    ┌─────────┐      ┌──────────┐        ┌──────────┐
    │  NASA   │      │CelesTrak │        │Cloudflare│
    │  EONET  │      │          │        │Workers AI│
    ├─────────┤      └──────────┘        └──────────┘
    │  USGS   │
    ├─────────┤
    │  FIRMS  │
    └─────────┘
```

### Data Flow

1. **Disaster Data**: Backend fetches from NASA EONET + USGS → KV cache (10min TTL) → Frontend map
2. **Satellite TLEs**: Backend fetches from CelesTrak → KV cache (12hr TTL) → Frontend orbital engine
3. **Pass Predictions**: Client-side SGP4 calculations using Satellite.js
4. **Weather Data**: Client-side fetch from Open-Meteo during satellite pass calculation
5. **AI Analysis**: Backend `env.AI.run` (Workers AI) → KV cache (2hr TTL) → `{ analysis, cached, source }`

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 22.0.0 (required by Wrangler 4.148+)
- **npm** ≥ 9.0.0
- **Cloudflare Account** (for deployment)
- See [docs/COORDINATED_RELEASE.md](docs/COORDINATED_RELEASE.md) before merging frontend + backend together
- **API Keys**:
  - [Mapbox Access Token](https://account.mapbox.com/access-tokens/)
  - Cloudflare account with Workers AI enabled (native binding; no Gemini key)
  - [NASA FIRMS Map Key](https://firms.modaps.eosdis.nasa.gov/api/) (optional, backend-only)

### Backend Setup

1. **Navigate to backend directory:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create `.dev.vars` file:**
   ```bash
   # Optional — fire hotspots
   FIRMS_MAP_KEY=your_firms_map_key_here
   # Optional — override default Workers AI model (must be allowlisted in src/config.ts)
   # AI_MODEL=@cf/meta/llama-3.1-8b-instruct-fp8
   ```
   Workers AI uses the Wrangler AI binding (`ai.binding = AI`, `remote: true` for local). No API token is required in the Worker for the native binding path.

4. **Start development server:**
   ```bash
   npm run dev
   ```
   Backend runs at `http://localhost:8787`

5. **Test endpoints:**
   ```bash
   # Health check
   curl http://localhost:8787/

   # Get disaster data
   curl http://localhost:8787/api/disasters

   # Get satellite TLEs
   curl http://localhost:8787/api/tles

   # Test AI analysis
   curl -X POST http://localhost:8787/api/analyze \
     -H "Content-Type: application/json" \
     -d '{"disasterTitle":"California Wildfire","satelliteName":"Landsat-9","passTime":"2025-12-27T10:00:00Z","cloudCover":15}'
   ```

### Frontend Setup

1. **Navigate to frontend directory:**
   ```bash
   cd frontend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create `.env` file:**
   ```bash
   # Copy from example
   cp .env.example .env

   # Edit .env with your values
   VITE_MAPBOX_TOKEN=your_mapbox_token_here
   VITE_API_BASE_URL=http://localhost:8787
   ```

4. **Start development server:**
   ```bash
   npm run dev
   ```
   Frontend runs at `http://localhost:5173`

5. **Open in browser:**
   ```
   http://localhost:5173
   ```

### Verification Checklist

- [ ] Backend starts without errors
- [ ] `/api/disasters` returns data
- [ ] `/api/tles` returns satellite data
- [ ] Frontend map loads only once (check browser console)
- [ ] Clicking disaster marker opens sidebar
- [ ] Satellite pass countdown updates
- [ ] Cloud coverage displays correctly
- [ ] AI analysis runs for a selected disaster (Workers AI binding configured)

---

## ✅ Automated Verification

### Map Point Verification Script

AegisMap includes a fully automated verification system that validates map points match backend disaster coordinates with **zero user interaction** required.

**Location**: `frontend/scripts/verify-map-points.mjs`

#### Quick Start

```bash
cd frontend
npm run verify-map-points
```

#### What It Validates

✅ **API Response Validation**
- Valid coordinate ranges: `lat ∈ [-90, 90]`, `lng ∈ [-180, 180]`
- Valid types: `fire`, `volcano`, `earthquake`
- No duplicate IDs

✅ **Map Source Validation**
- GeoJSON sources exist only when API has data for that type
- Handles zero-count scenarios (e.g., 0 volcanoes = expected, PASS)
- Source data can be extracted from `window.mapDebug`

✅ **Data Parity Validation**
- Feature counts match API counts per type
- Every API disaster ID exists as a map feature
- Coordinates match within epsilon `1e-5` (≈1 meter accuracy)

#### Usage Examples

```bash
# Basic usage (defaults to http://localhost:5173/)
npm run verify-map-points

# Custom frontend URL
FRONTEND_URL=http://localhost:3000 npm run verify-map-points

# Verify against specific backend
API_BASE_URL=http://localhost:8787 npm run verify-map-points

# Combined
FRONTEND_URL=http://localhost:5173 API_BASE_URL=http://localhost:8787 npm run verify-map-points
```

#### How It Works

1. **Launch Browser**: Chromium in headless mode (no UI)
2. **Network Interception**: Captures `/api/disasters` request using Playwright routing
3. **Map Access**: Uses `window.mapDebug` exposed by MapBoard component
4. **Source Extraction**: Reads `map.getSource(type)._data.features` for actual rendered data
5. **Validation**: Compares API response with map source data point-by-point

#### Edge Cases Handled

- **Zero disasters of a type**: If API returns 0 volcanoes, missing `volcanoes` source is expected (PASS)
- **Missing source when expected**: If API has 5 fires but `fires` source missing = FAIL
- **Features without IDs**: Non-disaster map overlays are ignored

#### Sample Output

**Success:**
```
============================================================
✅ PASS
============================================================
All validations passed! Map points match backend disaster coordinates.

Summary:
  Total API Records:    127
  Total Map Features:   127
  Validation Errors:    0

Counts by Type:
  🔥 fire       API:  89, Map:  89 ✓
  🌋 volcano    API:  12, Map:  12 ✓
  🌍 earthquake API:  26, Map:  26 ✓
```

**Failure:**
```
============================================================
❌ FAIL
============================================================
Found 2 validation error(s).

Counts by Type:
  🔥 fire       API:  89, Map:  87 ✗

Coordinate Mismatches:
  EONET_5678 (fire): expected (-118.25, 34.05), got (-118.2501, 34.05), diff=(1.00e-4, 0.00e+0)
```

#### CI/CD Integration

**GitHub Actions:**
```yaml
- name: Verify Map Points
  run: npm run verify-map-points
  env:
    FRONTEND_URL: http://localhost:5173
```

**Exit Codes**: 0 = PASS, 1 = FAIL

---

## 📡 API Reference

### Base URL
- **Local**: `http://localhost:8787`
- **Production**: `https://your-worker.workers.dev`

### Endpoints

#### 1. Health Check
```http
GET /
```
**Response:**
```json
{
  "status": "AegisMap API Online",
  "version": "1.1.0"
}
```

#### 2. Get Disasters
```http
GET /api/disasters
```
**Description**: Fetches merged disaster data from NASA EONET and USGS.

**Cache**: 10 minutes (Cloudflare KV)

**Response:**
```json
[
  {
    "id": "EONET_1234",
    "type": "fire",
    "title": "California Wildfire",
    "lat": 34.0522,
    "lng": -118.2437,
    "date": "2025-12-27T10:00:00Z",
    "severity": "high"
  },
  {
    "id": "us6000abcd",
    "type": "earthquake",
    "title": "M 6.2 - 10km NW of Los Angeles",
    "lat": 34.1522,
    "lng": -118.3437,
    "date": "2025-12-27T09:30:00Z",
    "severity": "high",
    "magnitude": 6.2
  }
]
```

#### 3. Get Satellite TLEs
```http
GET /api/tles
```
**Description**: Fetches Two-Line Element (TLE) orbital data for 6 disaster monitoring satellites.

**Cache**: 12 hours (Cloudflare KV)

**Satellites**:
- Landsat-8 (NORAD 39084)
- Landsat-9 (NORAD 49260)
- Sentinel-2A (NORAD 40697)
- Sentinel-2B (NORAD 42063)
- Terra (NORAD 25994)
- Aqua (NORAD 27424)

**Response** (plaintext TLE format):
```
LANDSAT 8                       
1 39084U 13008A   25361.50000000  .00000000  00000-0  00000-0 0  9999
2 39084  98.2000 180.0000 0001000  90.0000 270.0000 14.57100000000000
LANDSAT 9                       
1 49260U 21088A   25361.50000000  .00000000  00000-0  00000-0 0  9999
2 49260  98.2000 180.0000 0001000  90.0000 270.0000 14.57100000000000
...
```

#### 4. Get Fire Hotspots
```http
GET /api/fire-hotspots?lat=34.0522&lng=-118.2437
```
**Description**: Fetches NASA FIRMS fire hotspot data within ±0.5° radius (~55km).

**Query Parameters**:
- `lat` (required): Latitude in decimal degrees
- `lng` (required): Longitude in decimal degrees

**Response:**
```json
{
  "hotspots": [
    {
      "latitude": 34.0522,
      "longitude": -118.2437,
      "bright_ti4": 320.5,
      "scan": 1.2,
      "track": 1.1,
      "acq_date": "2025-12-27",
      "acq_time": "0930",
      "satellite": "N",
      "confidence": "h",
      "version": "1.0",
      "bright_ti5": 298.3,
      "frp": 45.6,
      "daynight": "D"
    }
  ],
  "totalCount": 1,
  "highConfidence": 1,
  "maxBrightness": 320.5,
  "maxPower": 45.6
}
```

#### 5. AI Coverage Analysis
```http
POST /api/analyze
```
**Description**: Workers AI satellite pass feasibility analysis (metadata guidance, not pixel inspection).

**Request Body:**
```json
{
  "disasterTitle": "California Wildfire",
  "satelliteName": "LANDSAT 9",
  "passTime": "2026-10-08T15:00:00.000Z",
  "cloudCover": 15,
  "disasterType": "fire"
}
```

Notes:
- `disasterType` is optional for legacy clients; when omitted it is treated as unknown (neutral guidance).
- `cloudCover` may be `null` when weather data is unavailable (never coerced to clear skies).
- `passTime` must be an ISO-8601 datetime **with timezone** (`Z` or `±HH:MM`). Date-only and timezone-less values are rejected; valid offsets are normalized to UTC.
- Client abort cancels the HTTP fetch only; it does not cancel remote Workers AI inference once accepted.
- CORS allowlisting is not authentication. See [docs/COORDINATED_RELEASE.md](docs/COORDINATED_RELEASE.md) for release gates and abuse-control blockers.

**Success Response:**
```json
{
  "analysis": "…two-sentence guidance…",
  "cached": false,
  "source": "workers-ai"
}
```

**Unavailable Response (non-2xx):**
```json
{
  "error": "analysis_unavailable",
  "code": "quota_exhausted",
  "message": "AI daily free allocation exhausted"
}
```

**Caching Strategy**:
- Hashed keys from model, prompt/cache version, disaster type/title, satellite + capabilities, pass ISO time, and cloud (including explicit unknown)
- 2-hour TTL; provider failures are not cached as successful AI

---

## 🚢 Deployment

### Backend (Cloudflare Workers)

1. **Create KV namespace:**
   ```bash
   cd backend
   wrangler kv:namespace create "AEGIS_CACHE"
   ```

2. **Update `wrangler.jsonc`:**
   ```jsonc
   {
     "kv_namespaces": [
       {
         "binding": "AEGIS_CACHE",
         "id": "YOUR_KV_ID_FROM_STEP_1"
       }
     ]
   }
   ```

3. **Set production secrets / bindings:**
   ```bash
   # AI binding is declared in wrangler.jsonc (no GEMINI_API_KEY)
   wrangler secret put FIRMS_MAP_KEY
   # Paste your FIRMS key when prompted
   ```

4. **Deploy:**
   ```bash
   npm run deploy
   ```

5. **Note your Worker URL** (e.g., `https://aegis-map-backend.YOUR_SUBDOMAIN.workers.dev`)

### Frontend (Cloudflare Pages)

1. **Update `.env` for production:**
   ```bash
   VITE_MAPBOX_TOKEN=your_mapbox_token
   VITE_API_BASE_URL=https://your-worker.workers.dev
   ```

2. **Build:**
   ```bash
   cd frontend
   npm run build
   ```

3. **Deploy to Cloudflare Pages:**
   ```bash
   npx wrangler pages deploy dist
   ```

4. **Configure custom domain** (optional):
   - Go to Cloudflare Pages dashboard
   - Add custom domain in settings
   - Update DNS records as instructed

### Alternative: GitHub Pages (Frontend Only)

1. **Update `vite.config.ts`:**
   ```typescript
   export default defineConfig({
     base: '/aegis-map/', // Replace with your repo name
     ...
   });
   ```

2. **Build and deploy:**
   ```bash
   npm run build
   npx gh-pages -d dist
   ```

---

## 🧪 Orbital Calculation Details

The frontend uses **Satellite.js** to perform client-side orbital mechanics calculations:

### SGP4 Propagation Pipeline

1. **Parse TLE Data**: Extract satellite orbital elements
2. **Initialize SGP4**: Create satellite record
3. **Propagate Position**: Calculate satellite ECI coordinates at given time
4. **Coordinate Conversion**:
   - ECI (Earth-Centered Inertial) → ECF (Earth-Centered Fixed)
   - ECF → Geodetic (Lat/Lng/Alt)
5. **Calculate Look Angles**:
   - Observer-to-satellite azimuth
   - Observer-to-satellite elevation
6. **Filter Passes**: Only include passes with elevation > 25°
7. **Optimize Search**: Skip 90 minutes after each detected pass (approximate orbital period)

### Performance Optimizations

- **5-minute time steps** for pass detection
- **90-minute skip** after each pass to avoid duplicate detections
- **24-hour forecast window** to balance accuracy and computation time
- **Client-side execution** to reduce backend load

---

## 🎨 UI/UX Features

### Design System

- **Color Themes**: Dark mode (default) + light mode
- **Typography**: Inter font family with optimized weights
- **Glassmorphism**: Backdrop blur with transparency effects
- **Animations**:
  - Pulsing disaster markers for high-severity events
  - Smooth accordion transitions
  - Loading skeletons
  - Toast notifications

### Responsive Breakpoints

- **Mobile**: < 768px
- **Desktop**: ≥ 768px

### Accessibility

- Keyboard shortcuts (`?` for help)
- ARIA labels on interactive elements
- Semantic HTML structure
- High-contrast color ratios

---

## 🐛 Troubleshooting

### Backend Issues

**Problem**: `analysis_unavailable` / AI binding config errors
- **Solution**: Confirm `wrangler.jsonc` has `"ai": { "binding": "AI", "remote": true }` and run `npm run cf-typegen`
- **Note**: Native binding does not use `GEMINI_API_KEY`. Local `wrangler dev` must authenticate to the Cloudflare account.

**Problem**: KV namespace errors
- **Solution**: Placeholder IDs in `wrangler.jsonc` are for local dev only. Create real KV namespaces for deployment.

**Problem**: CORS errors
- **Solution**: Origins are allowlisted (localhost Vite ports + GitHub Pages). Ensure `VITE_API_BASE_URL` matches your Worker URL.

### Frontend Issues

**Problem**: Map doesn't load
- **Solution**: Verify `VITE_MAPBOX_TOKEN` in `.env` is correct
- **Check**: Mapbox account hasn't exceeded 50k map loads/month

**Problem**: No disasters showing
- **Solution**: Ensure backend is running on correct port (8787 for local)
- **Check**: Browser console for CORS or network errors

**Problem**: Satellite calculations slow
- **Solution**: Normal for first calculation (processing 6 satellites over 24 hours). Results cached in component state.

**Problem**: AI analysis not working
- **Solution**: 
  - Confirm Workers AI binding (`env.AI`) and free Neurons allocation
  - Check Cloudflare dashboard for Workers AI errors (quota 3036 / capacity 3040)
  - Check backend logs for error details
  - Fallback analysis will display if API unavailable

### Map Performance

**Problem**: Map reloading on state changes
- **Solution**: This is prevented by useRef pattern. If occurring, check for conditional rendering around `<MapBoard />`.

**Problem**: Exceeding Mapbox free tier
- **Solution**: Monitor usage at [Mapbox Dashboard](https://account.mapbox.com/). Optimize by:
  - Implementing stricter caching
  - Using lower-resolution tiles
  - Limiting map interactions

---

## 🔒 Security & Privacy

### API Key Protection

✅ **Secure**:
- All API keys stored in backend (Cloudflare Worker environment)
- `.env` and `.dev.vars` gitignored
- Production secrets managed via `wrangler secret`

✅ **Client-Side**:
- Only Mapbox public token exposed (expected)
- No sensitive credentials in frontend code

### Data Privacy

- No user authentication or personal data collection
- All disaster data from public government APIs
- KV cache contains only public disaster/satellite information

---

## 📈 Future Enhancements

- [ ] Historical disaster timeline with playback
- [ ] Export satellite pass schedule to calendar (.ics)
- [ ] Push notifications for optimal imaging passes
- [ ] Multi-satellite comparison view
- [ ] SAR satellite integration (all-weather imaging)
- [ ] Offline PWA support with service workers
- [ ] Mobile app (React Native)
- [ ] Advanced analytics dashboard
- [ ] User accounts with saved locations
- [ ] Email/SMS alerts for disasters in areas of interest

---

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/AmazingFeature`
3. **Commit changes**: `git commit -m 'Add AmazingFeature'`
4. **Push to branch**: `git push origin feature/AmazingFeature`
5. **Open a Pull Request**

### Development Guidelines

- Follow existing code style (ESLint + Prettier)
- Add TypeScript types for all new code
- Update documentation for API changes
- Test on both mobile and desktop
- Ensure accessibility standards

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

### Third-Party Licenses

- **Mapbox**: Free tier (50k loads/month) - [Mapbox Terms](https://www.mapbox.com/tos/)
- **NASA EONET**: Public domain
- **USGS**: Public domain
- **NASA FIRMS**: Public domain
- **NASA GIBS**: Public domain
- **Open-Meteo**: CC BY 4.0
- **Cloudflare Workers AI**: Free allocation / Neurons - [Workers AI Terms](https://developers.cloudflare.com/workers-ai/)

---

## 🙏 Acknowledgments

- **NASA** for EONET, FIRMS, and GIBS services
- **USGS** for real-time earthquake data
- **CelesTrak** for satellite TLE data
- **Open-Meteo** for weather forecasts
- **Mapbox** for map rendering
- **Cloudflare** for Workers AI
- **Cloudflare** for Workers and KV infrastructure

---

## 📞 Support

- **Repository**: [github.com/eamaster/aegis-map](https://github.com/eamaster/aegis-map)
- **Issues**: [GitHub Issues](https://github.com/eamaster/aegis-map/issues)
- **Discussions**: [GitHub Discussions](https://github.com/eamaster/aegis-map/discussions)

---

**Built with** ❤️ **for disaster response teams and emergency management professionals.**

**Star ⭐ this repository if you find it useful!**
