/**
 * Thin authority adapters + conditional-fetch KV snapshot caching for Official Warnings.
 * Supported pilot adapters:
 *  - no-metalerts (MET Norway MetAlerts 2.0 GeoJSON + CAP v1.2)
 *  - my-metmalaysia (MET Malaysia via data.gov.my Open API)
 *  - ir-irimo (IRIMO CAP v1.2 via WMO Alert Hub RSS feeds, fa + en)
 *  - in-sachet (NDMA India SACHET CAP RSS + FetchXMLFile + FetchPolygonXMLFile)
 */

import type { OfficialWarningItem, WarningLocalizedBlock } from '../../../shared/contracts';
import type { WarningAuthoritySpec } from '../../../shared/warningRegistry';
import {
	CLOCK_SKEW_TOLERANCE_MS,
	MISSING_EXPIRY_MAX_AGE_MS,
	normalizeSeverity,
	parseCapAlertXml,
	parseRssFeed,
	parseSachetPolygonXml,
	resolveCapLifecycle,
	sanitizeBulletinUrl,
	type CapArea,
	type ParsedCapAlert,
} from './capParser';
import { matchMalaysiaWarningText, matchPointToCapAreas } from './geoMatch';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const WARNING_FETCH_TIMEOUT_MS = 9000;
const MAX_CAP_FETCHES_PER_POLL = 8;
const WARNING_SNAPSHOT_KV_TTL_SECONDS = 7 * 24 * 60 * 60; // Keep LKG up to 7 days for stale display
const WARNING_BACKOFF_MS = 3 * 60 * 1000;
const CAP_XML_CACHE_TTL_SECONDS = 12 * 60 * 60;
const REQUEST_USER_AGENT = 'AegisMap/1.5 (https://github.com/eamaster/aegis-map; disaster-safety)';

export interface StoredWarningRecord {
	id: string;
	identifier: string;
	sourceId: string;
	issuerName: string;
	issuerUrl: string;
	countryCode: string;
	msgType: 'Alert' | 'Update' | 'Cancel' | 'Ack' | 'Error';
	category: string;
	severity: OfficialWarningItem['severity'];
	urgency: string;
	certainty: string;
	sentAt: string;
	effectiveAt: string | null;
	onsetAt: string | null;
	expiresAt: string | null;
	missingExpiry: boolean;
	clockSkewFlag: boolean;
	primaryLanguage: string;
	translations: WarningLocalizedBlock[];
	bulletinUrl: string | null;
	attribution: string;
	areas: CapArea[];
	malaysiaCombinedText?: string;
}

export interface AuthoritySnapshotDoc {
	version: 1;
	sourceId: string;
	checkedAt: string;
	lastSuccessAt: string | null;
	etag?: string | null;
	lastModified?: string | null;
	backoffUntil?: string | null;
	lastError?: string | null;
	records: StoredWarningRecord[];
}

export function authoritySnapshotKey(sourceId: string): string {
	return `warnings:source:v1:${sourceId}`;
}

