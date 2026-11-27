/**
 * Seed realistic worldwide FIRMS VIIRS detections into local KV storage for both 24h and 7d windows.
 * Used for local E2E testing to simulate post-refresh cache state.
 * Writes cells BEFORE meta with FNV-1a checksum & char length (matching production two-phase protocol).
 */
const now = new Date();
const NAMESPACE_ID = process.env.KV_NAMESPACE_ID || '7f6c89c7faa84c288f31941bef51b14c';
const API_ORIGIN = (process.env.API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const kvBase = `${API_ORIGIN}/cdn-cgi/local/explorer/api/storage/kv/namespaces/${NAMESPACE_ID}/values`;

function fnv1a64Hex(input) {
	let hash = 0xcbf29ce484222325n;
	const prime = 0x100000001b3n;
	for (let i = 0; i < input.length; i++) {
		hash ^= BigInt(input.charCodeAt(i));
		hash = (hash * prime) & 0xffffffffffffffffn;
	}
	return hash.toString(16).padStart(16, '0');
}

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
	makeCell('cell:-4.25:21.75', -4.25, 21.75, 45, 82.5, 38.2, 'high'),
	makeCell('cell:-8.75:25.25', -8.75, 25.25, 28, 45.0, 22.4, 'medium'),
	makeCell('cell:-11.25:17.75', -11.25, 17.75, 19, 32.1, 18.0, 'medium'),
	makeCell('cell:-11.25:-55.25', -11.25, -55.25, 62, 115.0, 48.5, 'high'),
	makeCell('cell:-14.75:-52.25', -14.75, -52.25, 34, 55.4, 26.8, 'medium'),
	makeCell('cell:-9.25:-63.75', -9.25, -63.75, 22, 38.0, 19.5, 'medium'),
	makeCell('cell:36.75:-119.75', 36.75, -119.75, 12, 28.0, 15.2, 'low'),
	makeCell('cell:-16.75:133.25', -16.75, 133.25, 18, 35.0, 21.0, 'medium'),
];

const totalDetections = cells.reduce((sum, c) => sum + c.detectionCount, 0);
const cellsJson = JSON.stringify(cells);
const cellsChecksum = fnv1a64Hex(cellsJson);

for (const win of ['24h', '7d']) {
	const hours = win === '7d' ? 168 : 24;
	const start = new Date(now.getTime() - hours * 3600 * 1000);
	const snapshotId = `${now.getTime().toString(36)}-${cellsChecksum.slice(0, 8)}`;

	const meta = {
		version: 2,
		window: win,
		windowRange: {
			startInclusive: start.toISOString(),
			endExclusive: now.toISOString(),
		},
		generatedAt: now.toISOString(),
		snapshotId,
		cellsCharLength: cellsJson.length,
		cellsChecksum,
		sensors: {
			VIIRS_SNPP_NRT: { status: 'ok', rawRows: Math.floor(totalDetections * 0.3), acceptedRows: Math.floor(totalDetections * 0.3) },
			VIIRS_NOAA20_NRT: { status: 'ok', rawRows: Math.floor(totalDetections * 0.5), acceptedRows: Math.floor(totalDetections * 0.5) },
			VIIRS_NOAA21_NRT: {
				status: 'ok',
				rawRows: totalDetections - Math.floor(totalDetections * 0.3) - Math.floor(totalDetections * 0.5),
				acceptedRows: totalDetections - Math.floor(totalDetections * 0.3) - Math.floor(totalDetections * 0.5),
			},
		},
		accounting: {
			rawRows: totalDetections,
			malformedRows: 0,
			outOfWindowRows: 0,
			duplicateRows: 0,
			acceptedDetections: totalDetections,
		},
		totalDetections,
		cellCount: cells.length,
	};

	const metaJson = JSON.stringify(meta);

	// Phase A: data keys first
	for (const [key, body] of [
		[`firms:global:cells:v2:${win}:${snapshotId}`, cellsJson],
		[`firms:global:cells:v2:${win}`, cellsJson],
		[`firms:global:lkg:cells:v2:${win}`, cellsJson],
	]) {
		const res = await fetch(`${kvBase}/${encodeURIComponent(key)}`, { method: 'PUT', body });
		if (!res.ok) {
			console.error(`KV PUT failed for ${key}:`, res.status, await res.text());
			process.exit(1);
		}
	}

	// Phase B: pointer meta keys second
	for (const [key, body] of [
		[`firms:global:meta:v2:${win}`, metaJson],
		[`firms:global:lkg:meta:v2:${win}`, metaJson],
	]) {
		const res = await fetch(`${kvBase}/${encodeURIComponent(key)}`, { method: 'PUT', body });
		if (!res.ok) {
			console.error(`KV PUT failed for ${key}:`, res.status, await res.text());
			process.exit(1);
		}
	}
}

console.log(`Successfully seeded ${cells.length} cells (${totalDetections} detections) for 24h & 7d into local KV.`);
