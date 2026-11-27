/**
 * Historical disaster archive, revision tracking, bounded resumable backfill,
 * and source-health analytics backed by Cloudflare D1 (`AEGIS_DB`).
 *
 * - Live captures use `is_backfill = 0` (`provenance: 'live_captured'`).
 * - Backfill rows use `is_backfill = 1` (`provenance: 'reconstructed_backfill'`).
 * - Existing live-captured rows preserve their `first_seen_at` and `is_backfill = 0`
 *   even if a later backfill sees the same upstream ID.
 */

import type {
	ArchivedDisasterEvent,
	ArchivedEventRevision,
	HistoryApiResponse,
	ProviderHealthSummary,
	SourceAnalyticsApiResponse,
} from '../../shared/contracts';
import {
	normalizeEonetEvents,
	normalizeUsgsFeatures,
	type DisasterRecord,
	type DisasterSources,
} from './disasters';
import { haversineKm } from './warnings/geoMatch';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const USGS_FDSN_EVENT_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const EONET_V3_EVENTS_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events';
const GDACS_MAP_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP';

const REQUIRED_D1_TABLES = [
	'disaster_events',
	'disaster_revisions',
	'ingestion_checkpoints',
	'provider_health_runs',
	'subscriptions',
	'subscription_deliveries',
] as const;

export type D1SchemaState = 'ready' | 'schema_missing' | 'unbound';

export async function checkD1SchemaReady(db: D1Database | undefined): Promise<D1SchemaState> {
	if (!db) return 'unbound';
	try {
		const res = await db
			.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?, ?, ?, ?)`)
			.bind(...REQUIRED_D1_TABLES)
			.all<{ name: string }>();
		const present = new Set((res.results ?? []).map((r) => r.name));
		return REQUIRED_D1_TABLES.every((t) => present.has(t)) ? 'ready' : 'schema_missing';
	} catch {
		return 'schema_missing';
	}
}

function computeRevisionHash(rec: Pick<DisasterRecord, 'title' | 'severity' | 'lat' | 'lng' | 'date'>): string {
	const str = `${rec.title}|${rec.severity}|${rec.lat.toFixed(4)}|${rec.lng.toFixed(4)}|${rec.date}`;
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

function sourceForRecord(rec: DisasterRecord): 'eonet' | 'usgs' {
	return rec.type === 'earthquake' ? 'usgs' : 'eonet';
}

function attributionForSource(src: 'eonet' | 'usgs'): string {
	return src === 'usgs' ? 'USGS Earthquake Hazards Program' : 'NASA EONET v3';
}

export async function upsertArchivedEvents(
	db: D1Database | undefined,
	records: readonly DisasterRecord[],
	options: { isBackfill: boolean; now?: Date },
): Promise<{ upserted: number; revisionsAdded: number }> {
	if (!db || records.length === 0) return { upserted: 0, revisionsAdded: 0 };

	const nowIso = (options.now ?? new Date()).toISOString();
	const isBackfillInt = options.isBackfill ? 1 : 0;
	let upserted = 0;
	let revisionsAdded = 0;

	// Process in bounded chunks to avoid exceeding D1 batch statement limits
	const CHUNK_SIZE = 25;
	for (let i = 0; i < records.length; i += CHUNK_SIZE) {
		const chunk = records.slice(i, i + CHUNK_SIZE);
		const stmts: D1PreparedStatement[] = [];

		for (const rec of chunk) {
			const src = sourceForRecord(rec);
			const id = `${src}:${rec.id}`;
			const revHash = computeRevisionHash(rec);
			const attribution = attributionForSource(src);

			stmts.push(
				db
					.prepare(
						`INSERT INTO disaster_events (
							id, upstream_id, source, type, title, lat, lng, severity,
							magnitude, area_acres, event_time, first_seen_at, ingested_at,
							is_backfill, attribution, revision_hash
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(source, upstream_id) DO UPDATE SET
							title = excluded.title,
							lat = excluded.lat,
							lng = excluded.lng,
							severity = excluded.severity,
							magnitude = COALESCE(excluded.magnitude, disaster_events.magnitude),
							area_acres = COALESCE(excluded.area_acres, disaster_events.area_acres),
							event_time = excluded.event_time,
							ingested_at = excluded.ingested_at,
							revision_hash = excluded.revision_hash`,
					)
					.bind(
						id,
						rec.id,
						src,
						rec.type,
						rec.title,
						rec.lat,
						rec.lng,
						rec.severity,
						rec.magnitude ?? null,
						rec.areaAcres ?? null,
						rec.date,
						nowIso,
						nowIso,
						isBackfillInt,
						attribution,
						revHash,
					),
			);

			stmts.push(
				db
					.prepare(
						`INSERT OR IGNORE INTO disaster_revisions (
							event_id, revision_number, observed_at, title, severity, lat, lng, source_timestamp, revision_hash
						) VALUES (
							?,
							COALESCE((SELECT MAX(revision_number) + 1 FROM disaster_revisions WHERE event_id = ?), 1),
							?, ?, ?, ?, ?, ?, ?
						)`,
					)
					.bind(id, id, nowIso, rec.title, rec.severity, rec.lat, rec.lng, rec.date, revHash),
			);
		}

		const batchRes = await db.batch(stmts);
		for (let b = 0; b < batchRes.length; b += 2) {
			if ((batchRes[b]?.meta?.changes ?? 0) > 0) upserted++;
			if ((batchRes[b + 1]?.meta?.changes ?? 0) > 0) revisionsAdded++;
		}
	}

	return { upserted, revisionsAdded };
}

export async function recordProviderHealthRun(
	db: D1Database | undefined,
	entry: {
		provider: string;
		status: string;
		latencyMs: number;
		recordCount: number;
		rejectedCount: number;
		errorDetail?: string | null;
		now?: Date;
	},
): Promise<void> {
	if (!db) return;
	try {
		await db
			.prepare(
				`INSERT INTO provider_health_runs (provider, run_at, status, latency_ms, record_count, rejected_count, error_detail)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				entry.provider,
				(entry.now ?? new Date()).toISOString(),
				entry.status,
				Math.max(0, Math.round(entry.latencyMs)),
				entry.recordCount,
				entry.rejectedCount,
				entry.errorDetail ?? null,
			)
			.run();
	} catch {
		// Best-effort health logging
	}
}

