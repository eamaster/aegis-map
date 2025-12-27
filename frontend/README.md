# AegisMap Frontend

React-based frontend application for disaster situational awareness with satellite pass predictions and AI-powered coverage analysis.

## 🛠️ Tech Stack

- **Framework:** React 19 + TypeScript
- **Build Tool:** Vite 7
- **Styling:** Tailwind CSS 4
- **Map Engine:** Mapbox GL JS 3.16 (Safe Mode with useRef)
- **Icons:** Lucide React
- **Date Handling:** date-fns
- **Orbital Calculations:** satellite.js 6.0.1

## 📦 Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── App.tsx          # Main application component with layout
│   │   ├── MapBoard.tsx     # Mapbox map component (Safe Mode)
│   │   ├── Sidebar.tsx      # Coverage analysis panel
│   │   └── DebugPanel.tsx   # Debug panel for development
│   ├── utils/
│   │   ├── orbitalEngine.ts # Satellite pass calculations (TLE parsing, SGP4)
│   │   └── markerIcons.ts   # Custom marker icons for disasters
│   ├── types/
│   │   └── index.ts         # TypeScript type definitions
│   ├── App.css              # Application styles
│   ├── index.css            # Global styles and Mapbox overrides
│   └── main.tsx             # Application entry point
├── public/                  # Static assets
├── dist/                    # Production build output
├── .env                     # Environment variables (gitignored)
├── package.json
└── vite.config.ts
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- Backend API running (see main README.md)

### Installation

```bash
# Install dependencies
npm install
```

### Environment Variables

Create a `.env` file in the `frontend/` directory:

```env
VITE_MAPBOX_TOKEN=your_mapbox_access_token_here
VITE_API_BASE_URL=http://localhost:8787
```

For production, use:
```env
VITE_API_BASE_URL=https://your-worker.workers.dev
```

### Development

```bash
# Start development server
npm run dev
```

The application will be available at `http://localhost:5173`

### Building for Production

```bash
# Build for production
npm run build
```

Output will be in the `dist/` directory, ready for deployment to Cloudflare Pages or any static hosting service.

### Preview Production Build

```bash
# Preview production build locally
npm run preview
```

## 📖 Key Features

### 1. **Interactive Map (MapBoard.tsx)**

- Displays disaster locations from NASA EONET and USGS
- Color-coded markers:
  - 🔴 Red: Wildfires
  - 🟠 Orange: Earthquakes
  - 🟡 Yellow: Volcanoes
- Click markers to open coverage analysis sidebar
- Safe Mode initialization prevents map re-initialization

### 2. **Coverage Analysis Sidebar (Sidebar.tsx)**

- **AI Insight:** Gemini AI analysis of satellite coverage feasibility
- **Next Pass:** Real-time countdown to next satellite overpass
- **Cloud Cover:** Current weather conditions at disaster location
- **Connectivity:** Starlink satellite pass information

### 3. **Satellite Pass Calculations (orbitalEngine.ts)**

- Parses TLE (Two-Line Element) data
- Uses SGP4 propagation to calculate satellite positions
- Filters passes by elevation (>25° by default)
- Calculates azimuth and elevation angles
- Optimizes calculation with time windowing

## 🔧 Component Details

### App.tsx

Main application component managing:
- Global layout (header, map area, sidebar)
- Selected disaster state
- Mobile menu state
- Responsive navigation

### MapBoard.tsx

Mapbox GL JS integration with:
- Safe Mode: Uses `useRef` to prevent re-initialization
- Disaster markers loaded from backend API
- Click handlers to select disasters
- Coordinate validation and normalization

### Sidebar.tsx

Coverage analysis panel with:
- TLE data fetching and parsing
- Satellite pass predictions
- Weather data integration (Open-Meteo API)
- Gemini AI analysis integration
- Real-time countdown timer
- Fallback handling for missing data

## 🗺️ Mapbox Safe Mode Pattern

**Critical:** The map uses a "Safe Mode" pattern to prevent re-initialization:

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

This prevents React from recreating the map on re-renders, which would cause:
- Map reloads
- Loss of map state
- Excessive API calls
- Performance degradation

## 🔌 API Integration

The frontend communicates with the backend API at `/api/` endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/disasters` | GET | Fetch disaster data |
| `/api/tles` | GET | Fetch satellite TLE data |
| `/api/analyze` | POST | Get AI coverage analysis |

See main `README.md` for API details.

## 🎨 Styling

- **Tailwind CSS 4:** Utility-first CSS framework
- **Glassmorphism:** Semi-transparent sidebar with backdrop blur
- **Dark Theme:** Optimized for data visibility
- **Responsive Design:** Mobile and desktop support

## 🧪 Development Scripts

```bash
npm run dev      # Start development server with HMR
npm run build    # Build for production (TypeScript check + Vite build)
npm run preview  # Preview production build locally
npm run lint     # Run ESLint
```

## 🐛 Troubleshooting

### Map doesn't load
- Check `VITE_MAPBOX_TOKEN` in `.env` is correct
- Verify Mapbox token has proper permissions
- Check browser console for errors

### No disasters showing
- Ensure backend is running on port 8787 (or configured URL)
- Check network tab for API errors
- Verify CORS is enabled on backend

### Sidebar shows "Loading..." indefinitely
- Check backend API is accessible
- Verify TLE data endpoint returns data
- Check browser console for errors

### Satellite calculations slow
- First calculation takes longer (parsing TLE data)
- Results are cached in component state
- Lower elevation threshold if needed (default: 25°)

## 📝 Notes

- **React 19:** Using latest React features (no need for StrictMode warnings)
- **TypeScript:** Strict type checking enabled
- **ESLint:** Configured with React hooks and TypeScript rules
- **Vite:** Fast HMR and optimized production builds

## 🔗 Related Documentation

- Main project README: `../README.md`
- Backend README: `../backend/README.md` (if exists)
- Mapbox GL JS: https://docs.mapbox.com/mapbox-gl-js/
- Satellite.js: https://github.com/shashwatak/satellite-js

## 📄 License

See main project README for license information.
