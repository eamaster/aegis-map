/**
 * Bounded, Resumable Historical Disaster Backfill CLI
 * Fetches historical USGS FDSN & NASA EONET v3 events and generates D1 SQL or executes via Wrangler.
 *
 * Usage:
 *   node scripts/backfill-history.mjs [--days 14] [--limit 100] [--local|--remote] [--dry-run]
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

function parseArgs(argv) {
	const dryRun = argv.includes('--dry-run');
	const remote = argv.includes('--remote');
	const envIdx = argv.indexOf('--env');
	const envName = envIdx !== -1 && argv[envIdx + 1] ? argv[envIdx + 1] : null;
	const daysIdx = argv.indexOf('--days');
	const days = daysIdx !== -1 ? Math.max(1, Math.min(30, Number(argv[daysIdx + 1]) || 14)) : 14;
	const limitIdx = argv.indexOf('--limit');
	const limit = limitIdx !== -1 ? Math.max(10, Math.min(200, Number(argv[limitIdx + 1]) || 100)) : 100;
	return { dryRun, remote, envName, days, limit };
}

async function loadModules() {
	const result = await esbuild.build({
		stdin: {
			contents: `export * from './src/disasters.ts';`,
			resolveDir: BACKEND_ROOT,
			sourcefile: 'backfill-entry.ts',
			loader: 'ts',
		},
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		write: false,
	});
	const dataUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text, 'utf-8').toString('base64')}`;
	return import(dataUrl);
}

function sqlStr(val) {
	if (val === null || val === undefined) return 'NULL';
	return `'${String(val).replace(/'/g, "''")}'`;
}

function revHash(rec) {
	const str = `${rec.title}|${rec.severity}|${rec.lat.toFixed(4)}|${rec.lng.toFixed(4)}|${rec.date}`;
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

async function main() {
	const { dryRun, remote, envName, days, limit } = parseArgs(process.argv.slice(2));
	const { normalizeEonetEvents, normalizeUsgsFeatures } = await loadModules();

	const now = new Date();
	const endIso = now.toISOString();
	const startIso = new Date(now.getTime() - days * 86_400_000).toISOString();

	const usgsUrl = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${encodeURIComponent(startIso)}&endtime=${encodeURIComponent(endIso)}&minmagnitude=4.5&limit=${limit}&orderby=time`;
	const eonetUrl = `https://eonet.gsfc.nasa.gov/api/v3/events?status=all&start=${startIso.slice(0, 10)}&end=${endIso.slice(0, 10)}&limit=${limit}`;

	console.log(`Fetching bounded backfill (${days}d, limit=${limit})...`);
	const [usgsRes, eonetRes] = await Promise.all([
		fetch(usgsUrl, { signal: AbortSignal.timeout(15000) }),
		fetch(eonetUrl, { signal: AbortSignal.timeout(15000) }),
	]);

	const records = [];
	if (usgsRes.ok) {
		const u = await usgsRes.json();
		if (Array.isArray(u.features)) records.push(...normalizeUsgsFeatures(u.features).records);
	}
	if (eonetRes.ok) {
		const e = await eonetRes.json();
		if (Array.isArray(e.events)) records.push(...normalizeEonetEvents(e.events).records);
	}

	console.log(`Normalized ${records.length} historical records (${startIso.slice(0, 10)}..${endIso.slice(0, 10)}).`);
	if (dryRun || records.length === 0) {
		console.log('Dry-run or empty result; exiting.');
		return;
	}

	const lines = [];
	const nowIso = now.toISOString();
	for (const rec of records) {
		const src = rec.type === 'earthquake' ? 'usgs' : 'eonet';
		const id = `${src}:${rec.id}`;
		const hash = revHash(rec);
		const attr = src === 'usgs' ? 'USGS Earthquake Hazards Program' : 'NASA EONET v3';
		lines.push(
			`INSERT INTO disaster_events (id, upstream_id, source, type, title, lat, lng, severity, magnitude, area_acres, event_time, first_seen_at, ingested_at, is_backfill, attribution, revision_hash) VALUES (${sqlStr(id)}, ${sqlStr(rec.id)}, ${sqlStr(src)}, ${sqlStr(rec.type)}, ${sqlStr(rec.title)}, ${rec.lat}, ${rec.lng}, ${sqlStr(rec.severity)}, ${rec.magnitude ?? 'NULL'}, ${rec.areaAcres ?? 'NULL'}, ${sqlStr(rec.date)}, ${sqlStr(nowIso)}, ${sqlStr(nowIso)}, 1, ${sqlStr(attr)}, ${sqlStr(hash)}) ON CONFLICT(source, upstream_id) DO UPDATE SET title=excluded.title, severity=excluded.severity, lat=excluded.lat, lng=excluded.lng, event_time=excluded.event_time, ingested_at=excluded.ingested_at, revision_hash=excluded.revision_hash;`,
		);
		lines.push(
			`INSERT OR IGNORE INTO disaster_revisions (event_id, revision_number, observed_at, title, severity, lat, lng, source_timestamp, revision_hash) VALUES (${sqlStr(id)}, COALESCE((SELECT MAX(revision_number) + 1 FROM disaster_revisions WHERE event_id = ${sqlStr(id)}), 1), ${sqlStr(nowIso)}, ${sqlStr(rec.title)}, ${sqlStr(rec.severity)}, ${rec.lat}, ${rec.lng}, ${sqlStr(rec.date)}, ${sqlStr(hash)});`,
		);
	}
	lines.push(
		`INSERT INTO ingestion_checkpoints (source, window_key, cursor, last_event_time, updated_at, status, records_processed) VALUES ('usgs+eonet', ${sqlStr(`backfill-${days}d`)}, ${sqlStr(`${startIso}..${endIso}`)}, ${sqlStr(endIso)}, ${sqlStr(nowIso)}, 'ok', ${records.length}) ON CONFLICT(source, window_key) DO UPDATE SET cursor=excluded.cursor, last_event_time=excluded.last_event_time, updated_at=excluded.updated_at, status=excluded.status, records_processed=excluded.records_processed;`,
	);

	const tmpSql = path.join(os.tmpdir(), `aegis-backfill-${Date.now()}.sql`);
	try {
		fs.writeFileSync(tmpSql, lines.join('\n'), 'utf-8');
		const dbBinding = 'AEGIS_DB';
		const wranglerBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
		const args = [
			'wrangler',
			'd1',
			'execute',
			dbBinding,
			'--file',
			tmpSql,
			remote ? '--remote' : '--local',
			...(envName ? ['--env', envName] : []),
		];
		execFileSync(wranglerBin, args, {
			cwd: BACKEND_ROOT,
			stdio: 'inherit',
			shell: process.platform === 'win32',
		});
		console.log(`Executed backfill SQL (${records.length} records).`);
	} finally {
		if (fs.existsSync(tmpSql)) fs.unlinkSync(tmpSql);
	}
}

main().catch((err) => {
	console.error('Backfill failed:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
