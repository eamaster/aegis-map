import { apiUrl } from '../config/api';
import { DEFAULT_OBSERVATION_WINDOW, DEFAULT_VOLCANO_MODE } from '../config/disasters';
import type {
    Disaster,
    DisasterSourceStatus,
    DisastersV2Response,
    FireDetectionCell,
    ObservationWindow,
    VolcanoMode,
} from '../types';
import { parseDisasterSourceHeaders } from './disasterSources';

export interface LoadDisastersOptions {
    window?: ObservationWindow;
    volcanoMode?: VolcanoMode;
}

export interface LoadDisastersResult {
    wildfires: Disaster[];
    fireCells: FireDetectionCell[];
    earthquakes: Disaster[];
    volcanoes: Disaster[];
    detectionCountTotal: number;
    sourceStatus: DisasterSourceStatus | null;
    fetchedAt: Date;
    window: ObservationWindow;
    isV2: boolean;
    firmsStatus?: 'ok' | 'stale' | 'partial' | 'unavailable' | 'warming';
    firmsGeneratedAt?: string;
    legacyNotice?: string;
}

let hasWarnedV2Fallback = false;

/** Reset the one-time v2 fallback warning flag (used in unit tests). */
export function resetV2FallbackWarning(): void {
    hasWarnedV2Fallback = false;
}

function warnV2FallbackOnce(reason: string): void {
    if (hasWarnedV2Fallback) return;
    hasWarnedV2Fallback = true;
    console.warn(`[AegisMap] /api/v2/disasters unavailable (${reason}); falling back to legacy /api/disasters.`);
}

/**
 * Filter legacy `/api/disasters` records by the selected observation window and volcano mode.
 * Note: Legacy `/api/disasters` only fetches the USGS 24h M2.5+ feed, so `7d` in legacy mode
 * filters wildfires/volcanoes to 7 days while earthquakes remain limited to ~24h.
 */
export function filterLegacyDisastersByWindow(
    records: Disaster[],
    window: ObservationWindow,
    volcanoMode: VolcanoMode = DEFAULT_VOLCANO_MODE,
    now: Date = new Date(),
): { wildfires: Disaster[]; volcanoes: Disaster[]; earthquakes: Disaster[]; legacyNotice: string } {
    const windowHours = window === '7d' ? 168 : 24;
    const endMs = now.getTime();
    const startMs = endMs - windowHours * 3_600_000;

    const isInWindow = (isoDate: string): boolean => {
        const ms = Date.parse(isoDate);
        return !Number.isNaN(ms) && ms >= startMs && ms < endMs;
    };

    const wildfires: Disaster[] = [];
    const volcanoes: Disaster[] = [];
    const earthquakes: Disaster[] = [];

    for (const d of records) {
        const inWin = isInWindow(d.date);
        if (d.type === 'earthquake') {
            if (inWin) earthquakes.push(d);
            continue;
        }
        if (d.type === 'fire' || d.type === 'volcano') {
            if (volcanoMode === 'strict' && !inWin) continue;
            const item: Disaster = inWin ? d : { ...d, isHistoricalContext: true };
            if (d.type === 'fire') wildfires.push(item);
            else volcanoes.push(item);
        }
    }

    const legacyNotice =
        window === '7d'
            ? 'Legacy fallback (7d): earthquakes limited to ~24h feed; satellite hotspots unavailable'
            : 'Legacy fallback (24h): satellite hotspots unavailable';

    return { wildfires, volcanoes, earthquakes, legacyNotice };
}

export function isV2Response(data: unknown): data is DisastersV2Response {
    if (!data || typeof data !== 'object') return false;
    const v = data as Partial<DisastersV2Response>;
    return (
        v.version === 2 &&
        Array.isArray(v.wildfires) &&
        Array.isArray(v.fireCells) &&
        Array.isArray(v.earthquakes) &&
        Array.isArray(v.volcanoes) &&
        typeof v.summary === 'object' &&
        v.summary !== null
    );
}

