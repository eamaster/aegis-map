/**
 * Bounded, XXE-safe CAP v1.2 XML & RSS parser + lifecycle resolver.
 * - Rejects DOCTYPE / ENTITY declarations before parsing.
 * - Enforces CAP status="Actual" and scope="Public".
 * - Resolves Alert / Update / Cancel chains via <references> even on out-of-order arrivals.
 * - Merges mirrored duplicate alerts and preserves multiple <info> language blocks.
 * - Converts CAP "lat,lng" vertices strictly to GeoJSON [lng, lat] order.
 */

import type { WarningLifecycleState, WarningLocalizedBlock, WarningSeverity } from '../../../shared/contracts';

export const MAX_CAP_XML_BYTES = 512 * 1024;
export const MAX_RSS_XML_BYTES = 1536 * 1024;
export const CLOCK_SKEW_TOLERANCE_MS = 10 * 60 * 1000;
export const MISSING_EXPIRY_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export interface CapReference {
	sender: string;
	identifier: string;
	sent: string;
}

export interface CapGeocode {
	valueName: string;
	value: string;
}

export interface CapCircle {
	lat: number;
	lng: number;
	radiusKm: number;
}

export interface CapArea {
	areaDesc: string;
	/** GeoJSON [lng, lat] outer rings converted from CAP lat,lng pairs. */
	polygons: Array<Array<[number, number]>>;
	circles: CapCircle[];
	geocodes: CapGeocode[];
}

export interface CapInfoBlock {
	language: string;
	category: string;
	event: string;
	urgency: string;
	severity: string;
	certainty: string;
	effective: string | null;
	onset: string | null;
	expires: string | null;
	senderName: string;
	headline: string;
	description: string;
	instruction: string | null;
	web: string | null;
	polygonUrls: string[];
	areas: CapArea[];
}

export interface ParsedCapAlert {
	identifier: string;
	sender: string;
	sent: string;
	sentMs: number;
	status: string;
	msgType: 'Alert' | 'Update' | 'Cancel' | 'Ack' | 'Error';
	scope: string;
	references: CapReference[];
	infos: CapInfoBlock[];
}

export interface RssFeedItem {
	title: string;
	link: string;
	guid: string;
	pubDate: string | null;
}

export function assertSafeXml(xmlText: string, maxBytes = MAX_CAP_XML_BYTES): void {
	if (typeof xmlText !== 'string' || xmlText.trim().length === 0) {
		throw new Error('Empty XML payload');
	}
	if (xmlText.length > maxBytes) {
		throw new Error(`XML exceeds maximum allowed size (${maxBytes} chars)`);
	}
	if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xmlText)) {
		throw new Error('Unsafe XML declaration (DOCTYPE/ENTITY rejected)');
	}
}

export function decodeXmlEntities(input: string): string {
	return input
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
		.replace(/&#(\d+);/g, (_, dec) => {
			const code = Number(dec);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
		})
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
			const code = parseInt(hex, 16);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
		})
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

function stripTags(input: string): string {
	return decodeXmlEntities(input.replace(/<[^>]+>/g, '')).trim();
}