export async function recordLiveDisastersToArchive(
	db: D1Database | undefined,
	records: readonly DisasterRecord[],
	sources: DisasterSources,
	latencyMs: number,
	now: Date = new Date(),
): Promise<void> {
	if (!db) return;
	try {
		await upsertArchivedEvents(db, records, { isBackfill: false, now });
		await Promise.all([
			recordProviderHealthRun(db, {
				provider: 'eonet',
				status: sources.eonet.status,
				latencyMs,
				recordCount: sources.eonet.count,
				rejectedCount: sources.eonet.rejected,
				now,
			}),
			recordProviderHealthRun(db, {
				provider: 'usgs',
				status: sources.usgs.status,
				latencyMs,
				recordCount: sources.usgs.count,
				rejectedCount: sources.usgs.rejected,
				now,
			}),
		]);
	} catch (err) {
		console.warn('Archive write skipped:', err instanceof Error ? err.message : 'error');
	}
}

export interface BackfillResult {
	usgsFetched: number;
	eonetFetched: number;
	gdacsMatched: number;
	upserted: number;
	revisionsAdded: number;
	checkpointCursor: string;
}

/**
 * Bounded resumable backfill from USGS FDSN Event API + NASA EONET v3 `status=all`
 * plus optional GDACS spatiotemporal enrichment (never counting matched events twice).
 */
