import type { Disaster, DisasterSourceState, DisasterSourceStatus } from '../types';

const SOURCE_STATES: readonly DisasterSourceState[] = ['ok', 'failed', 'malformed'];

function readState(value: string | undefined): DisasterSourceState | 'unknown' {
    return SOURCE_STATES.includes(value as DisasterSourceState) ? (value as DisasterSourceState) : 'unknown';
}

/** Parses X-Disaster-Sources ("eonet=ok;usgs=failed") and X-Disaster-Partial. Returns null when absent. */
export function parseDisasterSourceHeaders(headers: Headers): DisasterSourceStatus | null {
    const raw = headers.get('X-Disaster-Sources');
    if (!raw) return null;
    const entries = new Map<string, string>();
    for (const part of raw.split(';')) {
        const [name, value] = part.split('=').map((s) => s.trim());
        if (name) entries.set(name, value);
    }
    const eonet = readState(entries.get('eonet'));
    const usgs = readState(entries.get('usgs'));
    const partial = headers.get('X-Disaster-Partial') === 'true' || eonet !== 'ok' || usgs !== 'ok';
    return { eonet, usgs, partial };
}

/** Human-readable summary of degraded sources, or null when every source is ok. */
export function describeDisasterSources(status: DisasterSourceStatus | null): string | null {
    if (!status || !status.partial) return null;
    const down: string[] = [];
    if (status.eonet !== 'ok') down.push('NASA EONET (wildfires, volcanoes)');
    if (status.usgs !== 'ok') down.push('USGS (earthquakes)');
    if (down.length === 0) return 'Some disaster sources are incomplete.';
    return `Unavailable: ${down.join(', ')}. Counts are incomplete.`;
}

/** Shape check for one /api/disasters record; the backend owns normalization. */
export function isDisasterRecord(value: unknown): value is Disaster {
    if (!value || typeof value !== 'object') return false;
    const d = value as Record<string, unknown>;
    return (
        typeof d.id === 'string' && d.id.length > 0 &&
        (d.type === 'fire' || d.type === 'volcano' || d.type === 'earthquake') &&
        typeof d.title === 'string' &&
        typeof d.lat === 'number' && Number.isFinite(d.lat) && Math.abs(d.lat) <= 90 &&
        typeof d.lng === 'number' && Number.isFinite(d.lng) && Math.abs(d.lng) <= 180 &&
        typeof d.date === 'string' && !Number.isNaN(Date.parse(d.date)) &&
        (d.severity === 'low' || d.severity === 'medium' || d.severity === 'high') &&
        (d.magnitude === undefined || (typeof d.magnitude === 'number' && Number.isFinite(d.magnitude)))
    );
}
