/**
 * Centralized Mapbox map configuration and error classification.
 * Keeps style URLs, layer/source registries, and fatal vs. recoverable
 * Mapbox error rules in one place (zero hardcoding in MapBoard).
 */

export const MAP_STYLES = {
    /** Satellite imagery with streets/labels (uses Mapbox raster + vector tiles). */
    primary: 'mapbox://styles/mapbox/satellite-streets-v12',
    /** Vector-only fallback when Mapbox raster satellite tiles are rate-limited (HTTP 429). */
    fallback: 'mapbox://styles/mapbox/dark-v11',
} as const;

export const MAP_INITIAL_VIEW = {
    center: [0, 20] as [number, number],
    zoom: 1.3,
    pitch: 0,
    bearing: 0,
    projection: 'globe' as const,
} as const;

export const DISASTER_SOURCE_IDS = ['fires', 'fire-cells', 'earthquakes', 'volcanoes'] as const;
export const DISASTER_LAYER_IDS = [
    'fires-layer',
    'fire-cells-layer',
    'earthquakes-layer',
    'volcanoes-layer',
] as const;

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
    | { kind: 'fallback_basemap'; reason: string }
    | { kind: 'ignore'; detail: string };

/**
 * Classify a Mapbox GL JS `error` event so transient or per-tile failures
 * never unmount the Live Monitor legend or block the interactive map.
 *
 * - HTTP 429 (e.g. Mapbox raster tile quota/rate limit on `mapbox.satellite`):
 *   triggers a one-time automatic fallback to `MAP_STYLES.fallback` (vector basemap),
 *   and suppresses duplicate subsequent tile 429s.
 * - HTTP 401/403 or WebGL initialization errors: fatal (invalid token or unsupported browser).
 * - Other tile/source/network errors: non-fatal (`ignore`) so disaster markers and
 *   monitoring controls remain usable.
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
                kind: 'fallback_basemap',
                reason: 'Satellite basemap tiles rate-limited (HTTP 429); switched to vector basemap.',
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