/** Extract all immediate/non-nested XML element inner blocks matching `tagName` (with optional namespace prefix). */
export function extractTagBlocks(xml: string, tagName: string): string[] {
	const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tagName}>`, 'gi');
	const out: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = re.exec(xml)) !== null) {
		out.push(match[1]);
	}
	return out;
}

function firstTagText(xml: string, tagName: string): string {
	const blocks = extractTagBlocks(xml, tagName);
	return blocks.length > 0 ? stripTags(blocks[0]) : '';
}

export function sanitizeBulletinUrl(raw: string | null | undefined): string | null {
	if (!raw || typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const normalized = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
	try {
		const u = new URL(normalized);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
	} catch {
		return null;
	}
}

function parseIsoOrNull(raw: string): string | null {
	if (!raw) return null;
	const ms = Date.parse(raw.trim());
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Parse CAP `<polygon>` string ("lat,lng lat,lng ...") into GeoJSON `[lng, lat]` ring.
 * Rejects malformed or out-of-range coordinates.
 */
export function parseCapPolygonToGeoJsonRing(raw: string): Array<[number, number]> | null {
	const tokens = raw.trim().split(/\s+/).filter(Boolean);
	const ring: Array<[number, number]> = [];
	for (const tok of tokens) {
		const parts = tok.split(',');
		if (parts.length !== 2) return null;
		const lat = Number(parts[0]);
		const lng = Number(parts[1]);
		if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
			return null;
		}
		ring.push([lng, lat]);
	}
	if (ring.length < 3) return null;
	return ring;
}

/** Parse CAP `<circle>` ("lat,lng radiusKm"). */
export function parseCapCircle(raw: string): CapCircle | null {
	const match = /^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/.exec(raw);
	if (!match) return null;
	const lat = Number(match[1]);
	const lng = Number(match[2]);
	const radiusKm = Number(match[3]);
	if (
		!Number.isFinite(lat) ||
		!Number.isFinite(lng) ||
		!Number.isFinite(radiusKm) ||
		Math.abs(lat) > 90 ||
		Math.abs(lng) > 180 ||
		radiusKm < 0
	) {
		return null;
	}
	return { lat, lng, radiusKm };
}

export function parseCapReferences(raw: string): CapReference[] {
	const refs: CapReference[] = [];
	// CAP references are whitespace-separated triplets "sender,identifier,sent"
	const tokens = raw.trim().split(/\s+/).filter(Boolean);
	for (const tok of tokens) {
		const parts = tok.split(',');
		if (parts.length >= 3) {
			const sender = parts[0].trim();
			const identifier = parts[1].trim();
			const sent = parts.slice(2).join(',').trim();
			if (identifier) {
				refs.push({ sender, identifier, sent });
			}
		}
	}
	return refs;
}

export function parseSachetPolygonXml(xmlText: string): Array<Array<[number, number]>> {
	assertSafeXml(xmlText);
	const rings: Array<Array<[number, number]>> = [];
	for (const polyRaw of extractTagBlocks(xmlText, 'polygon')) {
		const ring = parseCapPolygonToGeoJsonRing(stripTags(polyRaw));
		if (ring) rings.push(ring);
	}
	return rings;
}

export function parseRssFeed(xmlText: string): RssFeedItem[] {
	assertSafeXml(xmlText, MAX_RSS_XML_BYTES);
	if (!/<rss\b|<feed\b|<channel\b/i.test(xmlText)) {
		throw new Error('Malformed RSS/Atom feed (missing root channel)');
	}
	const itemBlocks = extractTagBlocks(xmlText, 'item');
	const items: RssFeedItem[] = [];
	for (const block of itemBlocks) {
		const link = firstTagText(block, 'link');
		const title = firstTagText(block, 'title');
		const guid = firstTagText(block, 'guid') || link;
		const pubDate = parseIsoOrNull(firstTagText(block, 'pubDate'));
		if (link) {
			items.push({ title, link, guid, pubDate });
		}
	}
	return items;
}

export function parseCapAlertXml(xmlText: string): ParsedCapAlert | null {
	assertSafeXml(xmlText, MAX_CAP_XML_BYTES);
	const alertBlocks = extractTagBlocks(xmlText, 'alert');
	const root = alertBlocks[0];
	if (!root) {
		throw new Error('Malformed CAP XML: missing <alert> root');
	}

	const identifier = firstTagText(root, 'identifier');
	const sender = firstTagText(root, 'sender');
	const sentRaw = firstTagText(root, 'sent');
	const sentIso = parseIsoOrNull(sentRaw);
	const status = firstTagText(root, 'status');
	const msgTypeRaw = firstTagText(root, 'msgType');
	const scope = firstTagText(root, 'scope');

	if (!identifier || !sentIso) {
		return null;
	}
	// CAP safety rule: only Actual + Public alerts may reach residents
	if (status.toLowerCase() !== 'actual' || scope.toLowerCase() !== 'public') {
		return null;
	}

	const msgType: ParsedCapAlert['msgType'] =
		msgTypeRaw === 'Alert' ||
		msgTypeRaw === 'Update' ||
		msgTypeRaw === 'Cancel' ||
		msgTypeRaw === 'Ack' ||
		msgTypeRaw === 'Error'
			? msgTypeRaw
			: 'Alert';

	const references = parseCapReferences(firstTagText(root, 'references'));
	const infoBlocks = extractTagBlocks(root, 'info');
	const infos: CapInfoBlock[] = [];

	for (const ib of infoBlocks) {
		const language = firstTagText(ib, 'language') || 'und';
		const category = firstTagText(ib, 'category') || 'Other';
		const event = firstTagText(ib, 'event');
		const urgency = firstTagText(ib, 'urgency') || 'Unknown';
		const severity = firstTagText(ib, 'severity') || 'Unknown';
		const certainty = firstTagText(ib, 'certainty') || 'Unknown';
		const effective = parseIsoOrNull(firstTagText(ib, 'effective'));
		const onset = parseIsoOrNull(firstTagText(ib, 'onset'));
		const expires = parseIsoOrNull(firstTagText(ib, 'expires'));
		const senderName = firstTagText(ib, 'senderName') || sender;
		const headline = firstTagText(ib, 'headline') || event;
		const description = firstTagText(ib, 'description');
		const instructionRaw = firstTagText(ib, 'instruction');
		const web = sanitizeBulletinUrl(firstTagText(ib, 'web'));

		const polygonUrls: string[] = [];
		for (const paramBlock of extractTagBlocks(ib, 'parameter')) {
			const vn = firstTagText(paramBlock, 'valueName');
			const val = firstTagText(paramBlock, 'value');
			if (vn.toLowerCase() === 'polygon url') {
				const safePolyUrl = sanitizeBulletinUrl(val);
				if (safePolyUrl) polygonUrls.push(safePolyUrl);
			}
		}

		const areas: CapArea[] = [];
		for (const ab of extractTagBlocks(ib, 'area')) {
			const areaDesc = firstTagText(ab, 'areaDesc');
			const polygons: Array<Array<[number, number]>> = [];
			for (const polyRaw of extractTagBlocks(ab, 'polygon')) {
				const ring = parseCapPolygonToGeoJsonRing(stripTags(polyRaw));
				if (ring) polygons.push(ring);
			}
			const circles: CapCircle[] = [];
			for (const circRaw of extractTagBlocks(ab, 'circle')) {
				const c = parseCapCircle(stripTags(circRaw));
				if (c) circles.push(c);
			}
			const geocodes: CapGeocode[] = [];
			for (const geoBlock of extractTagBlocks(ab, 'geocode')) {
				const valueName = firstTagText(geoBlock, 'valueName');
				const value = firstTagText(geoBlock, 'value');
				if (valueName && value) geocodes.push({ valueName, value });
			}
			areas.push({ areaDesc, polygons, circles, geocodes });
		}

		infos.push({
			language,
			category,
			event,
			urgency,
			severity,
			certainty,
			effective,
			onset,
			expires,
			senderName,
			headline,
			description,
			instruction: instructionRaw || null,
			web,
			polygonUrls,
			areas,
		});
	}

	return {
		identifier,
		sender,
		sent: sentIso,
		sentMs: Date.parse(sentIso),
		status,
		msgType,
		scope,
		references,
		infos,
	};
}

export function normalizeSeverity(raw: string): WarningSeverity {
	const s = raw.trim().toLowerCase();
	if (s === 'extreme' || s === 'red') return 'extreme';
	if (s === 'severe' || s === 'orange') return 'severe';
	if (s === 'moderate' || s === 'yellow') return 'moderate';
	if (s === 'minor' || s === 'green') return 'minor';
	return 'unknown';
}

export interface ResolvedCapAlert {
	alert: ParsedCapAlert;
	lifecycleState: WarningLifecycleState;
	missingExpiry: boolean;
	clockSkewFlag: boolean;
	mergedLanguages: WarningLocalizedBlock[];
	/** Transitive closure of referenced CAP identifiers (for superseding Update/Cancel chains). */
	referencedIdentifiers: string[];
	supersededByIdentifier: string | null;
}

function areaHasGeometry(area: CapArea): boolean {
	return area.polygons.length > 0 || area.circles.length > 0 || area.geocodes.length > 0;
}

/**
 * Resolve CAP lifecycle across a batch of parsed alerts:
 * - Deduplicates mirrored alerts by `(sender, identifier)` or `identifier` + merges language blocks.
 * - Supersedes/cancels earlier alerts referenced by newer `Update` or `Cancel` messages (even if arrived out of order).
 * - Computes transitive CAP reference closures and inherits parent areas when Update/Cancel omits geometry.
 * - Flags missing `<expires>`, future `<sent>` clock skew, and `upcoming` vs `active` vs `expired`.
 */
export function resolveCapLifecycle(
	rawAlerts: readonly ParsedCapAlert[],
	now: Date = new Date(),
): ResolvedCapAlert[] {
	const nowMs = now.getTime();
	const deduped = new Map<string, ParsedCapAlert>();

	for (const alert of rawAlerts) {
		if (alert.msgType === 'Ack' || alert.msgType === 'Error') continue;
		const key = `${alert.identifier}`;
		const existing = deduped.get(key);
		if (!existing) {
			deduped.set(key, {
				...alert,
				infos: alert.infos.map((info) => ({
					...info,
					areas: info.areas.map((a) => ({
						...a,
						polygons: [...a.polygons],
						circles: [...a.circles],
						geocodes: [...a.geocodes],
					})),
				})),
				references: [...alert.references],
			});
		} else {
			// Merge distinct language info blocks & any references from mirrored feeds
			const seenLangs = new Set(existing.infos.map((i) => i.language.toLowerCase()));
			for (const info of alert.infos) {
				if (!seenLangs.has(info.language.toLowerCase())) {
					existing.infos.push(info);
					seenLangs.add(info.language.toLowerCase());
				}
			}
			for (const ref of alert.references) {
				if (!existing.references.some((r) => r.identifier === ref.identifier)) {
					existing.references.push(ref);
				}
			}
		}
	}

	// Build transitive reference closure & track superseding/cancelling replacements
	const supersededBy = new Map<string, { msgType: 'Update' | 'Cancel'; sentMs: number; byIdentifier: string }>();
	for (const alert of deduped.values()) {
		if (alert.msgType === 'Update' || alert.msgType === 'Cancel') {
			for (const ref of alert.references) {
				const prev = supersededBy.get(ref.identifier);
				if (!prev || alert.sentMs >= prev.sentMs) {
					supersededBy.set(ref.identifier, {
						msgType: alert.msgType,
						sentMs: alert.sentMs,
						byIdentifier: alert.identifier,
					});
				}
			}
		}
	}

	const closureCache = new Map<string, string[]>();
	const collectTransitiveRefs = (id: string, visiting = new Set<string>()): string[] => {
		const cached = closureCache.get(id);
		if (cached) return cached;
		if (visiting.has(id)) return [];
		visiting.add(id);
		const node = deduped.get(id);
		const out: string[] = [];
		const seen = new Set<string>();
		if (node) {
			for (const ref of node.references) {
				if (ref.identifier && ref.identifier !== id && !seen.has(ref.identifier)) {
					seen.add(ref.identifier);
					out.push(ref.identifier);
				}
				for (const subId of collectTransitiveRefs(ref.identifier, visiting)) {
					if (subId !== id && !seen.has(subId)) {
						seen.add(subId);
						out.push(subId);
					}
				}
			}
		}
		visiting.delete(id);
		closureCache.set(id, out);
		return out;
	};

	const resolved: ResolvedCapAlert[] = [];
	for (const alert of deduped.values()) {
		const referencedIdentifiers = collectTransitiveRefs(alert.identifier);
		const sup = supersededBy.get(alert.identifier);

		// Inherit parent areas if an Update/Cancel omitted geometry
		const primaryInfo = alert.infos[0];
		const hasAnyGeo = primaryInfo?.areas.some(areaHasGeometry) ?? false;
		if (!hasAnyGeo && referencedIdentifiers.length > 0) {
			for (const refId of referencedIdentifiers) {
				const parentInfo = deduped.get(refId)?.infos[0];
				if (parentInfo && parentInfo.areas.some(areaHasGeometry)) {
					if (primaryInfo) {
						if (primaryInfo.areas.length === 0) {
							primaryInfo.areas = parentInfo.areas.map((a) => ({
								...a,
								polygons: [...a.polygons],
								circles: [...a.circles],
								geocodes: [...a.geocodes],
							}));
						} else {
							primaryInfo.areas.push(...parentInfo.areas);
						}
					} else {
						alert.infos.push({
							...parentInfo,
							areas: parentInfo.areas.map((a) => ({
								...a,
								polygons: [...a.polygons],
								circles: [...a.circles],
								geocodes: [...a.geocodes],
							})),
						});
					}
					break;
				}
			}
		}

		let lifecycleState: WarningLifecycleState;
		let supersededByIdentifier: string | null = null;
		if (alert.msgType === 'Cancel') {
			lifecycleState = 'cancelled';
		} else if (sup && sup.sentMs >= alert.sentMs) {
			lifecycleState = sup.msgType === 'Cancel' ? 'cancelled' : 'superseded';
			supersededByIdentifier = sup.byIdentifier;
		} else {
			const effInfo = alert.infos[0];
			const expiresMs = effInfo?.expires ? Date.parse(effInfo.expires) : NaN;
			const onsetMs = effInfo?.onset ? Date.parse(effInfo.onset) : NaN;
			const missingExpiry = !effInfo?.expires;

			if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
				lifecycleState = 'expired';
			} else if (missingExpiry && nowMs - alert.sentMs > MISSING_EXPIRY_MAX_AGE_MS) {
				lifecycleState = 'expired';
			} else if (Number.isFinite(onsetMs) && onsetMs > nowMs + CLOCK_SKEW_TOLERANCE_MS) {
				lifecycleState = 'upcoming';
			} else {
				lifecycleState = 'active';
			}
		}

		const finalInfo = alert.infos[0];
		const missingExpiry = !finalInfo?.expires;
		const clockSkewFlag = alert.sentMs > nowMs + CLOCK_SKEW_TOLERANCE_MS;

		const mergedLanguages: WarningLocalizedBlock[] = alert.infos.map((info) => ({
			language: info.language,
			headline: info.headline,
			event: info.event,
			description: info.description,
			instruction: info.instruction,
			areaDesc: info.areas.map((a) => a.areaDesc).filter(Boolean).join('; '),
			web: info.web,
		}));

		resolved.push({
			alert,
			lifecycleState,
			missingExpiry,
			clockSkewFlag,
			mergedLanguages,
			referencedIdentifiers,
			supersededByIdentifier,
		});
	}

	return resolved;
}
