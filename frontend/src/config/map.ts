/**
 * Centralized Mapbox Standard Satellite configuration, satellite tile fallback,
 * layer/source registries, and error classification.
 * Reference: https://docs.mapbox.com/map-styles/guides/standard-styles/#mapbox-standard-satellite
 */

export const MAP_STYLES = {
    /** Official Mapbox GL JS v3 Standard Satellite style. */
    primary: 'mapbox://styles/mapbox/standard-satellite',
} as const;

/** Standard Satellite basemap configuration (Mapbox GL JS v3). */
export const MAP_BASEMAP_CONFIG = {
    basemap: {
        showPlaceLabels: true,
        showRoadLabels: true,
        showPointOfInterestLabels: false,
    },
} as const;

export const MAP_INITIAL_VIEW = {
    center: [0, 20] as [number, number],
    zoom: 1.3,
    pitch: 0,
    bearing: 0,
    projection: 'globe' as const,
} as const;

/**
 * Fallback satellite raster tile service (Esri World Imagery, CORS-enabled, no API key)
 * mounted in Standard Satellite's `bottom` slot ONLY when Mapbox's `mapbox.satellite`
 * raster tiles return HTTP 429. Preserves the satellite globe, borders, place labels,
 * and WebGL context without calling `setStyle()`.
 */
export const FALLBACK_SATELLITE_SOURCE_ID = 'fallback-satellite-imagery';
export const FALLBACK_SATELLITE_LAYER_ID = 'fallback-satellite-imagery-layer';
export const FALLBACK_SATELLITE_TILE_TEMPLATE =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const SATELLITE_FALLBACK_TTL_MS = 60 * 60 * 1000; // 1 hour per browser session

const SATELLITE_FALLBACK_STORAGE_PREFIX = 'aegis-map:sat-fallback:';

/** Derive a non-secret storage key scoped to the active Mapbox token (without storing the token). */
function satelliteFallbackStorageKey(token: string): string {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i++) {
        hash ^= token.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return `${SATELLITE_FALLBACK_STORAGE_PREFIX}${(hash >>> 0).toString(16)}`;
}

/** Check whether satellite tile fallback was already activated for this token in the current session. */
export function isSatelliteFallbackRemembered(
    token: string | undefined,
    storage: Pick<Storage, 'getItem' | 'removeItem'> | null | undefined =
        typeof window !== 'undefined' ? window.sessionStorage : null,
    nowMs: number = Date.now(),
): boolean {
    if (!token || !storage) return false;
    const key = satelliteFallbackStorageKey(token);
    try {
        const raw = storage.getItem(key);
        if (!raw) return false;
        const expiresAt = Number(raw);
        if (!Number.isFinite(expiresAt) || nowMs >= expiresAt) {
            storage.removeItem(key);
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

/** Remember satellite tile fallback for this token in sessionStorage to avoid repeated 429 bursts on reload. */
export function rememberSatelliteFallback(
    token: string | undefined,
    storage: Pick<Storage, 'setItem'> | null | undefined =
        typeof window !== 'undefined' ? window.sessionStorage : null,
    nowMs: number = Date.now(),
): void {
    if (!token || !storage) return;
    try {
        storage.setItem(satelliteFallbackStorageKey(token), String(nowMs + SATELLITE_FALLBACK_TTL_MS));
    } catch {
        // Ignore private-mode storage errors
    }
}

const MAPBOX_SATELLITE_TILE_RE =
    /^https:\/\/api\.mapbox\.com\/v4\/mapbox\.satellite\/(\d+)\/(\d+)\/(\d+)(?:@2x)?\.(?:webp|jpg\d*|png)(?:\?.*)?$/i;

/**
 * Rewrite a rate-limited Mapbox satellite raster tile URL to the equivalent
 * Esri World Imagery XYZ tile (Esri uses `{z}/{y}/{x}`). Returns null for
 * non-satellite URLs (styles, fonts, sprites, vector borders/labels).
 */
export function rewriteSatelliteTileUrl(url: string): string | null {
    const match = MAPBOX_SATELLITE_TILE_RE.exec(url);
    if (!match) return null;
    const [, z, x, y] = match;
    return FALLBACK_SATELLITE_TILE_TEMPLATE
        .replace('{z}', z)
        .replace('{y}', y)
        .replace('{x}', x);
}

export const SELECTED_DISASTER_SOURCE_ID = 'selected-disaster';
export const SELECTED_DISASTER_LAYER_ID = 'selected-disaster-ring-layer';

export const DISASTER_SOURCE_IDS = ['fires', 'fire-cells', 'earthquakes', 'volcanoes'] as const;

/**
 * Render/hit-test priority order for disaster layers (topmost interactive priority first).
 * Used by both layer cleanup and unified click/hover resolution so tooltips and
 * clicks always resolve the exact same feature when markers overlap.
 */
export const DISASTER_LAYER_PRIORITY = [
    'fires-layer',
    'volcanoes-layer',
    'earthquakes-layer',
    'fire-cells-layer',
] as const;

export const DISASTER_LAYER_IDS = DISASTER_LAYER_PRIORITY;

export const DISASTER_LAYER_ICONS: Readonly<Record<(typeof DISASTER_LAYER_PRIORITY)[number], string>> = {
    'fires-layer': '🔥',
    'volcanoes-layer': '🌋',
    'earthquakes-layer': '🌍',
    'fire-cells-layer': '🛰️',
};

export interface MapboxErrorEventLike {
    sourceId?: string;
    error?: {
        status?: number;
        message?: string;
        url?: string;
    };
}

export type MapErrorAction =
    | { kind: 'fatal'; message: string }
    | { kind: 'fallback_satellite_tiles'; reason: string }
    | { kind: 'ignore'; detail: string };

/**
 * Classify a Mapbox GL JS `error` event so transient or per-tile failures
 * never unmount the Live Monitor legend, switch away from satellite imagery,
 * or rebuild the Mapbox style.
 */
export function classifyMapboxError(
    event: MapboxErrorEventLike | null | undefined,
    options: { hasFallbackApplied: boolean },
): MapErrorAction {
    const status = event?.error?.status;
    const rawMessage = typeof event?.error?.message === 'string' ? event.error.message.trim() : '';
    const lower = rawMessage.toLowerCase();
    const url = typeof event?.error?.url === 'string' ? event.error.url : '';

    if (status === 429 || lower.includes('too many requests')) {
        if (!options.hasFallbackApplied) {
            return {
                kind: 'fallback_satellite_tiles',
                reason: 'Mapbox satellite tiles rate-limited (HTTP 429); switched to backup satellite imagery.',
            };
        }
        return { kind: 'ignore', detail: `Tile rate-limited (429): ${url || rawMessage}` };
    }

    if (
        status === 401 ||
        status === 403 ||
        lower.includes('unauthorized') ||
        lower.includes('access token') ||
        lower.includes('webgl')
    ) {
        return {
            kind: 'fatal',
            message: rawMessage
                ? `Map error: ${rawMessage}`
                : 'Mapbox authentication or WebGL initialization failed.',
        };
    }

    return {
        kind: 'ignore',
        detail: rawMessage || (status ? `HTTP ${status}` : 'Non-fatal map tile error'),
    };
}
