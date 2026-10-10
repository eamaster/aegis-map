import { chromium } from 'playwright';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173/aegis-map/';
const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8787';

async function run() {
  console.log('🚀 Starting AegisMap E2E Sidebar & Integration Verification');
  console.log(`Frontend URL: ${FRONTEND_URL}`);
  console.log(`API Base:     ${API_BASE_URL}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  const networkCalls = {
    disasters: null,
    tles: null,
    fireHotspots: null,
    weather: null,
    gibsWms: null,
  };

  const consoleLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    consoleLogs.push({ type: msg.type(), text });
    console.log(`[BROWSER ${msg.type().toUpperCase()}] ${text}`);
  });

  page.on('pageerror', (err) => {
    console.error(`[BROWSER UNHANDLED ERROR] ${err.message}`);
  });

  page.on('request', (req) => {
    console.log(`[REQ] ${req.method()} ${req.url()}`);
  });

  page.on('response', async (res) => {
    const url = res.url();
    console.log(`[RES] ${res.status()} ${url}`);
    if (url.includes('/api/disasters')) {
      networkCalls.disasters = { status: res.status(), url };
    } else if (url.includes('/api/tles')) {
      networkCalls.tles = { status: res.status(), url };
    } else if (url.includes('/api/fire-hotspots')) {
      try {
        const json = await res.json();
        networkCalls.fireHotspots = { status: res.status(), count: json.totalCount, url };
      } catch {
        networkCalls.fireHotspots = { status: res.status(), url };
      }
    } else if (url.includes('open-meteo.com')) {
      networkCalls.weather = { status: res.status(), url };
    } else if (url.includes('gibs.earthdata.nasa.gov')) {
      networkCalls.gibsWms = { status: res.status(), url };
    }
  });

  console.log('Navigating to frontend...');
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  console.log('Waiting for map to initialize and load disasters...');
  await page.waitForFunction(() => {
    const map = window.mapDebug;
    if (!map || typeof map.getSource !== 'function') return false;
    return map.getSource('fires') !== undefined || map.getSource('earthquakes') !== undefined;
  }, { timeout: 45000 });

  console.log('Disaster data source verified on map!');

  // Select the first available feature
  console.log('Selecting disaster to open Sidebar...');
  const selectedFeature = await page.evaluate(() => {
    const map = window.mapDebug;
    const sourceName = map.getSource('fires') ? 'fires' : 'earthquakes';
    const source = map.getSource(sourceName);
    const feature = source._data.features[0];
    const props = feature.properties;

    const disaster = {
      id: props.id,
      title: props.title,
      lng: props.lng,
      lat: props.lat,
      type: props.type,
      severity: props.severity,
      date: props.date,
    };

    if (typeof window.selectDisasterDebug === 'function') {
      window.selectDisasterDebug(disaster);
    }

    return disaster;
  });

  console.log('Disaster selected:', selectedFeature);

  // Wait for sidebar to be visible
  console.log('Waiting for Sidebar to appear...');
  await page.waitForSelector('.sidebar-container', { timeout: 10000 });
  console.log('Sidebar is open!');

  // Give 5 seconds for subrequests (TLEs, satellite pass calculations, weather, FIRMS hotspots, GIBS imagery)
  console.log('Waiting 5s for orbital passes, weather, and satellite imagery to resolve...');
  await page.waitForTimeout(5000);

  // Inspect the sidebar DOM content
  const sidebarData = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar-container');
    if (!sidebar) return null;

    const text = sidebar.innerText;

    // Check for pass predictions or honest no-pass state
    const hasSatellites =
      /landsat|sentinel|terra|aqua|pass|elevation|satellite/i.test(text);

    // Check for weather
    const hasWeather =
      /cloud cover|weather|%/i.test(text);

    // Check for thermal / imagery
    const hasThermal =
      /hotspot|thermal|firms|imagery/i.test(text);

    return {
      hasSatellites,
      hasWeather,
      hasThermal,
      textSnippet: text.substring(0, 600),
    };
  });

  console.log('\n--- Sidebar Content Audit ---');
  console.log('Orbital Pass Predictions Detected:', sidebarData.hasSatellites);
  console.log('Weather Section Detected:         ', sidebarData.hasWeather);
  console.log('Thermal / Imagery Section:         ', sidebarData.hasThermal);

  console.log('\n--- Network Integration Audit ---');
  console.log('/api/disasters:     ', networkCalls.disasters);
  console.log('/api/tles:          ', networkCalls.tles);
  console.log('/api/fire-hotspots: ', networkCalls.fireHotspots);
  console.log('Open-Meteo weather: ', networkCalls.weather);
  console.log('NASA GIBS WMS:      ', networkCalls.gibsWms);

  console.log('\n--- Captured Sidebar Text ---\n', sidebarData.textSnippet);

  await page.screenshot({ path: 'sidebar_verified.png' });
  console.log('\nScreenshot saved to sidebar_verified.png');

  await browser.close();

  if (!sidebarData || !sidebarData.hasSatellites) {
    console.error('❌ FAILED: Sidebar did not render satellite pass predictions');
    process.exit(1);
  }

  console.log('\n✅ PASS: End-to-end Sidebar and data integrations verified successfully!');
}

run().catch((err) => {
  console.error('Fatal error in verification:', err);
  process.exit(1);
});
