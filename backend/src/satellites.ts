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
