/**
 * AegisMap Deterministic Responsive UI/UX, Pinned Popup Tip-Geometry,
 * Multi-Viewport Clipping/Scroll/Focus/RTL, and Interrupted Service-Worker
 * Upgrade Verification Suite.
 *
 * Usage:
 *   FRONTEND_URL=http://127.0.0.1:4173/aegis-map/ SW_BASELINE_DIST=/path/to/baseline-dist node scripts/verify-responsive-ux.mjs
 *
 * Environment variables:
 *   FRONTEND_URL       Served candidate production URL under /aegis-map/
 *   SW_BASELINE_DIST   Required path to distinct baseline dist build (unless --allow-missing-baseline)
 *   UX_EVIDENCE_DIR    Output directory for matched before/after PNGs, WebM video, ux-test-report.json & ux-test-report.md
 *   CANDIDATE_SHA      Commit SHA of candidate build (recorded in report)
 *   BASELINE_SHA       Commit SHA of baseline build (recorded in report)
 */

import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
	generateEphemeralClientPushKeys,
	generateEphemeralVapidKeys,
} from '../../shared/test-helpers/ephemeralWebPush.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const FRONTEND_DIST = path.resolve(__dirname, '../dist');
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://127.0.0.1:4173/aegis-map/').replace(/\/?$/, '/');
const EVIDENCE_DIR = process.env.UX_EVIDENCE_DIR
	? path.resolve(process.env.UX_EVIDENCE_DIR)
	: path.resolve(REPO_ROOT, '.tmp/ux-evidence');
const SW_BASELINE_DIST = process.env.SW_BASELINE_DIST ? path.resolve(process.env.SW_BASELINE_DIST) : null;
const ALLOW_MISSING_BASELINE = process.argv.includes('--allow-missing-baseline');
const STEP_TIMEOUT = 35000;

/**
 * Justified popup-tip attachment tolerance (pixels in X and Y):
 * Mapbox GL JS rounds popup CSS transforms to integer pixels (<= 1px) and the
 * CSS border triangle tip has a 1.5–2px border seam on globe curvature.
 * 4.5px allows sub-pixel / integer rounding while failing any visibly detached
 * popup (>= 5px gap, stale pan position, wrong anchor, or wrong marker).
 */
const MAX_TIP_TOLERANCE_PX = 4.5;
const POPUP_CONFIGURED_OFFSET_PX = 20;

function resolveGitSha(fallback = 'unknown') {
	try {
		return childProcess.execSync('git rev-parse HEAD', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
	} catch {
		return fallback;
	}
}

const CANDIDATE_SHA = process.env.CANDIDATE_SHA || resolveGitSha();
const BASELINE_SHA = process.env.BASELINE_SHA || '556f4c39f27925ad037a9b2c4e7975e58df462de';

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

class Checks {
	constructor() {
		this.items = [];
		this.skipped = [];
	}
	record(ok, label, detail = '', gate = 'general') {
		this.items.push({ ok: Boolean(ok), label, detail, gate });
		console.log(`  ${ok ? 'PASS' : 'FAIL'}  [${gate}] ${label}${detail ? ` — ${detail}` : ''}`);
		return Boolean(ok);
	}
	skip(label, reason, gate = 'general') {
		this.skipped.push({ label, reason, gate });
		console.log(`  SKIP  [${gate}] ${label} — ${reason}`);
	}
	get passed() {
		return this.items.filter((i) => i.ok);
	}
	get failed() {
		return this.items.filter((i) => !i.ok);
	}
}

// ============================================================================
// Deterministic Fixtures (Disasters, Warnings, Fresh Checksummed TLEs, SAR, Archive)
// ============================================================================

function withTleChecksum(line68) {
	const padded = line68.slice(0, 68).padEnd(68, ' ');
	let sum = 0;
	for (let i = 0; i < 68; i++) {
		const ch = padded[i];
		if (ch >= '0' && ch <= '9') sum += Number(ch);
		else if (ch === '-') sum += 1;
	}
	return `${padded}${sum % 10}`;
}

function buildFreshDeterministicTleText(nowMs = Date.now()) {
	const epochDate = new Date(nowMs - 2 * 3600_000);
	const yr2 = String(epochDate.getUTCFullYear() % 100).padStart(2, '0');
	const startOfYear = Date.UTC(epochDate.getUTCFullYear(), 0, 1);
	const dayOfYear = 1 + (epochDate.getTime() - startOfYear) / 86_400_000;
	const epochField = `${yr2}${dayOfYear.toFixed(8).padStart(12, '0')}`;

	const sats = [
		{ name: 'LANDSAT 8', norad: '39084', intl: '13008A  ', inc: ' 98.2112', raan: ' 42.1540', ecc: '0001245', argp: ' 88.4120', ma: '271.7210', mm: '14.57112410', rev: '64120' },
		{ name: 'LANDSAT 9', norad: '49260', intl: '21088A  ', inc: ' 98.2154', raan: ' 42.3100', ecc: '0001189', argp: ' 91.1050', ma: ' 91.8840', mm: '14.57114020', rev: '21890' },
		{ name: 'SENTINEL-2A', norad: '40697', intl: '15028A  ', inc: ' 98.5681', raan: '115.4200', ecc: '0001092', argp: ' 94.3310', ma: '265.8100', mm: '14.30818200', rev: '52110' },
		{ name: 'SENTINEL-2B', norad: '42063', intl: '17013A  ', inc: ' 98.5692', raan: '115.4400', ecc: '0001120', argp: ' 92.8100', ma: ' 85.9200', mm: '14.30819100', rev: '41050' },
		{ name: 'TERRA', norad: '25994', intl: '99068A  ', inc: ' 98.1985', raan: '160.2500', ecc: '0001420', argp: ' 79.5500', ma: '280.6000', mm: '14.57109500', rev: '38910' },
		{ name: 'AQUA', norad: '27424', intl: '02022A  ', inc: ' 98.2040', raan: '245.1200', ecc: '0001380', argp: ' 84.1900', ma: '195.4400', mm: '14.57118000', rev: '22410' },
	];

	const lines = [];
	for (const s of sats) {
		const l1 = withTleChecksum(`1 ${s.norad}U ${s.intl} ${epochField}  .00000412  00000-0  96214-4 0  999`);
		const l2 = withTleChecksum(`2 ${s.norad} ${s.inc} ${s.raan} ${s.ecc} ${s.argp} ${s.ma} ${s.mm}${s.rev}`);
		lines.push(s.name, l1, l2);
	}
	return { text: `${lines.join('\n')}\n`, oldestEpochIso: epochDate.toISOString() };
}

const DETERMINISTIC_EVENTS = {
	eventA: {
		id: 'det-fire-va',
		type: 'fire',
		title: 'Wildfire Little Ridge Complex, Highland, Virginia',
		lat: 38.314,
		lng: -79.791,
		date: '2026-11-26T21:15:00.000Z',
		severity: 'high',
		areaAcres: 1450,
	},
	eventB: {
		id: 'det-quake-pt',
		type: 'earthquake',
		title: 'M 5.6 - 48 km SW of Horta, Azores',
		lat: 38.215,
		lng: -29.042,
		date: '2026-11-27T11:40:00.000Z',
		severity: 'high',
		magnitude: 5.6,
	},
	eventC: {
		id: 'det-volc-is',
		type: 'volcano',
		title: 'Reykjanes Peninsula Fissure System, Iceland',
		lat: 63.882,
		lng: -22.432,
		date: '2026-11-20T09:00:00.000Z',
		severity: 'medium',
		isHistoricalContext: true,
	},
	eventEdge: {
		id: 'det-fire-iber',
		type: 'fire',
		title: 'Serra da Estrela Ridge Wildfire, Portugal',
		lat: 40.321,
		lng: -7.612,
		date: '2026-11-27T08:20:00.000Z',
		severity: 'medium',
		areaAcres: 620,
	},
};

const LONG_SAR_SCENE_ID =
	'S1A_IW_GRDH_1SDV_20261126T174211_20261126T174236_056728_06F5A2_9F4B_SUPERLONGTOKEN';

const CORS_HEADERS = {
	'access-control-allow-origin': '*',
	'access-control-expose-headers':
		'X-Disaster-Sources, X-Disaster-Fetched-At, X-Disaster-Partial, X-TLE-Status, X-TLE-Oldest-Epoch, Retry-After',
};

async function installDeterministicFixtures(page, options = {}) {
	const {
		subscriptionAvailable = true,
		subscriptionReason = undefined,
		pushAvailable = false,
		pushMode = 'unavailable',
		vapidPublicKey = undefined,
		pushReason = undefined,
		trackCounts = null,
		mapboxTracker = null,
	} = options;

	const tlePayload = buildFreshDeterministicTleText();
	const nowIso = new Date().toISOString();

	// Fallback Mapbox GL v8 globe style ONLY if api.mapbox.com rejects token in CI
	await page.route('https://api.mapbox.com/styles/v1/**', async (route) => {
		try {
			const res = await route.fetch({ timeout: 8000 });
			if (res.ok()) {
				if (mapboxTracker) mapboxTracker.mode = 'live-mapbox-standard-satellite';
				await route.fulfill({ response: res });
				return;
			}
		} catch {
			// Fall back to deterministic globe style below
		}
		if (mapboxTracker) mapboxTracker.mode = 'deterministic-globe-fallback-style';
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: CORS_HEADERS,
			body: JSON.stringify({
				version: 8,
				name: 'Aegis Deterministic Globe Fallback',
				projection: { name: 'globe' },
				sources: {},
				layers: [
					{
						id: 'ocean-bg',
						type: 'background',
						paint: { 'background-color': '#0b192c' },
					},
				],
			}),
		});
	});

	await page.route('**/api/v2/disasters**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: {
				...CORS_HEADERS,
				'x-disaster-sources': 'eonet=ok;usgs=ok;firms=ok',
				'x-disaster-fetched-at': nowIso,
				'x-disaster-partial': 'false',
			},
			body: JSON.stringify({
				version: 2,
				window: '24h',
				windowRange: {
					startInclusive: '2026-11-26T18:00:00.000Z',
					endExclusive: '2026-11-27T18:00:00.000Z',
				},
				summary: {
					namedFires: 2,
					fireDetections: 42,
					fireCells: 1,
					earthquakes: 1,
					volcanoes: 1,
				},
				wildfires: [DETERMINISTIC_EVENTS.eventA, DETERMINISTIC_EVENTS.eventEdge],
				earthquakes: [DETERMINISTIC_EVENTS.eventB],
				volcanoes: [DETERMINISTIC_EVENTS.eventC],
				fireCells: [
					{
						cellId: 'cell_-12.25_132.75',
						lat: -12.25,
						lng: 132.75,
						bounds: [132.5, -12.5, 133.0, -12.0],
						detectionCount: 42,
						maxFrp: 118.5,
						avgFrp: 31.2,
						maxBrightTi4: 356.4,
						latestAcqTime: '2026-11-27T06:00:00Z',
						confidenceCounts: { high: 12, nominal: 30, low: 0, unknown: 0 },
						dayNightCounts: { day: 30, night: 12, unknown: 0 },
						satelliteCounts: { N: 42 },
						intensity: 'high',
					},
				],
				sources: {
					eonet: { status: 'ok', count: 3, rejected: 0 },
					usgs: { status: 'ok', count: 1, rejected: 0 },
					firms: {
						status: 'ok',
						generatedAt: nowIso,
						sensors: { VIIRS_SNPP_NRT: { status: 'ok', rawRows: 42, acceptedRows: 42 } },
						accounting: {
							rawRows: 42,
							malformedRows: 0,
							outOfWindowRows: 0,
							duplicateRows: 0,
							acceptedDetections: 42,
						},
					},
				},
				fetchedAt: nowIso,
			}),
		}),
	);

	await page.route('**/api/tles**', (route) => {
		if (trackCounts) trackCounts.tles++;
		return route.fulfill({
			status: 200,
			contentType: 'text/plain; charset=utf-8',
			headers: {
				...CORS_HEADERS,
				'x-tle-status': 'complete',
				'x-tle-oldest-epoch': tlePayload.oldestEpochIso,
			},
			body: tlePayload.text,
		});
	});

	await page.route('https://api.open-meteo.com/v1/forecast**', (route) => {
		const baseMs = Math.floor(Date.now() / 3_600_000) * 3_600_000;
		const times = Array.from({ length: 48 }, (_, i) =>
			new Date(baseMs + i * 3_600_000).toISOString().slice(0, 16),
		);
		const clouds = times.map((_, i) => (i * 7 + 18) % 85);
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: CORS_HEADERS,
			body: JSON.stringify({ hourly: { time: times, cloud_cover: clouds } }),
		});
	});

	await page.route('**/api/analyze**', (route) => {
		if (route.request().method() === 'POST' && trackCounts) trackCounts.analyze++;
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: CORS_HEADERS,
			body: JSON.stringify({
				source: 'workers-ai',
				cached: true,
				analysis:
					'Upcoming polar-orbiting overpass offers favorable viewing geometry with low-to-moderate cloud cover; verify thermal detections against Sentinel-1 radar backscatter.',
			}),
		});
	});

	await page.route('**/api/fire-hotspots**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: CORS_HEADERS,
			body: JSON.stringify({
				source: 'VIIRS_SNPP_NRT',
				sensor: 'VIIRS S-NPP 375m',
				totalCount: 3,
				rejectedRows: 0,
				fetchedAt: nowIso,
				coverage: {
					status: 'complete',
					timezone: 'UTC',
					requestedStart: '2026-11-21',
					requestedEnd: '2026-11-27',
					missingDates: [],
					windows: [],
				},
				hotspots: [
					{
						latitude: 38.316,
						longitude: -79.789,
						bright_ti4: 344.2,
						frp: 28.4,
						confidence: 'h',
						acq_date: '2026-11-26',
						acq_time: '1815',
						satellite: 'N',
						daynight: 'D',
					},
				],
			}),
		}),
	);

	await page.route('**/api/v1/sar-scenes**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: CORS_HEADERS,
			body: JSON.stringify({
				version: 1,
				cached: true,
				nextToken: null,
				scenes: [
					{
						id: LONG_SAR_SCENE_ID,
						datetime: '2026-11-26T17:42:11Z',
						instrumentMode: 'IW',
						polarizations: ['VV', 'VH'],
						orbitState: 'ascending',
						incidenceAngleDeg: 38.4,
						bbox: [-80.25, 37.95, -79.2, 38.75],
						copernicusBrowserUrl: 'https://browser.dataspace.copernicus.eu/',
						stacItemUrl: 'https://catalogue.dataspace.copernicus.eu/',
					},
					{
						id: 'S1B_EW_GRDM_UNKNOWN_DATE_SCENE',
						datetime: '',
						instrumentMode: 'EW',
						polarizations: ['HH'],
						orbitState: 'descending',
						incidenceAngleDeg: null,
						bbox: [-80.5, 37.8, -79.1, 38.8],
						copernicusBrowserUrl: 'https://browser.dataspace.copernicus.eu/',
						stacItemUrl: 'https://catalogue.dataspace.copernicus.eu/',
					},
				],
			}),
		}),
	);

	const fortyArchiveEvents = Array.from({ length: 40 }, (_, idx) => ({
		id: `arch-det-${idx + 1}`,
		upstreamId: idx === 0 ? DETERMINISTIC_EVENTS.eventB.id : `arch-up-${idx + 1}`,
		type: idx % 3 === 0 ? 'earthquake' : idx % 3 === 1 ? 'fire' : 'volcano',
		title:
			idx === 0
				? DETERMINISTIC_EVENTS.eventB.title
				: `Archived Observation #${idx + 1} — Regional Hazard Monitoring Record`,
		lat: idx === 0 ? DETERMINISTIC_EVENTS.eventB.lat : 35.68 + idx * 0.08,
		lng: idx === 0 ? DETERMINISTIC_EVENTS.eventB.lng : 51.38 + idx * 0.08,
		eventTime: '2026-11-26T17:50:00Z',
		firstSeenAt: '2026-11-26T17:54:00Z',
		severity: idx % 2 === 0 ? 'high' : 'medium',
		magnitude: idx % 3 === 0 ? 5.6 : null,
		areaAcres: idx % 3 === 1 ? 4200 : null,
		provenance: idx % 2 === 0 ? 'live_captured' : 'reconstructed_backfill',
		attribution: idx % 3 === 0 ? 'USGS Earthquake Hazards Program' : 'NASA EONET',
		gdacsMatchId: idx === 0 ? '1009981' : null,
		revisions: [
			{ revisionNumber: 1, observedAt: '2026-11-26T17:54:00Z', title: 'Initial report', severity: 'medium' },
			{ revisionNumber: 2, observedAt: '2026-11-26T18:20:00Z', title: 'Updated magnitude/area', severity: 'high' },
		],
	}));

	await page.route('**/api/v1/history**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: CORS_HEADERS,
			body: JSON.stringify({ version: 1, storageAvailable: true, events: fortyArchiveEvents }),
		}),
	);

	await page.route('**/api/v1/analytics/sources**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: CORS_HEADERS,
			body: JSON.stringify({
				version: 1,
				storageAvailable: true,
				providers: [
					{ provider: 'eonet', runs: 24, okRuns: 24, avgLatencyMs: 182, totalRecords: 98, totalRejected: 0, lastStatus: 'ok' },
					{ provider: 'usgs', runs: 24, okRuns: 24, avgLatencyMs: 94, totalRecords: 26, totalRejected: 0, lastStatus: 'ok' },
				],
			}),
		}),
	);

	await page.route('**/api/v1/warnings**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: CORS_HEADERS,
			body: JSON.stringify({
				version: 1,
				query: { lat: 59.9139, lng: 10.7522, countryCode: 'NO', checkedAt: nowIso },
				coverageStatus: 'active_warnings',
				coverageExplanation: 'Checked Meteorologisk institutt (MET Norway) — 1 active official warning.',
				warnings: [
					{
						id: 'no-det-gale-1',
						identifier: '2.49.0.1.578.0.20261127120000',
						sourceId: 'no-metalerts',
						issuerName: 'Meteorologisk institutt (MET Norway)',
						issuerUrl: 'https://www.met.no/',
						countryCode: 'NO',
						msgType: 'Alert',
						lifecycleState: 'active',
						category: 'Met',
						severity: 'moderate',
						urgency: 'Expected',
						certainty: 'Likely',
						sentAt: '2026-11-27T12:00:00Z',
						effectiveAt: '2026-11-27T12:00:00Z',
						onsetAt: '2026-11-27T14:00:00Z',
						expiresAt: '2026-11-28T06:00:00Z',
						missingExpiry: false,
						clockSkewFlag: false,
						matchMethod: 'polygon',
						matchUncertain: false,
						matchNote: 'Point inside official CAP warning polygon',
						primaryLanguage: 'no',
						translations: [
							{
								language: 'no',
								headline: 'Gult farevarsel for kraftige vindkast, Oslo og Akershus',
								event: 'Vindkast (Gale-force gusts)',
								description: 'Lokalt kraftige vindkast på 22–26 m/s fra sørvest.',
								instruction: 'Sikre løse gjenstander. Unngå unødvendig ferdsel på utsatte steder.',
								areaDesc: 'Oslo',
								web: 'https://www.met.no/',
							},
						],
						bulletinUrl: 'https://www.met.no/',
						attribution: 'Data from Meteorologisk institutt (MET Norway) — NLOD 2.0',
					},
				],
				sources: [
					{
						sourceId: 'no-metalerts',
						authorityName: 'Meteorologisk institutt (MET Norway)',
						countryCodes: ['NO', 'SJ'],
						status: 'ok',
						checkedAt: nowIso,
						lastSuccessAt: nowIso,
						activeAlertCount: 1,
						matchedAlertCount: 1,
						unsupportedHazards: ['Earthquakes (NORSAR)', 'Floods & Landslides (NVE)'],
						attribution: 'MET Norway (NLOD 2.0)',
						termsUrl: 'https://api.met.no/doc/License',
					},
				],
			}),
		}),
	);

	await page.route('**/api/v1/subscriptions/status**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: CORS_HEADERS,
			body: JSON.stringify({
				available: subscriptionAvailable,
				mode: subscriptionAvailable ? 'sandbox' : 'unavailable',
				smsAvailable: false,
				reason: subscriptionReason,
				pushAvailable,
				pushMode,
				...(vapidPublicKey ? { vapidPublicKey } : {}),
				...(pushReason ? { pushReason } : {}),
			}),
		}),
	);
}

