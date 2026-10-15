/**
 * Seed realistic worldwide FIRMS VIIRS detections into local KV storage.
 * Used for local E2E testing to simulate post-refresh cache state.
 */
const now = new Date();
const start = new Date(now.getTime() - 24 * 3600 * 1000);

function makeCell(id, lat, lng, count, maxFrp, avgFrp, intensity) {
	return {
		cellId: id,
		lat,
		lng,
		bounds: [lng - 0.25, lat - 0.25, lng + 0.25, lat + 0.25],
		detectionCount: count,
		maxFrp,
		avgFrp,
		maxBrightTi4: 345.5,
		latestAcqTime: now.toISOString(),
		confidenceCounts: { high: Math.floor(count * 0.6), nominal: Math.floor(count * 0.4), low: 0, unknown: 0 },
		dayNightCounts: { day: count, night: 0, unknown: 0 },
		satelliteCounts: { N20: count },
		intensity,
	};
}

const cells = [
	// Africa: Democratic Republic of the Congo & Angola
	makeCell('cell:-4.25:21.75', -4.25, 21.75, 45, 82.5, 38.2, 'high'),
	makeCell('cell:-8.75:25.25', -8.75, 25.25, 28, 45.0, 22.4, 'medium'),
	makeCell('cell:-11.25:17.75', -11.25, 17.75, 19, 32.1, 18.0, 'medium'),
	// South America: Brazil (Amazon & Cerrado)
	makeCell('cell:-11.25:-55.25', -11.25, -55.25, 62, 115.0, 48.5, 'high'),
	makeCell('cell:-14.75:-52.25', -14.75, -52.25, 34, 55.4, 26.8, 'medium'),
	makeCell('cell:-9.25:-63.75', -9.25, -63.75, 22, 38.0, 19.5, 'medium'),
	// North America: California
	makeCell('cell:36.75:-119.75', 36.75, -119.75, 12, 28.0, 15.2, 'low'),
	// Australia: Northern Territory
	makeCell('cell:-16.75:133.25', -16.75, 133.25, 18, 35.0, 21.0, 'medium'),
];

const totalDetections = cells.reduce((sum, c) => sum + c.detectionCount, 0);

const snapshot = {
	version: 2,
	window: '24h',
	windowRange: {
		startInclusive: start.toISOString(),
		endExclusive: now.toISOString(),
	},
	generatedAt: now.toISOString(),
	sensors: {
		VIIRS_SNPP_NRT: { status: 'ok', rawRows: Math.floor(totalDetections * 0.3), acceptedRows: Math.floor(totalDetections * 0.3) },
		VIIRS_NOAA20_NRT: { status: 'ok', rawRows: Math.floor(totalDetections * 0.5), acceptedRows: Math.floor(totalDetections * 0.5) },
		VIIRS_NOAA21_NRT: { status: 'ok', rawRows: totalDetections - Math.floor(totalDetections * 0.3) - Math.floor(totalDetections * 0.5), acceptedRows: totalDetections - Math.floor(totalDetections * 0.3) - Math.floor(totalDetections * 0.5) },
	},
	accounting: {
		rawRows: totalDetections,
		malformedRows: 0,
		outOfWindowRows: 0,
		duplicateRows: 0,
		acceptedDetections: totalDetections,
	},
	totalDetections,
	cells,
};

const jsonStr = JSON.stringify(snapshot);

// Put into local miniflare KV via explorer API
const kvUrl = 'http://127.0.0.1:8787/cdn-cgi/local/explorer/api/storage/kv/namespaces/7f6c89c7faa84c288f31941bef51b14c/values/firms:global:snapshot:v2:24h';
const res = await fetch(kvUrl, { method: 'PUT', body: jsonStr });
if (!res.ok) {
	console.error('KV PUT failed:', res.status, await res.text());
	process.exit(1);
}

// Clear lock key if present
const lockUrl = 'http://127.0.0.1:8787/cdn-cgi/local/explorer/api/storage/kv/namespaces/7f6c89c7faa84c288f31941bef51b14c/values/firms:global:lock:v2:24h';
await fetch(lockUrl, { method: 'DELETE' });

// Also write LKG backup
const lkgUrl = 'http://127.0.0.1:8787/cdn-cgi/local/explorer/api/storage/kv/namespaces/7f6c89c7faa84c288f31941bef51b14c/values/firms:global:lkg:v2:24h';
await fetch(lkgUrl, { method: 'PUT', body: jsonStr });

console.log(`Successfully seeded ${cells.length} cells (${totalDetections} detections) into local KV.`);
