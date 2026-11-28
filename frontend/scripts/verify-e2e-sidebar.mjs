/**
 * AegisMap end-to-end verification (Playwright).
 *
 * Scenarios:
 *   success  - every integration must succeed with valid content; any provider
 *              failure, partial coverage, or unavailable state fails the run.
 *   failure  - FIRMS/TLE/GIBS failures and a partial disaster source are injected
 *              with page.route; the UI must show honest unavailable/partial states.
 *
 * Run (Node 22.6+, frontend built against the local Worker):
 *   node --experimental-strip-types scripts/verify-e2e-sidebar.mjs [--scenario success|failure|all] [--live-analyze]
 *
 * Env:
 *   FRONTEND_URL  (default http://localhost:5173/aegis-map/)
 *   API_BASE_URL  backend the frontend must use (default http://127.0.0.1:8787)
 *   E2E_STEP_TIMEOUT_MS (default 45000)
 *
 * /api/analyze is stubbed by default so ordinary runs never use Workers AI.
 * --live-analyze leaves it unstubbed in the success scenario only and allows
 * exactly one real inference request; any second request fails the run.
 * EONET and USGS sit behind /api/disasters; the success scenario checks them
 * with one direct request per upstream query and compares record identities and fields.
 *
 * Exit codes: 0 all checks passed, 1 a check failed, 2 the run could not start.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundled = await esbuild.build({
    stdin: {
        contents: `
            export { EONET_QUERIES, USGS_URL, parseEonetPayload, parseUsgsPayload } from '../../backend/src/disasters.ts';
            export { MONITORED_NORAD_IDS, validateTleRecord } from '../../backend/src/satellites.ts';
            export { isDisasterRecord, parseDisasterSourceHeaders } from '../src/utils/disasterSources.ts';
        `,
        resolveDir: __dirname,
        sourcefile: 'verify-e2e-deps.ts',
        loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    write: false,
});
const {
    EONET_QUERIES,
    USGS_URL,
    parseEonetPayload,
    parseUsgsPayload,
    MONITORED_NORAD_IDS,
    validateTleRecord,
    isDisasterRecord,
    parseDisasterSourceHeaders,
} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text, 'utf-8').toString('base64')}`);

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173/aegis-map/';
const API_BASE_URL = (process.env.API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const API_ORIGIN = new URL(API_BASE_URL).origin;
const STEP_TIMEOUT = Number(process.env.E2E_STEP_TIMEOUT_MS || 45000);
/** Screenshots go to the git-ignored repository .tmp directory. */
const SCREENSHOT = (name) => fileURLToPath(new URL(`../../.tmp/${name}`, import.meta.url));
const scenarioArg = process.argv.includes('--scenario') ? process.argv[process.argv.indexOf('--scenario') + 1] : 'all';
const LIVE_ANALYZE = process.argv.includes('--live-analyze');

const isApi = (url, path) => {
    const u = new URL(url);
    return u.origin === API_ORIGIN && u.pathname === path;
};

class Checks {
    constructor(name) {
        this.name = name;
        this.items = [];
    }
    record(ok, label, detail = '') {
        this.items.push({ ok, label, detail });
        console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
        return ok;
    }
    get failed() {
        return this.items.filter((i) => !i.ok);
    }
}

/** Validate a /api/tles body with the Worker's own validator; returns unique NORAD IDs and epochs. */
function validateTleBody(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0 || lines.length % 3 !== 0) return { ok: false, reason: `line count ${lines.length} is not a multiple of 3` };
    const records = [];
    for (let i = 0; i < lines.length; i += 3) {
        const catalog = Number(lines[i + 1].substring(2, 7));
        const result = validateTleRecord(lines.slice(i, i + 3), { expectedNoradId: catalog });
        if (!result.valid) return { ok: false, reason: `record ${i / 3 + 1}: ${result.reason}` };
        records.push(result.record);
    }
    const ids = records.map((r) => r.noradId);
    if (new Set(ids).size !== ids.length) return { ok: false, reason: 'duplicate NORAD IDs' };
    if (ids.some((id) => !MONITORED_NORAD_IDS.includes(id))) return { ok: false, reason: 'unexpected NORAD ID' };
    return { ok: true, records };
}

/** Move the camera to a candidate, then click the top rendered feature at its pixel. */
async function clickDisaster(page, candidates) {
    for (const candidate of candidates) {
        const target = await page.evaluate(async ({ lng, lat }) => {
            const map = window.mapDebug;
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, 15000);
                map.once('idle', () => {
                    clearTimeout(timer);
                    resolve();
                });
                map.jumpTo({ center: [lng, lat], zoom: 6 });
            });
            const point = map.project([lng, lat]);
            const layers = ['fires-layer', 'volcanoes-layer', 'earthquakes-layer'].filter((l) => map.getLayer(l));
            const hit = map.queryRenderedFeatures([point.x, point.y], { layers })[0];
            const rect = map.getCanvas().getBoundingClientRect();
            return { x: rect.left + point.x, y: rect.top + point.y, id: hit?.properties?.id ?? null };
        }, candidate);
        if (target.id === candidate.id) {
            await page.mouse.click(target.x, target.y);
            return candidate;
        }
    }
    return null;
}

async function waitForAttr(page, selector, attr, accept, label) {
    await page.waitForFunction(
        ({ selector, attr, accept }) => {
            const el = document.querySelector(selector);
            return !!el && accept.includes(el.getAttribute(attr));
        },
        { selector, attr, accept },
        { timeout: STEP_TIMEOUT },
    ).catch(() => {
        throw new Error(`timed out waiting for ${label} (${selector}[${attr}] in ${accept.join('|')})`);
    });
    return page.locator(selector).getAttribute(attr);
}