// ============================================================================
// Switchable /aegis-map/ Server with Targeted Asset Interruption Injection
// ============================================================================

const MIME_BY_EXT = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
};

function startSwitchableBaseServer(initialRootDir) {
	let activeRoot = initialRootDir;
	let failPathSubstrings = [];
	let serverOffline = false;

	const server = http.createServer((req, res) => {
		if (serverOffline) {
			req.socket.destroy();
			return;
		}
		const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
		if (!urlObj.pathname.startsWith('/aegis-map')) {
			res.writeHead(404);
			res.end('Not found');
			return;
		}
		if (failPathSubstrings.some((sub) => urlObj.pathname.includes(sub))) {
			res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
			res.end('Simulated interrupted deployment asset failure');
			return;
		}

		let rel = urlObj.pathname.slice('/aegis-map'.length);
		if (!rel || rel === '/') rel = '/index.html';
		const safeRel = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
		let filePath = path.join(activeRoot, safeRel);
		const isAssetRequest = safeRel.replace(/\\/g, '/').startsWith('/assets/') || safeRel.replace(/\\/g, '/').startsWith('assets/');
		if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
			if (isAssetRequest) {
				res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
				res.end('Missing hashed asset');
				return;
			}
			filePath = path.join(activeRoot, 'index.html');
		}
		if (!fs.existsSync(filePath)) {
			res.writeHead(404);
			res.end('Missing shell');
			return;
		}
		const ext = path.extname(filePath).toLowerCase();
		res.writeHead(200, {
			'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream',
			'Cache-Control': isAssetRequest ? 'public, max-age=31536000, immutable' : 'no-cache',
		});
		fs.createReadStream(filePath).pipe(res);
	});

	return new Promise((resolve, reject) => {
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			resolve({
				url: `http://127.0.0.1:${port}/aegis-map/`,
				setRoot: (nextDir) => {
					activeRoot = nextDir;
				},
				setFailSubstrings: (subs) => {
					failPathSubstrings = subs;
				},
				setServerOffline: (down) => {
					serverOffline = Boolean(down);
				},
				close: () => new Promise((r) => server.close(() => r())),
			});
		});
	});
}

// ============================================================================
// Browser Geometry & Clipping Helpers
// ============================================================================

async function waitForMapReady(page) {
	await page.waitForFunction(
		() =>
			Boolean(
				window.mapDebug &&
					typeof window.mapDebug.getLayer === 'function' &&
					['fires-layer', 'earthquakes-layer', 'volcanoes-layer'].some((l) => window.mapDebug.getLayer(l)),
			),
		undefined,
		{ timeout: STEP_TIMEOUT },
	);
}

/**
 * Measures the rendered Mapbox popup tip endpoint (`tipApex`) against the
 * projected double-circle selection-ring center (`ringCenter`) accounting for
 * the active `mapboxgl-popup-anchor-*` orientation and `POPUP_CONFIGURED_OFFSET_PX`.
 */
async function measurePinnedPopupAttachment(page, offsetPx = POPUP_CONFIGURED_OFFSET_PX) {
	return page.evaluate((configuredOffset) => {
		const map = window.mapDebug;
		const popups = Array.from(document.querySelectorAll('.mapboxgl-popup'));
		const sidebar = document.querySelector('[data-testid="sidebar"]');
		const sidebarId = sidebar?.getAttribute('data-disaster-id') ?? null;
		const inspectorTitle = document.querySelector('[data-testid="inspector-event-title"]')?.textContent?.trim() ?? null;

		const selSrc = map?.getSource?.('selected-disaster');
		const ringFeat = selSrc?._data?.features?.[0] ?? null;
		const ringCoords = ringFeat?.geometry?.coordinates ?? null;
		const ringId = ringFeat?.properties?.id ?? null;
		const hasHaloLayer = Boolean(map?.getLayer?.('selected-disaster-halo-layer'));
		const hasRingLayer = Boolean(map?.getLayer?.('selected-disaster-ring-layer'));

		if (popups.length !== 1 || !ringCoords || !map) {
			return {
				popupCount: popups.length,
				sidebarId,
				inspectorTitle,
				ringId,
				ringCoords,
				hasHaloLayer,
				hasRingLayer,
				attached: false,
			};
		}

		const popupEl = popups[0];
		const pinnedContent = popupEl.querySelector('[data-testid="pinned-disaster-popup"]');
		const pinnedId = pinnedContent?.getAttribute('data-disaster-id') ?? null;
		const tipEl = popupEl.querySelector('.mapboxgl-popup-tip');
		const canvasRect = map.getCanvas().getBoundingClientRect();
		const projected = map.project([ringCoords[0], ringCoords[1]]);
		const ringCenter = {
			x: canvasRect.left + projected.x,
			y: canvasRect.top + projected.y,
		};

		const anchorOrder = [
			'bottom-left',
			'bottom-right',
			'top-left',
			'top-right',
			'bottom',
			'top',
			'left',
			'right',
			'center',
		];
		const anchor =
			anchorOrder.find((a) => popupEl.classList.contains(`mapboxgl-popup-anchor-${a}`)) || 'bottom';

		const tipRect = tipEl?.getBoundingClientRect();
		const popRect = popupEl.getBoundingClientRect();
		if (!tipRect) {
			return {
				popupCount: popups.length,
				pinnedId,
				sidebarId,
				inspectorTitle,
				ringId,
				ringCoords,
				hasHaloLayer,
				hasRingLayer,
				anchor,
				attached: false,
			};
		}

		let tipApex = { x: tipRect.left + tipRect.width / 2, y: tipRect.bottom };
		const diag = configuredOffset * Math.SQRT1_2;
		let expectedTip = { x: ringCenter.x, y: ringCenter.y - configuredOffset };

		switch (anchor) {
			case 'bottom':
				tipApex = { x: tipRect.left + tipRect.width / 2, y: tipRect.bottom };
				expectedTip = { x: ringCenter.x, y: ringCenter.y - configuredOffset };
				break;
			case 'top':
				tipApex = { x: tipRect.left + tipRect.width / 2, y: tipRect.top };
				expectedTip = { x: ringCenter.x, y: ringCenter.y + configuredOffset };
				break;
			case 'left':
				tipApex = { x: tipRect.left, y: tipRect.top + tipRect.height / 2 };
				expectedTip = { x: ringCenter.x + configuredOffset, y: ringCenter.y };
				break;
			case 'right':
				tipApex = { x: tipRect.right, y: tipRect.top + tipRect.height / 2 };
				expectedTip = { x: ringCenter.x - configuredOffset, y: ringCenter.y };
				break;
			case 'bottom-left':
				tipApex = { x: tipRect.left, y: tipRect.bottom };
				expectedTip = { x: ringCenter.x + diag, y: ringCenter.y - diag };
				break;
			case 'bottom-right':
				tipApex = { x: tipRect.right, y: tipRect.bottom };
				expectedTip = { x: ringCenter.x - diag, y: ringCenter.y - diag };
				break;
			case 'top-left':
				tipApex = { x: tipRect.left, y: tipRect.top };
				expectedTip = { x: ringCenter.x + diag, y: ringCenter.y + diag };
				break;
			case 'top-right':
				tipApex = { x: tipRect.right, y: tipRect.top };
				expectedTip = { x: ringCenter.x - diag, y: ringCenter.y + diag };
				break;
			default:
				tipApex = { x: popRect.left + popRect.width / 2, y: popRect.top + popRect.height / 2 };
				expectedTip = { x: ringCenter.x, y: ringCenter.y };
				break;
		}

		const dx = Math.abs(tipApex.x - expectedTip.x);
		const dy = Math.abs(tipApex.y - expectedTip.y);

		return {
			popupCount: popups.length,
			pinnedId,
			sidebarId,
			inspectorTitle,
			ringId,
			ringCoords,
			hasHaloLayer,
			hasRingLayer,
			anchor,
			ringCenter: { x: Number(ringCenter.x.toFixed(2)), y: Number(ringCenter.y.toFixed(2)) },
			tipApex: { x: Number(tipApex.x.toFixed(2)), y: Number(tipApex.y.toFixed(2)) },
			expectedTip: { x: Number(expectedTip.x.toFixed(2)), y: Number(expectedTip.y.toFixed(2)) },
			dx: Number(dx.toFixed(2)),
			dy: Number(dy.toFixed(2)),
			popupBounds: {
				left: Math.round(popRect.left),
				top: Math.round(popRect.top),
				right: Math.round(popRect.right),
				bottom: Math.round(popRect.bottom),
			},
			viewport: { width: window.innerWidth, height: window.innerHeight },
		};
	}, offsetPx);
}

/**
 * Scrolls `selector` into view and verifies it is genuinely visible, non-zero-sized,
 * unclipped horizontally, and fully reachable via scrolling vertically (including cards
 * taller than a 568px phone viewport by checking both start and end scroll positions).
 */
