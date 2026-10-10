/**
 * Capability metadata for the monitored satellite fleet only.
 * Sourced from public mission docs (Landsat OLI/TIRS, Sentinel-2 MSI, Terra/Aqua MODIS).
 * None of these platforms carry SAR — do not invent SAR for them.
 *
 * Matching uses exact normalized aliases only (no substring / reverse-substring).
 */

export type SensorCapabilities = {
	optical: boolean;
	thermal: boolean;
	sar: boolean;
	summary: string;
};

/** NORAD catalog numbers fetched by GET /api/tles */
export const MONITORED_NORAD_IDS = [39084, 49260, 40697, 42063, 25994, 27424] as const;

const BY_NORAD: Record<number, { names: string[]; capabilities: SensorCapabilities }> = {
	39084: {
		names: ['LANDSAT 8', 'LANDSAT-8', 'LANDSAT8'],
		capabilities: {
			optical: true,
			thermal: true,
			sar: false,
			summary: 'Landsat-8: optical multispectral (OLI) and thermal infrared (TIRS). No SAR.',
		},
	},
	49260: {
		names: ['LANDSAT 9', 'LANDSAT-9', 'LANDSAT9'],
		capabilities: {
			optical: true,
			thermal: true,
			sar: false,
			summary: 'Landsat-9: optical multispectral (OLI-2) and thermal infrared (TIRS-2). No SAR.',
		},
	},
	40697: {
		names: ['SENTINEL-2A', 'SENTINEL 2A', 'S2A'],
		capabilities: {
			optical: true,
			thermal: false,
			sar: false,
			summary: 'Sentinel-2A: optical multispectral (MSI) only. No thermal. No SAR.',
		},
	},
	42063: {
		names: ['SENTINEL-2B', 'SENTINEL 2B', 'S2B'],
		capabilities: {
			optical: true,
			thermal: false,
			sar: false,
			summary: 'Sentinel-2B: optical multispectral (MSI) only. No thermal. No SAR.',
		},
	},
	25994: {
		names: ['TERRA', 'EOS TERRA'],
		capabilities: {
			optical: true,
			thermal: true,
			sar: false,
			summary: 'Terra (MODIS): optical and thermal infrared bands. No SAR.',
		},
	},
	27424: {
		names: ['AQUA', 'EOS AQUA'],
		capabilities: {
			optical: true,
			thermal: true,
			sar: false,
			summary: 'Aqua (MODIS): optical and thermal infrared bands. No SAR.',
		},
	},
};