export async function runBoundedHistoryBackfill(options: {
	db: D1Database;
	days?: number;
	limit?: number;
	fetchImpl?: FetchLike;
	now?: Date;
}): Promise<BackfillResult> {
	const now = options.now ?? new Date();
	const days = Math.max(1, Math.min(30, options.days ?? 14));
	const limit = Math.max(10, Math.min(200, options.limit ?? 100));
	const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

	const endIso = now.toISOString();
	const startDate = new Date(now.getTime() - days * 86_400_000);
	const startIso = startDate.toISOString();
	const windowKey = `backfill-${days}d`;

	const usgsUrl = `${USGS_FDSN_EVENT_URL}?format=geojson&starttime=${encodeURIComponent(startIso)}&endtime=${encodeURIComponent(endIso)}&minmagnitude=4.0&limit=${limit}&orderby=time`;
	const eonetUrl = `${EONET_V3_EVENTS_URL}?status=all&start=${startIso.slice(0, 10)}&end=${endIso.slice(0, 10)}&limit=${limit}`;

	const records: DisasterRecord[] = [];
	let usgsCount = 0;
	let eonetCount = 0;

	const usgsRes = await fetchImpl(usgsUrl, { signal: AbortSignal.timeout(12_000) });
	if (usgsRes.ok) {
		const json = (await usgsRes.json()) as { features?: unknown[] };
		if (Array.isArray(json.features)) {
			const norm = normalizeUsgsFeatures(json.features);
			usgsCount = norm.records.length;
			records.push(...norm.records);
		}
	}

	const eonetRes = await fetchImpl(eonetUrl, { signal: AbortSignal.timeout(12_000) });
	if (eonetRes.ok) {
		const json = (await eonetRes.json()) as { events?: unknown[] };
		if (Array.isArray(json.events)) {
			const norm = normalizeEonetEvents(json.events);
			eonetCount = norm.records.length;
			records.push(...norm.records);
		}
	}

	const { upserted, revisionsAdded } = await upsertArchivedEvents(options.db, records, {
		isBackfill: true,
		now,
	});

	// Optional GDACS enrichment: attach GDACS event ID to matching archived events without double-counting
	let gdacsMatched = 0;
	try {
		const gdacsRes = await fetchImpl(GDACS_MAP_URL, { signal: AbortSignal.timeout(8_000) });
		if (gdacsRes.ok) {
			const gdacsJson = (await gdacsRes.json()) as {
				features?: Array<{
					geometry?: { coordinates?: [number, number] };
					properties?: { eventid?: string | number; eventtype?: string; fromdate?: string };
				}>;
			};
			if (Array.isArray(gdacsJson.features)) {
				for (const gf of gdacsJson.features.slice(0, 60)) {
					const coords = gf.geometry?.coordinates;
					const eventId = gf.properties?.eventid;
					if (!coords || coords.length < 2 || eventId == null) continue;
					const [gLng, gLat] = coords;
					const match = records.find(
						(r) => haversineKm(r.lat, r.lng, gLat, gLng) <= 75,
					);
					if (match) {
						const src = sourceForRecord(match);
						const id = `${src}:${match.id}`;
						await options.db
							.prepare(`UPDATE disaster_events SET gdacs_match_id = ? WHERE id = ? AND gdacs_match_id IS NULL`)
							.bind(String(eventId), id)
							.run();
						gdacsMatched++;
					}
				}
			}
		}
	} catch {
		// GDACS is optional enrichment and may time out
	}

	const checkpointCursor = `${startIso}..${endIso}`;
	await options.db
		.prepare(
			`INSERT INTO ingestion_checkpoints (source, window_key, cursor, last_event_time, updated_at, status, records_processed)
			 VALUES ('usgs+eonet', ?, ?, ?, ?, 'ok', ?)
			 ON CONFLICT(source, window_key) DO UPDATE SET
			   cursor = excluded.cursor,
			   last_event_time = excluded.last_event_time,
			   updated_at = excluded.updated_at,
			   status = excluded.status,
			   records_processed = excluded.records_processed`,
		)
		.bind(windowKey, checkpointCursor, endIso, now.toISOString(), records.length)
		.run();

	return {
		usgsFetched: usgsCount,
		eonetFetched: eonetCount,
		gdacsMatched,
		upserted,
		revisionsAdded,
		checkpointCursor,
	};
}

