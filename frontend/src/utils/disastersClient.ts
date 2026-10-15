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
                const status = headerStatus ?? {
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
        }
    } catch {
        // Fall back to legacy /api/disasters
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
    const wildfires = legacyList.filter((d) => d.type === 'fire');
    const volcanoes = legacyList.filter((d) => d.type === 'volcano');
    const earthquakes = legacyList.filter((d) => d.type === 'earthquake');
    const status = parseDisasterSourceHeaders(legacyResponse.headers);
    const fetchedAtHeader = legacyResponse.headers.get('X-Disaster-Fetched-At');
    const fetchedAt = fetchedAtHeader ? new Date(fetchedAtHeader) : new Date();

    return {
        wildfires,
        fireCells: [],
        earthquakes,
        volcanoes,
        detectionCountTotal: 0,
        sourceStatus: status,
        fetchedAt: Number.isNaN(fetchedAt.getTime()) ? new Date() : fetchedAt,
        window,
        isV2: false,
        firmsStatus: 'unavailable',
    };
}