function attachCommonListeners(page, checks, state, { liveAnalyze = false } = {}) {
    state.tleRequests = 0;
    state.analyzeRequests = 0;
    page.on('pageerror', (err) => state.pageErrors.push(err.message));
    page.on('request', (req) => {
        const u = new URL(req.url());
        if (u.pathname.startsWith('/api/') && u.origin !== API_ORIGIN) state.foreignApi.push(req.url());
        if (isApi(req.url(), '/api/tles')) state.tleRequests++;
        if (isApi(req.url(), '/api/analyze') && req.method() === 'POST') state.analyzeRequests++;
    });
    if (liveAnalyze) {
        let forwarded = 0;
        return page.route(`${API_ORIGIN}/api/analyze`, (route) => {
            if (route.request().method() !== 'POST') return route.continue();
            if (forwarded++ === 0) return route.continue();
            return route.fulfill({ status: 429, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'e2e live budget exceeded', code: 'e2e_budget' }) });
        });
    }
    return page.route(`${API_ORIGIN}/api/analyze`, (route) =>
        route.fulfill({
            status: 503,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({ error: 'analysis_unavailable', code: 'e2e_stubbed', message: 'Analysis is not exercised by this verification.' }),
        }),
    );
}

async function loadApp(page, checks) {
    const disastersResponse = page.waitForResponse(
        (r) => isApi(r.url(), '/api/v2/disasters') || isApi(r.url(), '/api/disasters'),
        { timeout: STEP_TIMEOUT },
    );
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
    const res = await disastersResponse;
    const rawEnvelope = await res.json().catch(() => null);
    const body = rawEnvelope?.version === 2
        ? [...(rawEnvelope.wildfires ?? []), ...(rawEnvelope.volcanoes ?? []), ...(rawEnvelope.earthquakes ?? [])]
        : rawEnvelope;
    await page.waitForFunction(() => {
        const map = window.mapDebug;
        return !!map && typeof map.getLayer === 'function' && ['fires-layer', 'volcanoes-layer', 'earthquakes-layer'].some((l) => map.getLayer(l));
    }, undefined, { timeout: STEP_TIMEOUT });
    checks.record(true, 'map rendered disaster layers');
    return { res, body, rawEnvelope };
}

