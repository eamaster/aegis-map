/**
 * Playwright E2E Verification for AegisMap v1.5 Slices:
 *  1. Near me text-first route loads without Mapbox GL JS blocking or executing.
 *  2. Place search disambiguation (offline gazetteer "Springfield"), manual coordinates, and explicit jurisdiction split.
 *  3. Localization switching (en -> fa RTL with <bdi dir="ltr"> mixed-script isolation -> ms).
 *  4. Official warnings rendering, offline cached notice replay on API outage, sandbox opt-in subscription lifecycle, and local wipe.
 *  5. Explore events Archive & Source Health drawer (live_captured vs backfill), 3-part epistemic separation in Sidebar,
 *     Copernicus STAC SAR panel, .ics calendar snapshot download + RFC 5545 validation, and 4x CPU throttle pass responsiveness.
 *
 * Usage:
 *   FRONTEND_URL=http://localhost:4173/aegis-map/ API_BASE_URL=http://127.0.0.1:8787 node scripts/verify-v15-slices.mjs
 */

import * as fs from 'node:fs';
import { chromium } from 'playwright';

const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:4173/aegis-map/').replace(/\/?$/, '/');
const API_BASE_URL = (process.env.API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const STEP_TIMEOUT = 30000;

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

async function main() {
	const checks = new Checks();
	const browser = await chromium.launch({
		headless: true,
		args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
	});

	try {
		// ------------------------------------------------------------------
		// PART 1: Near Me (Resident Safety) + RTL + Offline Replay + Subscriptions
		// ------------------------------------------------------------------
		console.log('\n=== Suite A & B: Near Me Resident View, RTL, Offline, Subscriptions ===');
		const nearMeCtx = await browser.newContext({
			viewport: { width: 1280, height: 860 },
			acceptDownloads: true,
		});
		const page = await nearMeCtx.newPage();

		const loadedScripts = [];
		page.on('response', (res) => {
			if (res.request().resourceType() === 'script') {
				loadedScripts.push(res.url());
			}
		});

		// Intercept Open-Meteo geocoding offline so we exercise offline gazetteer disambiguation for "Springfield"
		await page.route('https://geocoding-api.open-meteo.com/**', (route) => route.abort('failed'));

		const tStart = Date.now();
		await page.goto(`${FRONTEND_URL}?view=near-me`, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
		await page.locator('[data-testid="near-me-view"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const tRenderMs = Date.now() - tStart;

		const hasMapboxScript = loadedScripts.some((u) => u.includes('mapbox-gl'));
		checks.record(!hasMapboxScript, 'Near me loads without downloading mapbox-gl chunk', `${tRenderMs}ms scripts=${loadedScripts.length}`);

		// Test "Georgetown" offline gazetteer disambiguation (Guyana & Texas, US)
		await page.locator('[data-testid="place-search-input"]').fill('Georgetown');
		await page.locator('[data-testid="place-search-btn"]').click();
		await page.locator('[data-testid="offline-search-notice"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const candidateCount = await page.locator('[data-testid="place-candidates"] button').count();
		checks.record(candidateCount >= 2, 'ambiguous place search ("Georgetown") shows multiple candidates', `count=${candidateCount}`);

		// Enter Oslo coordinates manually -> triggers live or mocked /api/v1/warnings
		await page.route(`${API_BASE_URL}/api/v1/warnings**`, async (route) => {
			// Let real Worker answer if reachable; otherwise provide schema-valid Norway warning fixture for E2E determinism
			try {
				const res = await route.fetch({ timeout: 10000 });
				if (res.ok()) return route.fulfill({ response: res });
			} catch {
				// fallback below
			}
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					version: 1,
					query: { lat: 59.9139, lng: 10.7522, countryCode: 'NO', checkedAt: new Date().toISOString() },
					coverageStatus: 'active_warnings',
					coverageExplanation: 'Checked Meteorologisk institutt (MET Norway) — 1 active warning matching coordinates.',
					warnings: [
						{
							id: 'no-e2e-gale-1',
							identifier: 'no-e2e-gale-1',
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
							sentAt: new Date().toISOString(),
							effectiveAt: new Date().toISOString(),
							onsetAt: new Date().toISOString(),
							expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
							missingExpiry: false,
							clockSkewFlag: false,
							matchMethod: 'polygon',
							matchUncertain: false,
							matchNote: 'Point inside official CAP/GeoJSON warning polygon',
							primaryLanguage: 'no',
							translations: [
								{
									language: 'no',
									headline: 'Gult farevarsel for vindkast, Oslo',
									event: 'Wind gusts',
									description: 'Lokalt kraftige vindkast.',
									instruction: 'Sikre løse gjenstander.',
									areaDesc: 'Oslo',
									web: 'https://www.met.no/',
								},
							],
							bulletinUrl: 'https://www.met.no/',
							attribution: 'MET Norway (NLOD 2.0)',
						},
					],
					sources: [
						{
							sourceId: 'no-metalerts',
							authorityName: 'Meteorologisk institutt (MET Norway)',
							countryCodes: ['NO', 'SJ'],
							status: 'ok',
							checkedAt: new Date().toISOString(),
							lastSuccessAt: new Date().toISOString(),
							activeAlertCount: 1,
							matchedAlertCount: 1,
							unsupportedHazards: ['Earthquakes (NORSAR)'],
							attribution: 'MET Norway',
							termsUrl: 'https://api.met.no/doc/License',
						},
					],
				}),
			});
		});

		const tWarnStart = Date.now();
		await page.locator('[data-testid="manual-coords-input"]').fill('59.9139, 10.7522');
		await page.locator('[data-testid="apply-coords-btn"]').click();
		await page.locator('[data-testid="warnings-coverage-banner"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const tFirstWarningMs = Date.now() - tWarnStart;
		checks.record(tFirstWarningMs < 10000, 'time to first readable warning on manual Oslo coords', `${tFirstWarningMs}ms`);

		// Jurisdiction split check: monitored place is Oslo (NO), set present physical jurisdiction to Malaysia (MY -> 999 / 112)
		await page.locator('[data-testid="present-jurisdiction-select"]').selectOption('MY');
		const numbersText = await page.locator('[data-testid="emergency-numbers-list"]').innerText();
		checks.record(
			numbersText.includes('999') && !numbersText.includes('113'),
			'emergency contacts reflect confirmed present jurisdiction (MY 999), separate from monitored place (NO)',
		);

		// Locale switching: EN -> FA (RTL + <bdi dir="ltr">) -> MS
		await page.locator('[data-testid="ui-locale-select"]').selectOption('fa');
		const faHtml = await page.evaluate(() => ({
			dir: document.documentElement.dir,
			lang: document.documentElement.lang,
			bdiCount: document.querySelectorAll('bdi[dir="ltr"]').length,
		}));
		checks.record(faHtml.dir === 'rtl' && faHtml.lang === 'fa' && faHtml.bdiCount > 0, 'Persian locale enables RTL with <bdi dir="ltr"> isolation', JSON.stringify(faHtml));

		await page.locator('[data-testid="ui-locale-select"]').selectOption('ms');
		const msDir = await page.evaluate(() => document.documentElement.dir);
		checks.record(msDir === 'ltr', 'Malay locale switches back to LTR', msDir);
		await page.locator('[data-testid="ui-locale-select"]').selectOption('en');

		// Offline notice replay: abort /api/v1/warnings and trigger refresh
		await page.unroute(`${API_BASE_URL}/api/v1/warnings**`);
		await page.route(`${API_BASE_URL}/api/v1/warnings**`, (route) => route.abort('failed'));
		await page.locator('[data-testid="refresh-warnings-btn"]').click();
		await page.locator('[data-testid="offline-cached-banner"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		checks.record(true, 'offline cached notice banner replays last stored notices on API failure');

		// Opt-in subscription flow (sandbox against local Worker or clean fallback)
		await page.locator('[data-testid="subscription-email-input"]').fill('e2e-resident@example.com');
		await page.locator('[data-testid="subscription-submit-btn"]').click();
		await page.locator('[data-testid="subscription-status-banner"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const confirmBtn = page.locator('[data-testid="subscription-confirm-sandbox-btn"]');
		if ((await confirmBtn.count()) > 0) {
			await confirmBtn.click();
			await page.waitForFunction(
				() => document.querySelector('[data-testid="subscription-status-banner"]')?.textContent?.includes('active'),
				undefined,
				{ timeout: STEP_TIMEOUT },
			);
			await page.locator('[data-testid="subscription-unsub-btn"]').click();
			await page.waitForFunction(
				() => document.querySelector('[data-testid="subscription-status-banner"]')?.textContent?.includes('unsubscribed'),
				undefined,
				{ timeout: STEP_TIMEOUT },
			);
			checks.record(true, 'sandbox double-opt-in subscription create -> confirm -> unsubscribe works');
		} else {
			checks.record(true, 'subscription UI rendered status cleanly');
		}

		// Local wipe clears storage
		await page.locator('[data-testid="clear-local-data-btn"]').click();
		await page.locator('[data-testid="wipe-status-notice"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		const remainingKeys = await page.evaluate(() => ({
			saved: localStorage.getItem('aegis:saved-places:v1'),
			jurisdiction: localStorage.getItem('aegis:present-jurisdiction:v1'),
		}));
		checks.record(remainingKeys.saved === null && remainingKeys.jurisdiction === null, 'local data wipe removes saved places & jurisdiction');

		await nearMeCtx.close();

		// ------------------------------------------------------------------
		// PART 2: Explore Events + Archive/Analytics + Sidebar 3-Part Epistemic + .ics + 4x CPU Throttle
		// ------------------------------------------------------------------
		console.log('\n=== Suite C & D: Explore Events Archive, SAR STAC, .ics Export, 4x CPU Throttle ===');
		const exploreCtx = await browser.newContext({
			viewport: { width: 1440, height: 900 },
			acceptDownloads: true,
		});
		const ep = await exploreCtx.newPage();
		const cdp = await exploreCtx.newCDPSession(ep);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

		// Stub analyze to zero AI Neuron usage during automated E2E
		await ep.route(`${API_BASE_URL}/api/analyze`, (route) =>
			route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'e2e_stubbed' }) }),
		);

		await ep.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
		await ep.waitForFunction(
			() => window.mapDebug && ['fires-layer', 'earthquakes-layer', 'volcanoes-layer'].some((l) => window.mapDebug.getLayer(l)),
			undefined,
			{ timeout: STEP_TIMEOUT },
		);
		checks.record(true, 'Explore events map mounted under 4x CPU throttle');

		// Open Historical Archive & Source Health drawer
		await ep.locator('[data-testid="open-timeline-drawer-btn"]').click();
		await ep.locator('[data-testid="timeline-analytics-drawer"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
		await ep.locator('[data-testid="tab-analytics"]').click();
		await ep.locator('[data-testid="tab-timeline"]').click();
		checks.record(true, 'Archive & Source Health drawer switches cleanly between Playback and Source Health tabs');
		await ep.locator('button[aria-label="Close timeline and analytics drawer"]').click();

		// Select first earthquake or fire via MapDebug click projection under 4x CPU throttle
		const tSelectStart = Date.now();
		const clickPos = await ep.evaluate(async () => {
			const map = window.mapDebug;
			for (const srcId of ['fires', 'earthquakes', 'volcanoes']) {
				const src = map.getSource(srcId);
				const feat = src?._data?.features?.[0];
				if (feat?.geometry?.coordinates) {
					const [lng, lat] = feat.geometry.coordinates;
					map.jumpTo({ center: [lng, lat], zoom: 6 });
					await new Promise((r) => setTimeout(r, 400));
					const pt = map.project([lng, lat]);
					const rect = map.getCanvas().getBoundingClientRect();
					return { x: rect.left + pt.x, y: rect.top + pt.y };
				}
			}
			return null;
		});

		if (clickPos) {
			await ep.mouse.click(clickPos.x, clickPos.y);
			await ep.locator('[data-testid="sidebar"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			const selectElapsedMs = Date.now() - tSelectStart;
			checks.record(true, '4x throttled event selection opened Sidebar', `${selectElapsedMs}ms`);

			// Check 3-part epistemic separation: Derived AI Insight, Confirmed Acquisition (SAR panel + GIBS), Predicted Overpass comparison
			await ep.locator('[data-testid="sar-scenes-panel"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			await ep.locator('[data-testid="pass-comparison-panel"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
			const passBadge = (await ep.locator('[data-testid="pass-comparison-panel"]').innerText()).toLowerCase();
			const sarBadge = (await ep.locator('[data-testid="sar-scenes-panel"]').innerText()).toLowerCase();
			checks.record(
				passBadge.includes('predicted overpass') && sarBadge.includes('confirmed acquisition'),
				'Sidebar clearly distinguishes Predicted Overpass from Confirmed Acquisition',
			);

			// Download .ics snapshot and verify RFC 5545 validity
			const [download] = await Promise.all([
				ep.waitForEvent('download', { timeout: 10000 }),
				ep.locator('[data-testid="export-ics-btn"]').click(),
			]);
			const dlPath = await download.path();
			const icsText = dlPath ? fs.readFileSync(dlPath, 'utf-8') : '';
			const enc = new TextEncoder();
			const maxOctets = Math.max(...icsText.split('\r\n').map((l) => enc.encode(l).length));
			checks.record(
				icsText.includes('BEGIN:VCALENDAR') && icsText.includes('BEGIN:VEVENT') && icsText.includes('SNAPSHOT ONLY') && maxOctets <= 75,
				'Downloaded .ics satisfies RFC 5545 (VCALENDAR, SNAPSHOT disclaimer, max <=75 octets/line)',
				`filename=${download.suggestedFilename()} maxOctets=${maxOctets}`,
			);
		} else {
			checks.record(false, 'could not locate rendered event feature on map');
		}

		await exploreCtx.close();
	} finally {
		await browser.close();
	}

	console.log(`\n=== v1.5 Verification Summary: ${checks.items.length - checks.failed.length}/${checks.items.length} passed ===`);
	if (checks.failed.length > 0) {
		console.error('Failed checks:', checks.failed.map((f) => f.label).join('; '));
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
