import { describe, it, expect } from 'vitest';
import type { FireHotspot, FireHotspotsPayload } from '../types';
import {
    createHotspotLoader,
    fireDisplayState,
    isFireHotspotsPayload,
    requestFireHotspots,
    summarizeVisibleHotspots,
    type FireHotspotState,
} from './fireHotspots';

const hotspot = (overrides: Partial<FireHotspot> = {}): FireHotspot => ({
    latitude: 45.2,
    longitude: 38.4,
    bright_ti4: 340,
    bright_ti5: 290,
    scan: 0.4,
    track: 0.4,
    acq_date: '2026-10-06',
    acq_time: '1026',
    satellite: 'N',
    confidence: 'h',
    version: '2.0NRT',
    frp: 10,
    daynight: 'D',
    ...overrides,
});

const payload = (hotspots: FireHotspot[], coverageStatus: 'complete' | 'partial' = 'complete'): FireHotspotsPayload => ({
    hotspots,
    totalCount: hotspots.length,
    highConfidence: hotspots.filter((h) => h.confidence === 'h').length,
    nominalConfidence: hotspots.filter((h) => h.confidence === 'n').length,
    lowConfidence: hotspots.filter((h) => h.confidence === 'l').length,
    unknownConfidence: hotspots.filter((h) => h.confidence === null).length,
    maxBrightness: null,
    maxPower: null,
    source: 'VIIRS_SNPP_NRT',
    sensor: 'VIIRS S-NPP 375 m (NRT)',
    coverage: {
        status: coverageStatus,
        timezone: 'UTC',
        requestedStart: '2026-10-04',
        requestedEnd: '2026-10-10',
        missingDates: coverageStatus === 'partial' ? ['2026-10-04', '2026-10-05'] : [],
        windows: [],
    },
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('requestFireHotspots states', () => {
    const signal = () => new AbortController().signal;

    it('separates legitimate empty, confidence-filtered, and detection results', async () => {
        const empty = await requestFireHotspots('u', async () => json(payload([])), signal());
        expect(empty && fireDisplayState(empty)).toBe('empty');

        const filtered = await requestFireHotspots('u', async () => json(payload([hotspot({ confidence: 'l' })])), signal());
        expect(filtered && fireDisplayState(filtered)).toBe('filtered');
        expect(filtered).toMatchObject({ state: 'loaded', hiddenLowConfidence: 1, visible: [] });

        const shown = await requestFireHotspots('u', async () => json(payload([hotspot(), hotspot({ confidence: 'l', acq_time: '0100' })])), signal());
        expect(shown && fireDisplayState(shown)).toBe('detections');
        expect(shown).toMatchObject({ state: 'loaded', hiddenLowConfidence: 1 });
    });

    it('reports provider failure as unavailable with the requested window, never as empty', async () => {
        const body = {
            error: 'NASA FIRMS did not return usable data for the requested window',
            code: 'firms_unavailable',
            source: 'VIIRS_SNPP_NRT',
            coverage: { ...payload([]).coverage, status: 'unavailable' },
        };
        const state = await requestFireHotspots('u', async () => json(body, 502), signal());
        expect(state).toMatchObject({ state: 'unavailable', code: 'firms_unavailable', source: 'VIIRS_SNPP_NRT' });
        expect(state && state.state === 'unavailable' && state.coverage?.requestedStart).toBe('2026-10-04');
        expect(state && fireDisplayState(state)).toBe('unavailable');
    });

    it('treats network errors and unexpected 200 bodies as unavailable', async () => {
        const network = await requestFireHotspots('u', async () => { throw new TypeError('offline'); }, signal());
        expect(network).toMatchObject({ state: 'unavailable' });
        const legacy = await requestFireHotspots('u', async () => json({ hotspots: [], totalCount: 0 }), signal());
        expect(legacy).toMatchObject({ state: 'unavailable', reason: 'Unexpected response from the fire hotspot service' });
    });

    it('validates payload shape including coverage windows', () => {
        expect(isFireHotspotsPayload(payload([hotspot()]))).toBe(true);
        const noWindows: Record<string, unknown> = { ...payload([]).coverage };
        delete noWindows.windows;
        expect(isFireHotspotsPayload({ ...payload([]), coverage: noWindows })).toBe(false);
        expect(isFireHotspotsPayload({ ...payload([hotspot()]), totalCount: 2 })).toBe(false);
    });
});

describe('createHotspotLoader selection safety', () => {
    it('ignores a delayed response for a previous selection (success after newer success)', async () => {
        const pending = new Map<string, ReturnType<typeof deferred<Response>>>();
        const fetchImpl = (url: string) => {
            const d = deferred<Response>();
            pending.set(url, d);
            return d.promise;
        };
        const updates: FireHotspotState[] = [];
        const loader = createHotspotLoader((lat, lng) => `${lat},${lng}`, fetchImpl, (s) => updates.push(s));

        loader.load(10, 20);
        loader.load(30, 40);
        pending.get('30,40')!.resolve(json(payload([hotspot({ latitude: 30 })])));
        await flush();
        pending.get('10,20')!.resolve(json(payload([hotspot({ latitude: 10 }), hotspot({ latitude: 10.1 })])));
        await flush();

        const last = updates[updates.length - 1];
        expect(last.state).toBe('loaded');
        expect(last.state === 'loaded' && last.data.hotspots.map((h) => h.latitude)).toEqual([30]);
        expect(updates.filter((u) => u.state === 'loaded')).toHaveLength(1);
    });

    it('does not let a stale failure or empty result overwrite the current selection', async () => {
        const pending: Array<ReturnType<typeof deferred<Response>>> = [];
        const fetchImpl = () => {
            const d = deferred<Response>();
            pending.push(d);
            return d.promise;
        };
        const updates: FireHotspotState[] = [];
        const loader = createHotspotLoader(() => 'u', fetchImpl, (s) => updates.push(s));

        loader.load(1, 1);
        loader.load(2, 2);
        loader.load(3, 3);
        pending[2].resolve(json(payload([hotspot()])));
        await flush();
        pending[0].resolve(json({ error: 'down' }, 502));
        pending[1].resolve(json(payload([])));
        await flush();

        expect(updates.map((u) => u.state)).toEqual(['loading', 'loading', 'loading', 'loaded']);
    });

    it('drops an in-flight response after cancel (selection changed to a non-fire event)', async () => {
        const d = deferred<Response>();
        const updates: FireHotspotState[] = [];
        const loader = createHotspotLoader(() => 'u', () => d.promise, (s) => updates.push(s));
        loader.load(1, 1);
        loader.cancel();
        d.resolve(json(payload([hotspot()])));
        await flush();
        expect(updates.map((u) => u.state)).toEqual(['loading']);
    });
});

describe('summarizeVisibleHotspots', () => {
    it('excludes unreported measurements instead of treating them as zero', () => {
        const s = summarizeVisibleHotspots([
            hotspot({ bright_ti4: 300, frp: null, confidence: null, acq_date: '2026-10-07', acq_time: '0915' }),
            hotspot({ bright_ti4: null, frp: 4, confidence: 'n', acq_date: '2026-10-06', acq_time: '2210' }),
        ]);
        expect(s).toEqual({
            total: 2,
            high: 0,
            nominal: 1,
            unknown: 1,
            maxBrightness: 300,
            maxPower: 4,
            latestDetection: '2026-10-07 09:15 UTC',
        });
        expect(summarizeVisibleHotspots([])).toMatchObject({ maxBrightness: null, maxPower: null, latestDetection: null });
    });
});