/** Convert a FireDetectionCell into a selectable Disaster item for sidebar and map details. */
export function cellToDisasterItem(cell: FireDetectionCell): Disaster {
    return {
        id: cell.cellId,
        type: 'fire_detection',
        title: `Thermal Hotspot Cell (${cell.detectionCount} detections)`,
        lat: cell.lat,
        lng: cell.lng,
        date: cell.latestAcqTime,
        severity: cell.intensity,
        detectionCell: cell,
    };
}

/**
 * Fetch disaster data from the backend. Prefers /api/v2/disasters with strict
 * window intervals, separate FIRMS cells, and volcano context. Gracefully falls
 * back to legacy /api/disasters if v2 is unavailable.
 */
export async function fetchDisastersData(
    options: LoadDisastersOptions = {},
): Promise<LoadDisastersResult> {
    const window = options.window ?? DEFAULT_OBSERVATION_WINDOW;
    const volcanoMode = options.volcanoMode ?? DEFAULT_VOLCANO_MODE;

    const v2Url = apiUrl(
        `/api/v2/disasters?window=${encodeURIComponent(window)}&volcanoMode=${encodeURIComponent(volcanoMode)}`,
    );

    try {
        const response = await fetch(v2Url);
        if (response.ok) {
            const data: unknown = await response.json();
            if (isV2Response(data)) {
                const headerStatus = parseDisasterSourceHeaders(response.headers);
                const firmsStatus = data.sources.firms.status;
                const status: DisasterSourceStatus = headerStatus ?? {
                    eonet: data.sources.eonet.status,
                    usgs: data.sources.usgs.status,
                    firms: firmsStatus,
                    partial:
                        data.sources.eonet.status !== 'ok' ||
                        data.sources.usgs.status !== 'ok' ||
                        (firmsStatus !== 'ok' && firmsStatus !== 'stale'),
                };
                if (!status.firms) {
                    status.firms = firmsStatus;
                }
                status.firmsGeneratedAt = data.sources.firms.generatedAt;
                status.firmsSensors = data.sources.firms.sensors;

                const fetchedAt = new Date(data.fetchedAt);
                return {
                    wildfires: data.wildfires,
                    fireCells: data.fireCells,
                    earthquakes: data.earthquakes,
                    volcanoes: data.volcanoes,
                    detectionCountTotal: data.summary.fireDetections,
                    sourceStatus: status,
                    fetchedAt: Number.isNaN(fetchedAt.getTime()) ? new Date() : fetchedAt,
                    window: data.window,
                    isV2: true,
                    firmsStatus,
                    firmsGeneratedAt: data.sources.firms.generatedAt,
                };
            }
            warnV2FallbackOnce('invalid v2 payload');
        } else {
            warnV2FallbackOnce(`HTTP ${response.status}`);
        }
    } catch (err) {
        warnV2FallbackOnce(err instanceof Error ? err.message : 'network error');
    }

    const legacyUrl = apiUrl('/api/disasters');
    const legacyResponse = await fetch(legacyUrl);
    if (!legacyResponse.ok) {
        throw new Error(`Disaster API error: ${legacyResponse.status}`);
    }
    const legacyData: unknown = await legacyResponse.json();
    if (!Array.isArray(legacyData)) {
        throw new Error('Disaster API returned invalid data');
    }

    const legacyList = legacyData as Disaster[];
    const status = parseDisasterSourceHeaders(legacyResponse.headers);
    const fetchedAtHeader = legacyResponse.headers.get('X-Disaster-Fetched-At');
    const parsedFetchedAt = fetchedAtHeader ? new Date(fetchedAtHeader) : new Date();
    const fetchedAt = Number.isNaN(parsedFetchedAt.getTime()) ? new Date() : parsedFetchedAt;
    const { wildfires, volcanoes, earthquakes, legacyNotice } = filterLegacyDisastersByWindow(
        legacyList,
        window,
        volcanoMode,
        fetchedAt,
    );

    return {
        wildfires,
        fireCells: [],
        earthquakes,
        volcanoes,
        detectionCountTotal: 0,
        sourceStatus: status,
        fetchedAt,
        window,
        isV2: false,
        firmsStatus: 'unavailable',
        legacyNotice,
    };
}
