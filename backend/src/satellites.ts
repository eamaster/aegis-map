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
 * Compute the standard NORAD TLE checksum (mod 10).
 * Digits 0-9 count as their face value, '-' counts as 1, all other characters count as 0.
 * Computed over columns 0 through 67.
 */
export function computeTleChecksum(line: string): number {
	let checksum = 0;
	const content = line.substring(0, 68);
	for (let i = 0; i < content.length; i++) {
		const char = content[i];
		if (char >= '0' && char <= '9') {
			checksum += Number.parseInt(char, 10);
		} else if (char === '-') {
			checksum += 1;
		}
	}
	return checksum % 10;
}

export type ParsedTleRecord = {
	noradId: number;
	name: string;
	line1: string;
	line2: string;
};

/**
 * Validate a 3-line TLE record (name, line1, line2).
 * Verifies catalog IDs, line prefixes, lengths, and checksums.
 */
export function validateTleRecord(lines: readonly string[]): {
	valid: boolean;
	record?: ParsedTleRecord;
	reason?: string;
} {
	if (lines.length < 3) {
		return { valid: false, reason: 'Record requires at least 3 lines' };
	}

	const name = lines[0].trim();
	const line1 = lines[1].trim();
	const line2 = lines[2].trim();

	if (!name) {
		return { valid: false, reason: 'Satellite name is empty' };
	}

	if (!line1.startsWith('1 ') || line1.length < 68) {
		return { valid: false, reason: 'Line 1 is invalid format or length' };
	}
	if (!line2.startsWith('2 ') || line2.length < 68) {
		return { valid: false, reason: 'Line 2 is invalid format or length' };
	}

	const catNr1 = Number.parseInt(line1.substring(2, 7).trim(), 10);
	const catNr2 = Number.parseInt(line2.substring(2, 7).trim(), 10);

	if (Number.isNaN(catNr1) || Number.isNaN(catNr2) || catNr1 !== catNr2) {
		return { valid: false, reason: 'Catalog number mismatch or invalid' };
	}

	const check1Expected = Number.parseInt(line1[line1.length - 1], 10);
	const check2Expected = Number.parseInt(line2[line2.length - 1], 10);

	if (computeTleChecksum(line1) !== check1Expected) {
		return { valid: false, reason: 'Line 1 checksum mismatch' };
	}
	if (computeTleChecksum(line2) !== check2Expected) {
		return { valid: false, reason: 'Line 2 checksum mismatch' };
	}

	return {
		valid: true,
		record: {
			noradId: catNr1,
			name,
			line1,
			line2,
		},
	};
}

/**
 * Parse a multi-satellite raw TLE text block into a map keyed by NORAD ID.
 */
export function parseTleText(tleText: string): Map<number, ParsedTleRecord> {
	const map = new Map<number, ParsedTleRecord>();
	if (!tleText || !tleText.trim()) return map;

	const rawLines = tleText.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

	for (let i = 0; i + 2 < rawLines.length; i += 3) {
		const result = validateTleRecord([rawLines[i], rawLines[i + 1], rawLines[i + 2]]);
		if (result.valid && result.record) {
			map.set(result.record.noradId, result.record);
		}
	}

	return map;
}

/**
 * Serialize a map of TLE records to standard text block in monitored fleet order.
 */
export function serializeTles(tleMap: Map<number, ParsedTleRecord>): string {
	const lines: string[] = [];

	// First output monitored satellites in canonical order
	for (const id of MONITORED_NORAD_IDS) {
		const rec = tleMap.get(id);
		if (rec) {
			lines.push(rec.name, rec.line1, rec.line2);
		}
	}

	// Then any extra satellites not in monitored array
	for (const [id, rec] of tleMap.entries()) {
		if (!(MONITORED_NORAD_IDS as readonly number[]).includes(id)) {
			lines.push(rec.name, rec.line1, rec.line2);
		}
	}

	return lines.join('\n');
}

/**
 * Merge newly fetched TLE records with existing/cached records.
 * Ensures a single satellite fetch failure does not discard other valid cached records.
 */
export function mergeTles(
	existingTleText: string | null | undefined,
	freshRecords: ParsedTleRecord[],
): string {
	const map = parseTleText(existingTleText || '');

	for (const rec of freshRecords) {
		map.set(rec.noradId, rec);
	}

	return serializeTles(map);
}

