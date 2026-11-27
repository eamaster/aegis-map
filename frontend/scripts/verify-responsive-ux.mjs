/**
 * Comprehensive Responsive UI/UX, Map Selection Persistence, Touch/Keyboard,
 * Persian RTL, Stress-Fixture, Service-Worker Upgrade & Video Verification Suite.
 *
 * Usage:
 *   FRONTEND_URL=http://127.0.0.1:4173/aegis-map/ API_BASE_URL=http://127.0.0.1:8787 node scripts/verify-responsive-ux.mjs
 *
 * Optional env:
 *   UX_EVIDENCE_DIR   Directory for matched after-*.png screenshots, after-diagnostics.json, and WebM video
 *   SW_BASELINE_DIST  Path to previous build dist folder (e.g. v1.5.0) to run live SW upgrade verification
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(__dirname, '../dist');
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://127.0.0.1:4173/aegis-map/').replace(/\/?$/, '/');
const API_BASE_URL = (process.env.API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const EVIDENCE_DIR = process.env.UX_EVIDENCE_DIR
	? path.resolve(process.env.UX_EVIDENCE_DIR)
	: path.resolve(__dirname, '../../.tmp/ux-evidence');
const SW_BASELINE_DIST = process.env.SW_BASELINE_DIST ? path.resolve(process.env.SW_BASELINE_DIST) : null;
const STEP_TIMEOUT = 35000;

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

class Checks {
	constructor() {
		this.items = [];
	}
	record(ok, label, detail = '') {
		this.items.push({ ok, label, detail });
		console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
		return ok;
	}
	get failed() {
		return this.items.filter((i) => !i.ok);
	}
}

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
	const server = http.createServer((req, res) => {
		const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
		if (!urlObj.pathname.startsWith('/aegis-map')) {
			res.writeHead(404);
			res.end('Not found');
			return;
		}
		let rel = urlObj.pathname.slice('/aegis-map'.length);
		if (!rel || rel === '/') rel = '/index.html';
		const safeRel = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
		let filePath = path.join(activeRoot, safeRel);
		if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
			filePath = path.join(activeRoot, 'index.html');
		}
		if (!fs.existsSync(filePath)) {
			res.writeHead(404);
			res.end('Missing asset');
			return;
		}
		const ext = path.extname(filePath).toLowerCase();
		const isImmutable = safeRel.replace(/\\/g, '/').startsWith('/assets/');
		res.writeHead(200, {
			'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream',
			'Cache-Control': isImmutable ? 'public, max-age=31536000, immutable' : 'no-cache',
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
				close: () => new Promise((r) => server.close(() => r())),
			});
		});
	});
}

async function waitForMapReady(page) {
	await page.waitForFunction(
		() =>
			Boolean(
				window.mapDebug &&
					typeof window.mapDebug.getLayer === 'function' &&
					['fires-layer', 'earthquakes-layer', 'volcanoes-layer', 'fire-cells-layer'].some((l) =>
						window.mapDebug.getLayer(l),
					),
			),
		undefined,
		{ timeout: STEP_TIMEOUT },
	);
}

async function pickTwoDistinctMapCandidates(page) {
	return page.evaluate(() => {
		const map = window.mapDebug;
		const items = [];
		for (const srcId of ['fires', 'earthquakes', 'volcanoes', 'fire-cells']) {
			const src = map.getSource(srcId);
			const feats = src?._data?.features ?? [];
			for (const f of feats) {
				if (f?.geometry?.coordinates && f?.properties?.id) {
					const [lng, lat] = f.geometry.coordinates;
					items.push({ id: f.properties.id, lng, lat, srcId });
				}
			}
		}
		if (items.length < 2) return items;
		const first = items[0];
		const second =
			items.find((c) => c.id !== first.id && Math.hypot(c.lng - first.lng, c.lat - first.lat) > 3) ||
			items[1];
		return [first, second];
	});
}

async function centerAndProjectCandidate(page, candidate, zoom = 5.2) {
	return page.evaluate(
		async ({ lng, lat, zoomLevel }) => {
			const map = window.mapDebug;
			map.jumpTo({ center: [lng, lat], zoom: zoomLevel, bearing: 0, pitch: 0 });
			await new Promise((r) => setTimeout(r, 350));
			const pt = map.project([lng, lat]);
			const rect = map.getCanvas().getBoundingClientRect();
			return { x: rect.left + pt.x, y: rect.top + pt.y, canvasX: pt.x, canvasY: pt.y };
		},
		{ lng: candidate.lng, lat: candidate.lat, zoomLevel: zoom },
	);
}

async function main() {
	const checks = new Checks();
	const diagnostics = {
		capturedAt: new Date().toISOString(),
		frontendUrl: FRONTEND_URL,
		apiBaseUrl: API_BASE_URL,
	};

	const browser = await chromium.launch({
		headless: true,
		args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
	});

	try {
		// =========================================================================
		// GATE F.1: Computed Style Proof, Viewport Matrix, 200% Zoom, Themes & RTL
		// =========================================================================
		console.log('\n=== Gate F.1: Computed Styles, Viewport Matrix, Themes, 200% Zoom & RTL ===');
		const styleCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
		const stylePage = await styleCtx.newPage();
		await stylePage.route(`${API_BASE_URL}/api/analyze`, (route) =>
			route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'ux_stub' }) }),
		);

		await stylePage.goto(`${FRONTEND_URL}?view=near-me`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
		await stylePage.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

		const afterStyles = await stylePage.evaluate(() => {
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
				helpCard: readStyle(document.querySelector('[data-testid="location-help-panel"]')),
			};
		});
		diagnostics.computedStyles1366Dark = afterStyles;

		checks.record(
			afterStyles.searchInput?.paddingTop >= 8 &&
				afterStyles.searchInput?.paddingLeft >= 10 &&
				afterStyles.searchInput?.borderRadius >= 8,
			'Tailwind v4 search input utilities restored (padding + border-radius)',
			JSON.stringify(afterStyles.searchInput),
		);
		checks.record(
			afterStyles.placeCard?.paddingTop >= 16 && afterStyles.placeCard?.borderRadius >= 12,
			'Tailwind v4 card spacing & radius utilities restored (0px -> >=16px)',
			JSON.stringify(afterStyles.placeCard),
		);
		checks.record(
			afterStyles.searchBtn?.backgroundColor !== 'rgb(240, 240, 240)',
			'Primary search button renders themed blue background instead of browser-default grey',
			afterStyles.searchBtn?.backgroundColor,
		);

		// Capture matched after-near-me-1366x768.png (with an active warning selected for rich real comparison)
		await stylePage.locator('[data-testid="manual-coords-disclosure"]').click();
		await stylePage.locator('[data-testid="manual-coords-input"]').fill('59.9139, 10.7522');
		await stylePage.locator('[data-testid="apply-coords-btn"]').click();
		await stylePage.locator('[data-testid="warnings-coverage-banner"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await stylePage.screenshot({ path: path.join(EVIDENCE_DIR, 'after-near-me-1366x768.png') });

		// Switch to Explore 1366x768 -> capture Archive & Selected Event (dark + light)
		await stylePage.locator('[data-testid="nav-explore-events"]').click();
		await waitForMapReady(stylePage);

		await stylePage.locator('[data-testid="open-timeline-drawer-btn"]').click();
		await stylePage.locator('[data-testid="timeline-analytics-drawer"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await stylePage.waitForTimeout(400);
		const archiveDialogBox = await stylePage.evaluate(() => {
			const dialogCard = document.querySelector('[data-testid="timeline-analytics-drawer"] > div');
			const r = dialogCard?.getBoundingClientRect();
			return r ? { width: Math.round(r.width), height: Math.round(r.height), left: Math.round(r.left) } : null;
		});
		diagnostics.archiveDialog1366 = archiveDialogBox;
		checks.record(
			Boolean(archiveDialogBox && archiveDialogBox.width >= 600 && archiveDialogBox.width <= 800 && archiveDialogBox.left >= 200),
			'Archive dialog renders as centered bounded modal on desktop (fixed inset-0 + max-w-3xl restored)',
			JSON.stringify(archiveDialogBox),
		);
		await stylePage.screenshot({ path: path.join(EVIDENCE_DIR, 'after-archive-1366x768.png') });
		await stylePage.locator('[data-testid="close-timeline-drawer-btn"]').click();

		const desktopCandidates = await pickTwoDistinctMapCandidates(stylePage);
		if (desktopCandidates.length >= 1) {
			const pos = await centerAndProjectCandidate(stylePage, desktopCandidates[0], 5.2);
			await stylePage.mouse.click(pos.x, pos.y);
			await stylePage.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			await stylePage.mouse.move(140, 420); // Move pointer away to prove persistent bubble in screenshot!
			await stylePage.waitForTimeout(500);
			await stylePage.screenshot({ path: path.join(EVIDENCE_DIR, 'after-explore-selected-1366x768.png') });

			// Light theme check + screenshot
			await stylePage.locator('[data-testid="theme-toggle-btn"]').click();
			await stylePage.waitForTimeout(250);
			const lightThemeAttr = await stylePage.evaluate(() => document.documentElement.getAttribute('data-theme'));
			checks.record(lightThemeAttr === 'light', 'Theme toggle switches root data-theme to light', lightThemeAttr || '');
			await stylePage.screenshot({ path: path.join(EVIDENCE_DIR, 'after-explore-selected-light-1366x768.png') });
			await stylePage.locator('[data-testid="theme-toggle-btn"]').click();
		}
		await styleCtx.close();

		// Viewport & Locale Overflow Matrix (320x568, 390x844, 844x390 landscape, 768x1024, 683x384 200%-zoom equivalent)
		const viewportSpecs = [
			{ name: '320x568-en', width: 320, height: 568, locale: 'en' },
			{ name: '320x568-fa-rtl', width: 320, height: 568, locale: 'fa' },
			{ name: '390x844-ms', width: 390, height: 844, locale: 'ms' },
			{ name: '844x390-landscape', width: 844, height: 390, locale: 'en' },
			{ name: '768x1024-tablet', width: 768, height: 1024, locale: 'en' },
			{ name: '683x384-zoom200', width: 683, height: 384, locale: 'en' },
		];

		for (const vp of viewportSpecs) {
			const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
			const p = await ctx.newPage();
			await p.goto(`${FRONTEND_URL}?view=near-me`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
			await p.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			await p.locator('[data-testid="ui-locale-select"]').selectOption(vp.locale);
			await p.waitForTimeout(120);

			const nearOverflow = await p.evaluate(() => ({
				scrollWidth: document.documentElement.scrollWidth,
				innerWidth: window.innerWidth,
				dir: document.documentElement.dir,
				bdiCount: document.querySelectorAll('bdi[dir="ltr"]').length,
			}));
			checks.record(
				nearOverflow.scrollWidth <= nearOverflow.innerWidth,
				`Zero horizontal overflow on Near me (${vp.name})`,
				`scrollWidth=${nearOverflow.scrollWidth} innerWidth=${nearOverflow.innerWidth} dir=${nearOverflow.dir}`,
			);
			if (vp.name === '320x568-fa-rtl') {
				await p.screenshot({ path: path.join(EVIDENCE_DIR, 'after-near-me-320x568-fa-rtl.png') });
			}
			await ctx.close();
		}

		// =========================================================================
		// GATE F.2 & G: Desktop Pinned Selection, Pan/Zoom, Globe Occlusion & Video
		// =========================================================================
		console.log('\n=== Gate F.2 & G: Persistent Pinned Bubble, Pan/Zoom, Globe Occlusion & Video ===');
		const videoTempDir = path.join(EVIDENCE_DIR, '_video_tmp');
		fs.mkdirSync(videoTempDir, { recursive: true });
		const recCtx = await browser.newContext({
			viewport: { width: 1280, height: 760 },
			recordVideo: { dir: videoTempDir, size: { width: 1280, height: 760 } },
		});
		const recPage = await recCtx.newPage();
		await recPage.route(`${API_BASE_URL}/api/analyze`, (route) =>
			route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'ux_stub' }) }),
		);

		await recPage.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
		await waitForMapReady(recPage);
		const pair = await pickTwoDistinctMapCandidates(recPage);
		checks.record(pair.length >= 2, 'Located two distinct map events for interactive selection recording', `count=${pair.length}`);

		if (pair.length >= 2) {
			const [evA, evB] = pair;
			const ptA = await centerAndProjectCandidate(recPage, evA, 5.0);
			await recPage.waitForTimeout(350);

			// 1. Click event A
			await recPage.mouse.click(ptA.x, ptA.y);
			await recPage.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			await recPage.locator('[data-testid="pinned-disaster-popup"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			await recPage.waitForTimeout(450);

			// 2. Move pointer to blank map space AND into inspector
			await recPage.mouse.move(160, 520, { steps: 12 });
			await recPage.waitForTimeout(400);
			const afterBlankLeave = await recPage.evaluate(() => ({
				popupCount: document.querySelectorAll('.mapboxgl-popup').length,
				pinnedId: document.querySelector('[data-testid="pinned-disaster-popup"]')?.getAttribute('data-disaster-id'),
				sidebarId: document.querySelector('[data-testid="sidebar"]')?.getAttribute('data-disaster-id'),
				hasHaloLayer: Boolean(window.mapDebug.getLayer('selected-disaster-halo-layer')),
				hasRingLayer: Boolean(window.mapDebug.getLayer('selected-disaster-ring-layer')),
			}));
			checks.record(
				afterBlankLeave.popupCount === 1 &&
					afterBlankLeave.pinnedId === evA.id &&
					afterBlankLeave.sidebarId === evA.id &&
					afterBlankLeave.hasHaloLayer &&
					afterBlankLeave.hasRingLayer,
				'Pinned bubble & double-circle marker remain attached after pointer leaves marker',
				JSON.stringify(afterBlankLeave),
			);

			await recPage.mouse.move(1120, 360, { steps: 10 }); // Inside right-hand inspector
			await recPage.waitForTimeout(300);
			const afterInspectorHover = await recPage.locator('.mapboxgl-popup').count();
			checks.record(afterInspectorHover === 1, 'Pinned bubble remains active while pointer is inside inspector', `popups=${afterInspectorHover}`);

			// 3. Pan the map by dragging and verify popup moves in lockstep with projected marker coordinates
			const beforePan = await recPage.evaluate(({ lng, lat }) => {
				const pt = window.mapDebug.project([lng, lat]);
				const mapRect = window.mapDebug.getCanvas().getBoundingClientRect();
				const popRect = document.querySelector('.mapboxgl-popup')?.getBoundingClientRect();
				return {
					markerX: mapRect.left + pt.x,
					markerY: mapRect.top + pt.y,
					popCenterX: popRect ? popRect.left + popRect.width / 2 : 0,
					popBottomY: popRect ? popRect.bottom : 0,
				};
			}, evA);

			await recPage.mouse.move(460, 420);
			await recPage.mouse.down();
			await recPage.mouse.move(560, 360, { steps: 14 });
			await recPage.mouse.up();
			await recPage.waitForTimeout(450);

			const afterPan = await recPage.evaluate(({ lng, lat }) => {
				const pt = window.mapDebug.project([lng, lat]);
				const mapRect = window.mapDebug.getCanvas().getBoundingClientRect();
				const popRect = document.querySelector('.mapboxgl-popup')?.getBoundingClientRect();
				const sidebarRect = document.querySelector('[data-testid="sidebar"]')?.getBoundingClientRect();
				const navCtrlRect = document.querySelector('.mapboxgl-ctrl-bottom-right')?.getBoundingClientRect();
				return {
					popupCount: document.querySelectorAll('.mapboxgl-popup').length,
					markerX: mapRect.left + pt.x,
					markerY: mapRect.top + pt.y,
					popCenterX: popRect ? popRect.left + popRect.width / 2 : 0,
					popRight: popRect ? popRect.right : 0,
					sidebarLeft: sidebarRect ? sidebarRect.left : 9999,
					navRight: navCtrlRect ? navCtrlRect.right : 0,
				};
			}, evA);

			const markerDeltaX = afterPan.markerX - beforePan.markerX;
			const popDeltaX = afterPan.popCenterX - beforePan.popCenterX;
			checks.record(
				afterPan.popupCount === 1 && Math.abs(markerDeltaX) > 20 && Math.abs(markerDeltaX - popDeltaX) < 12,
				'Pinned bubble tracks double-circle marker coordinates accurately during map pan',
				`markerDeltaX=${markerDeltaX.toFixed(1)} popDeltaX=${popDeltaX.toFixed(1)}`,
			);
			checks.record(
				afterPan.popRight <= afterPan.sidebarLeft + 2 && afterPan.navRight <= afterPan.sidebarLeft + 2,
				'Desktop side-by-side inspector never covers pinned popup or Mapbox bottom-right controls',
				`popRight=${Math.round(afterPan.popRight)} navRight=${Math.round(afterPan.navRight)} sidebarLeft=${Math.round(afterPan.sidebarLeft)}`,
			);

			// 4. Select second event B -> ring, bubble, and inspector atomically switch to B
			const ptB = await centerAndProjectCandidate(recPage, evB, 5.0);
			await recPage.waitForTimeout(300);
			await recPage.mouse.click(ptB.x, ptB.y);
			await recPage.waitForFunction(
				(expectedId) =>
					document.querySelector('[data-testid="pinned-disaster-popup"]')?.getAttribute('data-disaster-id') ===
					expectedId,
				evB.id,
				{ timeout: STEP_TIMEOUT },
			);
			await recPage.mouse.move(180, 500, { steps: 10 });
			await recPage.waitForTimeout(500);
			const stateB = await recPage.evaluate(() => ({
				popupCount: document.querySelectorAll('.mapboxgl-popup').length,
				pinnedId: document.querySelector('[data-testid="pinned-disaster-popup"]')?.getAttribute('data-disaster-id'),
				sidebarId: document.querySelector('[data-testid="sidebar"]')?.getAttribute('data-disaster-id'),
			}));
			checks.record(
				stateB.popupCount === 1 && stateB.pinnedId === evB.id && stateB.sidebarId === evB.id,
				'Selecting event B replaces pinned bubble and inspector cleanly without duplicate popups',
				JSON.stringify(stateB),
			);

			// 5. Globe far-side occlusion check: rotate antipodal at globe zoom -> popup detaches, rotate back -> re-attaches
			const antipodeLng = evB.lng > 0 ? evB.lng - 180 : evB.lng + 180;
			await recPage.evaluate(
				({ lng, lat }) => {
					window.mapDebug.jumpTo({ center: [lng, -lat], zoom: 1.4, bearing: 0, pitch: 0 });
				},
				{ lng: antipodeLng, lat: evB.lat },
			);
			await recPage.waitForTimeout(350);
			const farSidePopups = await recPage.locator('.mapboxgl-popup').count();
			const farSideSidebar = await recPage.locator('[data-testid="sidebar"]').getAttribute('data-disaster-id');
			checks.record(
				farSidePopups === 0 && farSideSidebar === evB.id,
				'Pinned popup detaches cleanly when marker rotates onto far side of 3D globe',
				`popups=${farSidePopups} sidebar=${farSideSidebar}`,
			);

			await recPage.evaluate(
				({ lng, lat }) => {
					window.mapDebug.jumpTo({ center: [lng, lat], zoom: 4.5, bearing: 0, pitch: 0 });
				},
				{ lng: evB.lng, lat: evB.lat },
			);
			await recPage.waitForTimeout(350);
			const returnedPopups = await recPage.locator('.mapboxgl-popup').count();
			checks.record(returnedPopups === 1, 'Pinned popup re-attaches when marker rotates back onto visible hemisphere', `popups=${returnedPopups}`);
		}

		const videoObj = recPage.video();
		await recCtx.close();
		if (videoObj) {
			const recordedPath = await videoObj.path();
			const targetVideoPath = path.join(EVIDENCE_DIR, 'after-explore-pinned-selection.webm');
			if (fs.existsSync(recordedPath)) {
				fs.copyFileSync(recordedPath, targetVideoPath);
				diagnostics.interactionVideo = targetVideoPath;
			}
		}
		fs.rmSync(videoTempDir, { recursive: true, force: true });

		// =========================================================================
		// GATE F.3: Touch-Only Mobile (390x844), Tab No-Refetch, Keyboard & Escape
		// =========================================================================
		console.log('\n=== Gate F.3: Touch-Only Mobile Sheet, Tab No-Refetch, Keyboard & Escape Stack ===');
		const touchCtx = await browser.newContext({
			viewport: { width: 390, height: 844 },
			hasTouch: true,
			isMobile: true,
		});
		const touchPage = await touchCtx.newPage();
		let mobileTleCount = 0;
		let mobileAnalyzeCount = 0;
		touchPage.on('request', (req) => {
			if (req.url().includes('/api/tles')) mobileTleCount++;
			if (req.url().includes('/api/analyze') && req.method() === 'POST') mobileAnalyzeCount++;
		});
		await touchPage.route(`${API_BASE_URL}/api/analyze`, (route) =>
			route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'ux_stub' }) }),
		);

		// Capture matched mobile Near me screenshot first
		await touchPage.goto(`${FRONTEND_URL}?view=near-me`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
		await touchPage.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await touchPage.locator('[data-testid="manual-coords-disclosure"]').tap();
		await touchPage.locator('[data-testid="manual-coords-input"]').fill('59.9139, 10.7522');
		await touchPage.locator('[data-testid="apply-coords-btn"]').tap();
		await touchPage.locator('[data-testid="warnings-coverage-banner"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await touchPage.screenshot({ path: path.join(EVIDENCE_DIR, 'after-near-me-390x844.png') });

		// Switch to Explore on 390x844 touch device
		await touchPage.locator('[data-testid="nav-explore-events"]').tap();
		await waitForMapReady(touchPage);

		// Capture matched mobile Archive screenshot
		await touchPage.locator('[data-testid="open-timeline-drawer-btn"]').tap();
		await touchPage.locator('[data-testid="timeline-analytics-drawer"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await touchPage.waitForTimeout(400);
		await touchPage.screenshot({ path: path.join(EVIDENCE_DIR, 'after-archive-390x844.png') });
		await touchPage.locator('[data-testid="close-timeline-drawer-btn"]').tap();

		const mobilePair = await pickTwoDistinctMapCandidates(touchPage);
		if (mobilePair.length >= 2) {
			const pt1 = await centerAndProjectCandidate(touchPage, mobilePair[0], 5.0);
			await touchPage.touchscreen.tap(pt1.x, pt1.y);
			await touchPage.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			await touchPage.waitForTimeout(550);

			const mobilePeekGeometry = await touchPage.evaluate(() => {
				const pop = document.querySelector('[data-testid="pinned-disaster-popup"]')?.getBoundingClientRect();
				const sheet = document.querySelector('[data-testid="sidebar"]')?.getBoundingClientRect();
				const sheetState = document.querySelector('[data-testid="sidebar"]')?.getAttribute('data-sheet-state');
				return {
					popupCount: document.querySelectorAll('.mapboxgl-popup').length,
					sheetState,
					popBottom: pop ? Math.round(pop.bottom) : null,
					popTop: pop ? Math.round(pop.top) : null,
					sheetTop: sheet ? Math.round(sheet.top) : null,
				};
			});
			checks.record(
				mobilePeekGeometry.popupCount === 1 &&
					mobilePeekGeometry.sheetState === 'peek' &&
					mobilePeekGeometry.popBottom !== null &&
					mobilePeekGeometry.sheetTop !== null &&
					mobilePeekGeometry.popBottom <= mobilePeekGeometry.sheetTop + 4,
				'Mobile touch tap pins bubble in unobstructed map space above collapsed peek sheet',
				JSON.stringify(mobilePeekGeometry),
			);
			await touchPage.screenshot({ path: path.join(EVIDENCE_DIR, 'after-explore-selected-390x844.png') });

			// Wait for initial pass + Open-Meteo weather + /api/analyze cycle to settle, then verify switching tabs + sheet expand + theme causes ZERO duplicate fetches
			await touchPage.waitForFunction(
				() => {
					const st = document.querySelector('[data-testid="sidebar"]')?.getAttribute('data-analysis-state') || '';
					return ['ready', 'no-pass', 'blocked-orbit'].includes(st) || st.startsWith('error-');
				},
				undefined,
				{ timeout: STEP_TIMEOUT },
			);
			const tleBeforeTabs = mobileTleCount;
			const analyzeBeforeTabs = mobileAnalyzeCount;

			await touchPage.locator('[data-testid="inspector-tab-imagery"]').tap();
			await touchPage.locator('[data-testid="inspector-tab-passes"]').tap();
			await touchPage.locator('[data-testid="inspector-tab-overview"]').tap();
			await touchPage.locator('[data-testid="sheet-expand-toggle"]').tap();
			await touchPage.locator('[data-testid="theme-toggle-btn"]').tap();
			await touchPage.locator('[data-testid="theme-toggle-btn"]').tap();
			await touchPage.waitForTimeout(350);

			checks.record(
				mobileTleCount === tleBeforeTabs && mobileAnalyzeCount === analyzeBeforeTabs,
				'Switching inspector tabs, toggling bottom-sheet height, and toggling theme trigger zero duplicate TLE/AI fetches',
				`tle=${mobileTleCount - tleBeforeTabs} analyze=${mobileAnalyzeCount - analyzeBeforeTabs}`,
			);

			// Keyboard selection via MapLegend event list + 10 rapid selections leak check + Escape topmost stack
			await touchPage.locator('[data-testid="expand-legend-btn"]').click();
			await touchPage.locator('[data-testid="legend-event-list-toggle"]').click();
			const itemButtons = touchPage.locator('[data-testid^="legend-event-item-"]');
			const itemCount = await itemButtons.count();
			const loops = Math.min(10, itemCount);
			for (let i = 0; i < loops; i++) {
				await itemButtons.nth(i).focus();
				await touchPage.keyboard.press('Enter');
			}
			const popupsAfterRapidLoop = await touchPage.locator('.mapboxgl-popup').count();
			checks.record(
				loops >= 2 && popupsAfterRapidLoop <= 1,
				'Keyboard event-list selection and repeated rapid selections leave <= 1 popup in DOM',
				`loops=${loops} popups=${popupsAfterRapidLoop}`,
			);

			// Topmost Escape stack: open Archive -> Escape closes Archive (keeping selection) -> Escape deselects event
			await touchPage.locator('[data-testid="open-timeline-drawer-btn"]').click();
			await touchPage.locator('[data-testid="timeline-analytics-drawer"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			await touchPage.keyboard.press('Escape');
			await touchPage.locator('[data-testid="timeline-analytics-drawer"]').waitFor({ state: 'hidden', timeout: STEP_TIMEOUT });
			const stillSelectedAfterArchiveEsc = await touchPage.locator('[data-testid="sidebar"]').count();
			checks.record(stillSelectedAfterArchiveEsc === 1, 'First Escape closes Archive modal without losing selected map event');

			await touchPage.keyboard.press('Escape');
			const selectedAfterSecondEsc = await touchPage.locator('[data-testid="sidebar"]').count();
			const popupsAfterSecondEsc = await touchPage.locator('.mapboxgl-popup').count();
			checks.record(
				selectedAfterSecondEsc === 0 && popupsAfterSecondEsc === 0,
				'Second Escape cleanly deselects map event and removes pinned bubble',
			);
		}
		await touchCtx.close();

		// =========================================================================
		// GATE F.4 & F.5: Resident No-Leakage, Unbroken 72-char SAR ID & 40-Row Archive
		// =========================================================================
		console.log('\n=== Gate F.4 & F.5: Resident No-Config-Leakage, 72-Char SAR ID at 320px & Archive Scroll/Playback ===');
		const stressCtx = await browser.newContext({ viewport: { width: 320, height: 568 } });
		const sp = await stressCtx.newPage();

		// Inject unavailable subscription status with internal env name in backend reason to prove UI scrubs it
		await sp.route(`${API_BASE_URL}/api/v1/subscriptions/status`, (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					available: false,
					mode: 'unavailable',
					smsAvailable: false,
					reason: 'RESEND_API_KEY and AEGIS_DB missing (sms_deferred 501)',
				}),
			}),
		);

		const longSarId = 'S1A_IW_GRDH_1SDV_20261126T174211_20261126T174236_056728_06F5A2_9F4B_SUPERLONGTOKEN';
		await sp.route(`${API_BASE_URL}/api/v1/sar-scenes**`, (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					version: 1,
					cached: false,
					nextToken: null,
					scenes: [
						{
							id: longSarId,
							datetime: '2026-11-26T17:42:11Z',
							instrumentMode: 'IW',
							polarizations: ['VV', 'VH'],
							orbitState: 'ascending',
							incidenceAngleDeg: 38.4,
							bbox: [10.12, 59.41, 11.45, 60.22],
							copernicusBrowserUrl: 'https://browser.dataspace.copernicus.eu/',
							stacItemUrl: 'https://catalogue.dataspace.copernicus.eu/',
						},
						{
							id: 'S1B_UNKNOWN_DATE_SCENE',
							datetime: '',
							instrumentMode: 'EW',
							polarizations: [],
							orbitState: null,
							incidenceAngleDeg: null,
							bbox: [10.0, 59.0, 11.0, 60.0],
							copernicusBrowserUrl: 'https://browser.dataspace.copernicus.eu/',
							stacItemUrl: 'https://catalogue.dataspace.copernicus.eu/',
						},
					],
				}),
			}),
		);

		const fortyArchiveEvents = Array.from({ length: 40 }, (_, idx) => ({
			id: `arch-stress-${idx + 1}`,
			upstreamId: `stress-ev-${idx + 1}`,
			type: idx % 3 === 0 ? 'fire' : idx % 3 === 1 ? 'earthquake' : 'volcano',
			title: `Archived Observation #${idx + 1} — Extended Multi-Clause Regional Hazard Bulletin Name`,
			lat: 35.68 + idx * 0.05,
			lng: 51.38 + idx * 0.05,
			eventTime: '2026-11-25T12:30:00Z',
			firstSeenAt: '2026-11-25T12:35:00Z',
			severity: idx % 2 === 0 ? 'high' : 'medium',
			magnitude: idx % 3 === 1 ? 5.6 : null,
			areaAcres: idx % 3 === 0 ? 18400 : null,
			provenance: idx % 2 === 0 ? 'live_captured' : 'reconstructed_backfill',
			attribution: 'USGS / NASA EONET',
			gdacsMatchId: idx === 0 ? '1009981' : null,
			revisions: [
				{ revisionNumber: 1, observedAt: '2026-11-25T12:35:00Z', title: 'Initial report', severity: 'medium' },
				{ revisionNumber: 2, observedAt: '2026-11-25T14:10:00Z', title: 'Updated report', severity: 'high' },
			],
		}));
		await sp.route(`${API_BASE_URL}/api/v1/history**`, (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ version: 1, storageAvailable: true, events: fortyArchiveEvents }),
			}),
		);
		await sp.route(`${API_BASE_URL}/api/analyze`, (route) =>
			route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'ux_stub' }) }),
		);

		await sp.goto(`${FRONTEND_URL}?view=near-me`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
		// Before country confirmation, emergency contacts should NOT show verified green border
		const unconfirmedJurisdictionVal = await sp.locator('[data-testid="present-jurisdiction-select"]').inputValue();
		checks.record(unconfirmedJurisdictionVal === '', 'Present physical country starts unconfirmed until resident chooses');

		// Set present country to MY, then select Oslo (NO) -> present country must stay MY!
		await sp.locator('[data-testid="present-jurisdiction-select"]').selectOption('MY');
		await sp.locator('[data-testid="manual-coords-disclosure"]').click();
		await sp.locator('[data-testid="manual-coords-input"]').fill('59.9139, 10.7522');
		await sp.locator('[data-testid="apply-coords-btn"]').click();
		await sp.locator('[data-testid="subscription-unavailable-banner"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });

		const preservedJurisdiction = await sp.locator('[data-testid="present-jurisdiction-select"]').inputValue();
		const nearMeBodyText = await sp.evaluate(() => document.body.innerText);
		checks.record(
			preservedJurisdiction === 'MY',
			'Selecting monitored place (Oslo, NO) never silently overwrites confirmed present country (MY)',
			preservedJurisdiction,
		);
		checks.record(
			!/RESEND_API_KEY|AEGIS_DB|sms_deferred/.test(nearMeBodyText),
			'Resident UI scrubs operator environment/binding identifiers (RESEND_API_KEY, AEGIS_DB, sms_deferred)',
		);

		// Navigate to Explore -> test browser Back/Forward under /aegis-map/
		await sp.locator('[data-testid="nav-explore-events"]').click();
		await waitForMapReady(sp);
		await sp.goBack();
		await sp.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await sp.goForward();
		await waitForMapReady(sp);
		checks.record(true, 'Browser Back and Forward navigate cleanly between Near me and Explore under /aegis-map/');

		// Open 40-row Archive -> start playback -> scroll list -> verify controls stay fixed -> inspect item -> verify playback stops
		await sp.locator('[data-testid="open-timeline-drawer-btn"]').click();
		await sp.locator('[data-testid="timeline-analytics-drawer"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await sp.locator('[data-testid="archive-play-toggle-btn"]').click();
		const barBeforeScroll = await sp.locator('[data-testid="archive-playback-bar"]').boundingBox();
		await sp.evaluate(() => {
			const body = document.querySelector('[data-testid="archive-scroll-body"]');
			if (body) body.scrollTop = 320;
		});
		const barAfterScroll = await sp.locator('[data-testid="archive-playback-bar"]').boundingBox();
		checks.record(
			Boolean(barBeforeScroll && barAfterScroll && Math.abs(barBeforeScroll.y - barAfterScroll.y) <= 1),
			'40-row Archive scrolls records list independently while header/tabs/playback bar remain fixed',
		);

		await sp.locator('[data-testid="inspect-archive-arch-stress-1"]').click();
		await sp.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await sp.locator('[data-testid="inspector-tab-imagery"]').click();
		await sp.locator(`[data-testid="sar-scene-${longSarId}"]`).waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await sp.locator(`[data-testid="sar-scene-${longSarId}"] details summary`).click();

		const sar320Overflow = await sp.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			innerWidth: window.innerWidth,
			hasUnknownDateFallback: document.body.innerText.includes('Unknown acquisition date'),
		}));
		checks.record(
			sar320Overflow.scrollWidth <= sar320Overflow.innerWidth && sar320Overflow.hasUnknownDateFallback,
			'72-char unbroken SAR scene ID inside Details + unknown acquisition date cause zero horizontal overflow at 320px',
			JSON.stringify(sar320Overflow),
		);

		// Re-open Archive to confirm playback stopped when drawer closed
		await sp.locator('[data-testid="open-timeline-drawer-btn"]').click();
		const playingAttrOnReopen = await sp.locator('[data-testid="timeline-analytics-drawer"]').getAttribute('data-playing');
		checks.record(playingAttrOnReopen === 'false', 'Archive playback stops cleanly when dialog closes', playingAttrOnReopen || '');
		await stressCtx.close();

		// =========================================================================
		// GATE F.6: Service Worker Upgrade (v1.5.0 -> v1.5.2) & Offline Navigation
		// =========================================================================
		console.log('\n=== Gate F.6: Service Worker Upgrade & Offline Shell Verification ===');
		const initialServeDir =
			SW_BASELINE_DIST && fs.existsSync(SW_BASELINE_DIST) ? SW_BASELINE_DIST : FRONTEND_DIST;
		const usedBaselineUpgrade = initialServeDir !== FRONTEND_DIST;
		const swServer = await startSwitchableBaseServer(initialServeDir);

		try {
			const swCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
			const swPage = await swCtx.newPage();
			await swPage.goto(`${swServer.url}?view=near-me`, { waitUntil: 'networkidle', timeout: STEP_TIMEOUT });
			await swPage.evaluate(() => navigator.serviceWorker?.ready);
			await swPage.waitForTimeout(500);

			const initialSwState = await swPage.evaluate(async () => ({
				caches: await caches.keys(),
				cardPaddingTop: parseFloat(
					window.getComputedStyle(
						document.querySelector('[aria-labelledby="place-selector-heading"]')?.closest('section') ||
							document.body,
					).paddingTop,
				),
			}));

			if (usedBaselineUpgrade) {
				swServer.setRoot(FRONTEND_DIST);
				await swPage.reload({ waitUntil: 'networkidle', timeout: STEP_TIMEOUT });
				// Wait for new service worker to install, skipWaiting, activate, and delete old cache
				await swPage.waitForFunction(
					async () => {
						const keys = await caches.keys();
						return keys.some((k) => k.includes('v1.5.2')) && !keys.includes('aegis-shell-v1.5.0');
					},
					undefined,
					{ timeout: 15000 },
				);
				// Reload once more under the newly claimed controller to confirm atomic HTML + CSS pairing
				await swPage.reload({ waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
				await swPage.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			}

			const upgradedSwState = await swPage.evaluate(async () => ({
				caches: await caches.keys(),
				hasController: Boolean(navigator.serviceWorker?.controller),
				cardPaddingTop: parseFloat(
					window.getComputedStyle(
						document.querySelector('[aria-labelledby="place-selector-heading"]')?.closest('section') ||
							document.body,
					).paddingTop,
				),
			}));
			diagnostics.swUpgrade = { usedBaselineUpgrade, initialSwState, upgradedSwState };

			checks.record(
				upgradedSwState.caches.includes('aegis-shell-v1.5.2') &&
					!upgradedSwState.caches.includes('aegis-shell-v1.5.0') &&
					upgradedSwState.cardPaddingTop >= 16,
				usedBaselineUpgrade
					? 'Live SW upgrade (v1.5.0 -> v1.5.2) purged stale cache and paired new HTML + Tailwind v4 CSS cleanly'
					: 'Fresh SW install activated aegis-shell-v1.5.2 with full Tailwind v4 CSS',
				JSON.stringify(upgradedSwState),
			);

			// Offline navigation check
			await swCtx.setOffline(true);
			await swPage.goto(`${swServer.url}?view=near-me`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
			await swPage.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			checks.record(true, 'Offline navigation to /aegis-map/?view=near-me succeeds from Service Worker shell cache');
			await swCtx.close();
		} finally {
			await swServer.close();
		}

		fs.writeFileSync(path.join(EVIDENCE_DIR, 'after-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
	} finally {
		await browser.close();
	}

	console.log(
		`\n=== Responsive UX Verification Summary: ${checks.items.length - checks.failed.length}/${checks.items.length} passed ===`,
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
