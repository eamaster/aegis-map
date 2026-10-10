/**
 * FIRMS hotspot loading for the imagery panel.
 * Provider failure, legitimately empty coverage, and detections hidden by the
 * confidence filter are kept as distinct states. A response for an earlier
 * selection never replaces state for the current one.
 */
import type { FireHotspot, FireHotspotsPayload, FirmsCoverage } from '../types';
import { isCurrentGeneration, nextGeneration, type SelectionGeneration } from './selectionGeneration';

export type FireHotspotState =
    | { state: 'idle' }
    | { state: 'loading' }
    | { state: 'unavailable'; reason: string; code?: string; coverage?: FirmsCoverage; source?: string }
    | { state: 'loaded'; data: FireHotspotsPayload; visible: FireHotspot[]; hiddenLowConfidence: number };

export type FireDisplayState = 'idle' | 'loading' | 'unavailable' | 'empty' | 'filtered' | 'detections';

export function fireDisplayState(s: FireHotspotState): FireDisplayState {
    if (s.state !== 'loaded') return s.state;
    if (s.data.totalCount === 0) return 'empty';
    if (s.visible.length === 0) return 'filtered';
    return 'detections';
}

const isNullableNumber = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));

export function isFireHotspotsPayload(value: unknown): value is FireHotspotsPayload {
    if (!value || typeof value !== 'object') return false;
    const v = value as Partial<FireHotspotsPayload>;
    const c = v.coverage;
    return (
        Array.isArray(v.hotspots) &&
        v.totalCount === v.hotspots.length &&
        typeof v.source === 'string' &&
        typeof v.sensor === 'string' &&
        isNullableNumber(v.maxBrightness) &&
        isNullableNumber(v.maxPower) &&
        !!c &&
        (c.status === 'complete' || c.status === 'partial') &&
        typeof c.requestedStart === 'string' &&
        typeof c.requestedEnd === 'string' &&
        Array.isArray(c.missingDates) &&
        Array.isArray(c.windows) &&
        v.hotspots.every(
            (h) =>
                h &&
                Number.isFinite(h.latitude) &&
                Number.isFinite(h.longitude) &&
                typeof h.acq_date === 'string' &&
                typeof h.acq_time === 'string',
        )
    );
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Resolves to null when aborted. */
export async function requestFireHotspots(
    url: string,
    fetchImpl: FetchLike,
    signal: AbortSignal,
): Promise<FireHotspotState | null> {
    let response: Response;
    try {
        response = await fetchImpl(url, { signal });
    } catch {
        if (signal.aborted) return null;
        return { state: 'unavailable', reason: 'Failed to connect to the fire hotspot service' };
    }

    let body: unknown = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }
    if (signal.aborted) return null;

    if (!response.ok) {
        const err = body as { error?: unknown; code?: unknown; coverage?: unknown; source?: unknown } | null;
        const coverage = err?.coverage as Partial<FirmsCoverage> | undefined;
        const hasWindow = typeof coverage?.requestedStart === 'string' && typeof coverage.requestedEnd === 'string';
        return {
            state: 'unavailable',
            reason: typeof err?.error === 'string' ? err.error : `NASA FIRMS proxy unavailable (HTTP ${response.status})`,
            ...(typeof err?.code === 'string' ? { code: err.code } : {}),
            ...(hasWindow ? { coverage: coverage as FirmsCoverage } : {}),
            ...(typeof err?.source === 'string' ? { source: err.source } : {}),
        };
    }
    if (!isFireHotspotsPayload(body)) {
        return { state: 'unavailable', reason: 'Unexpected response from the fire hotspot service' };
    }

    const visible = body.hotspots.filter((h) => h.confidence !== 'l');
    return { state: 'loaded', data: body, visible, hiddenLowConfidence: body.hotspots.length - visible.length };
}

export interface HotspotLoader {
    load(lat: number, lng: number): void;
    cancel(): void;
}

export function createHotspotLoader(
    buildUrl: (lat: number, lng: number) => string,
    fetchImpl: FetchLike,
    onUpdate: (state: FireHotspotState) => void,
): HotspotLoader {
    let generation: SelectionGeneration = 0;
    let controller: AbortController | null = null;

    return {
        load(lat, lng) {
            controller?.abort();
            generation = nextGeneration(generation);
            const requestGeneration = generation;
            const current = new AbortController();
            controller = current;
            onUpdate({ state: 'loading' });
            void requestFireHotspots(buildUrl(lat, lng), fetchImpl, current.signal).then((result) => {
                if (result && isCurrentGeneration(requestGeneration, generation)) onUpdate(result);
            });
        },
        cancel() {
            controller?.abort();
            controller = null;
            generation = nextGeneration(generation);
        },
    };
}

/** Summary over displayed detections; unreported measurements are excluded, never zero. */
export function summarizeVisibleHotspots(hotspots: readonly FireHotspot[]) {
    const brightness = hotspots.map((h) => h.bright_ti4).filter((v): v is number => v !== null);
    const power = hotspots.map((h) => h.frp).filter((v): v is number => v !== null);
    return {
        total: hotspots.length,
        high: hotspots.filter((h) => h.confidence === 'h').length,
        nominal: hotspots.filter((h) => h.confidence === 'n').length,
        unknown: hotspots.filter((h) => h.confidence === null).length,
        avgBrightness: brightness.length ? brightness.reduce((a, b) => a + b, 0) / brightness.length : null,
        maxPower: power.length ? Math.max(...power) : null,
    };
}