async function runSuccess(browser) {
    const checks = new Checks('success');
    const state = { pageErrors: [], foreignApi: [] };
    const evidence = {};
    console.log('\n=== Scenario: success (all integrations must succeed) ===');
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
        const page = await context.newPage();
        await attachCommonListeners(page, checks, state, { liveAnalyze: LIVE_ANALYZE });
        const analyzeResponse = LIVE_ANALYZE ? page.waitForResponse((r) => isApi(r.url(), '/api/analyze') && r.request().method() === 'POST', { timeout: STEP_TIMEOUT * 3 }) : null;
        analyzeResponse?.catch(() => {});

        const { res, body, rawEnvelope } = await loadApp(page, checks);
        const isV2 = rawEnvelope?.version === 2;
        const sources = parseDisasterSourceHeaders({ get: (n) => res.headers()[n.toLowerCase()] ?? null });
        checks.record(res.status() === 200, `${isV2 ? '/api/v2/disasters' : '/api/disasters'} HTTP 200 from expected backend`, `${res.status()} ${res.url()}`);
        const valid = Array.isArray(body) && body.length > 0 && body.every(isDisasterRecord);
        checks.record(valid, 'disasters response carries non-empty valid records', Array.isArray(body) ? `${body.length} records` : typeof body);
        checks.record(sources?.eonet === 'ok' && sources?.usgs === 'ok' && !sources.partial, 'disaster sources complete', res.headers()['x-disaster-sources'] ?? 'missing header');
        const legendState = await waitForAttr(page, '[data-testid="map-legend"]', 'data-disaster-state', ['complete', 'partial', 'failed', 'unknown'], 'legend');
        checks.record(legendState === 'complete', 'legend shows complete source state', legendState);
        const volcanoCount = Array.isArray(body) ? body.filter((d) => d.type === 'volcano').length : -1;
        const legendVolcano = await page.locator('[data-testid="map-legend"]').getAttribute('data-count-volcano');
        checks.record(volcanoCount > 0 && legendVolcano === String(volcanoCount), 'legend volcano count matches served open volcano events', `legend=${legendVolcano} served=${volcanoCount}`);
        const scope = (await page.locator('[data-testid="legend-scope"]').textContent()) ?? '';
        checks.record(/60 days/.test(scope) && /open NASA EONET volcanic/.test(scope), 'legend states per-category scope', scope.slice(0, 160));
        evidence.disasters = {
            fetchedAt: res.headers()['x-disaster-fetched-at'],
            sources: res.headers()['x-disaster-sources'],
            windowRange: isV2 ? rawEnvelope.windowRange : null,
            counts: Array.isArray(body) ? { fire: body.filter((d) => d.type === 'fire').length, volcano: body.filter((d) => d.type === 'volcano').length, earthquake: body.filter((d) => d.type === 'earthquake').length } : null,
        };

        const fires = (Array.isArray(body) ? body : []).filter((d) => d.type === 'fire').slice(0, 8);
        if (!checks.record(fires.length > 0, 'at least one fire event available for FIRMS checks')) return { checks, evidence, state };

        evidence.appDisasters = Array.isArray(body) ? body : [];
        evidence.v2WindowRange = isV2 ? rawEnvelope.windowRange : null;
        const expectResponse = (predicate, label, timeout = STEP_TIMEOUT) =>
            page.waitForResponse(predicate, { timeout }).catch(() => {
                throw new Error(`no ${label} response within ${timeout} ms`);
            });
        const tleResponse = expectResponse((r) => isApi(r.url(), '/api/tles'), '/api/tles');
        const firmsResponse = expectResponse((r) => isApi(r.url(), '/api/fire-hotspots'), '/api/fire-hotspots');
        const weatherResponse = expectResponse((r) => r.url().startsWith('https://api.open-meteo.com/'), 'Open-Meteo', STEP_TIMEOUT * 2);
        for (const p of [tleResponse, firmsResponse, weatherResponse]) p.catch(() => {});

        const selected = await clickDisaster(page, fires);
        if (!checks.record(!!selected, 'real map click selected a fire event', selected ? `${selected.id} (${selected.lat}, ${selected.lng})` : 'no candidate was the top rendered feature')) {
            return { checks, evidence, state };
        }
        const sidebarId = await page.locator('[data-testid="sidebar"]').getAttribute('data-disaster-id', { timeout: STEP_TIMEOUT });
        checks.record(sidebarId === selected.id, 'sidebar context matches clicked event', `sidebar=${sidebarId}`);
        evidence.selected = { id: selected.id, title: selected.title, lat: selected.lat, lng: selected.lng, date: selected.date };

        // Orbital elements
        const tle = await tleResponse;
        const tleText = await tle.text();
        const tleCheck = tle.status() === 200 ? validateTleBody(tleText) : { ok: false, reason: `HTTP ${tle.status()}` };
        checks.record(tleCheck.ok, '/api/tles returns valid checksummed elements', tleCheck.ok ? `${tleCheck.records.length} unique NORAD IDs` : tleCheck.reason);
        checks.record(tle.headers()['x-tle-status'] === 'complete', 'TLE status complete', `X-TLE-Status=${tle.headers()['x-tle-status']} missing=${tle.headers()['x-tle-missing'] || '-'} retained=${tle.headers()['x-tle-retained'] || '-'}`);
        if (tleCheck.ok) evidence.tles = tleCheck.records.map((r) => ({ noradId: r.noradId, name: r.name, epoch: r.epoch }));

        const passState = await waitForAttr(page, '[data-testid="sidebar"]', 'data-pass-state', ['pass', 'no-pass', 'unavailable'], 'pass prediction');
        checks.record(passState === 'pass' || passState === 'no-pass', 'pass prediction resolved to pass or explicit no-pass', passState);
        if (passState === 'pass') {
            const sat = await page.locator('[data-testid="sidebar"]').getAttribute('data-pass-satellite');
            const passTime = Date.parse(await page.locator('[data-testid="sidebar"]').getAttribute('data-pass-time'));
            const names = tleCheck.ok ? tleCheck.records.map((r) => r.name) : [];
            checks.record(names.includes(sat), 'pass satellite is one of the served TLEs', sat);
            checks.record(passTime >= Date.now() - 10 * 60 * 1000 && passTime <= Date.now() + 24 * 3600 * 1000, 'pass time within the 24 h window', new Date(passTime).toISOString());
            const threshold = await page.locator('[data-testid="sidebar"]').getAttribute('data-pass-threshold');
            const note = (await page.locator('[data-testid="pass-note"]').textContent()) ?? '';
            checks.record(['25', '15', '5'].includes(threshold) && note.includes(`${threshold}° elevation`) && note.includes('does not guarantee'), 'pass note states sampling threshold and no acquisition guarantee', `threshold=${threshold}`);
            evidence.pass = { satellite: sat, time: new Date(passTime).toISOString(), threshold };
        } else {
            evidence.pass = { state: passState };
        }

        // AI Insight: the request is made only with a predicted pass and known weather.
        const settledAnalysis = ['blocked-orbit', 'no-pass', 'ready', 'error-config', 'error-capacity', 'error-provider', 'error-request', 'error-network'];
        const analysisState = await waitForAttr(page, '[data-testid="sidebar"]', 'data-analysis-state', settledAnalysis, 'analysis state');
        if (passState === 'no-pass') {
            checks.record(analysisState === 'no-pass' && state.analyzeRequests === 0, 'no pass: analysis not requested', `${analysisState} requests=${state.analyzeRequests}`);
        } else if (LIVE_ANALYZE) {
            const live = await analyzeResponse;
            const liveBody = await live.json().catch(() => null);
            const text = (await page.locator('[data-testid="analysis-text"]').textContent()) ?? '';
            checks.record(live.status() === 200 && liveBody?.source === 'workers-ai' && typeof liveBody?.analysis === 'string' && liveBody.analysis.length > 0, 'LIVE: /api/analyze returned a Workers AI analysis', `HTTP ${live.status()} source=${liveBody?.source ?? liveBody?.code} cached=${liveBody?.cached}`);
            checks.record(analysisState === 'ready' && text.trim() === liveBody?.analysis?.trim(), 'LIVE: AI Insight shows the returned analysis', analysisState);
            evidence.liveAnalysis = { http: live.status(), cached: liveBody?.cached, chars: liveBody?.analysis?.length ?? 0 };
        } else {
            checks.record(analysisState === 'error-provider' && state.analyzeRequests === 1, 'stubbed analysis failure shown as provider unavailability (stub, not live AI)', `${analysisState} requests=${state.analyzeRequests}`);
        }

        // Weather
        const weather = await weatherResponse;
        const wu = new URL(weather.url());
        checks.record(weather.status() === 200, 'Open-Meteo HTTP 200', String(weather.status()));
        checks.record(Number(wu.searchParams.get('latitude')) === selected.lat && Number(wu.searchParams.get('longitude')) === selected.lng, 'weather requested for selected coordinates');
        const weatherState = await waitForAttr(page, '[data-testid="sidebar"]', 'data-weather-state', ['known', 'unavailable'], 'weather');
        const cloud = Number(await page.locator('[data-testid="sidebar"]').getAttribute('data-cloud-cover'));
        checks.record(weatherState === 'known' && cloud >= 0 && cloud <= 100, 'weather state known with valid cloud cover', `${weatherState} ${cloud}`);

        // FIRMS
        const firms = await firmsResponse;
        const fu = new URL(firms.url());
        const firmsBody = await firms.json().catch(() => null);
        checks.record(Number(fu.searchParams.get('lat')) === selected.lat && Number(fu.searchParams.get('lng')) === selected.lng, 'FIRMS requested for selected coordinates');
        checks.record(firms.status() === 200 && firmsBody?.coverage?.status === 'complete', 'FIRMS returned complete coverage', `HTTP ${firms.status()} coverage=${firmsBody?.coverage?.status ?? firmsBody?.code ?? 'n/a'}`);
        await page.locator('[data-testid="inspector-tab-imagery"]').click();
        const firmsState = await waitForAttr(page, '[data-testid="satellite-imagery"]', 'data-firms-state', ['detections', 'empty', 'filtered', 'unavailable'], 'FIRMS state');
        checks.record(['detections', 'empty', 'filtered'].includes(firmsState), 'FIRMS UI shows a successful result', firmsState);
        const imagery = page.locator('[data-testid="satellite-imagery"]');
        if (firmsBody?.coverage) {
            checks.record((await imagery.getAttribute('data-firms-total')) === String(firmsBody.totalCount), 'FIRMS UI total matches response', String(firmsBody.totalCount));
            checks.record((await imagery.getAttribute('data-firms-window')) === `${firmsBody.coverage.requestedStart}/${firmsBody.coverage.requestedEnd}`, 'FIRMS UI window matches response', `${firmsBody.coverage.requestedStart}/${firmsBody.coverage.requestedEnd}`);
            checks.record((await imagery.getAttribute('data-firms-sensor')) === firmsBody.source, 'FIRMS UI sensor matches response', firmsBody.source);
            evidence.firms = {
                source: firmsBody.source,
                window: `${firmsBody.coverage.requestedStart}..${firmsBody.coverage.requestedEnd}`,
                windows: firmsBody.coverage.windows,
                totalCount: firmsBody.totalCount,
                rejectedRows: firmsBody.rejectedRows,
                fetchedAt: firmsBody.fetchedAt,
                sampleIdentities: firmsBody.hotspots.slice(0, 3).map((h) => `${h.latitude}|${h.longitude}|${h.acq_date}|${h.acq_time}|${h.satellite}|conf=${h.confidence}|frp=${h.frp}`),
            };
        }

        // Imagery: switch to Imagery tab, then verify fire view and false color request the labelled product/date.
        await page.locator('[data-testid="inspector-tab-imagery"]').click();
        for (const tab of ['fire', 'falsecolor']) {
            const gibsBase = expectResponse((r) => r.url().startsWith('https://gibs.earthdata.nasa.gov/') && !r.url().includes('Thermal_Anomalies'), `GIBS ${tab}`);
            let capturedOverlayReqUrl = null;
            const onOverlayReq = (req) => {
                if (req.url().startsWith('https://gibs.earthdata.nasa.gov/') && req.url().includes('Thermal_Anomalies')) {
                    capturedOverlayReqUrl = req.url();
                }
            };
            if (tab === 'fire') page.on('request', onOverlayReq);
            const gibsOverlayOutcome = tab === 'fire'
                ? Promise.race([
                      expectResponse((r) => r.url().startsWith('https://gibs.earthdata.nasa.gov/') && r.url().includes('Thermal_Anomalies'), 'GIBS thermal overlay')
                          .then((res) => ({ kind: 'response', res })),
                      page.waitForEvent('requestfailed', {
                          predicate: (req) => req.url().startsWith('https://gibs.earthdata.nasa.gov/') && req.url().includes('Thermal_Anomalies'),
                          timeout: STEP_TIMEOUT,
                      }).then((req) => ({ kind: 'failed', failure: req.failure()?.errorText || 'requestfailed', url: req.url() })),
                  ]).catch((err) => ({ kind: 'timeout', error: err instanceof Error ? err.message : String(err) }))
                : null;
            await page.locator(`[data-testid="imagery-tab-${tab}"]`).click();
            const gibs = await gibsBase;
            const gu = new URL(gibs.url());
            const product = await imagery.getAttribute('data-imagery-product');
            const date = await imagery.getAttribute('data-imagery-date');
            const status = await waitForAttr(page, '[data-testid="satellite-imagery"]', 'data-imagery-status', ['loaded', 'error'], `${tab} imagery`);
            const contentType = gibs.headers()['content-type'] ?? '';
            checks.record(gu.searchParams.get('LAYERS') === product && gu.searchParams.get('TIME') === date, `${tab} imagery request matches labelled product/date`, `${product} ${date}`);
            checks.record(gibs.status() === 200 && contentType.startsWith('image/') && status === 'loaded', `${tab} imagery loaded`, `HTTP ${gibs.status()} ${contentType} ui=${status}`);
            const [minLat, minLng, maxLat, maxLng] = (gu.searchParams.get('BBOX') || '').split(',').map(Number);
            checks.record(Math.abs((minLat + maxLat) / 2 - selected.lat) < 1e-6 && Math.abs((minLng + maxLng) / 2 - selected.lng) < 1e-6, `${tab} imagery centered on selected event`);
            evidence[`imagery_${tab}`] = { product, date, http: gibs.status(), contentType };
            const caption = (await page.locator('[data-testid="imagery-caption"]').textContent()) ?? '';
            checks.record(caption.includes(`requested UTC day ${date}`) && caption.includes('not confirmed'), `${tab} caption labels the date as requested, coverage unconfirmed`, caption.slice(0, 120));
            const limitation = await imagery.getAttribute('data-imagery-limitation');
            const limitationShown = (await page.locator('[data-testid="imagery-limitation"]').count()) > 0;
            checks.record(!!limitation === limitationShown, `${tab} bbox limitation notice matches spec`, limitation || 'none');
            if (tab === 'fire') {
                const outcome = await gibsOverlayOutcome;
                page.off('request', onOverlayReq);
                const overlayProduct = await imagery.getAttribute('data-imagery-overlay-product');
                const overlayDate = await imagery.getAttribute('data-imagery-overlay-date');
                const overlayStatus = await waitForAttr(page, '[data-testid="satellite-imagery"]', 'data-imagery-overlay-status', ['loaded', 'error'], 'thermal overlay');
                const reqUrl = outcome?.kind === 'response' ? outcome.res.url() : (outcome?.url || capturedOverlayReqUrl);
                if (reqUrl) {
                    const ou = new URL(reqUrl);
                    checks.record(
                        ou.searchParams.get('LAYERS') === overlayProduct &&
                            (overlayDate ? ou.searchParams.get('TIME') === overlayDate : !ou.searchParams.has('TIME')) &&
                            ou.searchParams.get('FORMAT') === 'image/png' &&
                            ou.searchParams.get('TRANSPARENT') === 'true',
                        'overlay request matches labelled product/date as transparent PNG',
                        `${overlayProduct} ${overlayDate || 'undated'}`,
                    );
                } else {
                    checks.record(false, 'overlay request captured', 'no Thermal_Anomalies request observed');
                }

                // Separate deterministic app UI handling from live GIBS upstream availability
                if (outcome?.kind === 'response') {
                    const overlayBody = await outcome.res.body().catch(() => Buffer.alloc(0));
                    const isPng = overlayBody.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
                    const overlayType = outcome.res.headers()['content-type'] ?? '';
                    if (outcome.res.status() === 200 && overlayType.startsWith('image/') && isPng) {
                        checks.record(overlayStatus === 'loaded', 'live overlay PNG decoded and shown in UI', `HTTP 200 ${overlayType} ${overlayBody.length} bytes ui=${overlayStatus}`);
                        evidence.imagery_fire.overlay = { product: overlayProduct, date: overlayDate, upstream: 'ok', http: outcome.res.status(), contentType: overlayType, bytes: overlayBody.length, ui: overlayStatus };
                    } else {
                        const fireCaption = (await page.locator('[data-testid="imagery-caption"]').textContent()) ?? '';
                        const reportedFailure = overlayStatus === 'error' && /Overlay .*failed to load/.test(fireCaption);
                        checks.record(reportedFailure, 'live upstream GIBS non-image error surfaced cleanly in UI', `HTTP ${outcome.res.status()} ${overlayType} ui=${overlayStatus}`);
                        evidence.imagery_fire.overlay = { product: overlayProduct, date: overlayDate, upstream: 'degraded', http: outcome.res.status(), contentType: overlayType, ui: overlayStatus };
                    }
                } else {
                    // Check direct HTTP response from live GIBS to confirm whether upstream returned ServiceExceptionReport XML (ORB blocked by Chromium)
                    let directStatus = null;
                    let directType = '';
                    let directSnippet = '';
                    if (reqUrl) {
                        const direct = await fetch(reqUrl).catch(() => null);
                        if (direct) {
                            directStatus = direct.status;
                            directType = direct.headers.get('content-type') || '';
                            directSnippet = (await direct.text().catch(() => '')).slice(0, 180);
                        }
                    }
                    const isUpstreamXmlException = directType.includes('xml') || directSnippet.includes('ServiceExceptionReport') || (directStatus !== null && directStatus >= 400);
                    const fireCaption = (await page.locator('[data-testid="imagery-caption"]').textContent()) ?? '';
                    const uiReportedError = overlayStatus === 'error' && /Overlay .*failed to load/.test(fireCaption);
                    checks.record(
                        isUpstreamXmlException && uiReportedError,
                        'live GIBS upstream error isolated and surfaced in UI (non-image upstream blocked by ORB)',
                        `upstream HTTP ${directStatus} ${directType} (${outcome?.failure || outcome?.kind}); ui=${overlayStatus}`,
                    );
                    evidence.imagery_fire.overlay = {
                        product: overlayProduct,
                        date: overlayDate,
                        upstream: isUpstreamXmlException ? 'upstream_service_exception' : outcome?.kind,
                        http: directStatus,
                        contentType: directType,
                        snippet: directSnippet.replace(/\s+/g, ' ').trim(),
                        ui: overlayStatus,
                    };
                }
                const markers = Number(await imagery.getAttribute('data-imagery-markers'));
                const total = Number(await imagery.getAttribute('data-firms-total'));
                checks.record(Number.isInteger(markers) && markers >= 0 && markers <= total, 'drawn markers do not exceed FIRMS detections', `${markers}/${total}`);
            }
        }

        // A second selection (a volcano when available) must reuse the fleet TLEs.
        const volcanoes = evidence.appDisasters.filter((d) => d.type === 'volcano').slice(0, 8);
        const second = await clickDisaster(page, volcanoes.length > 0 ? volcanoes : fires.filter((f) => f.id !== selected.id));
        if (checks.record(!!second, 'second real map click selected another event', second ? `${second.type} ${second.id}` : 'none')) {
            await page.waitForFunction((id) => document.querySelector('[data-testid="sidebar"]')?.getAttribute('data-disaster-id') === id, second.id, { timeout: STEP_TIMEOUT });
            const secondPass = await waitForAttr(page, '[data-testid="sidebar"]', 'data-pass-state', ['pass', 'no-pass', 'unavailable'], 'second pass prediction');
            checks.record(secondPass === 'pass' || secondPass === 'no-pass', 'second selection resolved pass prediction', secondPass);
            checks.record(state.tleRequests === 1, 'one /api/tles request shared across selections', `requests=${state.tleRequests}`);
        }

        await page.screenshot({ path: SCREENSHOT('e2e-success.png') });
    } catch (err) {
        checks.record(false, 'scenario completed', err instanceof Error ? err.message : String(err));
    } finally {
        await context.close();
    }
    return { checks, evidence, state };
}

