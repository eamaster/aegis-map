#!/usr/bin/env node
/**
 * FIRMS hotspot verification: application route vs. direct FIRMS query.
 *
 * Uses the Worker's own adapter (src/firms.ts) for the direct query so there
 * is one parser, one window plan, and one bbox policy. Compares observation
 * identities and fields, not only counts. The MAP_KEY is never printed.
 *
 * Run (Node 22.6+):
 *   node --experimental-strip-types scripts/verify-firms-hotspots.mjs --lat 45.72 --lng 37.95
 *   node --experimental-strip-types scripts/verify-firms-hotspots.mjs            # first SAMPLE_COUNT fires from /api/disasters
 *
 * Env: API_BASE_URL (default http://127.0.0.1:8787), FIRMS_MAP_KEY, SAMPLE_COUNT (default 1)
 * Request budget per location: 1 app request + one direct FIRMS request per window and bbox (2, or 4 across the antimeridian).
 *
 * Exit codes: 0 match, 1 mismatch, 2 configuration/usage error, 3 provider or application unavailable.
 */
import {
	buildFirmsAreaUrl,
	buildFirmsBboxes,
	fetch7DayFirmsHotspots,
	hotspotIdentity,
	parseCoordinateQuery,
	planFirmsWindows,
	redactSecret,
} from '../src/firms.ts';