async function checkScrollReachableAndUnclipped(page, selector) {
	return page.evaluate((sel) => {
		const el = document.querySelector(sel);
		if (!el) return { found: false, unclipped: false, detail: `missing ${sel}` };
		el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		const r = el.getBoundingClientRect();
		const cs = window.getComputedStyle(el);
		const visibleStyle = cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0;
		const withinX = r.left >= -1 && r.right <= window.innerWidth + 1;
		const sized = r.width >= 24 && r.height >= 24;

		let withinY = r.top >= -1 && r.bottom <= window.innerHeight + 1;
		if (!withinY && r.height > window.innerHeight) {
			el.scrollIntoView({ block: 'start', inline: 'nearest' });
			const topRect = el.getBoundingClientRect();
			const topReachable = topRect.top >= -1 && topRect.top < window.innerHeight;
			el.scrollIntoView({ block: 'end', inline: 'nearest' });
			const botRect = el.getBoundingClientRect();
			const botReachable = botRect.bottom > 0 && botRect.bottom <= window.innerHeight + 1;
			withinY = topReachable && botReachable;
		}
		return {
			found: true,
			unclipped: visibleStyle && withinX && withinY && sized,
			detail: `${sel} rect=[${Math.round(r.left)},${Math.round(r.top)}..${Math.round(r.right)},${Math.round(r.bottom)}] vp=${window.innerWidth}x${window.innerHeight}`,
		};
	}, selector);
}