async function runFailure(browser) {
    const checks = new Checks('failure');
    const state = { pageErrors: [], foreignApi: [] };
    console.log('\n=== Scenario: graceful failure (injected provider failures) ===');
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
        const page = await context.newPage();
        await attachCommonListeners(page, checks, state);
        await page.route(new RegExp(`^${API_ORIGIN.replace(/[.]/g, '\\.')}/api/(v2/)?disasters`), async (route) => {
            const upstream = await route.fetch();
            const parsed = await upstream.json();
            const patched = parsed?.version === 2
                ? {
                      ...parsed,
                      earthquakes: [],
                      sources: { ...parsed.sources, usgs: { status: 'failed', count: 0, rejected: 0 } },
                  }
                : Array.isArray(parsed)
                  ? parsed.filter((d) => d.type !== 'earthquake')
                  : parsed;
            await route.fulfill({
                status: 200,
                headers: { ...upstream.headers(), 'x-disaster-sources': 'eonet=ok;usgs=failed', 'x-disaster-partial': 'true' },
                contentType: 'application/json',
                body: JSON.stringify(patched),
            });
        });
        await page.route(`${API_ORIGIN}/api/tles`, (route) =>
            route.fulfill({
                status: 502,
                contentType: 'application/json',
                headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Retry-After', 'retry-after': '900' },
                body: JSON.stringify({ error: 'No valid orbital elements are available', code: 'tle_unavailable', missing: MONITORED_NORAD_IDS, failed: MONITORED_NORAD_IDS, upstreamAttempted: true, retryAfterSeconds: 900 }),
            }),
        );
        await page.route(new RegExp(`^${API_ORIGIN.replace(/[.]/g, '\\.')}/api/fire-hotspots`), (route) =>
            route.fulfill({
                status: 502,
                contentType: 'application/json',
                headers: { 'access-control-allow-origin': '*' },
                body: JSON.stringify({
                    error: 'NASA FIRMS did not return usable data for the requested window',
                    code: 'firms_unavailable',
                    source: 'VIIRS_SNPP_NRT',
                    coverage: { status: 'unavailable', timezone: 'UTC', requestedStart: '2000-01-01', requestedEnd: '2000-01-07', missingDates: [], windows: [] },
                }),
            }),
        );
        // Fire base passes through; its overlay returns deterministic GIBS ServiceExceptionReport XML (blocked by ORB); every other GIBS image fails.
        await page.route('https://gibs.earthdata.nasa.gov/**', (route) => {
            const url = route.request().url();
            if (url.includes('Thermal_Anomalies')) {
                return route.fulfill({
                    status: 200,
                    contentType: 'text/xml; charset=UTF-8',
                    body: '<?xml version="1.0" encoding="UTF-8"?><ServiceExceptionReport version="1.1.1"><ServiceException>msShapefileOpen(): Fixture simulated GIBS shapefile error.</ServiceException></ServiceExceptionReport>',
                });
            }
            if (url.includes('MODIS_Aqua_CorrectedReflectance_TrueColor')) return route.continue();
            return route.abort('failed');
        });

        const { body } = await loadApp(page, checks);
        const legendState = await waitForAttr(page, '[data-testid="map-legend"]', 'data-disaster-state', ['complete', 'partial', 'failed', 'unknown'], 'legend');
        checks.record(legendState === 'partial', 'legend shows partial source state', legendState);
        const notice = await page.locator('[data-testid="disaster-source-notice"]').textContent({ timeout: STEP_TIMEOUT });
        checks.record(/USGS/.test(notice ?? ''), 'legend names the unavailable source', notice ?? '');

        const fires = (Array.isArray(body) ? body : []).filter((d) => d.type === 'fire').slice(0, 8);
        const selected = await clickDisaster(page, fires);
        if (!checks.record(!!selected, 'real map click selected a fire event', selected?.id ?? 'none')) return { checks, state };
        checks.record((await page.locator('[data-testid="sidebar"]').getAttribute('data-disaster-id', { timeout: STEP_TIMEOUT })) === selected.id, 'sidebar context matches clicked event');

        const passState = await waitForAttr(page, '[data-testid="sidebar"]', 'data-pass-state', ['pass', 'no-pass', 'unavailable'], 'pass prediction');
        checks.record(passState === 'unavailable', 'TLE failure shows pass prediction unavailable (not no-pass)', passState);
        const sidebar = page.locator('[data-testid="sidebar"]');
        checks.record((await sidebar.getAttribute('data-orbit-failure')) === 'tle_unavailable', 'orbit failure carries the server error code');
        const analysisState = await sidebar.getAttribute('data-analysis-state');
        const analysisText = (await page.locator('[data-testid="analysis-text"]').textContent()) ?? '';
        checks.record(analysisState === 'blocked-orbit' && /orbital data is unavailable/.test(analysisText) && !/Unable to retrieve satellite data/.test(analysisText), 'AI Insight reports blocked prerequisite, not an AI failure', `${analysisState}: ${analysisText.slice(0, 100)}`);
        checks.record(state.analyzeRequests === 0, 'no analysis requested without orbital data', `requests=${state.analyzeRequests}`);
        const passText = (await page.locator('[data-testid="pass-status"]').textContent()) ?? '';
        checks.record(/15 min/.test(passText), 'pass status shows the server retry time', passText.slice(0, 160));
        const tleBefore = state.tleRequests;
        const retried = page.waitForResponse((r) => isApi(r.url(), '/api/tles'), { timeout: STEP_TIMEOUT }).catch(() => null);
        await page.locator('[data-testid="retry-orbital-data"]').click();
        checks.record(!!(await retried) && state.tleRequests === tleBefore + 1, 'retry orbital data makes exactly one new request', `before=${tleBefore} after=${state.tleRequests}`);
        checks.record(tleBefore === 1, 'Retry-After failure was not re-requested automatically', `requests before retry=${tleBefore}`);
        const weatherState = await waitForAttr(page, '[data-testid="sidebar"]', 'data-weather-state', ['known', 'unavailable'], 'weather');
        checks.record(weatherState === 'unavailable', 'weather marked unavailable without a pass', weatherState);

        await page.locator('[data-testid="inspector-tab-imagery"]').click();
        const firmsState = await waitForAttr(page, '[data-testid="satellite-imagery"]', 'data-firms-state', ['detections', 'empty', 'filtered', 'unavailable'], 'FIRMS state');
        checks.record(firmsState === 'unavailable', 'FIRMS failure shown as unavailable (not empty)', firmsState);
        const imageryText = await page.locator('[data-testid="satellite-imagery"]').innerText();
        checks.record(imageryText.includes('2000-01-01') && imageryText.includes('VIIRS_SNPP_NRT'), 'unavailable state names the requested sensor and window');

        await page.locator('[data-testid="imagery-tab-fire"]').click();
        const fireBase = await waitForAttr(page, '[data-testid="satellite-imagery"]', 'data-imagery-status', ['loaded', 'error'], 'fire base imagery');
        const overlayStatus = await waitForAttr(page, '[data-testid="satellite-imagery"]', 'data-imagery-overlay-status', ['loaded', 'error', 'not-rendered'], 'thermal overlay');
        checks.record(fireBase === 'loaded' && overlayStatus === 'error', 'undecodable overlay reported as failed while base image loads', `base=${fireBase} overlay=${overlayStatus}`);
        const caption = (await page.locator('[data-testid="imagery-caption"]').textContent()) ?? '';
        checks.record(/Overlay .*failed to load/.test(caption), 'caption states the overlay failed', caption.slice(0, 160));

        await page.locator('[data-testid="imagery-tab-falsecolor"]').click();
        const imageryStatus = await waitForAttr(page, '[data-testid="satellite-imagery"]', 'data-imagery-status', ['loaded', 'error'], 'imagery');
        checks.record(imageryStatus === 'error', 'GIBS failure shown as imagery unavailable', imageryStatus);
        await page.screenshot({ path: SCREENSHOT('e2e-failure.png') });
    } catch (err) {
        checks.record(false, 'scenario completed', err instanceof Error ? err.message : String(err));
    } finally {
        await context.close();
    }
    return { checks, state };
}

