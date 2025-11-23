# 🏛️ AegisMap - Disaster Situational Awareness Dashboard

Professional-grade disaster monitoring with satellite pass predictions and AI-powered coverage analysis.

## 🛠️ Tech Stack

- **Frontend:** React 18 + Vite + Tailwind CSS + TypeScript
- **Map Engine:** Mapbox GL JS (Safe Mode with useRef)
- **Backend:** Cloudflare Workers + Hono Framework
- **Caching:** Cloudflare KV
- **Orbital Math:** Satellite.js (Client-side calculations)
- **AI Analysis:** Google Gemini 1.5 Pro
- **Weather:** Open-Meteo API (Free)
- **Disaster Data:** NASA EONET + USGS

## 📦 Project Structure

```
aegis-map/
├── backend/          # Cloudflare Worker API
│   ├── src/
│   │   └── index.ts  # Hono API routes
│   ├── .dev.vars     # Local environment secrets
│   └── wrangler.jsonc
│
└── frontend/         # React Application
    ├── src/
    │   ├── components/
    │   │   ├── MapBoard.tsx   # Mapbox map (Safe Mode)
    │   │   └── Sidebar.tsx    # Coverage analysis panel
    │   ├── utils/
    │   │   └── orbitalEngine.ts  # Satellite pass calculations
  │   └── types/
    │       └── index.ts       # TypeScript definitions
    └── .env          # Environment variables
```

## 🚀 Quick Start

### Backend Setup

1. **Navigate to backend:**
   ```bash
   cd backend
   ```

2. **Environment variables are already configured in `.dev.vars`**

3. **Start local development server:**
   ```bash
   npm run dev
   ```
   Backend will run at `http://localhost:8787`

4. **Test endpoints:**
   ```bash
   # Test disaster data
   curl http://localhost:8787/api/disasters
   
   # Test TLE data
   curl http://localhost:8787/api/tles
   
   # Test AI analysis
   curl -X POST http://localhost:8787/api/analyze \
     -H "Content-Type: application/json" \
     -d '{"disasterTitle":"California Wildfire","satelliteName":"Landsat-9","passTime":"2025-11-23T10:30:00Z","cloudCover":15}'
   ```

### Frontend Setup

1. **Navigate to frontend:**
   ```bash
   cd frontend
   ```

2. **Environment variables are already configured in `.env`:**
   - `VITE_MAPBOX_TOKEN`: Mapbox public token
   - `VITE_API_BASE_URL`: Backend API URL

3. **Start development server:**
   ```bash
   npm run dev
   ```
   Frontend will run at `http://localhost:5173`

4. **Open in browser:**
   ```
   http://localhost:5173
   ```

## ⚡ Features

### 1. **Real-Time Disaster Monitoring**
- Wildfires (NASA EONET)
- Volcanoes (NASA EONET)
- Earthquakes (USGS)
- Auto-refresh every 10 minutes (KV cached)

### 2. **Satellite Pass Predictions**
- Calculates next satellite overpass
- Filters by elevation (>25°)
- Real-time countdown timer
- Satellites monitored:
  - Landsat-8 & Landsat-9
  - Sentinel-2A & Sentinel-2B
  - Terra & Aqua

### 3. **Weather Integration**
- Cloud coverage forecast
- Hourly predictions up to 2 days
- Auto-matched to satellite pass time

### 4. **AI Coverage Analysis**
- Powered by Gemini 1.5 Pro
- Assesses satellite imagery feasibility
- Considers cloud cover and sensor capabilities
- Provides actionable 2-sentence summaries

## 🔒 Security Features

- ✅ API keys stored in backend (never exposed to client)
- ✅ KV caching prevents rate limiting
- ✅ CORS enabled for local development
- ✅ Environment variables gitignored

## 🗺️ Mapbox Safety Protocol

**Critical:** We use a "Safe Mode" initialization pattern to prevent map reloads:

```typescript
const map = useRef<mapboxgl.Map | null>(null);

useEffect(() => {
  if (map.current) return; // ← PREVENTS RE-INITIALIZATION
  
  map.current = new mapboxgl.Map({...});
  
  map.current.on('load', () => {
    // Add layers once
  });
}, []); // ← EMPTY DEPENDENCY ARRAY
```

