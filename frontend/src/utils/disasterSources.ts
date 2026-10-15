import type { Disaster, DisasterSourceState, DisasterSourceStatus } from '../types';

const SOURCE_STATES: readonly DisasterSourceState[] = ['ok', 'failed', 'malformed'];

function readState(value: string | undefined): DisasterSourceState | 'unknown' {
    return SOURCE_STATES.includes(value as DisasterSourceState) ? (value as DisasterSourceState) : 'unknown';
}

/** Parses X-Disaster-Sources ("eonet=ok;usgs=failed"), X-FIRMS-Status, and X-Disaster-Partial. Returns null when absent. */
export function parseDisasterSourceHeaders(headers: Headers): DisasterSourceStatus | null {
    const raw = headers.get('X-Disaster-Sources');
    const firmsRaw = headers.get('X-FIRMS-Status');
    if (!raw && !firmsRaw) return null;
    const entries = new Map<string, string>();
    if (raw) {
        for (const part of raw.split(';')) {
            const [name, value] = part.split('=').map((s) => s.trim());
            if (name) entries.set(name, value);
        }
    }
    const eonet = readState(entries.get('eonet'));
    const usgs = readState(entries.get('usgs'));
    const firms = firmsRaw ? (firmsRaw as DisasterSourceStatus['firms']) : undefined;
    const partial =
        headers.get('X-Disaster-Partial') === 'true' ||
        eonet !== 'ok' ||
        usgs !== 'ok' ||
        (firms !== undefined && firms !== 'ok' && firms !== 'stale');
    return { eonet, usgs, firms, partial };
}

/** Human-readable summary of degraded sources, or null when every source is ok. */
export function describeDisasterSources(status: DisasterSourceStatus | null): string | null {
    if (!status || !status.partial) return null;
    const down: string[] = [];
    if (status.eonet !== 'ok') down.push('NASA EONET (wildfires, volcanoes)');
    if (status.usgs !== 'ok') down.push('USGS (earthquakes)');
    if (status.firms === 'warming') down.push('NASA FIRMS (warming up)');
    else if (status.firms === 'unavailable') down.push('NASA FIRMS (satellite thermal detections)');
    if (down.length === 0) return 'Some disaster sources are incomplete.';
    return `Unavailable: ${down.join(', ')}. Counts are incomplete.`;
}

/** Notice displayed when satellite thermal hotspots are warming up or down. */
export function getFirmsStatusNotice(status: DisasterSourceStatus | null, isV2: boolean = true): string | null {
    if (!isV2) return 'Satellite hotspots: unavailable (legacy mode)';
    if (status?.firms === 'warming' || status?.firms === 'unavailable') {
        return 'Satellite hotspots: unavailable (warming up / source down)';
    }
    return null;
}

/** Subtitle for the Satellite Hotspots row in the Live Monitor legend. */
export function formatFireCellsSubtitle(
    cellCount: number | undefined,
    status: DisasterSourceStatus | null,
    isV2: boolean = true,
): string {
    if (!isV2) return 'FIRMS VIIRS (unavailable)';
    if (status?.firms === 'warming') return 'FIRMS VIIRS (warming up...)';
    if (status?.firms === 'unavailable') return 'FIRMS VIIRS (source down)';
    if (status?.firms === 'ok' || status?.firms === 'stale') {
        return `FIRMS VIIRS (${cellCount ?? 0} cells)`;
    }
    return 'FIRMS VIIRS (unavailable)';
}

/** Query scope per category, as served by the Worker (backend EONET_QUERIES, USGS_URL, and FIRMS). */
export const DISASTER_SCOPE = {
    fire: 'confirmed agency-reported wildfires (NASA EONET v3)',
    fire_detection: 'satellite thermal anomaly cells (NASA FIRMS VIIRS 375m)',
    volcano: 'active volcanic alert events (NASA EONET)',
    earthquake: 'USGS M2.5+ earthquake events',
} as const;

/**
 * Legend count text. Zero is only shown as confirmed absence when the
 * category's source loaded successfully; otherwise it is unknown or unavailable.
 */
export function displayCategoryCount(
    count: number,
    type: Disaster['type'],
    status: DisasterSourceStatus | null,
    loadFailed: boolean,
    isV2: boolean = true,
): string {
    if (type === 'fire_detection') {
        if (!isV2) return 'unavailable';
        if (status?.firms === 'warming') return 'warming up';
        if (status?.firms === 'unavailable') return 'unavailable';
        if (loadFailed || (status?.firms && status.firms !== 'ok' && status.firms !== 'stale')) return 'unavailable';
        return count.toLocaleString();
    }
    const state = status ? (type === 'earthquake' ? status.usgs : status.eonet) : 'unknown';
    if (count === 0 && (loadFailed || state !== 'ok')) return '—';
    return count.toLocaleString();
}

/** Shape check for one /api/disasters record; the backend owns normalization. */
export function isDisasterRecord(value: unknown): value is Disaster {
    if (!value || typeof value !== 'object') return false;
    const d = value as Record<string, unknown>;
    return (
        typeof d.id === 'string' && d.id.length > 0 &&
        (d.type === 'fire' || d.type === 'volcano' || d.type === 'earthquake' || d.type === 'fire_detection') &&
        typeof d.title === 'string' &&
        typeof d.lat === 'number' && Number.isFinite(d.lat) && Math.abs(d.lat) <= 90 &&
        typeof d.lng === 'number' && Number.isFinite(d.lng) && Math.abs(d.lng) <= 180 &&
        typeof d.date === 'string' && !Number.isNaN(Date.parse(d.date)) &&
        (d.severity === 'low' || d.severity === 'medium' || d.severity === 'high') &&
        (d.magnitude === undefined || (typeof d.magnitude === 'number' && Number.isFinite(d.magnitude))) &&
        (d.areaAcres === undefined || (typeof d.areaAcres === 'number' && Number.isFinite(d.areaAcres)))
    );
}