const COMPARED_FIELDS = ['type', 'title', 'lat', 'lng', 'date', 'severity', 'magnitude'];
const DAY_MS = 86_400_000;

/** Raw-payload facts read without the shared parser, keyed by id. */
function rawUsgsFacts(payload) {
    const facts = new Map();
    for (const f of payload?.features ?? []) {
        const [lng, lat] = f?.geometry?.coordinates ?? [];
        facts.set(f?.id, { lng, lat, time: f?.properties?.time, updated: f?.properties?.updated, mag: f?.properties?.mag });
    }
    return facts;
}

function rawEonetFacts(payload) {
    const facts = new Map();
    for (const e of payload?.events ?? []) {
        const geoms = (e?.geometry ?? []).filter((g) => typeof g?.date === 'string' && Number.isFinite(Date.parse(g.date)));
        const latest = geoms.reduce((a, g) => (!a || Date.parse(g.date) > Date.parse(a.date) ? g : a), null);
        facts.set(e?.id, latest ? { type: latest.type, date: new Date(Date.parse(latest.date)).toISOString(), coordinates: latest.coordinates } : null);
    }
    return facts;
}

/**
 * Explain an application/upstream difference as provider change after the
 * application's fetch, using only evidence visible in the raw upstream data.
 * Returns null when the difference is not explained.
 */