const API_BASE_URL = (process.env.API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const FIRMS_MAP_KEY = process.env.FIRMS_MAP_KEY || '';
const SAMPLE_COUNT = Number.parseInt(process.env.SAMPLE_COUNT || '1', 10);
const COMPARED_FIELDS = ['bright_ti4', 'bright_ti5', 'frp', 'confidence', 'daynight', 'scan', 'track', 'version'];

function argValue(name) {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

function redact(text) {
	return redactSecret(String(text), FIRMS_MAP_KEY);
}

function compareObservations(app, direct) {
	const appById = new Map(app.map((h) => [hotspotIdentity(h), h]));
	const directById = new Map(direct.map((h) => [hotspotIdentity(h), h]));
	const onlyApp = [...appById.keys()].filter((k) => !directById.has(k));
	const onlyDirect = [...directById.keys()].filter((k) => !appById.has(k));
	const fieldDiffs = [];
	for (const [id, a] of appById) {
		const d = directById.get(id);
		if (!d) continue;
		for (const f of COMPARED_FIELDS) {
			if (a[f] !== d[f]) fieldDiffs.push({ id, field: f, app: a[f], direct: d[f] });
		}
	}
	return { onlyApp, onlyDirect, fieldDiffs };
}

async function verifyLocation(lat, lng) {
	const now = new Date();
	const windows = planFirmsWindows(now);
	const bboxes = buildFirmsBboxes(lat, lng);
	console.log(`\nLocation (${lat}, ${lng})`);
	console.log(`  bboxes:  ${bboxes.join(' | ')}`);
	for (const w of windows) {
		for (const b of bboxes) {
			console.log(`  request: ${redact(buildFirmsAreaUrl(FIRMS_MAP_KEY, b, w.dayRange, w.startDate))}  (${w.startDate}..${w.endDate})`);
		}
	}

	const appRes = await fetch(`${API_BASE_URL}/api/fire-hotspots?lat=${lat}&lng=${lng}`, { signal: AbortSignal.timeout(30000) });
	const appBody = await appRes.json().catch(() => null);
	console.log(`  app:     HTTP ${appRes.status}, coverage=${appBody?.coverage?.status ?? 'n/a'}, totalCount=${appBody?.totalCount ?? 'n/a'}, fetchedAt=${appBody?.fetchedAt ?? 'n/a'}, cacheVersion=${appBody?.cacheVersion ?? 'n/a'}`);

	const direct = await fetch7DayFirmsHotspots(lat, lng, FIRMS_MAP_KEY, { now });
	for (const w of direct.coverage.windows) {
		console.log(`  direct ${w.id}: ${w.status}${w.httpStatus ? ` (HTTP ${w.httpStatus})` : ''}, ${w.detections} detections, ${w.rejectedRows} rejected rows, ${w.startDate}..${w.endDate}`);
	}
	console.log(`  direct:  coverage=${direct.coverage.status}, totalCount=${direct.totalCount}`);

	if (direct.coverage.status !== 'complete') {
		return { outcome: 'unavailable', reason: `direct FIRMS coverage ${direct.coverage.status}` };
	}
	if (!appRes.ok || !appBody || appBody.coverage?.status !== 'complete') {
		return { outcome: 'unavailable', reason: `application HTTP ${appRes.status}, coverage ${appBody?.coverage?.status ?? 'n/a'}` };
	}
	if (appBody.coverage.requestedStart !== direct.coverage.requestedStart || appBody.coverage.requestedEnd !== direct.coverage.requestedEnd) {
		return { outcome: 'mismatch', reason: `window differs: app ${appBody.coverage.requestedStart}..${appBody.coverage.requestedEnd}` };
	}
	if (JSON.stringify(appBody.bboxes) !== JSON.stringify(direct.bboxes)) {
		return { outcome: 'mismatch', reason: `bboxes differ: app ${JSON.stringify(appBody.bboxes)}` };
	}

	const diff = compareObservations(appBody.hotspots, direct.hotspots);
	const identities = direct.hotspots.map(hotspotIdentity).sort();
	console.log(`  identities (${identities.length}): ${identities.slice(0, 5).join(', ')}${identities.length > 5 ? ', ...' : ''}`);
	if (diff.onlyApp.length || diff.onlyDirect.length || diff.fieldDiffs.length) {
		console.log(`  only in app:    ${diff.onlyApp.slice(0, 5).join(', ') || '-'}`);
		console.log(`  only in direct: ${diff.onlyDirect.slice(0, 5).join(', ') || '-'}`);
		console.log(`  field diffs:    ${JSON.stringify(diff.fieldDiffs.slice(0, 5))}`);
		const cacheAgeMin = appBody.fetchedAt ? (now.getTime() - Date.parse(appBody.fetchedAt)) / 60000 : NaN;
		return {
			outcome: 'mismatch',
			reason: `${diff.onlyApp.length} app-only, ${diff.onlyDirect.length} direct-only, ${diff.fieldDiffs.length} field diffs (app data age ${cacheAgeMin.toFixed(1)} min; NRT updates within the cache TTL also appear here)`,
		};
	}
	return { outcome: 'match', reason: `${identities.length} identical observations` };
}

async function main() {
	if (!FIRMS_MAP_KEY || FIRMS_MAP_KEY === 'YOUR_FIRMS_MAP_KEY_HERE') {
		console.error('FIRMS_MAP_KEY is not set.');
		process.exit(2);
	}
	console.log(`API_BASE_URL: ${API_BASE_URL}`);

	let locations = [];
	const latArg = argValue('--lat');
	const lngArg = argValue('--lng');
	if (latArg !== undefined || lngArg !== undefined) {
		const parsed = parseCoordinateQuery(latArg, lngArg);
		if (!parsed.ok) {
			console.error(`Invalid --lat/--lng: ${parsed.reason}`);
			process.exit(2);
		}
		locations = [{ lat: parsed.lat, lng: parsed.lng }];
	} else {
		const res = await fetch(`${API_BASE_URL}/api/disasters`, { signal: AbortSignal.timeout(30000) });
		if (!res.ok) {
			console.error(`/api/disasters HTTP ${res.status}`);
			process.exit(3);
		}
		const fires = (await res.json()).filter((d) => d.type === 'fire');
		locations = fires.slice(0, SAMPLE_COUNT).map((d) => ({ lat: d.lat, lng: d.lng }));
		if (locations.length === 0) {
			console.error('No fire events available to sample; pass --lat/--lng.');
			process.exit(3);
		}
	}

	const results = [];
	for (const loc of locations) {
		try {
			results.push(await verifyLocation(loc.lat, loc.lng));
		} catch (err) {
			results.push({ outcome: 'unavailable', reason: redact(err instanceof Error ? err.message : err) });
		}
		console.log(`  RESULT: ${results.at(-1).outcome.toUpperCase()} - ${results.at(-1).reason}`);
	}

	if (results.some((r) => r.outcome === 'mismatch')) process.exit(1);
	if (results.some((r) => r.outcome === 'unavailable')) process.exit(3);
	process.exit(0);
}

main().catch((err) => {
	console.error(`Fatal: ${redact(err instanceof Error ? err.message : err)}`);
	process.exit(3);
});