export async function queryArchivedHistory(options: {
	db: D1Database | undefined;
	from?: string;
	to?: string;
	type?: string;
	limit?: number;
}): Promise<HistoryApiResponse> {
	if (!options.db) {
		return {
			version: 1,
			storageAvailable: false,
			total: 0,
			events: [],
			note: 'D1 archive binding (AEGIS_DB) is not configured in this environment.',
		};
	}

	const limit = Math.max(1, Math.min(100, options.limit ?? 50));
	const clauses: string[] = [];
	const params: unknown[] = [];

	if (options.from && Number.isFinite(Date.parse(options.from))) {
		clauses.push('event_time >= ?');
		params.push(new Date(Date.parse(options.from)).toISOString());
	}
	if (options.to && Number.isFinite(Date.parse(options.to))) {
		clauses.push('event_time <= ?');
		params.push(new Date(Date.parse(options.to)).toISOString());
	}
	if (options.type === 'fire' || options.type === 'volcano' || options.type === 'earthquake') {
		clauses.push('type = ?');
		params.push(options.type);
	}

	const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
	const rowsRes = await options.db
		.prepare(
			`SELECT id, upstream_id, source, type, title, lat, lng, severity, magnitude, area_acres,
			        event_time, first_seen_at, ingested_at, is_backfill, attribution, gdacs_match_id
			 FROM disaster_events
			 ${whereSql}
			 ORDER BY event_time DESC
			 LIMIT ?`,
		)
		.bind(...params, limit)
		.all<{
			id: string;
			upstream_id: string;
			source: 'eonet' | 'usgs' | 'gdacs';
			type: 'fire' | 'volcano' | 'earthquake';
			title: string;
			lat: number;
			lng: number;
			severity: 'low' | 'medium' | 'high';
			magnitude: number | null;
			area_acres: number | null;
			event_time: string;
			first_seen_at: string;
			ingested_at: string;
			is_backfill: number;
			attribution: string;
			gdacs_match_id: string | null;
		}>();

	const rows = rowsRes.results ?? [];
	const events: ArchivedDisasterEvent[] = [];

	for (const r of rows) {
		const revRes = await options.db
			.prepare(
				`SELECT revision_number, observed_at, title, severity, lat, lng, source_timestamp
				 FROM disaster_revisions
				 WHERE event_id = ?
				 ORDER BY revision_number ASC
				 LIMIT 10`,
			)
			.bind(r.id)
			.all<{
				revision_number: number;
				observed_at: string;
				title: string;
				severity: string;
				lat: number;
				lng: number;
				source_timestamp: string;
			}>();

		const revisions: ArchivedEventRevision[] = (revRes.results ?? []).map((rv) => ({
			revisionNumber: rv.revision_number,
			observedAt: rv.observed_at,
			title: rv.title,
			severity: rv.severity,
			lat: rv.lat,
			lng: rv.lng,
			sourceTimestamp: rv.source_timestamp,
		}));

		events.push({
			id: r.id,
			upstreamId: r.upstream_id,
			source: r.source,
			type: r.type,
			title: r.title,
			lat: r.lat,
			lng: r.lng,
			severity: r.severity,
			magnitude: r.magnitude,
			areaAcres: r.area_acres,
			eventTime: r.event_time,
			firstSeenAt: r.first_seen_at,
			ingestedAt: r.ingested_at,
			provenance: r.is_backfill === 1 ? 'reconstructed_backfill' : 'live_captured',
			attribution: r.attribution,
			gdacsMatchId: r.gdacs_match_id,
			revisions,
		});
	}

	return {
		version: 1,
		storageAvailable: true,
		total: events.length,
		events,
	};
}

export async function querySourceAnalytics(
	db: D1Database | undefined,
	now: Date = new Date(),
): Promise<SourceAnalyticsApiResponse> {
	if (!db) {
		return {
			version: 1,
			storageAvailable: false,
			generatedAt: now.toISOString(),
			providers: [],
			note: 'D1 archive binding (AEGIS_DB) is not configured in this environment.',
		};
	}

	const aggRes = await db
		.prepare(
			`SELECT provider,
			        COUNT(*) AS runs,
			        SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok_runs,
			        SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS failed_runs,
			        AVG(latency_ms) AS avg_latency_ms,
			        MAX(run_at) AS last_run_at,
			        SUM(record_count) AS total_records,
			        SUM(rejected_count) AS total_rejected
			 FROM provider_health_runs
			 GROUP BY provider
			 ORDER BY provider ASC`,
		)
		.all<{
			provider: string;
			runs: number;
			ok_runs: number;
			failed_runs: number;
			avg_latency_ms: number | null;
			last_run_at: string | null;
			total_records: number;
			total_rejected: number;
		}>();

	const providers: ProviderHealthSummary[] = [];
	for (const row of aggRes.results ?? []) {
		const latest = await db
			.prepare(`SELECT status FROM provider_health_runs WHERE provider = ? ORDER BY run_at DESC LIMIT 1`)
			.bind(row.provider)
			.first<{ status: string }>();
		providers.push({
			provider: row.provider,
			runs: row.runs,
			okRuns: row.ok_runs ?? 0,
			failedRuns: row.failed_runs ?? 0,
			avgLatencyMs: row.avg_latency_ms !== null ? Math.round(row.avg_latency_ms) : null,
			lastRunAt: row.last_run_at,
			lastStatus: latest?.status ?? null,
			totalRecords: row.total_records ?? 0,
			totalRejected: row.total_rejected ?? 0,
		});
	}

	return {
		version: 1,
		storageAvailable: true,
		generatedAt: now.toISOString(),
		providers,
	};
}