/** Normalize for exact alias comparison: trim, upper, collapse whitespace, unify hyphens. */
export function normalizeSatelliteName(name: string): string {
	return name.trim().toUpperCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

function compactSatelliteName(name: string): string {
	return normalizeSatelliteName(name).replace(/\s+/g, '');
}

/** Build exact-alias lookup once (spaced + compact forms). */
const ALIAS_INDEX: Map<string, { noradId: number; capabilities: SensorCapabilities }> = (() => {
	const map = new Map<string, { noradId: number; capabilities: SensorCapabilities }>();
	for (const [id, entry] of Object.entries(BY_NORAD)) {
		const noradId = Number(id);
		for (const alias of entry.names) {
			const spaced = normalizeSatelliteName(alias);
			const compact = compactSatelliteName(alias);
			map.set(spaced, { noradId, capabilities: entry.capabilities });
			map.set(compact, { noradId, capabilities: entry.capabilities });
		}
	}
	return map;
})();

/**
 * Resolve capabilities for a TLE/satellite display name from the monitored fleet.
 * Exact normalized aliases only — unknown and ambiguous names stay unknown.
 */
export function resolveSatelliteCapabilities(satelliteName: string): {
	noradId: number | null;
	capabilities: SensorCapabilities | null;
} {
	const spaced = normalizeSatelliteName(satelliteName);
	const compact = compactSatelliteName(satelliteName);

	const hit = ALIAS_INDEX.get(spaced) ?? ALIAS_INDEX.get(compact);
	if (!hit) {
		return { noradId: null, capabilities: null };
	}
	return hit;
}

export function formatCapabilityContext(
	satelliteName: string,
	capabilities: SensorCapabilities | null,
): string {
	if (!capabilities) {
		return `Satellite "${satelliteName}" is not in the monitored fleet capability map. Sensor capabilities are unknown — do not invent optical, thermal, or SAR sensors.`;
	}
	return `Named satellite sensors: ${capabilities.summary} optical=${capabilities.optical}; thermal=${capabilities.thermal}; sar=${capabilities.sar}.`;
}

/**
 * TLE freshness policy for 24-hour pass predictions:
 * - Elements whose epoch is older than TLE_MAX_EPOCH_AGE_DAYS are never served
 *   (SGP4 along-track error for these LEO platforms grows to several km/day,
 *   which shifts 5-minute pass sampling noticeably after about a week).
 * - Cached records are refreshed from CelesTrak once TLE_REFRESH_AFTER_MS has
 *   elapsed since they were fetched; until a refresh succeeds, the valid cached
 *   record is retained and reported as retained, not as fresh.
 * - After a refresh attempt where any satellite failed, further upstream
 *   attempts wait TLE_REFRESH_BACKOFF_MS (no per-request refresh storms).
 */
export const TLE_LINE_LENGTH = 69;
export const TLE_MAX_EPOCH_AGE_DAYS = 7;
export const TLE_MAX_FUTURE_EPOCH_DAYS = 1;
export const TLE_REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
export const TLE_REFRESH_BACKOFF_MS = 15 * 60 * 1000;
export const TLE_FETCH_TIMEOUT_MS = 6000;
export const TLE_CACHE_KEY = 'tles:v3';
export const TLE_CACHE_TTL_SECONDS = TLE_MAX_EPOCH_AGE_DAYS * 24 * 60 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute the standard NORAD TLE checksum (mod 10) over columns 1-68.
 * Digits count as their value, '-' counts as 1, everything else counts as 0.
 */
export function computeTleChecksum(line: string): number {
	let checksum = 0;
	const content = line.substring(0, 68);
	for (let i = 0; i < content.length; i++) {
		const char = content[i];
		if (char >= '0' && char <= '9') {
			checksum += char.charCodeAt(0) - 48;
		} else if (char === '-') {
			checksum += 1;
		}
	}
	return checksum % 10;
}

/** Parse the line-1 epoch (columns 19-32, YYDDD.DDDDDDDD) as a UTC Date. */
export function parseTleEpoch(line1: string): Date | null {
	const field = line1.substring(18, 32);
	if (!/^\d{5}\.\d{8}$/.test(field)) return null;
	const yy = Number(field.slice(0, 2));
	const dayOfYear = Number(field.slice(2));
	const year = yy < 57 ? 2000 + yy : 1900 + yy;
	const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
	if (dayOfYear < 1 || dayOfYear >= (isLeap ? 367 : 366)) return null;
	return new Date(Date.UTC(year, 0, 1) + (dayOfYear - 1) * DAY_MS);
}

export type ParsedTleRecord = {
	noradId: number;
	name: string;
	line1: string;
	line2: string;
	epoch: string;
};

export interface TleValidationOptions {
	/** Requested NORAD ID; the record must describe exactly this object. */
	expectedNoradId?: number;
	/** Reference time for the epoch age policy. */
	now?: Date;
}

function validateElementLine(line: string, prefix: '1' | '2'): string | null {
	if (line.length !== TLE_LINE_LENGTH) return `Line ${prefix} must be ${TLE_LINE_LENGTH} characters (got ${line.length})`;
	if (line[0] !== prefix || line[1] !== ' ') return `Line ${prefix} has wrong line number`;
	const checkChar = line[68];
	if (checkChar < '0' || checkChar > '9') return `Line ${prefix} checksum column is not a digit`;
	if (computeTleChecksum(line) !== checkChar.charCodeAt(0) - 48) return `Line ${prefix} checksum mismatch`;
	return null;
}

/**
 * Validate exactly one 3-line record (name, line 1, line 2): fixed 69-column
 * element lines, column-69 checksums, matching catalog numbers, the requested
 * NORAD ID, and an epoch within the freshness policy.
 */
export function validateTleRecord(
	lines: readonly string[],
	options: TleValidationOptions = {},
): { valid: boolean; record?: ParsedTleRecord; reason?: string } {
	if (lines.length !== 3) {
		return { valid: false, reason: `Expected exactly 3 lines, got ${lines.length}` };
	}

	const name = lines[0].trim();
	const line1 = lines[1].trimEnd();
	const line2 = lines[2].trimEnd();

	if (!name || name.startsWith('1 ') || name.startsWith('2 ')) {
		return { valid: false, reason: 'Satellite name line is missing' };
	}
	const line1Error = validateElementLine(line1, '1');
	if (line1Error) return { valid: false, reason: line1Error };
	const line2Error = validateElementLine(line2, '2');
	if (line2Error) return { valid: false, reason: line2Error };

	const cat1 = line1.substring(2, 7);
	const cat2 = line2.substring(2, 7);
	if (!/^\d{5}$/.test(cat1.trim().padStart(5, '0')) || cat1 !== cat2) {
		return { valid: false, reason: 'Catalog number mismatch or invalid' };
	}
	const noradId = Number(cat1.trim());
	if (options.expectedNoradId !== undefined && noradId !== options.expectedNoradId) {
		return { valid: false, reason: `Expected NORAD ${options.expectedNoradId}, got ${noradId}` };
	}

	const epoch = parseTleEpoch(line1);
	if (!epoch) {
		return { valid: false, reason: 'Epoch field is invalid' };
	}
	const now = options.now ?? new Date();
	const ageMs = now.getTime() - epoch.getTime();
	if (ageMs > TLE_MAX_EPOCH_AGE_DAYS * DAY_MS) {
		return { valid: false, reason: `Epoch ${epoch.toISOString()} is older than ${TLE_MAX_EPOCH_AGE_DAYS} days` };
	}
	if (ageMs < -TLE_MAX_FUTURE_EPOCH_DAYS * DAY_MS) {
		return { valid: false, reason: `Epoch ${epoch.toISOString()} is in the future` };
	}

	return { valid: true, record: { noradId, name, line1, line2, epoch: epoch.toISOString() } };
}

/** Parse one provider response for a requested NORAD ID (exactly one record). */
export function parseProviderTle(text: string, expectedNoradId: number, now: Date) {
	const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
	return validateTleRecord(lines, { expectedNoradId, now });
}

export type CachedTleRecord = ParsedTleRecord & { fetchedAt: string };

export interface TleCacheDocument {
	version: 3;
	records: Record<string, { name: string; line1: string; line2: string; fetchedAt: string }>;
	lastFailedRefreshAt?: string;
}

/**
 * Re-validate every cached record before use; anything malformed, keyed under
 * the wrong ID, outside the monitored fleet, or past the epoch policy is dropped.
 */
export function readTleCache(raw: string | null, now: Date): {
	records: Map<number, CachedTleRecord>;
	lastFailedRefreshAt: number | null;
	dropped: number;
} {
	const records = new Map<number, CachedTleRecord>();
	if (!raw) return { records, lastFailedRefreshAt: null, dropped: 0 };

	let doc: unknown;
	try {
		doc = JSON.parse(raw);
	} catch {
		return { records, lastFailedRefreshAt: null, dropped: 1 };
	}
	const d = doc as Partial<TleCacheDocument> | null;
	if (!d || d.version !== 3 || !d.records || typeof d.records !== 'object') {
		return { records, lastFailedRefreshAt: null, dropped: 1 };
	}

	let dropped = 0;
	for (const [key, entry] of Object.entries(d.records)) {
		const id = Number(key);
		const fetchedAtMs = entry && typeof entry.fetchedAt === 'string' ? Date.parse(entry.fetchedAt) : NaN;
		if (
			!(MONITORED_NORAD_IDS as readonly number[]).includes(id) ||
			!entry ||
			typeof entry.name !== 'string' ||
			typeof entry.line1 !== 'string' ||
			typeof entry.line2 !== 'string' ||
			!Number.isFinite(fetchedAtMs) ||
			fetchedAtMs > now.getTime() + 60_000
		) {
			dropped++;
			continue;
		}
		const result = validateTleRecord([entry.name, entry.line1, entry.line2], { expectedNoradId: id, now });
		if (!result.valid || !result.record) {
			dropped++;
			continue;
		}
		records.set(id, { ...result.record, fetchedAt: new Date(fetchedAtMs).toISOString() });
	}

	const failedMs = typeof d.lastFailedRefreshAt === 'string' ? Date.parse(d.lastFailedRefreshAt) : NaN;
	return { records, lastFailedRefreshAt: Number.isFinite(failedMs) ? failedMs : null, dropped };
}

export function writeTleCache(records: Map<number, CachedTleRecord>, lastFailedRefreshAt: Date | null): string {
	const doc: TleCacheDocument = { version: 3, records: {} };
	for (const [id, rec] of records) {
		doc.records[String(id)] = { name: rec.name, line1: rec.line1, line2: rec.line2, fetchedAt: rec.fetchedAt };
	}
	if (lastFailedRefreshAt) doc.lastFailedRefreshAt = lastFailedRefreshAt.toISOString();
	return JSON.stringify(doc);
}

/** Serialize records as standard 3-line TLE text in monitored fleet order. */
export function serializeTles(records: Map<number, ParsedTleRecord>): string {
	const lines: string[] = [];
	for (const id of MONITORED_NORAD_IDS) {
		const rec = records.get(id);
		if (rec) lines.push(rec.name, rec.line1, rec.line2);
	}
	return lines.join('\n');
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TleLoadResult {
	/** complete: every monitored satellite served; partial: some missing. */
	status: 'complete' | 'partial';
	records: Map<number, CachedTleRecord>;
	missing: number[];
	/** IDs fetched from CelesTrak during this request. */
	refreshed: number[];
	/** IDs past the refresh point, served from cache because refresh failed or was backed off. */
	retained: number[];
	/** IDs whose refresh attempt failed during this request. */
	failed: number[];
	backoffActive: boolean;
}

export interface TleStore {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export function celestrakTleUrl(noradId: number): string {
	return `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=tle`;
}

/**
 * Load monitored TLEs under the single cache policy above. One bounded
 * request per satellite needing refresh, no retries.
 */
export async function loadMonitoredTles(
	store: TleStore | undefined,
	options: { now?: Date; fetchImpl?: FetchLike } = {},
): Promise<TleLoadResult> {
	const now = options.now ?? new Date();
	const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));

	let raw: string | null = null;
	if (store) {
		try {
			raw = await store.get(TLE_CACHE_KEY);
		} catch (err) {
			console.warn('TLE cache read failed:', err instanceof Error ? err.name : 'Error');
		}
	}
	const cache = readTleCache(raw, now);
	if (cache.dropped > 0) console.warn(`TLE cache: dropped ${cache.dropped} invalid or expired entries`);
	const records = cache.records;

	const due = MONITORED_NORAD_IDS.filter((id) => {
		const rec = records.get(id);
		return !rec || now.getTime() - Date.parse(rec.fetchedAt) >= TLE_REFRESH_AFTER_MS;
	});
	const backoffActive =
		cache.lastFailedRefreshAt !== null && now.getTime() - cache.lastFailedRefreshAt < TLE_REFRESH_BACKOFF_MS;

	const refreshed: number[] = [];
	const failed: number[] = [];

	if (due.length > 0 && !backoffActive) {
		await Promise.all(
			due.map(async (id) => {
				try {
					const response = await fetchImpl(celestrakTleUrl(id), {
						headers: { 'User-Agent': 'AegisMap/1.2 (Satellite-Monitor)' },
						signal: AbortSignal.timeout(TLE_FETCH_TIMEOUT_MS),
					});
					if (!response.ok) {
						console.warn(`TLE ${id}: HTTP ${response.status}`);
						failed.push(id);
						return;
					}
					const result = parseProviderTle(await response.text(), id, now);
					if (!result.valid || !result.record) {
						console.warn(`TLE ${id}: rejected (${result.reason})`);
						failed.push(id);
						return;
					}
					records.set(id, { ...result.record, fetchedAt: now.toISOString() });
					refreshed.push(id);
				} catch (err) {
					console.warn(`TLE ${id}: ${err instanceof Error ? err.name : 'Error'}`);
					failed.push(id);
				}
			}),
		);

		if (store) {
			try {
				await store.put(TLE_CACHE_KEY, writeTleCache(records, failed.length > 0 ? now : null), {
					expirationTtl: TLE_CACHE_TTL_SECONDS,
				});
			} catch (err) {
				console.warn('TLE cache write failed:', err instanceof Error ? err.name : 'Error');
			}
		}
	}

	const missing = MONITORED_NORAD_IDS.filter((id) => !records.has(id));
	const retained = due.filter((id) => records.has(id) && !refreshed.includes(id));

	return {
		status: missing.length === 0 ? 'complete' : 'partial',
		records,
		missing,
		refreshed: refreshed.sort((a, b) => a - b),
		retained,
		failed: failed.sort((a, b) => a - b),
		backoffActive,
	};
}
