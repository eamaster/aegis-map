/**
 * Capability metadata for the monitored satellite fleet only.
 * Sourced from public mission docs (Landsat OLI/TIRS, Sentinel-2 MSI, Terra/Aqua MODIS).
 * None of these platforms carry SAR — do not invent SAR for them.
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

function normalizeName(name: string): string {
	return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Resolve capabilities for a TLE/satellite display name from the monitored fleet.
 * Returns null when the satellite is not in the known registry (capabilities unknown).
 */
export function resolveSatelliteCapabilities(satelliteName: string): {
	noradId: number | null;
	capabilities: SensorCapabilities | null;
} {
	const normalized = normalizeName(satelliteName);
	const compact = normalized.replace(/[\s_-]+/g, '');

	for (const [id, entry] of Object.entries(BY_NORAD)) {
		for (const alias of entry.names) {
			const aliasNorm = normalizeName(alias);
			const aliasCompact = aliasNorm.replace(/[\s_-]+/g, '');
			if (
				normalized === aliasNorm ||
				compact === aliasCompact ||
				normalized.includes(aliasNorm) ||
				aliasNorm.includes(normalized)
			) {
				return { noradId: Number(id), capabilities: entry.capabilities };
			}
		}
	}

	return { noradId: null, capabilities: null };
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