**Budget:** 50,000 map loads/month. Monitor usage at [Mapbox Dashboard](https://account.mapbox.com/).

## 📡 API Endpoints

### Backend (Port 8787)

| Endpoint | Method | Description | Cache TTL |
|----------|--------|-------------|-----------|
| `/api/disasters` | GET | Merged NASA EONET + USGS data | 10 min |
| `/api/tles` | GET | Satellite TLE elements | 12 hours |
| `/api/analyze` | POST | AI coverage analysis | No cache |

### Example Response: `/api/disasters`
```json
[
  {
    "id": "EONET_1234",
    "type": "fire",
    "title": "California Wildfire",
    "lat": 34.0522,
    "lng": -118.2437,
    "date": "2025-11-22T12:00:00Z",
    "severity": "high"
  }
]
```

## 🧪 Testing Checklist

- [ ] Backend starts without errors
- [ ] Disasters endpoint returns data
- [ ] TLEs endpoint returns satellite data
- [ ] AI analyze endpoint works with test data
- [ ] Frontend map loads only once (check console)
- [ ] Clicking disaster opens sidebar
- [ ] Satellite pass countdown updates every second
- [ ] Cloud coverage displays correctly
- [ ] AI analysis button triggers Gemini

## 🚢 Deployment

### Backend (Cloudflare Workers)

1. **Create KV namespace:**
   ```bash
   wrangler kv:namespace create "AEGIS_CACHE"
   ```

2. **Update `wrangler.jsonc` with the KV ID returned above**

3. **Set production secret:**
   ```bash
   wrangler secret put GEMINI_API_KEY
   # Paste your Gemini API key when prompted
   # Get your key from: https://aistudio.google.com/app/apikey
   ```

4. **Deploy:**
   ```bash
   npm run deploy
   ```

### Frontend (Cloudflare Pages recommended)

1. **Update `.env` with production API URL:**
   ```
   VITE_API_BASE_URL=https://your-worker.workers.dev
   ```

2. **Build:**
   ```bash
   npm run build
   ```

3. **Deploy to Cloudflare Pages:**
   ```bash
   npx wrangler pages deploy dist
   ```

## 📊 Orbital Calculation Details

The `orbitalEngine.ts` uses satellite.js to:

1. Parse TLE (Two-Line Element) data
2. Propagate satellite position using SGP4
3. Convert ECI → ECF → Geodetic coordinates
4. Calculate look angles (azimuth & elevation)
5. Filter passes with elevation > 25°
6. Optimize with 90-minute skips after each pass

## 🎨 UI/UX Features

- Dark theme for data visibility
- Responsive design (mobile & desktop)
- Glassmorphism sidebar
- Real-time countdown animations
- Color-coded disaster types:
  - 🔴 Red: Fires
  - 🟠 Orange: Earthquakes & Volcanoes

## 📝 License

This project uses:
- Mapbox (Free tier: 50k loads/month)
- NASA EONET (Public domain)
- USGS (Public domain)
- Open-Meteo (CC BY 4.0)
- Google Gemini API (Pay-as-you-go)

## 🐛 Troubleshooting

### Backend Issues

**Problem:** `GEMINI_API_KEY is undefined`
- **Solution:** Check `.dev.vars` file exists in `backend/` directory

**Problem:** KV namespace errors
- **Solution:** The placeholder IDs in `wrangler.jsonc` are for local dev only. For deployment, create real KV namespaces.

### Frontend Issues

**Problem:** Map doesn't load
- **Solution:** Verify `VITE_MAPBOX_TOKEN` in `.env` is correct

**Problem:** No disasters showing
- **Solution:** Ensure backend is running on port 8787

**Problem:** Satellite calculations slow
- **Solution:** This is normal for first calculation. Results are cached in component state.

## 🔮 Future Enhancements

- [ ] Historical disaster timeline
- [ ] Export satellite pass schedule
- [ ] Push notifications for optimal passes
- [ ] Multi-satellite comparison
- [ ] SAR satellite integration (all-weather imaging)

---

**Built with** ❤️ **for disaster response teams**