async function centerAndProjectEvent(page, ev, zoom = 5.0) {
	return page.evaluate(
		async ({ lng, lat, z }) => {
			const map = window.mapDebug;
			map.jumpTo({ center: [lng, lat], zoom: z, bearing: 0, pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
			await new Promise((r) => {
				const timer = setTimeout(r, 2000);
				map.once('idle', () => {
					clearTimeout(timer);
					r();
				});
			});
			const pt = map.project([lng, lat]);
			const rect = map.getCanvas().getBoundingClientRect();
			return { x: rect.left + pt.x, y: rect.top + pt.y, canvasWidth: rect.width, canvasHeight: rect.height };
		},
		{ lng: ev.lng, lat: ev.lat, z: zoom },
	);
}

// ============================================================================
// Main Verification Execution
// ============================================================================

async function main() {
	const checks = new Checks();
	const artifacts = [];
	const mapboxTracker = { mode: 'live-mapbox-standard-satellite' };

	const browser = await chromium.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
	});
	const browserLabel = `Chromium ${browser.version()} (Playwright headless, ANGLE SwiftShader WebGL2)`;

	const registerArtifact = (file, meta) => {
		artifacts.push({
			file,
			sha: meta.sha || CANDIDATE_SHA,
			surface: meta.surface,
			viewport: meta.viewport,
			browser: browserLabel,
			theme: meta.theme || 'dark',
			locale: meta.locale || 'en',
			fixture: meta.fixture || 'deterministic-v1.5-ux-fixture',
			executionMode: meta.executionMode || 'Playwright Chromium desktop emulation',
		});
	};

	const reportData = {
		generatedAt: new Date().toISOString(),
		candidateSha: CANDIDATE_SHA,
		baselineSha: BASELINE_SHA,
		browser: browserLabel,
		frontendUrl: FRONTEND_URL,
		maxTipTolerancePx: MAX_TIP_TOLERANCE_PX,
		popupConfiguredOffsetPx: POPUP_CONFIGURED_OFFSET_PX,
		computedStyles: {},
		popupTipMeasurements: [],
		swFreshInstall: null,
		swInterruptedUpgrade: null,
		zoomChecks: {},
		artifacts,
		summary: null,
	};

	try {
		// =========================================================================
		// GATE 1: Service Worker Offline Updates (Fresh Install + Interrupted Upgrade)
		// =========================================================================
		console.log('\n=== Gate 1: Service Worker Fresh Install & Interrupted Upgrade Safety ===');

		// 1A: Fresh-install coverage (reported separately from upgrade coverage)
		const freshServer = await startSwitchableBaseServer(FRONTEND_DIST);
		try {
			const freshCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
			const freshPage = await freshCtx.newPage();

			// Visit /aegis-map/ (Explore) first so NearMeView lazy chunk is NOT loaded by page navigation,
			// proving SW install pre-caches the NearMeView route graph directly from the Vite build manifest!
			await freshPage.goto(freshServer.url, { waitUntil: 'load', timeout: STEP_TIMEOUT });
			await freshPage.evaluate(async () => {
				const deadline = Date.now() + 15000;
				while (Date.now() < deadline) {
					const reg = await navigator.serviceWorker?.getRegistration();
					const ctrl = navigator.serviceWorker?.controller;
					const keys = await caches.keys();
					if (reg?.active?.state === 'activated' && ctrl && keys.some((k) => k.startsWith('aegis-shell-'))) {
						return;
					}
					await new Promise((r) => setTimeout(r, 100));
				}
				throw new Error('Timed out waiting for fresh SW activation');
			});

			freshServer.setServerOffline(true);
			await freshCtx.setOffline(true);
			await freshPage.goto(`${freshServer.url}?view=near-me`, {
				waitUntil: 'domcontentloaded',
				timeout: STEP_TIMEOUT,
			});
			await freshPage.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			await freshPage.locator('[data-testid="place-search-input"]').fill('Georgetown');
			await freshPage.locator('[data-testid="place-search-btn"]').click();
			await freshPage.locator('[data-testid="place-candidates"] button').first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			const freshOfflineCandidates = await freshPage.locator('[data-testid="place-candidates"] button').count();
			const freshCaches = await freshPage.evaluate(() => caches.keys());
			reportData.swFreshInstall = { caches: freshCaches, offlineCandidates: freshOfflineCandidates };

			checks.record(
				freshOfflineCandidates >= 2 && freshCaches.length === 1 && freshCaches[0].startsWith('aegis-shell-'),
				'Fresh install pre-caches shell + CSS + entry JS + lazy NearMeView route so Near me opens & operates offline even when only Explore was visited online',
				JSON.stringify(reportData.swFreshInstall),
				'sw-fresh-install',
			);
			await freshCtx.close();
		} finally {
			await freshServer.close();
		}

		// 1B: Deterministic Interrupted Upgrade Test (SW_BASELINE_DIST -> FRONTEND_DIST)
		if (!SW_BASELINE_DIST || !fs.existsSync(SW_BASELINE_DIST)) {
			if (ALLOW_MISSING_BASELINE) {
				checks.skip(
					'Interrupted SW upgrade from baseline build',
					'SW_BASELINE_DIST not provided (--allow-missing-baseline set)',
					'sw-interrupted-upgrade',
				);
			} else {
				checks.record(
					false,
					'SW_BASELINE_DIST baseline build is explicitly required for release-gate upgrade verification',
					`SW_BASELINE_DIST=${SW_BASELINE_DIST || 'unset'}`,
					'sw-interrupted-upgrade',
				);
			}
		} else {
			const baselineHtml = fs.readFileSync(path.join(SW_BASELINE_DIST, 'index.html'), 'utf-8');
			const candidateHtml = fs.readFileSync(path.join(FRONTEND_DIST, 'index.html'), 'utf-8');
			const candidateManifest = JSON.parse(
				fs.readFileSync(path.join(FRONTEND_DIST, '.vite', 'manifest.json'), 'utf-8'),
			);
			const nearMeManifestEntry = Object.entries(candidateManifest).find(([k]) =>
				k.replace(/\\/g, '/').endsWith('src/components/NearMeView.tsx'),
			)?.[1];
			const candidateEntryChunk = Object.values(candidateManifest).find((c) => c.isEntry);

			const baselineCssMatch = baselineHtml.match(/href="\/aegis-map\/(assets\/[^"]+\.css)"/);
			const candidateCssFile = candidateEntryChunk?.css?.[0] ?? '';
			const candidateEntryJsFile = candidateEntryChunk?.file ?? '';
			const candidateNearMeJsFile = nearMeManifestEntry?.file ?? '';

			checks.record(
				Boolean(
					baselineCssMatch &&
						candidateCssFile &&
						candidateNearMeJsFile &&
						baselineCssMatch[1] !== candidateCssFile,
				),
				'Baseline and candidate builds have distinct content-hashed assets',
				`oldCss=${baselineCssMatch?.[1]} newCss=${candidateCssFile} newNearMe=${candidateNearMeJsFile}`,
				'sw-interrupted-upgrade',
			);

			const upgServer = await startSwitchableBaseServer(SW_BASELINE_DIST);
			try {
				// Also capture matched before-*.png screenshots from SW_BASELINE_DIST under identical fixtures!
				for (const [vpLabel, w, h] of [
					['1366x768', 1366, 768],
					['390x844', 390, 844],
				]) {
					const bCtx = await browser.newContext({ viewport: { width: w, height: h } });
					const bp = await bCtx.newPage();
					await installDeterministicFixtures(bp, { mapboxTracker });
					await bp.goto(`${upgServer.url}?view=near-me`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
					await bp.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
					const nearFile = `before-near-me-${vpLabel}.png`;
					await bp.screenshot({ path: path.join(EVIDENCE_DIR, nearFile) });
					registerArtifact(nearFile, { sha: BASELINE_SHA, surface: 'Near me (baseline)', viewport: vpLabel });

					await bp.goto(upgServer.url, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
					await waitForMapReady(bp);
					await bp.locator('[data-testid="open-timeline-drawer-btn"]').click();
					await bp.locator('[data-testid="timeline-analytics-drawer"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
					await bp.waitForTimeout(300);
					const archFile = `before-archive-${vpLabel}.png`;
					await bp.screenshot({ path: path.join(EVIDENCE_DIR, archFile) });
					registerArtifact(archFile, { sha: BASELINE_SHA, surface: 'Archive (baseline)', viewport: vpLabel });
					await bp.locator('button[aria-label="Close timeline and analytics drawer"]').click();

					const ptBase = await centerAndProjectEvent(bp, DETERMINISTIC_EVENTS.eventA, 5.0);
					await bp.mouse.click(ptBase.x, ptBase.y);
					// On baseline v1.5.0 mobile (390x844), the uncollapsed legend covered the map center; fall back to debug selector only for baseline before-screenshot capture
					const baseSidebarVisible = await bp.locator('[data-testid="sidebar"]').isVisible().catch(() => false);
					if (!baseSidebarVisible) {
						await bp.evaluate((ev) => window.selectDisasterDebug?.(ev), DETERMINISTIC_EVENTS.eventA);
					}
					await bp.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
					await bp.mouse.move(120, 420);
					await bp.waitForTimeout(300);
					const expFile = `before-explore-selected-${vpLabel}.png`;
					await bp.screenshot({ path: path.join(EVIDENCE_DIR, expFile) });
					registerArtifact(expFile, { sha: BASELINE_SHA, surface: 'Explore selected (baseline)', viewport: vpLabel });
					await bCtx.close();
				}

				// Step 1: Install and use the baseline build under /aegis-map/
				const swCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
				const swPage = await swCtx.newPage();

				await swPage.goto(`${upgServer.url}?view=near-me`, { waitUntil: 'networkidle', timeout: STEP_TIMEOUT });
				await swPage.evaluate(async () => {
					await navigator.serviceWorker?.ready;
					// Seed an unrelated same-origin cache to prove cleanup stays strictly scoped to aegis-shell-*
					const foreign = await caches.open('unrelated-third-party-v1');
					await foreign.put('/unrelated-item', new Response('keep-me'));
				});
				// Reload once under v1.5.0 controller so its SWR handler caches baseline NearMeView + CSS + JS
				await swPage.reload({ waitUntil: 'networkidle', timeout: STEP_TIMEOUT });
				await swPage.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

				const oldInstalledState = await swPage.evaluate(async () => ({
					caches: await caches.keys(),
					stylesheets: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) =>
						l.getAttribute('href'),
					),
				}));
				const oldShellCache = oldInstalledState.caches.find((k) => k.startsWith('aegis-shell-')) || '';
				checks.record(
					Boolean(oldShellCache) &&
						oldInstalledState.caches.includes('unrelated-third-party-v1'),
					'Installed and operated baseline build under /aegis-map/',
					JSON.stringify(oldInstalledState),
					'sw-interrupted-upgrade',
				);

				// Step 2: Switch server to FRONTEND_DIST, interrupt required new NearMeView chunk with HTTP 503
				upgServer.setRoot(FRONTEND_DIST);
				upgServer.setFailSubstrings([candidateNearMeJsFile]);

				const interruptedResult = await swPage.evaluate(async () => {
					const reg = await navigator.serviceWorker.getRegistration();
					if (!reg) return { error: 'no-registration' };
					const stateLog = [];
					const waitRedundant = new Promise((resolve) => {
						const timer = setTimeout(() => resolve('timeout'), 10000);
						reg.addEventListener(
							'updatefound',
							() => {
								const inst = reg.installing;
								if (!inst) return;
								inst.addEventListener('statechange', () => {
									stateLog.push(inst.state);
									if (inst.state === 'redundant' || inst.state === 'activated') {
										clearTimeout(timer);
										resolve(inst.state);
									}
								});
							},
							{ once: true },
						);
					});
					await reg.update().catch(() => {});
					const finalInstallState = await waitRedundant;
					const keys = await caches.keys();
					return {
						finalInstallState,
						stateLog,
						cachesAfterInterrupt: keys,
						hasActiveController: Boolean(navigator.serviceWorker.controller),
					};
				});

				checks.record(
					interruptedResult.finalInstallState === 'redundant' &&
						Boolean(oldShellCache) &&
						interruptedResult.cachesAfterInterrupt.includes(oldShellCache) &&
						interruptedResult.cachesAfterInterrupt.filter((k) => k.startsWith('aegis-shell-')).length === 1,
					'Interrupted SW update aborts install, rolls back staging cache, and preserves last working shell',
					JSON.stringify(interruptedResult),
					'sw-interrupted-upgrade',
				);

				// Step 3: Go offline and reopen Near me -> resident sees and operates the intact old interface!
				upgServer.setServerOffline(true);
				await swCtx.setOffline(true);
				await swPage.goto(`${upgServer.url}?view=near-me`, {
					waitUntil: 'domcontentloaded',
					timeout: STEP_TIMEOUT,
				});
				await swPage.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
				await swPage.locator('[data-testid="place-search-input"]').fill('Georgetown');
				await swPage.locator('[data-testid="place-search-btn"]').click();
				await swPage.locator('[data-testid="place-candidates"] button').first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
				const oldOfflineCandidates = await swPage.locator('[data-testid="place-candidates"] button').count();
				await swPage.locator('[data-testid="place-candidates"] button').first().click();
				const oldStylesheetHref = await swPage.evaluate(() =>
					document.querySelector('link[rel="stylesheet"]')?.getAttribute('href') || '',
				);

				checks.record(
					oldOfflineCandidates >= 2 && oldStylesheetHref.includes(baselineCssMatch?.[1] || ''),
					'Offline reopen after interrupted update serves intact, operable baseline Near me interface',
					`candidates=${oldOfflineCandidates} css=${oldStylesheetHref}`,
					'sw-interrupted-upgrade',
				);

				// Step 4: Restore connectivity, clear asset interruption, complete update, go offline again!
				upgServer.setServerOffline(false);
				await swCtx.setOffline(false);
				upgServer.setFailSubstrings([]);

				await swPage.evaluate(async (prevShellCache) => {
					const reg = await navigator.serviceWorker.getRegistration();
					await reg?.update();
					const deadline = Date.now() + 15000;
					while (Date.now() < deadline) {
						const curReg = await navigator.serviceWorker?.getRegistration();
						const keys = await caches.keys();
						if (
							curReg?.active?.state === 'activated' &&
							navigator.serviceWorker?.controller &&
							keys.some((k) => k.startsWith('aegis-shell-') && k !== prevShellCache) &&
							!keys.includes(prevShellCache)
						) {
							return;
						}
						await new Promise((r) => setTimeout(r, 100));
					}
					throw new Error('Timed out waiting for upgraded SW activation');
				}, oldShellCache);

				// Immediately go offline again and reopen Near me
				upgServer.setServerOffline(true);
				await swCtx.setOffline(true);
				await swPage.goto(`${upgServer.url}?view=near-me`, {
					waitUntil: 'domcontentloaded',
					timeout: STEP_TIMEOUT,
				});
				await swPage.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
				await swPage.locator('[data-testid="place-search-input"]').fill('Georgetown');
				await swPage.locator('[data-testid="place-search-btn"]').click();
				await swPage.locator('[data-testid="place-candidates"] button').first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
				const newOfflineCandidates = await swPage.locator('[data-testid="place-candidates"] button').count();

				const finalOfflineVerify = await swPage.evaluate(async () => {
					const cssHref = document.querySelector('link[rel="stylesheet"]')?.getAttribute('href') || '';
					const entryScriptSrc = document.querySelector('script[type="module"]')?.getAttribute('src') || '';
					const loadedScripts = performance
						.getEntriesByType('resource')
						.map((e) => e.name)
						.filter((n) => n.endsWith('.js'));
					const cardEl = document.querySelector('[aria-labelledby="place-selector-heading"]')?.closest('section');
					const cardPaddingTop = cardEl ? parseFloat(window.getComputedStyle(cardEl).paddingTop) : 0;
					return {
						caches: await caches.keys(),
						cssHref,
						entryScriptSrc,
						loadedScripts,
						cardPaddingTop,
					};
				});
				reportData.swInterruptedUpgrade = {
					interruptedResult,
					oldOfflineCandidates,
					newOfflineCandidates,
					finalOfflineVerify: {
						caches: finalOfflineVerify.caches,
						cssHref: finalOfflineVerify.cssHref,
						entryScriptSrc: finalOfflineVerify.entryScriptSrc,
						cardPaddingTop: finalOfflineVerify.cardPaddingTop,
					},
				};

				const hasNewNearMeLoaded = finalOfflineVerify.loadedScripts.some((u) =>
					u.includes(candidateNearMeJsFile),
				);
				checks.record(
					newOfflineCandidates >= 2 &&
						finalOfflineVerify.cssHref.includes(candidateCssFile) &&
						finalOfflineVerify.entryScriptSrc.includes(candidateEntryJsFile) &&
						hasNewNearMeLoaded &&
						finalOfflineVerify.cardPaddingTop >= 16 &&
						Boolean(oldShellCache) &&
						!finalOfflineVerify.caches.includes(oldShellCache) &&
						finalOfflineVerify.caches.some((k) => k.startsWith('aegis-shell-') && k !== oldShellCache) &&
						finalOfflineVerify.caches.includes('unrelated-third-party-v1'),
					'Completed SW upgrade retires old shell, preserves unrelated caches, and serves matching new HTML + CSS + JS offline',
					`css=${finalOfflineVerify.cssHref} js=${finalOfflineVerify.entryScriptSrc} paddingTop=${finalOfflineVerify.cardPaddingTop}`,
					'sw-interrupted-upgrade',
				);
				await swCtx.close();
			} finally {
				await upgServer.close();
			}
		}

		// =========================================================================
		// GATE 2: Pinned Popup Tip-to-Double-Circle Geometry & Interaction Recording
		// =========================================================================
		console.log('\n=== Gate 2: Pinned Popup Tip Geometry (X/Y <= 4.5px), Edge Flip, Rotation & Video ===');
		const videoTempDir = path.join(EVIDENCE_DIR, '_video_tmp');
		fs.mkdirSync(videoTempDir, { recursive: true });

		const recCtx = await browser.newContext({
			viewport: { width: 1280, height: 760 },
			recordVideo: { dir: videoTempDir, size: { width: 1280, height: 760 } },
		});
		const recPage = await recCtx.newPage();
		await installDeterministicFixtures(recPage, { mapboxTracker });

		await recPage.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
		await waitForMapReady(recPage);

		const assertPopupTipAttached = async (page, expectedEv, stepLabel, gate = 'popup-tip-geometry') => {
			const m = await measurePinnedPopupAttachment(page);
			reportData.popupTipMeasurements.push({ step: stepLabel, expectedId: expectedEv.id, ...m });
			const coordsMatch =
				Array.isArray(m.ringCoords) &&
				Math.abs(m.ringCoords[0] - expectedEv.lng) < 1e-4 &&
				Math.abs(m.ringCoords[1] - expectedEv.lat) < 1e-4;
			const idsAgree =
				m.popupCount === 1 &&
				m.pinnedId === expectedEv.id &&
				m.sidebarId === expectedEv.id &&
				m.ringId === expectedEv.id &&
				m.inspectorTitle === expectedEv.title &&
				m.hasHaloLayer &&
				m.hasRingLayer;
			const tipAttached =
				typeof m.dx === 'number' &&
				typeof m.dy === 'number' &&
				m.dx <= MAX_TIP_TOLERANCE_PX &&
				m.dy <= MAX_TIP_TOLERANCE_PX;

			checks.record(
				coordsMatch && idsAgree && tipAttached,
				`${stepLabel}: popup tip attached to double-circle center (anchor=${m.anchor}, dx=${m.dx}px, dy=${m.dy}px <= ${MAX_TIP_TOLERANCE_PX}px)`,
				`id=${m.pinnedId} ring=${JSON.stringify(m.ringCoords)} tip=${JSON.stringify(m.tipApex)} expected=${JSON.stringify(m.expectedTip)}`,
				gate,
			);
			return m;
		};

		// 2.1 Real map click on Event A
		const ptA = await centerAndProjectEvent(recPage, DETERMINISTIC_EVENTS.eventA, 5.0);
		await recPage.mouse.click(ptA.x, ptA.y);
		await recPage.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await recPage.locator('[data-testid="pinned-disaster-popup"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await recPage.waitForTimeout(450);
		await assertPopupTipAttached(recPage, DETERMINISTIC_EVENTS.eventA, 'Initial click on Event A');

		// 2.2 Pointer leave to blank ocean AND into right-hand inspector
		await recPage.mouse.move(160, 520, { steps: 10 });
		await recPage.waitForTimeout(300);
		await assertPopupTipAttached(recPage, DETERMINISTIC_EVENTS.eventA, 'After pointer leave to blank map');

		await recPage.mouse.move(1120, 340, { steps: 10 });
		await recPage.waitForTimeout(250);
		await assertPopupTipAttached(recPage, DETERMINISTIC_EVENTS.eventA, 'While pointer hovers inside inspector');

		// 2.3 Diagonal drag pan (+115px X, -75px Y)
		await recPage.mouse.move(460, 430);
		await recPage.mouse.down();
		await recPage.mouse.move(575, 355, { steps: 14 });
		await recPage.mouse.up();
		await recPage.waitForTimeout(400);
		await assertPopupTipAttached(recPage, DETERMINISTIC_EVENTS.eventA, 'After diagonal drag pan');

		// 2.4 Zoom in and zoom out
		await recPage.evaluate(() => {
			window.mapDebug.zoomTo(6.8, { duration: 0 });
		});
		await recPage.waitForTimeout(250);
		await assertPopupTipAttached(recPage, DETERMINISTIC_EVENTS.eventA, 'After zoom in to z=6.8');

		await recPage.evaluate(() => {
			window.mapDebug.zoomTo(4.2, { duration: 0 });
		});
		await recPage.waitForTimeout(250);
		await assertPopupTipAttached(recPage, DETERMINISTIC_EVENTS.eventA, 'After zoom out to z=4.2');

		// 2.5 Viewport-edge point: pan selected marker near top-right edge of map canvas so Mapbox flips anchor!
		await recPage.evaluate(({ lng, lat }) => {
			const map = window.mapDebug;
			const rect = map.getCanvas().getBoundingClientRect();
			const cur = map.project([lng, lat]);
			const targetX = rect.width - 42;
			const targetY = 44;
			map.panBy([cur.x - targetX, cur.y - targetY], { duration: 0 });
		}, DETERMINISTIC_EVENTS.eventA);
		await recPage.waitForTimeout(300);
		const edgeMeas = await assertPopupTipAttached(
			recPage,
			DETERMINISTIC_EVENTS.eventA,
			'Near top-end viewport edge (flipped Mapbox anchor)',
		);
		checks.record(
			edgeMeas.anchor !== 'bottom',
			'Mapbox flipped popup anchor near top-end viewport edge while keeping tip attached',
			`anchor=${edgeMeas.anchor}`,
			'popup-tip-geometry',
		);

		// Also click a second event positioned near the viewport edge (await idle so WebGL finishes painting after cross-Atlantic jump)
		const edgeClickTarget = await recPage.evaluate(async ({ lng, lat }) => {
			const map = window.mapDebug;
			map.jumpTo({ center: [lng, lat], zoom: 5.0, bearing: 0, pitch: 0 });
			const rect = map.getCanvas().getBoundingClientRect();
			map.panBy([-(rect.width / 2 - 64), rect.height / 2 - 64], { duration: 0 });
			await new Promise((r) => {
				const timer = setTimeout(r, 1500);
				map.once('idle', () => {
					clearTimeout(timer);
					r();
				});
			});
			const pt = map.project([lng, lat]);
			return { x: rect.left + pt.x, y: rect.top + pt.y };
		}, DETERMINISTIC_EVENTS.eventEdge);
		await recPage.mouse.click(edgeClickTarget.x, edgeClickTarget.y);
		await recPage.waitForFunction(
			(expectedId) =>
				document.querySelector('[data-testid="sidebar"]')?.getAttribute('data-disaster-id') === expectedId,
			DETERMINISTIC_EVENTS.eventEdge.id,
			{ timeout: 10000 },
		);
		await recPage.waitForTimeout(600); // Allow safe-area easeTo nudge to settle
		await assertPopupTipAttached(recPage, DETERMINISTIC_EVENTS.eventEdge, 'Click on viewport-edge Event D after safe-area nudge');

		// 2.6 A -> B selection (switch to Earthquake Event B)
		let ptB = await centerAndProjectEvent(recPage, DETERMINISTIC_EVENTS.eventB, 4.8);
		await recPage.mouse.click(ptB.x, ptB.y);
		try {
			await recPage.waitForFunction(
				(expectedId) =>
					document.querySelector('[data-testid="sidebar"]')?.getAttribute('data-disaster-id') === expectedId,
				DETERMINISTIC_EVENTS.eventB.id,
				{ timeout: 2500 },
			);
		} catch {
			ptB = await centerAndProjectEvent(recPage, DETERMINISTIC_EVENTS.eventB, 4.8);
			await recPage.mouse.click(ptB.x, ptB.y);
			await recPage.waitForFunction(
				(expectedId) =>
					document.querySelector('[data-testid="sidebar"]')?.getAttribute('data-disaster-id') === expectedId,
				DETERMINISTIC_EVENTS.eventB.id,
				{ timeout: 8000 },
			);
		}
		await recPage.waitForTimeout(500);
		await recPage.mouse.move(170, 500, { steps: 8 });
		await recPage.waitForTimeout(300);
		await assertPopupTipAttached(recPage, DETERMINISTIC_EVENTS.eventB, 'A -> B selection switch to Event B');

		// 2.7 Globe far-side hide & return -> exactly 1 popup reappears for Event B attached to double circle
		const antipodeLng = DETERMINISTIC_EVENTS.eventB.lng > 0
			? DETERMINISTIC_EVENTS.eventB.lng - 180
			: DETERMINISTIC_EVENTS.eventB.lng + 180;
		await recPage.evaluate(
			({ lng, lat }) => {
				window.mapDebug.jumpTo({ center: [lng, -lat], zoom: 1.4, bearing: 0, pitch: 0 });
			},
			{ lng: antipodeLng, lat: DETERMINISTIC_EVENTS.eventB.lat },
		);
		await recPage.waitForTimeout(350);
		const farSideCount = await recPage.locator('.mapboxgl-popup').count();
		const farSideInspector = await recPage.locator('[data-testid="sidebar"]').getAttribute('data-disaster-id');
		checks.record(
			farSideCount === 0 && farSideInspector === DETERMINISTIC_EVENTS.eventB.id,
			'Far-side globe rotation detaches pinned popup while preserving Event B in inspector',
			`popups=${farSideCount} sidebar=${farSideInspector}`,
			'popup-tip-geometry',
		);

		await recPage.evaluate(
			({ lng, lat }) => {
				window.mapDebug.jumpTo({ center: [lng, lat], zoom: 4.6, bearing: 0, pitch: 0 });
			},
			DETERMINISTIC_EVENTS.eventB,
		);
		await recPage.waitForTimeout(350);
		await assertPopupTipAttached(
			recPage,
			DETERMINISTIC_EVENTS.eventB,
			'Globe rotation return re-attaches single pinned popup to Event B',
		);

		const videoObj = recPage.video();
		await recCtx.close();
		if (videoObj) {
			const rawVideo = await videoObj.path();
			const targetVideo = 'after-explore-pinned-selection.webm';
			if (fs.existsSync(rawVideo)) {
				fs.copyFileSync(rawVideo, path.join(EVIDENCE_DIR, targetVideo));
				registerArtifact(targetVideo, {
					sha: CANDIDATE_SHA,
					surface: 'Explore interactive recording (click A -> leave -> pan -> zoom -> edge -> select B -> globe hide/return)',
					viewport: '1280x760',
				});
			}
		}
		fs.rmSync(videoTempDir, { recursive: true, force: true });

		// 2.8 Mobile Touch Tap, Collapsed Peek Sheet, Mobile Rotation (390x844 <-> 844x390), Zero Tab Refetch & Escape Stack
		const touchTrack = { tles: 0, analyze: 0 };
		const touchCtx = await browser.newContext({
			viewport: { width: 390, height: 844 },
			hasTouch: true,
			isMobile: true,
		});
		const touchPage = await touchCtx.newPage();
		await installDeterministicFixtures(touchPage, { trackCounts: touchTrack, mapboxTracker });

		await touchPage.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
		await waitForMapReady(touchPage);

		const mPtA = await centerAndProjectEvent(touchPage, DETERMINISTIC_EVENTS.eventA, 4.8);
		await touchPage.touchscreen.tap(mPtA.x, mPtA.y);
		await touchPage.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await touchPage.waitForTimeout(550);

		const mobileTapMeas = await assertPopupTipAttached(
			touchPage,
			DETERMINISTIC_EVENTS.eventA,
			'Mobile touch tap (390x844 portrait, collapsed peek sheet)',
			'mobile-touch-rotation',
		);
		const mobileSheetRect = await touchPage.locator('[data-testid="sidebar"]').boundingBox();
		checks.record(
			Boolean(mobileSheetRect && mobileTapMeas.popupBounds.bottom <= mobileSheetRect.y + 4),
			'Mobile collapsed peek sheet leaves pinned popup & double-circle unobstructed above sheet',
			`popupBottom=${mobileTapMeas.popupBounds.bottom} sheetTop=${Math.round(mobileSheetRect?.y ?? 0)}`,
			'mobile-touch-rotation',
		);

		// Rotate phone 390x844 -> 844x390 landscape -> 390x844 portrait
		await touchPage.setViewportSize({ width: 844, height: 390 });
		await touchPage.waitForTimeout(400);
		await assertPopupTipAttached(
			touchPage,
			DETERMINISTIC_EVENTS.eventA,
			'After mobile rotation to 844x390 landscape',
			'mobile-touch-rotation',
		);

		await touchPage.setViewportSize({ width: 390, height: 844 });
		await touchPage.waitForTimeout(400);
		await assertPopupTipAttached(
			touchPage,
			DETERMINISTIC_EVENTS.eventA,
			'After mobile rotation back to 390x844 portrait',
			'mobile-touch-rotation',
		);

		// Wait for initial AI analysis to settle, then verify zero refetches across tab/sheet/theme toggles
		await touchPage.waitForFunction(
			() => {
				const st = document.querySelector('[data-testid="sidebar"]')?.getAttribute('data-analysis-state') || '';
				return ['ready', 'no-pass', 'blocked-orbit'].includes(st) || st.startsWith('error-');
			},
			undefined,
			{ timeout: STEP_TIMEOUT },
		);
		const tlesBeforeTabs = touchTrack.tles;
		const analyzeBeforeTabs = touchTrack.analyze;

		await touchPage.locator('[data-testid="inspector-tab-imagery"]').tap();
		await touchPage.locator('[data-testid="inspector-tab-passes"]').tap();
		await touchPage.locator('[data-testid="inspector-tab-overview"]').tap();
		await touchPage.locator('[data-testid="sheet-expand-toggle"]').tap();
		await touchPage.locator('[data-testid="theme-toggle-btn"]').tap();
		await touchPage.locator('[data-testid="theme-toggle-btn"]').tap();
		await touchPage.waitForTimeout(300);

		checks.record(
			touchTrack.tles === tlesBeforeTabs && touchTrack.analyze === analyzeBeforeTabs,
			'Tab switches, sheet height toggle, and theme toggle cause zero duplicate TLE or AI requests',
			`tleDelta=${touchTrack.tles - tlesBeforeTabs} analyzeDelta=${touchTrack.analyze - analyzeBeforeTabs}`,
			'mobile-touch-rotation',
		);

		// Keyboard event-list rapid selection + topmost Escape stack
		await touchPage.locator('[data-testid="expand-legend-btn"]').click();
		await touchPage.locator('[data-testid="legend-event-list-toggle"]').click();
		const listBtns = touchPage.locator('[data-testid^="legend-event-item-"]');
		const listTotal = await listBtns.count();
		for (let i = 0; i < Math.min(8, listTotal); i++) {
			await listBtns.nth(i % listTotal).focus();
			await touchPage.keyboard.press('Enter');
		}
		checks.record(
			(await touchPage.locator('.mapboxgl-popup').count()) <= 1,
			'Repeated keyboard Event list selections leave at most 1 popup in DOM',
			`items=${listTotal}`,
			'mobile-touch-rotation',
		);

		await touchPage.locator('[data-testid="open-timeline-drawer-btn"]').click();
		await touchPage.locator('[data-testid="timeline-analytics-drawer"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await touchPage.keyboard.press('Escape');
		await touchPage.locator('[data-testid="timeline-analytics-drawer"]').waitFor({ state: 'hidden', timeout: STEP_TIMEOUT });
		const retainedSelection = await touchPage.locator('[data-testid="sidebar"]').count();
		await touchPage.keyboard.press('Escape');
		const clearedSelection = await touchPage.locator('[data-testid="sidebar"]').count();
		checks.record(
			retainedSelection === 1 && clearedSelection === 0,
			'Topmost Escape closes Archive first (keeping selection) and deselects event on second Escape',
			`afterFirst=${retainedSelection} afterSecond=${clearedSelection}`,
			'mobile-touch-rotation',
		);
		await touchCtx.close();

		// =========================================================================
		// GATE 3: Multi-Viewport Rendered Interface, Unclipped Controls, RTL, Themes & Zoom
		// =========================================================================
		console.log('\n=== Gate 3: Multi-Viewport (320, 390, 768, 1366), Unclipped Scroll/Focus, RTL, Themes & Zoom ===');

		const matrixViewports = [
			{ label: '320x568', width: 320, height: 568, mode: 'Playwright Chromium narrow-phone viewport emulation' },
			{ label: '390x844', width: 390, height: 844, mode: 'Playwright Chromium phone viewport emulation' },
			{ label: '768x1024', width: 768, height: 1024, mode: 'Playwright Chromium tablet viewport emulation' },
			{ label: '1366x768', width: 1366, height: 768, mode: 'Playwright Chromium desktop viewport' },
			{ label: '1920x1080', width: 1920, height: 1080, mode: 'Playwright Chromium wide-desktop viewport' },
		];

		for (const vp of matrixViewports) {
			const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
			const p = await ctx.newPage();
			await installDeterministicFixtures(p, {
				subscriptionAvailable: false,
				subscriptionReason: 'RESEND_API_KEY and AEGIS_DB missing (sms_deferred 501)',
				mapboxTracker,
			});

			// A. Near me at vp
			await p.goto(`${FRONTEND_URL}?view=near-me`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
			await p.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

			if (vp.label === '1366x768') {
				reportData.computedStyles = await p.evaluate(() => {
					const readStyle = (el) => {
						if (!el) return null;
						const cs = window.getComputedStyle(el);
						const r = el.getBoundingClientRect();
						return {
							paddingTop: parseFloat(cs.paddingTop),
							paddingLeft: parseFloat(cs.paddingLeft),
							borderRadius: parseFloat(cs.borderRadius),
							backgroundColor: cs.backgroundColor,
							width: Math.round(r.width),
							height: Math.round(r.height),
						};
					};
					return {
						searchInput: readStyle(document.querySelector('[data-testid="place-search-input"]')),
						searchBtn: readStyle(document.querySelector('[data-testid="place-search-btn"]')),
						placeCard: readStyle(document.querySelector('[aria-labelledby="place-selector-heading"]')?.closest('section')),
					};
				});
			}

			// Verify keyboard focus outline visibility
			await p.keyboard.press('Tab');
			await p.keyboard.press('Tab');
			const focusCheck = await p.evaluate(() => {
				const el = document.activeElement;
				if (!el || el === document.body) return { focused: false, outlineStyle: 'none' };
				const cs = window.getComputedStyle(el);
				return { focused: true, tag: el.tagName, outlineStyle: cs.outlineStyle };
			});
			checks.record(
				focusCheck.focused && focusCheck.outlineStyle !== 'none',
				`Keyboard Tab focus reaches header control with visible focus ring (${vp.label})`,
				JSON.stringify(focusCheck),
				`rendered-${vp.label}`,
			);

			// Confirm present country MY, select Oslo (NO), verify active warning + unclipped scroll reachability
			await p.locator('[data-testid="present-jurisdiction-select"]').selectOption('MY');
			await p.locator('[data-testid="manual-coords-disclosure"]').click();
			await p.locator('[data-testid="manual-coords-input"]').fill('59.9139, 10.7522');
			await p.locator('[data-testid="apply-coords-btn"]').click();
			await p.locator('[data-testid="warning-card-no-det-gale-1"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

			const nearFile = `after-near-me-${vp.label}.png`;
			await p.evaluate(() => window.scrollTo(0, 0));
			await p.screenshot({ path: path.join(EVIDENCE_DIR, nearFile) });
			registerArtifact(nearFile, { surface: 'Near me (active warning)', viewport: vp.label, executionMode: vp.mode });

			// Check actual scroll reachability & unclipped bounds for primary buttons, warning card, and footer wipe button
			const requiredNearControls = [
				'[data-testid="nav-near-me"]',
				'[data-testid="nav-explore-events"]',
				'[data-testid="change-place-btn"]',
				'[data-testid="warning-card-no-det-gale-1"]',
				'[data-testid="copy-location-btn"]',
				'[data-testid="clear-local-data-btn"]',
			];
			const nearClipped = [];
			for (const sel of requiredNearControls) {
				const res = await checkScrollReachableAndUnclipped(p, sel);
				if (!res.unclipped) nearClipped.push(res.detail);
			}
			const nearOverflow = await p.evaluate(() => ({
				scrollWidth: document.documentElement.scrollWidth,
				innerWidth: window.innerWidth,
				bodyText: document.body.innerText,
				presentCountry: document.querySelector('[data-testid="present-jurisdiction-select"]')?.value,
			}));
			checks.record(
				nearOverflow.scrollWidth <= nearOverflow.innerWidth &&
					nearClipped.length === 0 &&
					nearOverflow.presentCountry === 'MY' &&
					!/RESEND_API_KEY|AEGIS_DB|sms_deferred/.test(nearOverflow.bodyText),
				`Near me (${vp.label}): zero overflow, all primary buttons & warning unclipped via scroll, present country preserved, zero config leakage`,
				nearClipped.length ? nearClipped.join('; ') : `scrollWidth=${nearOverflow.scrollWidth}/${nearOverflow.innerWidth}`,
				`rendered-${vp.label}`,
			);

			// B. Explore + Archive + Selected Event + Long SAR Scene ID at vp
			await p.evaluate(() => window.scrollTo(0, 0));
			await p.locator('[data-testid="nav-explore-events"]').click();
			await waitForMapReady(p);

			await p.locator('[data-testid="open-timeline-drawer-btn"]').click();
			await p.locator('[data-testid="timeline-analytics-drawer"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			await p.waitForTimeout(300);
			const archFile = `after-archive-${vp.label}.png`;
			await p.screenshot({ path: path.join(EVIDENCE_DIR, archFile) });
			registerArtifact(archFile, { surface: 'Archive (40 records)', viewport: vp.label, executionMode: vp.mode });

			// Verify Archive independent scroll + playback stop on close
			await p.locator('[data-testid="archive-play-toggle-btn"]').click();
			const barBefore = await p.locator('[data-testid="archive-playback-bar"]').boundingBox();
			await p.evaluate(() => {
				const sc = document.querySelector('[data-testid="archive-scroll-body"]');
				if (sc) sc.scrollTop = 360;
			});
			const barAfter = await p.locator('[data-testid="archive-playback-bar"]').boundingBox();
			const inspectReach = await checkScrollReachableAndUnclipped(p, '[data-testid="archive-inspect-current-btn"]');
			checks.record(
				Boolean(barBefore && barAfter && Math.abs(barBefore.y - barAfter.y) <= 1 && inspectReach.unclipped),
				`Archive (${vp.label}): playback bar fixed & unclipped while 40-row list scrolls independently`,
				inspectReach.detail,
				`rendered-${vp.label}`,
			);
			await p.locator('[data-testid="close-timeline-drawer-btn"]').click();

			// Select Event A on map at vp
			const vpPtA = await centerAndProjectEvent(p, DETERMINISTIC_EVENTS.eventA, 4.8);
			await p.mouse.click(vpPtA.x, vpPtA.y);
			await p.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			await p.mouse.move(Math.min(120, vp.width - 20), Math.min(260, vp.height - 20));
			await p.waitForTimeout(450);

			const expFile = `after-explore-selected-${vp.label}.png`;
			await p.screenshot({ path: path.join(EVIDENCE_DIR, expFile) });
			registerArtifact(expFile, { surface: 'Explore (selected event + pinned bubble)', viewport: vp.label, executionMode: vp.mode });

			if (vp.label === '768x1024') {
				const tabletOverlap = await p.evaluate(() => {
					const leg = document.querySelector('[data-testid="map-legend"]')?.getBoundingClientRect();
					const pop = document.querySelector('[data-testid="pinned-disaster-popup"]')?.getBoundingClientRect();
					if (!leg || !pop) return { ok: false, detail: 'missing legend or popup' };
					const separated = leg.right <= pop.left + 2 || leg.bottom <= pop.top + 2 || leg.left >= pop.right - 2;
					return {
						ok: separated,
						detail: `legend=[${Math.round(leg.left)},${Math.round(leg.top)}..${Math.round(leg.right)},${Math.round(leg.bottom)}] popup=[${Math.round(pop.left)},${Math.round(pop.top)}..${Math.round(pop.right)},${Math.round(pop.bottom)}]`,
					};
				});
				checks.record(
					tabletOverlap.ok,
					'Tablet (768x1024): legend auto-collapses on selection so pinned bubble is completely unobstructed',
					tabletOverlap.detail,
					'rendered-768x1024',
				);
			}

			// Inspect long 76-char SAR scene ID on Imagery tab at vp
			await p.locator('[data-testid="inspector-tab-imagery"]').click();
			await p.locator(`[data-testid="sar-scene-${LONG_SAR_SCENE_ID}"]`).waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			await p.locator(`[data-testid="sar-scene-${LONG_SAR_SCENE_ID}"] details summary`).click();
			const sarOverflow = await p.evaluate(() => ({
				scrollWidth: document.documentElement.scrollWidth,
				innerWidth: window.innerWidth,
			}));
			checks.record(
				sarOverflow.scrollWidth <= sarOverflow.innerWidth,
				`Explore (${vp.label}): 76-char unbroken Sentinel-1 STAC ID inside Details causes zero horizontal overflow`,
				`${sarOverflow.scrollWidth}/${sarOverflow.innerWidth}`,
				`rendered-${vp.label}`,
			);

			if (vp.label === '1366x768') {
				await p.locator('[data-testid="inspector-tab-overview"]').click();
				await p.locator('[data-testid="theme-toggle-btn"]').click();
				await p.waitForTimeout(250);
				const lightFile = 'after-explore-selected-light-1366x768.png';
				await p.screenshot({ path: path.join(EVIDENCE_DIR, lightFile) });
				registerArtifact(lightFile, {
					surface: 'Explore (selected event, light theme)',
					viewport: '1366x768',
					theme: 'light',
					executionMode: vp.mode,
				});
			}
			await ctx.close();
		}

		// Persian RTL (`fa`) at 320x568 & 1366x768 + Landscape 844x390 + Real Chromium CSS Zoom (200%) & Viewport-Equivalent Zoom
		const rtlCtx = await browser.newContext({ viewport: { width: 320, height: 568 } });
		const rtlPage = await rtlCtx.newPage();
		await installDeterministicFixtures(rtlPage, { mapboxTracker });
		await rtlPage.goto(`${FRONTEND_URL}?view=near-me`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
		await rtlPage.locator('[data-testid="ui-locale-select"]').selectOption('fa');
		await rtlPage.locator('[data-testid="manual-coords-disclosure"]').click();
		await rtlPage.locator('[data-testid="manual-coords-input"]').fill('59.9139, 10.7522');
		await rtlPage.locator('[data-testid="apply-coords-btn"]').click();
		await rtlPage.locator('[data-testid="warning-card-no-det-gale-1"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await rtlPage.evaluate(() => window.scrollTo(0, 0));

		const rtlFile = 'after-near-me-320x568-fa-rtl.png';
		await rtlPage.screenshot({ path: path.join(EVIDENCE_DIR, rtlFile) });
		registerArtifact(rtlFile, {
			surface: 'Near me (Persian RTL + active warning)',
			viewport: '320x568',
			locale: 'fa',
			executionMode: 'Playwright Chromium narrow-phone RTL emulation',
		});
		const rtlCheck = await rtlPage.evaluate(() => ({
			dir: document.documentElement.dir,
			lang: document.documentElement.lang,
			bdiCount: document.querySelectorAll('bdi[dir="ltr"]').length,
			scrollWidth: document.documentElement.scrollWidth,
			innerWidth: window.innerWidth,
		}));
		const rtlWarningUnclipped = await checkScrollReachableAndUnclipped(
			rtlPage,
			'[data-testid="warning-card-no-det-gale-1"]',
		);
		checks.record(
			rtlCheck.dir === 'rtl' &&
				rtlCheck.lang === 'fa' &&
				rtlCheck.bdiCount >= 5 &&
				rtlCheck.scrollWidth <= rtlCheck.innerWidth &&
				rtlWarningUnclipped.unclipped,
			'Persian RTL (320x568): dir="rtl", <bdi dir="ltr"> numeric isolation, zero overflow, and unclipped warning card',
			JSON.stringify(rtlCheck),
			'rtl-and-zoom',
		);

		// Switch RTL page to Explore at 1366x768 to verify RTL Explore + selected event
		await rtlPage.setViewportSize({ width: 1366, height: 768 });
		await rtlPage.locator('[data-testid="nav-explore-events"]').click();
		await waitForMapReady(rtlPage);
		const rtlPt = await centerAndProjectEvent(rtlPage, DETERMINISTIC_EVENTS.eventA, 4.8);
		await rtlPage.mouse.click(rtlPt.x, rtlPt.y);
		await rtlPage.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await rtlPage.waitForTimeout(400);
		const rtlExploreFile = 'after-explore-selected-1366x768-fa-rtl.png';
		await rtlPage.screenshot({ path: path.join(EVIDENCE_DIR, rtlExploreFile) });
		registerArtifact(rtlExploreFile, {
			surface: 'Explore (Persian RTL + selected event)',
			viewport: '1366x768',
			locale: 'fa',
			executionMode: 'Playwright Chromium desktop RTL',
		});
		await assertPopupTipAttached(rtlPage, DETERMINISTIC_EVENTS.eventA, 'Persian RTL 1366x768 Explore selected event', 'rtl-and-zoom');
		await rtlCtx.close();

		// Real Chromium CSS 200% zoom (`style.zoom = '2'` on 1366x768) + 683x384 DPR=2 viewport-equivalent check
		const zoomCtx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
		const zoomPage = await zoomCtx.newPage();
		await installDeterministicFixtures(zoomPage, { mapboxTracker });
		await zoomPage.goto(`${FRONTEND_URL}?view=near-me`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
		await zoomPage.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await zoomPage.evaluate(() => {
			document.documentElement.style.zoom = '2';
		});
		await zoomPage.waitForTimeout(200);
		const cssZoomMetrics = await zoomPage.evaluate(() => ({
			method: 'Chromium CSS documentElement.style.zoom=2 at 1366x768',
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		}));
		const cssZoomBtnReach = await checkScrollReachableAndUnclipped(zoomPage, '[data-testid="place-search-btn"]');

		// Viewport-equivalent 200% zoom (683x384 CSS px at DPR=2, matching desktop Chrome Ctrl++ 200% layout width)
		await zoomPage.evaluate(() => {
			document.documentElement.style.zoom = '1';
		});
		await zoomPage.setViewportSize({ width: 683, height: 384 });
		await zoomPage.waitForTimeout(200);
		const vpEquivZoomMetrics = await zoomPage.evaluate(() => ({
			method: 'Viewport-equivalent 683x384 CSS px @ deviceScaleFactor=2 (1366x768 @ 200%)',
			scrollWidth: document.documentElement.scrollWidth,
			innerWidth: window.innerWidth,
		}));
		const vpZoomWipeReach = await checkScrollReachableAndUnclipped(zoomPage, '[data-testid="clear-local-data-btn"]');
		reportData.zoomChecks = { cssZoomMetrics, vpEquivZoomMetrics };

		checks.record(
			cssZoomMetrics.scrollWidth <= cssZoomMetrics.clientWidth + 2 &&
				cssZoomBtnReach.unclipped &&
				vpEquivZoomMetrics.scrollWidth <= vpEquivZoomMetrics.innerWidth &&
				vpZoomWipeReach.unclipped,
			'200% zoom verified via both Chromium CSS zoom=2 and 683x384 DPR=2 viewport-equivalent with full scroll reachability',
			JSON.stringify(reportData.zoomChecks),
			'rtl-and-zoom',
		);
		await zoomCtx.close();

		// =========================================================================
		// GATE 4: Branding Icons/Manifest, Install, Web Push, NOAA-20/GIBS Pixel Alignment,
		//         Short Desktop Live Monitor (1366x620), Geolocation, zh-Hans & Task Layout
		// =========================================================================
		console.log('\n=== Gate 4: Icons, Install, Web Push, NOAA-20/GIBS, Short Live Monitor, Geolocation & zh-Hans ===');

		// 4A: Clean profile icon, manifest & standalone install + ephemeral-key per-place Web Push lifecycle + notification navigation
		const ephemeralVapid = await generateEphemeralVapidKeys();
		const ephemeralClient = await generateEphemeralClientPushKeys();
		const iconCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
		const iconPage = await iconCtx.newPage();
		const pushPosts = [];
		const pushUnsubs = [];
		const serverRegistrations = new Map();
		let failNextPushRegister = false;
		let subIdSeq = 1;
		const makePlaceKey = (sourceId, lat, lng) => `${sourceId}:${Number(lat).toFixed(3)}:${Number(lng).toFixed(3)}`;

		await installDeterministicFixtures(iconPage, {
			subscriptionAvailable: false,
			subscriptionReason: 'RESEND_API_KEY missing',
			pushAvailable: true,
			pushMode: 'web_push',
			vapidPublicKey: ephemeralVapid.publicKey,
			mapboxTracker,
		});
		await iconPage.route('**/api/v1/subscriptions/push-lookup', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: CORS_HEADERS,
				body: JSON.stringify({
					ok: true,
					registrations: Array.from(serverRegistrations.values()),
				}),
			});
		});
		await iconPage.route('**/api/v1/subscriptions', async (route) => {
			const payload = JSON.parse(route.request().postData() || '{}');
			pushPosts.push(payload);
			if (failNextPushRegister) {
				failNextPushRegister = false;
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					headers: CORS_HEADERS,
					body: JSON.stringify({ ok: false, code: 'server_error', message: 'Simulated transient server failure' }),
				});
				return;
			}
			const placeKey = makePlaceKey(payload.sourceId, payload.lat, payload.lng);
			const existing = serverRegistrations.get(placeKey);
			const subscriptionId = existing?.subscriptionId || `sub-push-det-${subIdSeq++}`;
			serverRegistrations.set(placeKey, {
				subscriptionId,
				placeKey,
				placeName: payload.placeName,
				countryCode: payload.countryCode,
				sourceId: payload.sourceId,
				lat: Number(Number(payload.lat).toFixed(3)),
				lng: Number(Number(payload.lng).toFixed(3)),
				minSeverity: payload.minSeverity || 'moderate',
				status: 'active',
			});
			await route.fulfill({
				status: 201,
				contentType: 'application/json',
				headers: CORS_HEADERS,
				body: JSON.stringify({
					ok: true,
					subscriptionId,
					status: 'active',
					transportMode: 'web_push',
				}),
			});
		});
		await iconPage.route('**/api/v1/subscriptions/unsubscribe**', async (route) => {
			const payload = JSON.parse(route.request().postData() || '{}');
			pushUnsubs.push(payload);
			if (payload.scope === 'place') {
				const placeKey = makePlaceKey(payload.sourceId, payload.lat, payload.lng);
				const removed = serverRegistrations.delete(placeKey) ? 1 : 0;
				await route.fulfill({
					status: removed ? 200 : 404,
					contentType: 'application/json',
					headers: CORS_HEADERS,
					body: JSON.stringify({
						ok: Boolean(removed),
						status: 'unsubscribed',
						scope: 'place',
						removedCount: removed,
						remainingCount: serverRegistrations.size,
						message: 'Place disabled',
					}),
				});
				return;
			}
			const removed = serverRegistrations.size;
			serverRegistrations.clear();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: CORS_HEADERS,
				body: JSON.stringify({
					ok: true,
					status: 'unsubscribed',
					scope: 'device',
					removedCount: removed,
					remainingCount: 0,
					message: 'Device disabled',
				}),
			});
		});

		await iconPage.addInitScript((fixture) => {
			// Clean mocked Notification + PushManager using runtime-generated ephemeral P-256 keys (never hardcoded)
			let perm = 'granted';
			let browserUnsubCount = 0;
			const swMessageListeners = new Set();
			const storageKey = '__ux_mock_browser_sub_active__';
			const makeMockSub = () => ({
				endpoint: fixture.endpoint,
				expirationTime: null,
				toJSON: () => ({
					endpoint: fixture.endpoint,
					expirationTime: null,
					keys: {
						p256dh: fixture.p256dh,
						auth: fixture.auth,
					},
				}),
				async unsubscribe() {
					browserUnsubCount++;
					window.sessionStorage.removeItem(storageKey);
					return true;
				},
			});
			Object.defineProperty(window, 'Notification', {
				configurable: true,
				value: class MockNotification {
					static get permission() {
						return perm;
					}
					static async requestPermission() {
						return perm;
					}
				},
			});
			window.__setMockNotificationPermission = (next) => {
				perm = next;
			};
			window.__getMockBrowserUnsubCount = () => browserUnsubCount;
			window.__forceMockBrowserSubActive = (active) => {
				if (active) window.sessionStorage.setItem(storageKey, '1');
				else window.sessionStorage.removeItem(storageKey);
			};
			window.__dispatchSwMessage = (msg) => {
				for (const fn of swMessageListeners) fn({ data: msg });
			};
			const fakePm = {
				async getSubscription() {
					return window.sessionStorage.getItem(storageKey) === '1' ? makeMockSub() : null;
				},
				async subscribe() {
					window.sessionStorage.setItem(storageKey, '1');
					return makeMockSub();
				},
			};
			Object.defineProperty(navigator, 'serviceWorker', {
				configurable: true,
				value: {
					ready: Promise.resolve({ pushManager: fakePm, scope: '/aegis-map/' }),
					async getRegistration() {
						return { pushManager: fakePm, scope: '/aegis-map/' };
					},
					async getRegistrations() {
						return [{ pushManager: fakePm, scope: '/aegis-map/', async unregister() { return true; } }];
					},
					addEventListener(type, fn) {
						if (type === 'message') swMessageListeners.add(fn);
					},
					removeEventListener(type, fn) {
						if (type === 'message') swMessageListeners.delete(fn);
					},
				},
			});
		}, {
			endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/ux-ephemeral-endpoint',
			p256dh: ephemeralClient.p256dh,
			auth: ephemeralClient.auth,
		});

		await iconPage.goto(`${FRONTEND_URL}?view=near-me`, { waitUntil: 'networkidle', timeout: STEP_TIMEOUT });
		await iconPage.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

		const domLinks = await iconPage.evaluate(() => ({
			iconLinks: Array.from(
				document.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]'),
			).map((link) => ({
				rel: link.getAttribute('rel') || '',
				href: link.href,
			})),
			brandImgs: document.querySelectorAll('header svg, header img').length,
		}));
		const linkResults = [];
		for (const link of domLinks.iconLinks) {
			const r = await iconPage.request.get(link.href);
			const body = await r.body();
			linkResults.push({
				rel: link.rel,
				href: link.href,
				status: r.status(),
				contentType: r.headers()['content-type'] || '',
				bytes: body.byteLength,
			});
		}
		const manifestRes = linkResults.find((x) => x.rel === 'manifest');
		let manifestValid = false;
		const manifestIcons = [];
		if (manifestRes && manifestRes.status === 200) {
			const mReq = await iconPage.request.get(manifestRes.href);
			const mj = await mReq.json();
			manifestValid = mj.scope === '/aegis-map/' && mj.start_url === '/aegis-map/?view=near-me';
			for (const icon of mj.icons || []) {
				const iconUrl = new URL(icon.src, manifestRes.href).href;
				const ir = await iconPage.request.get(iconUrl);
				const iBody = await ir.body();
				manifestIcons.push({
					src: icon.src,
					status: ir.status(),
					contentType: ir.headers()['content-type'] || '',
					bytes: iBody.byteLength,
				});
			}
		}
		const assetAudit = { results: linkResults, manifestValid, manifestIcons, brandImgs: domLinks.brandImgs };
		checks.record(
			assetAudit.results.length >= 4 &&
				assetAudit.results.every((r) => r.status === 200 && !r.contentType.includes('text/html') && r.bytes > 0) &&
				assetAudit.manifestValid &&
				assetAudit.manifestIcons.length >= 2 &&
				assetAudit.manifestIcons.every((i) => i.status === 200 && i.contentType.startsWith('image/') && i.bytes > 0) &&
				assetAudit.brandImgs > 0,
			'Favicon, apple-touch-icon, manifest.webmanifest & manifest PNGs return HTTP 200 with non-HTML MIME types',
			JSON.stringify(assetAudit),
			'pwa-and-push',
		);

		await iconPage.locator('[data-testid="pwa-install-btn"]').click();
		await iconPage.locator('[data-testid="install-instructions-dialog"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await iconPage.screenshot({ path: path.join(EVIDENCE_DIR, 'after-favicon-install-clean.png') });
		registerArtifact('after-favicon-install-clean.png', { surface: 'Header Brand Icon + Install Modal', viewport: '1366x768', executionMode: 'Clean profile Playwright Chromium' });
		await iconPage.locator('[data-testid="install-modal-close-btn"]').click();

		// Select Place A (Oslo) and test full per-place & device Web Push lifecycle + retry + reload/lost metadata + expired endpoint + notification click
		await iconPage.locator('[data-testid="manual-coords-disclosure"]').click();
		await iconPage.locator('[data-testid="manual-coords-input"]').fill('59.9139, 10.7522');
		await iconPage.locator('[data-testid="apply-coords-btn"]').click();
		await iconPage.locator('[data-testid="enable-push-alerts-btn"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const inertEmailInputs = await iconPage.locator('[data-testid="subscription-email-input"]').count();
		checks.record(inertEmailInputs === 0, 'Inert email <form> is hidden when server email delivery is unavailable', `emailInputs=${inertEmailInputs}`, 'pwa-and-push');

		// 1. Enroll Place A (Oslo)
		await iconPage.locator('[data-testid="enable-push-alerts-btn"]').click();
		await iconPage.locator('[data-testid="disable-push-alerts-btn"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

		// 2. Switch to Place B (Bergen) -> must NOT falsely show active; simulate partial failure then retry
		await iconPage.locator('[data-testid="change-place-btn"]').click();
		if (!(await iconPage.locator('[data-testid="manual-coords-input"]').isVisible())) {
			await iconPage.locator('[data-testid="manual-coords-disclosure"]').click();
		}
		await iconPage.locator('[data-testid="manual-coords-input"]').fill('60.3913, 5.3221');
		await iconPage.locator('[data-testid="apply-coords-btn"]').click();
		await iconPage.locator('[data-testid="enable-push-alerts-btn"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const placeBActiveBeforeEnroll = await iconPage.locator('[data-testid="web-push-optin-card"]').getAttribute('data-push-active-place');

		failNextPushRegister = true;
		await iconPage.locator('[data-testid="enable-push-alerts-btn"]').click();
		await iconPage.locator('[data-testid="retry-push-op-btn"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const placeBActiveAfterFail = await iconPage.locator('[data-testid="web-push-optin-card"]').getAttribute('data-push-active-place');
		await iconPage.locator('[data-testid="retry-push-op-btn"]').click();
		await iconPage.locator('[data-testid="disable-push-alerts-btn"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const placeBActiveCount = await iconPage.locator('[data-testid="web-push-optin-card"]').getAttribute('data-push-active-count');

		// 3. Return to Place A, wipe localStorage (lost metadata) & reload -> server lookup restores Place A active
		await iconPage.evaluate(() => window.localStorage.removeItem('aegis:push-sub:v2'));
		await iconPage.goto(`${FRONTEND_URL}?view=near-me&lat=59.9139&lng=10.7522&country=NO`, { waitUntil: 'networkidle', timeout: STEP_TIMEOUT });
		await iconPage.locator('[data-testid="disable-push-alerts-btn"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

		// 4. Disable Place A ONLY -> Place B remains active, browser PushSubscription NOT unsubscribed
		await iconPage.locator('[data-testid="disable-push-alerts-btn"]').click();
		await iconPage.locator('[data-testid="enable-push-alerts-btn"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const unsubCountAfterPlaceA = await iconPage.evaluate(() => window.__getMockBrowserUnsubCount());
		const remainingAfterPlaceA = await iconPage.locator('[data-testid="web-push-optin-card"]').getAttribute('data-push-active-count');

		// 5. Switch back to Place B -> STILL active; then disable whole device
		await iconPage.goto(`${FRONTEND_URL}?view=near-me&lat=60.3913&lng=5.3221&country=NO`, { waitUntil: 'networkidle', timeout: STEP_TIMEOUT });
		await iconPage.locator('[data-testid="disable-push-alerts-btn"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await iconPage.locator('[data-testid="disable-push-alerts-btn"]').click();
		await iconPage.locator('[data-testid="enable-push-alerts-btn"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const unsubCountAfterFinal = await iconPage.evaluate(() => window.__getMockBrowserUnsubCount());

		// 6. Expired endpoint (browser has stale sub, server lookup returns []) -> must NOT show active
		await iconPage.evaluate(() => window.__forceMockBrowserSubActive(true));
		await iconPage.reload({ waitUntil: 'networkidle', timeout: STEP_TIMEOUT });
		await iconPage.locator('[data-testid="enable-push-alerts-btn"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const expiredShowsActive = await iconPage.locator('[data-testid="web-push-optin-card"]').getAttribute('data-push-active-place');
		await iconPage.evaluate(() => window.__forceMockBrowserSubActive(false));

		// 7. Denied permission fails closed
		await iconPage.evaluate(() => window.__setMockNotificationPermission('denied'));
		await iconPage.locator('[data-testid="enable-push-alerts-btn"]').click();
		await iconPage.waitForTimeout(250);
		const disableAfterDenied = await iconPage.locator('[data-testid="disable-push-alerts-btn"]').count();

		// 8. Notification click for cancelled warning in existing window switches place & shows cancelled state without fabricating active warning
		await iconPage.evaluate(() => {
			window.__dispatchSwMessage({
				type: 'AEGIS_WARNING_CLICK',
				url: '/aegis-map/?view=near-me&lat=59.9139&lng=10.7522&country=NO&warningId=cap-cancelled-99&noticeStatus=cancelled',
				warningId: 'cap-cancelled-99',
				route: {
					view: 'near-me',
					lat: 59.9139,
					lng: 10.7522,
					countryCode: 'NO',
					warningId: 'cap-cancelled-99',
					placeName: 'Oslo',
					msgType: 'Cancel',
				},
			});
		});
		await iconPage.locator('[data-testid="notification-warning-status"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const cancelBannerStatus = await iconPage.locator('[data-testid="notification-warning-status"]').getAttribute('data-notice-status');

		checks.record(
			placeBActiveBeforeEnroll === 'false' &&
				placeBActiveAfterFail === 'false' &&
				placeBActiveCount === '2' &&
				unsubCountAfterPlaceA === 0 &&
				remainingAfterPlaceA === '1' &&
				unsubCountAfterFinal === 1 &&
				expiredShowsActive === 'false' &&
				disableAfterDenied === 0 &&
				cancelBannerStatus === 'cancelled',
			'Per-place Web Push enrollment, partial-failure retry, lost-metadata reload recovery, per-place vs device removal, expired endpoint, denied permission & cancelled notification navigation verified',
			JSON.stringify({
				placeBActiveBeforeEnroll,
				placeBActiveAfterFail,
				placeBActiveCount,
				unsubCountAfterPlaceA,
				remainingAfterPlaceA,
				unsubCountAfterFinal,
				expiredShowsActive,
				disableAfterDenied,
				cancelBannerStatus,
			}),
			'pwa-and-push',
		);
		await iconCtx.close();

		// Standalone display-mode hides install button
		const standaloneCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
		const standalonePage = await standaloneCtx.newPage();
		await installDeterministicFixtures(standalonePage, { mapboxTracker });
		await standalonePage.addInitScript(() => {
			const origMM = window.matchMedia.bind(window);
			window.matchMedia = (q) => (q.includes('display-mode: standalone') ? { ...origMM(q), matches: true, media: q, addEventListener() {}, removeEventListener() {} } : origMM(q));
		});
		await standalonePage.goto(`${FRONTEND_URL}?view=near-me`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
		await standalonePage.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const installBtnCount = await standalonePage.locator('[data-testid="pwa-install-btn"]').count();
		checks.record(installBtnCount === 0, 'Install AegisMap button is hidden when running in standalone PWA mode', `count=${installBtnCount}`, 'pwa-and-push');
		await standaloneCtx.close();

		// 4B: NOAA-20 Hotspot Cell (32.250°N, 6.750°E), Undated GIBS Thermal Overlay, & Pixel Alignment + Short Desktop Live Monitor (1366x620)
		const fireCtx = await browser.newContext({ viewport: { width: 1366, height: 620 } });
		const firePage = await fireCtx.newPage();
		const capturedOverlayUrls = [];
		const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
		await installDeterministicFixtures(firePage, { mapboxTracker });
		await firePage.unroute('**/api/v2/disasters**');
		await firePage.route('**/api/v2/disasters**', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { ...CORS_HEADERS, 'x-disaster-sources': 'eonet=ok;usgs=ok;firms=ok', 'x-disaster-fetched-at': new Date().toISOString(), 'x-disaster-partial': 'false' },
				body: JSON.stringify({
					version: 2,
					window: '24h',
					windowRange: { startInclusive: '2026-11-27T00:00:00Z', endExclusive: '2026-11-28T00:00:00Z' },
					summary: { namedFires: 1, fireDetections: 14, fireCells: 1, earthquakes: 1, volcanoes: 1 },
					wildfires: [DETERMINISTIC_EVENTS.eventA],
					earthquakes: [DETERMINISTIC_EVENTS.eventB],
					volcanoes: [DETERMINISTIC_EVENTS.eventC],
					fireCells: [
						{
							cellId: 'cell_32.25_6.75',
							lat: 32.25,
							lng: 6.75,
							bounds: [6.5, 32.0, 7.0, 32.5],
							detectionCount: 14,
							maxFrp: 45.2,
							avgFrp: 19.4,
							maxBrightTi4: 351.2,
							latestAcqTime: '2026-11-27T13:10:00Z',
							confidenceCounts: { high: 5, nominal: 9, low: 0, unknown: 0 },
							dayNightCounts: { day: 10, night: 4, unknown: 0 },
							satelliteCounts: { N20: 14 },
							intensity: 'medium',
						},
					],
					sources: {
						eonet: { status: 'ok', count: 2, rejected: 0 },
						usgs: { status: 'ok', count: 1, rejected: 0 },
						firms: { status: 'ok', generatedAt: new Date().toISOString(), sensors: { VIIRS_NOAA20_NRT: { status: 'ok', rawRows: 14, acceptedRows: 14 } }, accounting: { rawRows: 14, malformedRows: 0, outOfWindowRows: 0, duplicateRows: 0, acceptedDetections: 14 } },
					},
					fetchedAt: new Date().toISOString(),
				}),
			}),
		);
		await firePage.unroute('**/api/fire-hotspots**');
		await firePage.route('**/api/fire-hotspots**', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: CORS_HEADERS,
				body: JSON.stringify({
					source: 'VIIRS_SNPP_NRT,VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT',
					sources: ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'],
					failedSources: [],
					sensor: 'VIIRS S-NPP, NOAA-20 & NOAA-21 375 m (NRT)',
					totalCount: 2,
					rawMatchedCount: 2,
					truncated: false,
					highConfidence: 1,
					nominalConfidence: 1,
					lowConfidence: 0,
					unknownConfidence: 0,
					maxBrightness: 351.2,
					maxPower: 45.2,
					rejectedRows: 0,
					fetchedAt: new Date().toISOString(),
					coverage: { status: 'complete', timezone: 'UTC', requestedStart: '2026-11-21', requestedEnd: '2026-11-28', missingDates: [], windows: [] },
					hotspots: [
						{ latitude: 32.25, longitude: 6.75, bright_ti4: 351.2, bright_ti5: 291, scan: 0.4, track: 0.4, acq_date: '2026-11-27', acq_time: '1310', satellite: 'NOAA-20', confidence: 'h', version: '2.0NRT', frp: 45.2, daynight: 'D' },
						{ latitude: 32.5, longitude: 7.0, bright_ti4: 339.1, bright_ti5: 289, scan: 0.4, track: 0.4, acq_date: '2026-11-27', acq_time: '1310', satellite: 'NOAA-20', confidence: 'n', version: '2.0NRT', frp: 19.4, daynight: 'D' },
					],
				}),
			}),
		);
		await firePage.route('https://gibs.earthdata.nasa.gov/**', (route) => {
			const u = route.request().url();
			if (u.includes('Thermal_Anomalies')) {
				capturedOverlayUrls.push(u);
			}
			return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
		});

		await firePage.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
		await waitForMapReady(firePage);

		// Verify 1366x620 Live Monitor fits controls & footer cleanly with single scroll body
		const shortLegendCheck = await firePage.evaluate(() => {
			const leg = document.querySelector('[data-testid="map-legend"]');
			const body = document.querySelector('[data-testid="legend-scroll-body"]');
			const winToggle = document.querySelector('[data-testid="window-toggle-container"]')?.getBoundingClientRect();
			const refreshBtn = document.querySelector('[data-testid="refresh-disasters-btn"]')?.getBoundingClientRect();
			const discOpen = document.querySelector('[data-testid="legend-scope-disclosure"]')?.hasAttribute('open') ?? false;
			if (!leg || !body || !winToggle || !refreshBtn) return { ok: false, reason: 'missing elements' };
			return {
				ok: body.scrollHeight <= body.clientHeight + 2 && refreshBtn.bottom <= window.innerHeight && winToggle.top >= 0 && !discOpen,
				scrollDelta: body.scrollHeight - body.clientHeight,
				refreshBottom: Math.round(refreshBtn.bottom),
				vh: window.innerHeight,
				discOpen,
			};
		});
		checks.record(shortLegendCheck.ok, 'Short desktop (1366x620): Live Monitor primary controls & footer visible cleanly without overflow', JSON.stringify(shortLegendCheck), 'short-desktop-legend');
		await firePage.screenshot({ path: path.join(EVIDENCE_DIR, 'after-live-monitor-short-desktop.png') });
		registerArtifact('after-live-monitor-short-desktop.png', { surface: 'Explore Live Monitor (1366x620)', viewport: '1366x620', executionMode: 'Playwright Chromium' });

		// Select NOAA-20 cell 32.250N, 6.750E via Legend Event List and inspect Fire tab + pixel alignment
		await firePage.locator('[data-testid="legend-event-list-toggle"]').click();
		await firePage.locator('[data-testid="legend-event-item-cell_32.25_6.75"]').click();
		await firePage.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await firePage.locator('[data-testid="inspector-tab-imagery"]').click();
		await firePage.locator('[data-testid="firms-satellite-breakdown"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await firePage.locator('[data-testid="imagery-hotspot-marker"]').first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

		const imageryGeometry = await firePage.evaluate(() => {
			const frame = document.querySelector('[data-testid="imagery-frame"]')?.getBoundingClientRect();
			const img = document.querySelector('[data-testid="imagery-base"]');
			const markers = Array.from(document.querySelectorAll('[data-testid="imagery-hotspot-marker"]'));
			if (!frame || !img || markers.length < 2) return { ok: false };
			const objectFit = window.getComputedStyle(img).objectFit;
			const centerRect = markers[0].getBoundingClientRect();
			const cornerRect = markers[1].getBoundingClientRect();
			const cx = centerRect.left + centerRect.width / 2 - frame.left;
			const cy = centerRect.top + centerRect.height / 2 - frame.top;
			const kx = cornerRect.left + cornerRect.width / 2 - frame.left;
			const ky = cornerRect.top + cornerRect.height / 2 - frame.top;
			const dxCenter = Math.abs(cx - frame.width * 0.5);
			const dyCenter = Math.abs(cy - frame.height * 0.5);
			const dxCorner = Math.abs(kx - frame.width * 0.75);
			const dyCorner = Math.abs(ky - frame.height * 0.25);
			return {
				ok: objectFit === 'fill' && Math.abs(frame.width / frame.height - 4 / 3) < 0.02 && dxCenter <= 2 && dyCenter <= 2 && dxCorner <= 2 && dyCorner <= 2,
				objectFit,
				ratio: Number((frame.width / frame.height).toFixed(3)),
				deltas: { dxCenter, dyCenter, dxCorner, dyCorner },
				sensorText: document.querySelector('[data-testid="firms-satellite-breakdown"]')?.innerText || '',
			};
		});
		checks.record(
			imageryGeometry.ok && capturedOverlayUrls.length >= 1 && !new URL(capturedOverlayUrls[0]).searchParams.has('TIME') && imageryGeometry.sensorText.includes('NOAA-20'),
			'NOAA-20 cell shows NOAA-20 breakdown, undated GIBS overlay (no TIME=), aspect 4:3 object-fill alignment <= 2px',
			JSON.stringify({ ...imageryGeometry, overlayUrl: capturedOverlayUrls[0] }),
			'noaa20-and-gibs',
		);
		await firePage.screenshot({ path: path.join(EVIDENCE_DIR, 'after-hotspot-noaa20-32.25N-6.75E.png') });
		registerArtifact('after-hotspot-noaa20-32.25N-6.75E.png', { surface: 'NOAA-20 Hotspot Imagery (32.250N, 6.750E)', viewport: '1366x620', executionMode: 'Playwright Chromium' });

		// Exercise GIBS XML ServiceExceptionReport on the thermal overlay while valid FIRMS points & MODIS base image remain intact
		await firePage.unroute('https://gibs.earthdata.nasa.gov/**');
		await firePage.route('https://gibs.earthdata.nasa.gov/**', (route) => {
			const u = route.request().url();
			if (u.includes('Thermal_Anomalies')) {
				return route.fulfill({
					status: 200,
					contentType: 'application/xml',
					body: '<?xml version="1.0" encoding="UTF-8"?><ServiceExceptionReport version="1.3.0"><ServiceException>Invalid layer extent</ServiceException></ServiceExceptionReport>',
				});
			}
			return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
		});
		await firePage.locator('[data-testid="imagery-tab-falsecolor"]').click();
		await firePage.locator('[data-testid="imagery-tab-fire"]').click();
		await firePage.waitForFunction(
			() => document.querySelector('[data-testid="satellite-imagery"]')?.getAttribute('data-imagery-overlay-status') === 'error',
			undefined,
			{ timeout: 10000 },
		);
		const xmlOverlayFallback = await firePage.evaluate(() => {
			const el = document.querySelector('[data-testid="satellite-imagery"]');
			return {
				baseStatus: el?.getAttribute('data-imagery-status'),
				overlayStatus: el?.getAttribute('data-imagery-overlay-status'),
				markers: document.querySelectorAll('[data-testid="imagery-hotspot-marker"]').length,
				caption: document.querySelector('[data-testid="imagery-caption"]')?.textContent || '',
			};
		});
		checks.record(
			xmlOverlayFallback.baseStatus === 'loaded' &&
				xmlOverlayFallback.overlayStatus === 'error' &&
				xmlOverlayFallback.markers === 2 &&
				xmlOverlayFallback.caption.includes('failed to load'),
			'GIBS XML ServiceExceptionReport degrades thermal overlay cleanly while MODIS base & valid FIRMS markers remain rendered',
			JSON.stringify(xmlOverlayFallback),
			'noaa20-and-gibs',
		);
		await fireCtx.close();

		// 4D: Healthy-empty saved Near me (Panaji, IN), desktop geolocation + race guard, & zh-Hans localization
		const nmCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
		const nmPage = await nmCtx.newPage();
		await installDeterministicFixtures(nmPage, {
			subscriptionAvailable: false,
			subscriptionReason: 'RESEND_API_KEY missing',
			mapboxTracker,
		});
		await nmPage.unroute('**/api/v1/warnings**');
		await nmPage.route('**/api/v1/warnings**', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: CORS_HEADERS,
				body: JSON.stringify({
					version: 1,
					query: { lat: 15.4909, lng: 73.8278, countryCode: 'IN', checkedAt: new Date().toISOString() },
					coverageStatus: 'checked_no_warnings',
					coverageExplanation: 'Checked NDMA SACHET — no active warnings for Panaji, Goa, India.',
					warnings: [],
					sources: [{ sourceId: 'in-sachet', authorityName: 'NDMA SACHET', countryCodes: ['IN'], status: 'ok', checkedAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString(), activeAlertCount: 0, matchedAlertCount: 0, unsupportedHazards: [], attribution: 'NDMA India', termsUrl: 'https://sachet.ndma.gov.in/' }],
				}),
			}),
		);
		await nmPage.addInitScript(() => {
			if (!window.localStorage.getItem('aegis:saved-places:v1')) {
				window.localStorage.setItem('aegis:saved-places:v1', JSON.stringify([{ id: 'gaz:in-panaji', label: 'Panaji, Goa, India', lat: 15.4909, lng: 73.8278, countryCode: 'IN', countryName: 'India', admin1: 'Goa', timezone: 'Asia/Kolkata', source: 'offline_gazetteer' }]));
				window.localStorage.setItem('aegis:present-jurisdiction:v1', 'IN');
			}
		});
		await nmPage.goto(`${FRONTEND_URL}?view=near-me`, { waitUntil: 'networkidle', timeout: STEP_TIMEOUT });
		await nmPage.locator('[data-testid="warnings-coverage-banner"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const emptyBalance = await nmPage.evaluate(() => {
			const gpsVisible = Boolean(document.querySelector('[data-testid="gps-request-btn"]'));
			const left = document.querySelector('[data-testid="official-warnings-section"]')?.getBoundingClientRect();
			const right = document.querySelector('[data-testid="location-help-panel"]')?.getBoundingClientRect();
			const banner = document.querySelector('[data-testid="warnings-coverage-banner"]')?.getBoundingClientRect();
			const sourcesHeading = document.querySelector('[data-testid="official-warnings-section"] h3')?.getBoundingClientRect();
			const innerVoidPx = banner && sourcesHeading ? Math.round(sourcesHeading.top - banner.bottom) : 9999;
			return {
				gpsVisible,
				row1GapPx: left && right ? Math.round(Math.abs(right.height - left.height)) : 9999,
				innerVoidPx,
			};
		});
		checks.record(
			emptyBalance.gpsVisible && emptyBalance.row1GapPx < 240 && emptyBalance.innerVoidPx < 60,
			'Healthy-empty Near me keeps Use my location visible, compact Row 1 heights, and zero internal card dead void',
			JSON.stringify(emptyBalance),
			'task-layout',
		);
		await nmPage.screenshot({ path: path.join(EVIDENCE_DIR, 'after-near-me-healthy-empty-saved.png'), fullPage: true });
		registerArtifact('after-near-me-healthy-empty-saved.png', { surface: 'Near me (healthy empty saved Panaji, full page)', viewport: '1366x768', executionMode: 'Playwright Chromium' });

		// Switch to zh-Hans and search Chinese offline gazetteer 北京
		await nmPage.locator('[data-testid="ui-locale-select"]').selectOption('zh-Hans');
		const zhLangCheck = await nmPage.evaluate(() => ({
			lang: document.documentElement.lang,
			heading: document.querySelector('h1')?.textContent || '',
			pageText: document.body.innerText,
		}));
		await nmPage.locator('[data-testid="change-place-btn"]').click();
		await nmPage.route('https://geocoding-api.open-meteo.com/**', (route) => route.abort('failed'));
		await nmPage.locator('[data-testid="place-search-input"]').fill('北京');
		await nmPage.locator('[data-testid="place-search-btn"]').click();
		await nmPage.locator('[data-testid="selected-place-summary"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const selectedZhText = await nmPage.locator('[data-testid="selected-place-summary"]').innerText();
		const hasLocalizedZhHeadings =
			zhLangCheck.pageText.includes('官方预警数据源覆盖与时效') &&
			zhLangCheck.pageText.includes('已核验紧急求助电话') &&
			!zhLangCheck.pageText.includes('AUTHORITY SOURCE COVERAGE');
		checks.record(
			zhLangCheck.lang === 'zh-Hans' && zhLangCheck.heading === '我附近' && selectedZhText.includes('Beijing') && hasLocalizedZhHeadings,
			'zh-Hans UI, localized subheadings, and Chinese offline gazetteer query (北京) work cleanly',
			JSON.stringify({ lang: zhLangCheck.lang, heading: zhLangCheck.heading, hasLocalizedZhHeadings, selectedZhText: selectedZhText.slice(0, 80) }),
			'zh-hans',
		);
		await nmPage.screenshot({ path: path.join(EVIDENCE_DIR, 'after-near-me-zh-hans-1366x768.png') });
		registerArtifact('after-near-me-zh-hans-1366x768.png', { surface: 'Near me (Simplified Chinese zh-Hans)', viewport: '1366x768', locale: 'zh-Hans', executionMode: 'Playwright Chromium' });
		await nmCtx.close();

		// 4E: Desktop coarse-first geolocation + manual selection race guard
		const geoCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
		const geoPage = await geoCtx.newPage();
		await installDeterministicFixtures(geoPage, { mapboxTracker });
		await geoPage.addInitScript(() => {
			Object.defineProperty(navigator, 'geolocation', {
				configurable: true,
				value: {
					getCurrentPosition(success) {
						setTimeout(() => {
							success({
								coords: { latitude: 3.139, longitude: 101.6869, accuracy: 1200 },
								timestamp: Date.now(),
							});
						}, 450);
					},
				},
			});
		});
		await geoPage.goto(`${FRONTEND_URL}?view=near-me`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
		await geoPage.locator('[data-testid="gps-request-btn"]').click();
		// Manual Beijing selection BEFORE delayed geolocation callback resolves -> manual Beijing must win
		await geoPage.route('https://geocoding-api.open-meteo.com/**', (route) => route.abort('failed'));
		await geoPage.locator('[data-testid="place-search-input"]').fill('北京');
		await geoPage.locator('[data-testid="place-search-btn"]').click();
		await geoPage.locator('[data-testid="selected-place-summary"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await geoPage.waitForTimeout(600);
		const raceWinnerText = await geoPage.locator('[data-testid="selected-place-summary"]').innerText();
		checks.record(
			raceWinnerText.includes('Beijing') && !raceWinnerText.includes('Kuala Lumpur') && !raceWinnerText.includes('3.139'),
			'Manual place selection (Beijing) is never overwritten by delayed desktop geolocation callback',
			raceWinnerText.slice(0, 80),
			'desktop-geolocation',
		);
		await geoCtx.close();
	} finally {
		await browser.close();
	}

	reportData.mapboxMode = mapboxTracker.mode;
	reportData.summary = {
		executed: checks.items.length,
		passed: checks.passed.length,
		failed: checks.failed.length,
		skipped: checks.skipped.length,
	};
	reportData.checks = checks.items;
	reportData.skippedChecks = checks.skipped;

	// Write machine-readable JSON & reviewer-readable Markdown report (zero local file:/// paths)
	fs.writeFileSync(path.join(EVIDENCE_DIR, 'ux-test-report.json'), JSON.stringify(reportData, null, 2));

	const mdLines = [
		'# AegisMap Responsive UI/UX, Pinned Popup Geometry & SW Upgrade Report',
		'',
		`- **Candidate SHA:** \`${CANDIDATE_SHA}\``,
		`- **Baseline SHA:** \`${BASELINE_SHA}\``,
		`- **Browser Engine:** ${browserLabel}`,
		`- **Mapbox Style Mode:** \`${reportData.mapboxMode}\``,
		`- **Popup Tip Attachment Tolerance:** \`<= ${MAX_TIP_TOLERANCE_PX} px\` in both X and Y (configured Mapbox offset \`${POPUP_CONFIGURED_OFFSET_PX} px\`)`,
		`- **Totals:** **${reportData.summary.passed}/${reportData.summary.executed} passed**, **${reportData.summary.failed} failed**, **${reportData.summary.skipped} skipped**`,
		'- **Emulation vs. Physical Hardware:** All browser checks in this report ran under Playwright headless Chromium (desktop + mobile touch/viewport/DPR emulation); physical iOS Safari / Android Chrome handsets and native OS `tel:` / `sms:` / Share sheets were not executed in CI.',
		'',
		'## 1. Pinned Popup Tip-to-Double-Circle Measurements',
		'',
		'| Transition / Scenario | Event ID | Anchor | Ring Center `(x, y)` | Tip Apex `(x, y)` | Expected Tip `(x, y)` | `dx` (px) | `dy` (px) |',
		'| --- | --- | --- | --- | --- | --- | --- | --- |',
		...reportData.popupTipMeasurements.map(
			(m) =>
				`| ${m.step} | \`${m.pinnedId}\` | \`${m.anchor}\` | \`(${m.ringCenter?.x}, ${m.ringCenter?.y})\` | \`(${m.tipApex?.x}, ${m.tipApex?.y})\` | \`(${m.expectedTip?.x}, ${m.expectedTip?.y})\` | \`${m.dx}\` | \`${m.dy}\` |`,
		),
		'',
		'## 2. Service Worker Offline & Interrupted-Upgrade Coverage',
		'',
		`- **Fresh-Install Coverage:** \`${JSON.stringify(reportData.swFreshInstall)}\``,
		`- **Interrupted-Upgrade Coverage (\`${BASELINE_SHA.slice(0, 7)} -> ${CANDIDATE_SHA.slice(0, 7)}\`):** \`${JSON.stringify(reportData.swInterruptedUpgrade)}\``,
		'',
		'## 3. Published Visual & Report Artifacts',
		'',
		'| Artifact File | Tested SHA | Surface | Viewport | Theme | Locale | Fixture | Execution Mode |',
		'| --- | --- | --- | --- | --- | --- | --- | --- |',
		...artifacts.map(
			(a) =>
				`| \`${a.file}\` | \`${a.sha.slice(0, 12)}\` | ${a.surface} | \`${a.viewport}\` | \`${a.theme}\` | \`${a.locale}\` | \`${a.fixture}\` | ${a.executionMode} |`,
		),
		'',
	];
	fs.writeFileSync(path.join(EVIDENCE_DIR, 'ux-test-report.md'), mdLines.join('\n'), 'utf-8');

	console.log(
		`\n=== Responsive UX Verification Summary: ${reportData.summary.passed}/${reportData.summary.executed} passed, ${reportData.summary.failed} failed, ${reportData.summary.skipped} skipped ===`,
	);
	if (checks.failed.length > 0) {
		console.error('Failed checks:', checks.failed.map((f) => f.label).join('; '));
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