function capCacheKey(url: string): string {
	let hash = 2166136261;
	for (let i = 0; i < url.length; i++) {
		hash ^= url.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return `warnings:cap:v1:${(hash >>> 0).toString(16)}`;
}

async function fetchBoundedText(
	url: string,
	fetchImpl: FetchLike,
	headers: Record<string, string> = {},
	maxBytes = 1536 * 1024,
): Promise<{ status: number; etag: string | null; lastModified: string | null; text: string }> {
	const res = await fetchImpl(url, {
		headers: { 'User-Agent': REQUEST_USER_AGENT, ...headers },
		signal: AbortSignal.timeout(WARNING_FETCH_TIMEOUT_MS),
	});
	const etag = res.headers.get('etag');
	const lastModified = res.headers.get('last-modified');
	if (res.status === 304) {
		return { status: 304, etag, lastModified, text: '' };
	}
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}`);
	}
	const text = await res.text();
	if (text.length > maxBytes) {
		throw new Error(`Response exceeded ${maxBytes} bytes`);
	}
	return { status: res.status, etag, lastModified, text };
}

function convertMalaysiaTimeToUtcIso(raw: string | null | undefined): string | null {
	if (!raw || typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed);
	const candidate = hasOffset ? trimmed : `${trimmed}+08:00`;
	const ms = Date.parse(candidate);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Adapter 1: MET Malaysia (`api.data.gov.my/weather/warning`). */
async function pollMetMalaysia(
	spec: WarningAuthoritySpec,
	fetchImpl: FetchLike,
	now: Date,
): Promise<{ records: StoredWarningRecord[]; etag: string | null; lastModified: string | null }> {
	const { text, etag, lastModified } = await fetchBoundedText(spec.feedUrls[0], fetchImpl);
	const data = JSON.parse(text) as unknown;
	if (!Array.isArray(data)) {
		throw new Error('MET Malaysia payload is not an array');
	}

	const records: StoredWarningRecord[] = [];
	for (let i = 0; i < data.length; i++) {
		const row = data[i] as Record<string, unknown> | null;
		if (!row || typeof row !== 'object') continue;
		const issue = (row.warning_issue ?? {}) as Record<string, unknown>;
		const titleEn = typeof issue.title_en === 'string' ? issue.title_en.trim() : '';
		const titleBm = typeof issue.title_bm === 'string' ? issue.title_bm.trim() : '';
		const headingEn = typeof row.heading_en === 'string' ? row.heading_en.trim() : '';
		const headingBm = typeof row.heading_bm === 'string' ? row.heading_bm.trim() : '';
		const textEn = typeof row.text_en === 'string' ? row.text_en.trim() : '';
		const textBm = typeof row.text_bm === 'string' ? row.text_bm.trim() : '';
		const instrEn = typeof row.instruction_en === 'string' ? row.instruction_en.trim() : '';
		const instrBm = typeof row.instruction_bm === 'string' ? row.instruction_bm.trim() : '';

		// Skip explicit non-warnings ("No Advisory" / "Tiada Nasihat")
		if (
			titleEn.toLowerCase() === 'no advisory' ||
			titleBm.toLowerCase() === 'tiada nasihat' ||
			headingEn.toLowerCase() === 'no advisory'
		) {
			continue;
		}

		const sentAt =
			convertMalaysiaTimeToUtcIso(typeof issue.issued === 'string' ? issue.issued : null) ?? now.toISOString();
		const onsetAt = convertMalaysiaTimeToUtcIso(typeof row.valid_from === 'string' ? row.valid_from : null);
		const expiresAt = convertMalaysiaTimeToUtcIso(typeof row.valid_to === 'string' ? row.valid_to : null);

		const translations: WarningLocalizedBlock[] = [];
		if (titleBm || textBm) {
			translations.push({
				language: 'ms',
				headline: titleBm || headingBm || titleEn,
				event: titleBm || 'Amaran Cuaca',
				description: [headingBm, textBm].filter(Boolean).join('\n\n'),
				instruction: instrBm || null,
				areaDesc: 'Lihat teks kawasan di dalam buletin MET Malaysia',
				web: spec.homepageUrl,
			});
		}
		if (titleEn || textEn) {
			translations.push({
				language: 'en',
				headline: titleEn || headingEn || titleBm,
				event: titleEn || 'Weather Warning',
				description: [headingEn, textEn].filter(Boolean).join('\n\n'),
				instruction: instrEn || null,
				areaDesc: 'See affected states/waters in MET Malaysia bulletin',
				web: spec.homepageUrl,
			});
		}
		if (translations.length === 0) continue;

		const combined = `${titleEn} ${headingEn} ${textEn} ${titleBm} ${headingBm} ${textBm}`;
		const lower = combined.toLowerCase();
		const severity: OfficialWarningItem['severity'] =
			lower.includes('danger') || lower.includes('bahaya') || lower.includes('third category')
				? 'extreme'
				: lower.includes('severe') || lower.includes('buruk') || lower.includes('second category')
					? 'severe'
					: 'moderate';

		const stableId = `my-${sentAt}-${(titleEn || titleBm).slice(0, 24).replace(/\s+/g, '-')}-${i}`;
		records.push({
			id: stableId,
			identifier: stableId,
			sourceId: spec.sourceId,
			issuerName: spec.authorityName,
			issuerUrl: spec.homepageUrl,
			countryCode: 'MY',
			msgType: 'Alert',
			category: 'Met',
			severity,
			urgency: 'Expected',
			certainty: 'Likely',
			sentAt,
			effectiveAt: sentAt,
			onsetAt,
			expiresAt,
			missingExpiry: !expiresAt,
			clockSkewFlag: Date.parse(sentAt) > now.getTime() + CLOCK_SKEW_TOLERANCE_MS,
			primaryLanguage: translations[0].language,
			translations,
			bulletinUrl: spec.homepageUrl,
			attribution: spec.attribution,
			areas: [],
			malaysiaCombinedText: combined,
		});
	}

	return { records, etag, lastModified };
}

/** Adapter 2: MET Norway (`api.met.no/weatherapi/metalerts/2.0/current.json`). */
async function pollMetNorway(
	spec: WarningAuthoritySpec,
	fetchImpl: FetchLike,
	now: Date,
	prevDoc: AuthoritySnapshotDoc | null,
): Promise<{
	notModified?: boolean;
	records: StoredWarningRecord[];
	etag: string | null;
	lastModified: string | null;
}> {
	const condHeaders: Record<string, string> = {};
	if (prevDoc?.etag) condHeaders['If-None-Match'] = prevDoc.etag;
	if (prevDoc?.lastModified) condHeaders['If-Modified-Since'] = prevDoc.lastModified;

	const res = await fetchBoundedText(spec.feedUrls[0], fetchImpl, condHeaders);
	if (res.status === 304 && prevDoc) {
		return { notModified: true, records: prevDoc.records, etag: res.etag ?? prevDoc.etag ?? null, lastModified: res.lastModified ?? prevDoc.lastModified ?? null };
	}

	const fc = JSON.parse(res.text) as {
		type?: string;
		features?: Array<{
			geometry?: { type?: string; coordinates?: unknown };
			properties?: Record<string, unknown>;
			when?: { interval?: [string, string] };
		}>;
	};
	if (!fc || !Array.isArray(fc.features)) {
		throw new Error('MET Norway payload missing features array');
	}

	const records: StoredWarningRecord[] = [];
	for (const feat of fc.features) {
		const p = feat.properties ?? {};
		const status = String(p.status ?? 'Actual');
		if (status.toLowerCase() !== 'actual') continue;

		const id = typeof p.id === 'string' ? p.id : '';
		if (!id) continue;

		const polygons: Array<Array<[number, number]>> = [];
		const geom = feat.geometry;
		if (geom?.type === 'Polygon' && Array.isArray(geom.coordinates) && Array.isArray(geom.coordinates[0])) {
			const ring = (geom.coordinates[0] as unknown[])
				.filter((pt): pt is [number, number] => Array.isArray(pt) && pt.length >= 2 && typeof pt[0] === 'number' && typeof pt[1] === 'number')
				.map(([lng, lat]): [number, number] => [lng, lat]);
			if (ring.length >= 3) polygons.push(ring);
		} else if (geom?.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
			for (const poly of geom.coordinates as unknown[]) {
				if (Array.isArray(poly) && Array.isArray(poly[0])) {
					const ring = (poly[0] as unknown[])
						.filter((pt): pt is [number, number] => Array.isArray(pt) && pt.length >= 2 && typeof pt[0] === 'number' && typeof pt[1] === 'number')
						.map(([lng, lat]): [number, number] => [lng, lat]);
					if (ring.length >= 3) polygons.push(ring);
				}
			}
		}

		const areaDesc = typeof p.area === 'string' ? p.area.trim() : '';
		const geocodes = Array.isArray(p.municipality)
			? p.municipality.map((m) => ({ valueName: 'municipality', value: String(m) }))
			: [];
		const resources = Array.isArray(p.resources) ? (p.resources as Array<{ mimeType?: string; uri?: string }>) : [];
		const capResource = resources.find((r) => r.mimeType === 'application/xml' && typeof r.uri === 'string')?.uri;
		const webUrl = sanitizeBulletinUrl(typeof p.web === 'string' ? p.web : null) ?? sanitizeBulletinUrl(capResource) ?? spec.homepageUrl;

		const interval = Array.isArray(feat.when?.interval) ? feat.when.interval : null;
		const onsetAt = interval?.[0] && Number.isFinite(Date.parse(interval[0])) ? new Date(Date.parse(interval[0])).toISOString() : null;
		const expiresAt = interval?.[1] && Number.isFinite(Date.parse(interval[1])) ? new Date(Date.parse(interval[1])).toISOString() : null;

		const headline = typeof p.title === 'string' ? p.title.trim() : String(p.eventAwarenessName ?? p.event ?? 'Weather Warning');
		const eventName = typeof p.eventAwarenessName === 'string' ? p.eventAwarenessName.trim() : String(p.event ?? 'Hazard');
		const description = typeof p.description === 'string' ? p.description.trim() : '';
		const instruction = typeof p.instruction === 'string' && p.instruction.trim() ? p.instruction.trim() : null;

		records.push({
			id: `no-${id}`,
			identifier: id,
			sourceId: spec.sourceId,
			issuerName: spec.authorityName,
			issuerUrl: spec.homepageUrl,
			countryCode: 'NO',
			msgType: p.type === 'Update' ? 'Update' : p.type === 'Cancel' ? 'Cancel' : 'Alert',
			category: 'Met',
			severity: normalizeSeverity(String(p.riskMatrixColor ?? p.severity ?? 'unknown')),
			urgency: 'Expected',
			certainty: String(p.certainty ?? 'Likely'),
			sentAt: now.toISOString(),
			effectiveAt: onsetAt,
			onsetAt,
			expiresAt,
			missingExpiry: !expiresAt,
			clockSkewFlag: false,
			primaryLanguage: 'no',
			translations: [
				{
					language: 'no',
					headline,
					event: eventName,
					description,
					instruction,
					areaDesc,
					web: webUrl,
				},
			],
			bulletinUrl: webUrl,
			attribution: spec.attribution,
			areas: [{ areaDesc, polygons, circles: [], geocodes }],
		});
	}

	return { records, etag: res.etag, lastModified: res.lastModified };
}

/** Adapter 3 & 4: CAP RSS feeds (IRIMO fa/en & India SACHET + FetchPolygonXMLFile). */
async function pollCapRssAuthority(
	spec: WarningAuthoritySpec,
	countryCode: string,
	fetchImpl: FetchLike,
	kv: KVNamespace | undefined,
	now: Date,
	prevDoc: AuthoritySnapshotDoc | null,
): Promise<{
	notModified?: boolean;
	records: StoredWarningRecord[];
	etag: string | null;
	lastModified: string | null;
}> {
	const condHeaders: Record<string, string> = {};
	if (spec.feedUrls.length === 1 && prevDoc?.etag) condHeaders['If-None-Match'] = prevDoc.etag;
	if (spec.feedUrls.length === 1 && prevDoc?.lastModified) condHeaders['If-Modified-Since'] = prevDoc.lastModified;

	let firstEtag: string | null = null;
	let firstLastMod: string | null = null;
	const itemLinks: string[] = [];

	for (let fIdx = 0; fIdx < spec.feedUrls.length; fIdx++) {
		const feedRes = await fetchBoundedText(spec.feedUrls[fIdx], fetchImpl, fIdx === 0 ? condHeaders : {});
		if (fIdx === 0) {
			firstEtag = feedRes.etag;
			firstLastMod = feedRes.lastModified;
			if (feedRes.status === 304 && prevDoc && spec.feedUrls.length === 1) {
				return {
					notModified: true,
					records: prevDoc.records,
					etag: feedRes.etag ?? prevDoc.etag ?? null,
					lastModified: feedRes.lastModified ?? prevDoc.lastModified ?? null,
				};
			}
		}
		const rssItems = parseRssFeed(feedRes.text);
		for (const item of rssItems.slice(0, MAX_CAP_FETCHES_PER_POLL)) {
			const safe = sanitizeBulletinUrl(item.link);
			if (safe && !itemLinks.includes(safe)) {
				itemLinks.push(safe);
			}
		}
	}

	const parsedAlerts: ParsedCapAlert[] = [];
	let networkFetches = 0;

	for (const link of itemLinks) {
		let xmlText: string | null = null;
		const cKey = capCacheKey(link);
		if (kv) {
			try {
				xmlText = await kv.get(cKey);
			} catch {
				xmlText = null;
			}
		}
		if (!xmlText) {
			if (networkFetches >= MAX_CAP_FETCHES_PER_POLL) break;
			try {
				networkFetches++;
				const res = await fetchBoundedText(link, fetchImpl);
				xmlText = res.text;
				if (kv) {
					await kv.put(cKey, xmlText, { expirationTtl: CAP_XML_CACHE_TTL_SECONDS }).catch(() => {});
				}
			} catch {
				continue;
			}
		}

		try {
			const parsed = parseCapAlertXml(xmlText);
			if (!parsed) continue;
			// Hydrate SACHET external polygon URLs if present and bounded
			for (const info of parsed.infos) {
				const hasPoly = info.areas.some((a) => a.polygons.length > 0);
				if (!hasPoly && info.polygonUrls.length > 0 && networkFetches < MAX_CAP_FETCHES_PER_POLL) {
					try {
						networkFetches++;
						const polyUrl = info.polygonUrls[0];
						const pKey = capCacheKey(polyUrl);
						let polyXml = kv ? await kv.get(pKey).catch(() => null) : null;
						if (!polyXml) {
							polyXml = (await fetchBoundedText(polyUrl, fetchImpl)).text;
							if (kv) await kv.put(pKey, polyXml, { expirationTtl: CAP_XML_CACHE_TTL_SECONDS }).catch(() => {});
						}
						const rings = parseSachetPolygonXml(polyXml);
						if (rings.length > 0) {
							if (info.areas.length === 0) {
								info.areas.push({ areaDesc: '', polygons: rings, circles: [], geocodes: [] });
							} else {
								info.areas[0].polygons.push(...rings);
							}
						}
					} catch {
						// Best-effort polygon hydration; keeps zone-only matchUncertain fallback
					}
				}
			}
			parsedAlerts.push(parsed);
		} catch {
			// Skip malformed individual CAP item while keeping valid siblings
		}
	}

	const resolved = resolveCapLifecycle(parsedAlerts, now);
	const records: StoredWarningRecord[] = [];
	for (const item of resolved) {
		if (item.lifecycleState === 'cancelled' || item.lifecycleState === 'superseded' || item.lifecycleState === 'expired') {
			continue;
		}
		const primaryInfo = item.alert.infos[0];
		if (!primaryInfo) continue;

		records.push({
			id: `${spec.sourceId}-${item.alert.identifier}`,
			identifier: item.alert.identifier,
			sourceId: spec.sourceId,
			issuerName: spec.authorityName,
			issuerUrl: spec.homepageUrl,
			countryCode,
			msgType: item.alert.msgType,
			category: primaryInfo.category,
			severity: normalizeSeverity(primaryInfo.severity),
			urgency: primaryInfo.urgency,
			certainty: primaryInfo.certainty,
			sentAt: item.alert.sent,
			effectiveAt: primaryInfo.effective,
			onsetAt: primaryInfo.onset,
			expiresAt: primaryInfo.expires,
			missingExpiry: item.missingExpiry,
			clockSkewFlag: item.clockSkewFlag,
			primaryLanguage: primaryInfo.language,
			translations: item.mergedLanguages,
			bulletinUrl: primaryInfo.web ?? spec.homepageUrl,
			attribution: spec.attribution,
			areas: primaryInfo.areas,
		});
	}

	return { records, etag: firstEtag, lastModified: firstLastMod };
}

export async function refreshOrLoadAuthoritySnapshot(
	spec: WarningAuthoritySpec,
	options: {
		kv?: KVNamespace;
		fetchImpl?: FetchLike;
		now?: Date;
		forceRefresh?: boolean;
	} = {},
): Promise<{ doc: AuthoritySnapshotDoc; status: 'ok' | 'stale' | 'unavailable' | 'not_modified' }> {
	const now = options.now ?? new Date();
	const nowMs = now.getTime();
	const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
	const key = authoritySnapshotKey(spec.sourceId);

	let prevDoc: AuthoritySnapshotDoc | null = null;
	if (options.kv) {
		try {
			const raw = await options.kv.get(key);
			if (raw) {
				const parsed = JSON.parse(raw) as Partial<AuthoritySnapshotDoc>;
				if (parsed.version === 1 && Array.isArray(parsed.records)) {
					prevDoc = parsed as AuthoritySnapshotDoc;
				}
			}
		} catch {
			prevDoc = null;
		}
	}

	const lastCheckedMs = prevDoc?.checkedAt ? Date.parse(prevDoc.checkedAt) : NaN;
	const withinMinPoll =
		!options.forceRefresh &&
		Number.isFinite(lastCheckedMs) &&
		nowMs - lastCheckedMs < spec.pollMinIntervalSeconds * 1000;
	const backoffActive =
		!options.forceRefresh &&
		prevDoc?.backoffUntil &&
		Date.parse(prevDoc.backoffUntil) > nowMs;

	if (prevDoc && (withinMinPoll || backoffActive)) {
		const isFresh =
			prevDoc.lastSuccessAt !== null &&
			nowMs - Date.parse(prevDoc.lastSuccessAt) <= spec.pollMinIntervalSeconds * 4 * 1000;
		return {
			doc: prevDoc,
			status: prevDoc.lastSuccessAt ? (isFresh ? 'ok' : 'stale') : 'unavailable',
		};
	}

	try {
		let pollResult: {
			notModified?: boolean;
			records: StoredWarningRecord[];
			etag: string | null;
			lastModified: string | null;
		};

		if (spec.feedFormat === 'datagovmy_json') {
			pollResult = await pollMetMalaysia(spec, fetchImpl, now);
		} else if (spec.feedFormat === 'metno_geojson_and_cap') {
			pollResult = await pollMetNorway(spec, fetchImpl, now, prevDoc);
		} else {
			pollResult = await pollCapRssAuthority(
				spec,
				spec.countryCodes[0],
				fetchImpl,
				options.kv,
				now,
				prevDoc,
			);
		}

		const nextDoc: AuthoritySnapshotDoc = {
			version: 1,
			sourceId: spec.sourceId,
			checkedAt: now.toISOString(),
			lastSuccessAt: now.toISOString(),
			etag: pollResult.etag,
			lastModified: pollResult.lastModified,
			backoffUntil: null,
			lastError: null,
			records: pollResult.records,
		};

		if (options.kv) {
			await options.kv
				.put(key, JSON.stringify(nextDoc), { expirationTtl: WARNING_SNAPSHOT_KV_TTL_SECONDS })
				.catch(() => {});
		}

		return { doc: nextDoc, status: pollResult.notModified ? 'not_modified' : 'ok' };
	} catch (err) {
		const reason = err instanceof Error ? err.message : 'Upstream fetch error';
		const failedDoc: AuthoritySnapshotDoc = {
			version: 1,
			sourceId: spec.sourceId,
			checkedAt: now.toISOString(),
			lastSuccessAt: prevDoc?.lastSuccessAt ?? null,
			etag: prevDoc?.etag ?? null,
			lastModified: prevDoc?.lastModified ?? null,
			backoffUntil: new Date(nowMs + WARNING_BACKOFF_MS).toISOString(),
			lastError: reason,
			// Preserve last-known-good alerts during transient outage or truncated response
			records: prevDoc?.records ?? [],
		};

		if (options.kv) {
			await options.kv
				.put(key, JSON.stringify(failedDoc), { expirationTtl: WARNING_SNAPSHOT_KV_TTL_SECONDS })
				.catch(() => {});
		}

		return {
			doc: failedDoc,
			status: prevDoc?.lastSuccessAt ? 'stale' : 'unavailable',
		};
	}
}

export function matchStoredRecordToPoint(
	rec: StoredWarningRecord,
	lat: number,
	lng: number,
	now: Date = new Date(),
): OfficialWarningItem | null {
	const nowMs = now.getTime();
	const expiresMs = rec.expiresAt ? Date.parse(rec.expiresAt) : NaN;
	const onsetMs = rec.onsetAt ? Date.parse(rec.onsetAt) : NaN;
	const sentMs = Date.parse(rec.sentAt);

	if (Number.isFinite(expiresMs) && expiresMs <= nowMs) return null;
	if (rec.missingExpiry && Number.isFinite(sentMs) && nowMs - sentMs > MISSING_EXPIRY_MAX_AGE_MS) {
		return null;
	}

	const match =
		rec.sourceId === 'my-metmalaysia' && rec.malaysiaCombinedText
			? matchMalaysiaWarningText(lat, lng, rec.malaysiaCombinedText)
			: matchPointToCapAreas(lat, lng, rec.areas, { countryCode: rec.countryCode });

	if (!match.matched) return null;

	const lifecycleState: OfficialWarningItem['lifecycleState'] =
		Number.isFinite(onsetMs) && onsetMs > nowMs + CLOCK_SKEW_TOLERANCE_MS ? 'upcoming' : 'active';

	return {
		id: rec.id,
		identifier: rec.identifier,
		sourceId: rec.sourceId,
		issuerName: rec.issuerName,
		issuerUrl: rec.issuerUrl,
		countryCode: rec.countryCode,
		msgType: rec.msgType,
		lifecycleState,
		category: rec.category,
		severity: rec.severity,
		urgency: rec.urgency,
		certainty: rec.certainty,
		sentAt: rec.sentAt,
		effectiveAt: rec.effectiveAt,
		onsetAt: rec.onsetAt,
		expiresAt: rec.expiresAt,
		missingExpiry: rec.missingExpiry,
		clockSkewFlag: rec.clockSkewFlag,
		matchMethod: match.method,
		matchUncertain: match.uncertain,
		matchNote: match.note,
		primaryLanguage: rec.primaryLanguage,
		translations: rec.translations,
		bulletinUrl: rec.bulletinUrl,
		attribution: rec.attribution,
	};
}
