/**
 * Off-Worker Worldwide NASA FIRMS VIIRS Ingestion Script
 *
 * Bundles `src/firmsGlobal.ts` via `esbuild`, fetches and aggregates worldwide
 * VIIRS thermal detections (S-NPP, NOAA-20, NOAA-21) for `24h` and `7d` rolling
 * windows, verifies accounting invariants, and writes split `meta` + `cells`
 * (plus LKG backup) keys to Cloudflare KV with one `wrangler kv bulk put` call
 * per window.
 *
 * Usage:
 *   node scripts/ingest-firms.mjs [--dry-run] [--local] [--window 24h|7d]
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, '..');

function readDevVarsKey(keyName) {
	const devVarsPath = path.join(BACKEND_ROOT, '.dev.vars');
	if (!fs.existsSync(devVarsPath)) return null;
	const content = fs.readFileSync(devVarsPath, 'utf-8');
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const eqIdx = line.indexOf('=');
		if (eqIdx === -1) continue;
		const k = line.slice(0, eqIdx).trim();
		const v = line.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
		if (k === keyName && v) return v;
	}
	return null;
}

async function loadFirmsModules() {
	const entryCode = `
		export * from './src/config.ts';
		export * from './src/firms.ts';
		export * from './src/firmsGlobal.ts';
	`;
	const result = await esbuild.build({
		stdin: {
			contents: entryCode,
			resolveDir: BACKEND_ROOT,
			sourcefile: 'ingest-entry.ts',
			loader: 'ts',
		},
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		write: false,
	});
	const code = result.outputFiles[0].text;
	const dataUrl = `data:text/javascript;base64,${Buffer.from(code, 'utf-8').toString('base64')}`;
	return import(dataUrl);
}

function parseArgs(argv) {
	const dryRun = argv.includes('--dry-run');
	const local = argv.includes('--local');
	let windowFilter = null;
	const winIdx = argv.indexOf('--window');
	if (winIdx !== -1 && argv[winIdx + 1]) {
		windowFilter = argv[winIdx + 1];
	}
	return { dryRun, local, windowFilter };
}

function verifyAccountingInvariants(snapshot) {
	const { rawRows, malformedRows, outOfWindowRows, duplicateRows, acceptedDetections } = snapshot.accounting;
	const sumAccounted = malformedRows + outOfWindowRows + duplicateRows + acceptedDetections;
	if (rawRows !== sumAccounted) {
		throw new Error(
			`Accounting invariant failed for ${snapshot.window}: rawRows (${rawRows}) !== sumAccounted (${sumAccounted})`,
		);
	}
	const sumCells = snapshot.cells.reduce((acc, cell) => acc + cell.detectionCount, 0);
	if (sumCells !== acceptedDetections || snapshot.totalDetections !== acceptedDetections) {
		throw new Error(
			`Cell sum invariant failed for ${snapshot.window}: sumCells (${sumCells}) !== acceptedDetections (${acceptedDetections})`,
		);
	}
}

async function main() {
	const { dryRun, local, windowFilter } = parseArgs(process.argv.slice(2));
	const mod = await loadFirmsModules();
	const {
		cacheKeyForWindow,
		computeSnapshotStatus,
		FIRMS_GLOBAL_CACHE_TTL_SECONDS,
		FIRMS_GLOBAL_CELLS_PREFIX,
		FIRMS_GLOBAL_LKG_CELLS_PREFIX,
		FIRMS_GLOBAL_LKG_META_PREFIX,
		FIRMS_GLOBAL_LKG_TTL_SECONDS,
		FIRMS_GLOBAL_META_PREFIX,
		ingestGlobalFirms,
		isObservationWindow,
		isSnapshotUsable,
		isValidFirmsMeta,
		isValidRawCellsJson,
		isValidSnapshot,
		OBSERVATION_WINDOWS,
		redactSecret,
		serializeGlobalFirmsSnapshotSplit,
	} = mod;

	const mapKey = (process.env.FIRMS_MAP_KEY || readDevVarsKey('FIRMS_MAP_KEY') || '').trim();
	if (!mapKey || mapKey === 'YOUR_FIRMS_MAP_KEY_HERE') {
		console.error('Error: FIRMS_MAP_KEY is required (set in environment or backend/.dev.vars).');
		process.exit(2);
	}

	const targetWindows = windowFilter ? [windowFilter] : [...OBSERVATION_WINDOWS];
	for (const w of targetWindows) {
		if (!isObservationWindow(w)) {
			console.error(`Error: Invalid window "${w}". Supported: ${OBSERVATION_WINDOWS.join(', ')}`);
			process.exit(2);
		}
	}

	console.log(
		`Starting global FIRMS ingestion (windows=${targetWindows.join(',')}, mode=${dryRun ? 'dry-run' : local ? 'local-kv' : 'remote-kv'})`,
	);

	let usableCount = 0;

	for (const window of targetWindows) {
		const t0 = Date.now();
		try {
			const snapshot = await ingestGlobalFirms(mapKey, window);
			const elapsedMs = Date.now() - t0;

			verifyAccountingInvariants(snapshot);
			if (!isValidSnapshot(snapshot)) {
				throw new Error(`Invalid snapshot structure produced for window ${window}`);
			}

			const sensorSummary = Object.entries(snapshot.sensors)
				.map(([prod, s]) => `${prod}=${s.status}(raw=${s.rawRows},acc=${s.acceptedRows})`)
				.join(' ');
			const status = computeSnapshotStatus({ generatedAt: snapshot.generatedAt, sensors: snapshot.sensors });

			console.log(
				`[${window}] Ingested in ${(elapsedMs / 1000).toFixed(1)}s: status=${status} cells=${snapshot.cells.length} detections=${snapshot.totalDetections} accounting=${JSON.stringify(snapshot.accounting)} sensors=[${sensorSummary}]`,
			);

			if (!isSnapshotUsable(snapshot)) {
				console.warn(
					`[${window}] Refusing to overwrite KV: no sensor returned usable data (${sensorSummary}). Existing LKG preserved.`,
				);
				continue;
			}

			const { meta, metaJson, cellsJson } = serializeGlobalFirmsSnapshotSplit(snapshot);
			if (!isValidFirmsMeta(meta) || !isValidRawCellsJson(cellsJson, meta.cellCount)) {
				throw new Error(`Split serialization validation failed for window ${window}`);
			}

			console.log(
				`[${window}] Payload sizes: meta=${Buffer.byteLength(metaJson)} B, cells=${(Buffer.byteLength(cellsJson) / (1024 * 1024)).toFixed(2)} MB`,
			);

			if (dryRun) {
				console.log(`[${window}] Dry-run complete: invariants verified, skipping KV upload.`);
				usableCount++;
				continue;
			}

			const bulkEntries = [
				{
					key: cacheKeyForWindow(window, FIRMS_GLOBAL_META_PREFIX),
					value: metaJson,
					expiration_ttl: FIRMS_GLOBAL_CACHE_TTL_SECONDS,
				},
				{
					key: cacheKeyForWindow(window, FIRMS_GLOBAL_CELLS_PREFIX),
					value: cellsJson,
					expiration_ttl: FIRMS_GLOBAL_CACHE_TTL_SECONDS,
				},
				{
					key: cacheKeyForWindow(window, FIRMS_GLOBAL_LKG_META_PREFIX),
					value: metaJson,
					expiration_ttl: FIRMS_GLOBAL_LKG_TTL_SECONDS,
				},
				{
					key: cacheKeyForWindow(window, FIRMS_GLOBAL_LKG_CELLS_PREFIX),
					value: cellsJson,
					expiration_ttl: FIRMS_GLOBAL_LKG_TTL_SECONDS,
				},
			];

			const tmpFile = path.join(os.tmpdir(), `aegis-firms-bulk-${window}-${ process.pid }-${Date.now()}.json`);
			try {
				fs.writeFileSync(tmpFile, JSON.stringify(bulkEntries), 'utf-8');
				const wranglerBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
				const args = [
					'wrangler',
					'kv',
					'bulk',
					'put',
					tmpFile,
					'--binding',
					'AEGIS_CACHE',
					local ? '--local' : '--remote',
				];
				execFileSync(wranglerBin, args, {
					cwd: BACKEND_ROOT,
					stdio: 'inherit',
					shell: process.platform === 'win32',
				});
				console.log(`[${window}] Uploaded 4 KV keys (meta, cells, lkg:meta, lkg:cells) via bulk put.`);
				usableCount++;
			} finally {
				try {
					if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
				} catch {
					// ignore temp file cleanup error
				}
			}
		} catch (err) {
			const rawMsg = err instanceof Error ? err.stack || err.message : String(err);
			console.error(`[${window}] Ingestion error:`, redactSecret(rawMsg, mapKey));
		}
	}

	if (usableCount === 0) {
		console.error('Global FIRMS ingestion failed: no window produced a usable snapshot.');
		process.exit(1);
	}
}

main().catch((err) => {
	console.error('Fatal error in ingest-firms:', err instanceof Error ? err.name : 'Error');
	process.exit(1);
});