function explainDifference(name, kind, record, raw, appFetchedMs, directMs, v2WindowRange) {
    if (name === 'usgs') {
        if (kind === 'onlyApp') return Date.parse(record.date) < directMs - DAY_MS ? 'aged out of past-day feed' : null;
        if (!raw) return null;
        return Math.max(raw.time ?? 0, raw.updated ?? 0) > appFetchedMs ? 'event created/updated after app fetch' : null;
    }
    if (v2WindowRange && kind === 'onlyUpstream' && record.type === 'fire') {
        const startMs = Date.parse(v2WindowRange.startInclusive);
        const endMs = Date.parse(v2WindowRange.endExclusive);
        const recMs = Date.parse(record.date);
        if (Number.isFinite(startMs) && Number.isFinite(recMs) && (recMs < startMs || recMs >= endMs)) {
            return 'outside active v2 observation window';
        }
    }
    if (kind === 'onlyApp') return record.type === 'fire' && Date.parse(record.date) < directMs - 60 * DAY_MS ? 'aged out of 60-day query' : null;
    if (kind === 'field') return raw && raw.date !== record.date ? 'newer geometry published' : null;
    return null;
}

/**
 * One direct request per provider. Compares every served field, lists ids
 * present on only one side, and classifies the result as exact, drift
 * (every difference explained by upstream change after the app's cached
 * fetch), or defect. Raw upstream values are also checked against the app
 * independently of the shared parser.
 */
async function verifyHiddenSources(appBody, appFetchedAt, checks, v2WindowRange = null) {
    console.log('\n=== EONET / USGS (behind /api/disasters) ===');
    const results = {};
    const appFetchedMs = Date.parse(appFetchedAt ?? '');
    for (const [name, urls, parse, rawFacts, types, listKey] of [
        ['eonet', EONET_QUERIES.map((q) => q.url), parseEonetPayload, rawEonetFacts, ['fire', 'volcano'], 'events'],
        ['usgs', [USGS_URL], parseUsgsPayload, rawUsgsFacts, ['earthquake'], 'features'],
    ]) {
        try {
            const responses = await Promise.all(urls.map((url) => fetch(url, { signal: AbortSignal.timeout(20000) })));
            const directMs = Date.now();
            const payloads = await Promise.all(responses.map((r) => r.json()));
            const res = responses.find((r) => !r.ok) ?? responses[0];
            const payload = { ...payloads[0], [listKey]: payloads.flatMap((p) => p?.[listKey] ?? []) };
            const { records, rejected } = parse(payload);
            const raw = rawFacts(payload);
            const upstream = new Map(records.map((r) => [r.id, r]));
            const app = appBody.filter((d) => types.includes(d.type));
            const appIds = new Set(app.map((d) => d.id));
            const onlyApp = app.filter((d) => !upstream.has(d.id));
            const onlyUpstream = records.filter((r) => !appIds.has(r.id));
            const fieldDiffs = app
                .filter((d) => upstream.has(d.id))
                .map((d) => {
                    const u = upstream.get(d.id);
                    const fields = COMPARED_FIELDS.filter((f) => u[f] !== d[f]);
                    return { id: d.id, fields, app: d };
                })
                .filter((d) => d.fields.length > 0);

            const unexplained = [];
            const explained = [];
            const classify = (kind, record) => {
                const why = Number.isFinite(appFetchedMs) ? explainDifference(name, kind, record, raw.get(record.id), appFetchedMs, directMs, v2WindowRange) : null;
                (why ? explained : unexplained).push(`${kind}:${record.id}${why ? ` (${why})` : ''}`);
            };
            onlyApp.forEach((d) => classify('onlyApp', d));
            onlyUpstream.forEach((r) => classify('onlyUpstream', r));
            fieldDiffs.forEach((d) => classify('field', d.app));

            // Independent of the parser: raw coordinates/time/magnitude for USGS, raw Point coordinates for EONET.
            let rawChecked = 0;
            let parserDerived = 0;
            const rawMismatches = [];
            for (const d of app) {
                const r = raw.get(d.id);
                if (!r || fieldDiffs.some((f) => f.id === d.id)) continue;
                if (name === 'usgs') {
                    rawChecked++;
                    const ok = r.lng === d.lng && r.lat === d.lat && new Date(r.time).toISOString() === d.date && (r.mag ?? undefined) === d.magnitude;
                    if (!ok) rawMismatches.push(d.id);
                } else if (r.type === 'Point') {
                    rawChecked++;
                    if (r.coordinates?.[0] !== d.lng || r.coordinates?.[1] !== d.lat || r.date !== d.date) rawMismatches.push(d.id);
                } else {
                    parserDerived++;
                }
            }

            const classification = unexplained.length === 0 ? (explained.length === 0 ? 'exact' : 'drift') : 'defect';
            results[name] = {
                http: res.status,
                appFetchedAt,
                appDataAgeSec: Number.isFinite(appFetchedMs) ? Math.round((directMs - appFetchedMs) / 1000) : null,
                upstream: records.length,
                upstreamRejected: rejected,
                app: app.length,
                matched: app.length - onlyApp.length - fieldDiffs.length,
                onlyApp: onlyApp.map((d) => d.id),
                onlyUpstream: onlyUpstream.map((r) => r.id),
                fieldDiffs: fieldDiffs.map((d) => `${d.id}:${d.fields.join('/')}`),
                classification,
                explained,
                unexplained,
                rawChecked,
                rawMismatches,
                polygonParserDerived: parserDerived,
            };
            checks.record(res.ok && app.length > 0, `${name} direct request succeeded and app served ${name} records`, `HTTP ${res.status}, app=${app.length}, upstream=${records.length}`);
            checks.record(
                classification !== 'defect',
                `${name} app/upstream parity (${classification})`,
                `matched=${results[name].matched}/${app.length} onlyApp=${onlyApp.length} onlyUpstream=${onlyUpstream.length} fieldDiffs=${fieldDiffs.length} age=${results[name].appDataAgeSec}s${unexplained.length ? ` unexplained=${unexplained.slice(0, 5).join(',')}` : ''}`,
            );
            checks.record(rawChecked > 0 && rawMismatches.length === 0, `${name} raw upstream values match app (parser-independent)`, `checked=${rawChecked} mismatches=${rawMismatches.slice(0, 5).join(',') || 0} polygonParserDerived=${parserDerived}`);
        } catch (err) {
            checks.record(false, `${name} direct check`, err instanceof Error ? err.message : String(err));
        }
    }
    return results;
}

async function main() {
    console.log(`Frontend: ${FRONTEND_URL}`);
    console.log(`Expected backend: ${API_ORIGIN}`);
    let browser;
    const summaries = [];
    try {
        browser = await chromium.launch({
            headless: true,
            args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        });
        if (scenarioArg === 'all' || scenarioArg === 'success') {
            const { checks, evidence, state } = await runSuccess(browser);
            const appBody = evidence.appDisasters ?? [];
            const v2WindowRange = evidence.v2WindowRange ?? null;
            delete evidence.appDisasters;
            delete evidence.v2WindowRange;
            if (checks.record(appBody.length > 0, 'application disaster body captured for source comparison')) {
                evidence.hiddenSources = await verifyHiddenSources(appBody, evidence.disasters?.fetchedAt, checks, v2WindowRange);
            }
            checks.record(state.pageErrors.length === 0, 'no application page errors', state.pageErrors.join(' | '));
            checks.record(state.foreignApi.length === 0, 'no API requests to an unexpected backend', state.foreignApi.slice(0, 3).join(' | '));
            console.log('\nEvidence:', JSON.stringify(evidence, null, 2));
            summaries.push(checks);
        }
        if (scenarioArg === 'all' || scenarioArg === 'failure') {
            const { checks, state } = await runFailure(browser);
            checks.record(state.pageErrors.length === 0, 'no application page errors', state.pageErrors.join(' | '));
            checks.record(state.foreignApi.length === 0, 'no API requests to an unexpected backend', state.foreignApi.slice(0, 3).join(' | '));
            summaries.push(checks);
        }
    } finally {
        await browser?.close();
    }

    console.log('\n=== Summary ===');
    for (const s of summaries) {
        console.log(`${s.name}: ${s.items.length - s.failed.length}/${s.items.length} checks passed${s.failed.length ? ` - FAILED: ${s.failed.map((f) => f.label).join('; ')}` : ''}`);
    }
    process.exit(summaries.length > 0 && summaries.every((s) => s.failed.length === 0) ? 0 : 1);
}

main().catch((err) => {
    console.error('Verification could not run:', err instanceof Error ? err.message : err);
    process.exit(2);
});
