import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    describeDisasterSources,
    displayCategoryCount,
    formatFireCellsSubtitle,
    getFirmsStatusNotice,
    isDisasterRecord,
    parseDisasterSourceHeaders,
} from './disasterSources';
import {
    fetchDisastersData,
    filterLegacyDisastersByWindow,
    resetV2FallbackWarning,
} from './disastersClient';
import type { Disaster } from '../types';

const headers = (init: Record<string, string>) => new Headers(init);

describe('parseDisasterSourceHeaders', () => {
    it('reads complete source status', () => {
        const status = parseDisasterSourceHeaders(headers({ 'X-Disaster-Sources': 'eonet=ok;usgs=ok', 'X-Disaster-Partial': 'false' }));
        expect(status).toEqual({ eonet: 'ok', usgs: 'ok', partial: false });
        expect(describeDisasterSources(status)).toBeNull();
    });

    it('marks partial results and names the degraded source', () => {
        const status = parseDisasterSourceHeaders(headers({ 'X-Disaster-Sources': 'eonet=ok;usgs=malformed', 'X-Disaster-Partial': 'true' }));
        expect(status).toEqual({ eonet: 'ok', usgs: 'malformed', partial: true });
        expect(describeDisasterSources(status)).toContain('USGS (earthquakes)');
    });

    it('treats an unrecognized state as partial even if the partial header is missing', () => {
        const status = parseDisasterSourceHeaders(headers({ 'X-Disaster-Sources': 'eonet=weird;usgs=ok' }));
        expect(status).toEqual({ eonet: 'unknown', usgs: 'ok', partial: true });
    });

    it('returns null when the backend sent no source metadata', () => {
        expect(parseDisasterSourceHeaders(headers({}))).toBeNull();
        expect(describeDisasterSources(null)).toBeNull();
    });
});

describe('isDisasterRecord', () => {
    const base = { id: 'us1', type: 'earthquake', title: 'x', lat: 0, lng: 0, date: '2026-10-05T00:00:00.000Z', severity: 'low' };

    it('accepts valid zero coordinates and zero magnitude', () => {
        expect(isDisasterRecord(base)).toBe(true);
        expect(isDisasterRecord({ ...base, magnitude: 0 })).toBe(true);
    });

    it('rejects missing coordinates, string coordinates, and invalid dates', () => {
        expect(isDisasterRecord({ ...base, lat: null })).toBe(false);
        expect(isDisasterRecord({ ...base, lng: '10' })).toBe(false);
        expect(isDisasterRecord({ ...base, lat: 91 })).toBe(false);
        expect(isDisasterRecord({ ...base, date: 'not-a-date' })).toBe(false);
        expect(isDisasterRecord({ ...base, type: 'flood' })).toBe(false);
    });

    it('accepts the Worker record for a real captured open volcano', () => {
        expect(
            isDisasterRecord({
                id: 'EONET_20710',
                type: 'volcano',
                title: 'Nevados del Chillan Volcano, Chile',
                lng: -71.378,
                lat: -36.868,
                date: '2026-06-15T00:00:00.000Z',
                severity: 'medium',
            }),
        ).toBe(true);
    });

    it('accepts wildfire records with areaAcres and varied severities', () => {
        expect(
            isDisasterRecord({
                id: 'EONET_100',
                type: 'fire',
                title: 'Large Fire',
                lng: -120.5,
                lat: 38.5,
                date: '2026-10-05T00:00:00.000Z',
                severity: 'high',
                areaAcres: 15420.5,
            }),
        ).toBe(true);
        expect(
            isDisasterRecord({
                id: 'EONET_101',
                type: 'fire',
                title: 'Small Fire',
                lng: -120.5,
                lat: 38.5,
                date: '2026-10-05T00:00:00.000Z',
                severity: 'low',
                areaAcres: 250,
            }),
        ).toBe(true);
        expect(isDisasterRecord({ ...base, areaAcres: NaN })).toBe(false);
    });
});

describe('displayCategoryCount', () => {
    const ok = { eonet: 'ok', usgs: 'ok', partial: false } as const;

    it('shows zero as confirmed only when that category source loaded', () => {
        expect(displayCategoryCount(0, 'volcano', ok, false)).toBe('0');
        expect(displayCategoryCount(0, 'volcano', { ...ok, eonet: 'failed', partial: true }, false)).toBe('—');
        expect(displayCategoryCount(0, 'earthquake', { ...ok, eonet: 'failed', partial: true }, false)).toBe('0');
        expect(displayCategoryCount(0, 'fire', null, false)).toBe('—');
        expect(displayCategoryCount(0, 'fire', ok, true)).toBe('—');
    });

    it('still shows records that did load from a partially failed source', () => {
        expect(displayCategoryCount(32, 'volcano', { ...ok, eonet: 'failed', partial: true }, false)).toBe('32');
    });

    it('handles fire_detection counts distinguishing real 0 from warming or unavailable', () => {
        // Legacy fallback: never show 0
        expect(displayCategoryCount(0, 'fire_detection', ok, false, false)).toBe('unavailable');

        // Warming state: show warming up, never 0
        expect(displayCategoryCount(0, 'fire_detection', { ...ok, firms: 'warming' }, false, true)).toBe('warming up');

        // Unavailable state: show unavailable, never 0
        expect(displayCategoryCount(0, 'fire_detection', { ...ok, firms: 'unavailable' }, false, true)).toBe('unavailable');

        // Snapshot ok, real 0: show 0
        expect(displayCategoryCount(0, 'fire_detection', { ...ok, firms: 'ok' }, false, true)).toBe('0');

        // Snapshot ok with detections: show formatted count
        expect(displayCategoryCount(1234, 'fire_detection', { ...ok, firms: 'ok' }, false, true)).toBe('1,234');

        // Snapshot partial or stale with detections: treat as data present and format count
        expect(displayCategoryCount(845, 'fire_detection', { ...ok, firms: 'partial', partial: true }, false, true)).toBe('845');
        expect(displayCategoryCount(845, 'fire_detection', { ...ok, firms: 'stale' }, false, true)).toBe('845');
    });
});

describe('getFirmsStatusNotice', () => {
    const ok = { eonet: 'ok', usgs: 'ok', partial: false } as const;

    it('returns notice for legacy mode', () => {
        expect(getFirmsStatusNotice(ok, false)).toBe('Satellite hotspots: unavailable (legacy mode)');
    });

    it('returns notice for warming up and unavailable states in v2', () => {
        expect(getFirmsStatusNotice({ ...ok, firms: 'warming' }, true)).toBe('Satellite hotspots: unavailable (warming up / source down)');
        expect(getFirmsStatusNotice({ ...ok, firms: 'unavailable' }, true)).toBe('Satellite hotspots: unavailable (warming up / source down)');
    });

    it('returns null when FIRMS status is ok', () => {
        expect(getFirmsStatusNotice({ ...ok, firms: 'ok' }, true)).toBeNull();
    });

    it('distinguishes partial coverage and names the lagging sensor', () => {
        const partialWithSensors = {
            ...ok,
            firms: 'partial' as const,
            partial: true,
            firmsSensors: {
                VIIRS_SNPP_NRT: { status: 'no_data' as const, rawRows: 0, acceptedRows: 0 },
                VIIRS_NOAA20_NRT: { status: 'ok' as const, rawRows: 100, acceptedRows: 100 },
                VIIRS_NOAA21_NRT: { status: 'ok' as const, rawRows: 120, acceptedRows: 120 },
            },
        };
        expect(getFirmsStatusNotice(partialWithSensors, true)).toBe(
            'Satellite hotspots: partial coverage (VIIRS_SNPP_NRT lagging)',
        );
        expect(describeDisasterSources(partialWithSensors)).toContain('VIIRS_SNPP_NRT lagging');
    });

    it('distinguishes stale snapshot and displays snapshot age', () => {
        const nowMs = Date.parse('2026-11-06T12:00:00.000Z');
        const staleStatus = {
            ...ok,
            firms: 'stale' as const,
            firmsGeneratedAt: '2026-11-06T05:00:00.000Z',
        };
        expect(getFirmsStatusNotice(staleStatus, true, nowMs)).toBe('Satellite hotspots: stale snapshot (7h old)');
        expect(getFirmsStatusNotice({ ...ok, firms: 'stale' }, true, nowMs)).toBe('Satellite hotspots: stale snapshot');
    });
});

describe('formatFireCellsSubtitle', () => {
    const ok = { eonet: 'ok', usgs: 'ok', partial: false } as const;

    it('returns unavailable for legacy mode', () => {
        expect(formatFireCellsSubtitle(0, ok, false)).toBe('FIRMS VIIRS (unavailable)');
    });

    it('returns warming up when warming', () => {
        expect(formatFireCellsSubtitle(0, { ...ok, firms: 'warming' }, true)).toBe('FIRMS VIIRS (warming up...)');
    });

    it('returns source down when unavailable', () => {
        expect(formatFireCellsSubtitle(0, { ...ok, firms: 'unavailable' }, true)).toBe('FIRMS VIIRS (source down)');
    });

    it('returns cell count when status is ok', () => {
        expect(formatFireCellsSubtitle(0, { ...ok, firms: 'ok' }, true)).toBe('FIRMS VIIRS (0 cells)');
        expect(formatFireCellsSubtitle(142, { ...ok, firms: 'ok' }, true)).toBe('FIRMS VIIRS (142 cells)');
    });

    it('formats partial and stale subtitles with lagging sensor or snapshot age', () => {
        const nowMs = Date.parse('2026-11-06T12:00:00.000Z');
        expect(
            formatFireCellsSubtitle(
                142,
                {
                    ...ok,
                    firms: 'partial',
                    partial: true,
                    firmsSensors: {
                        VIIRS_SNPP_NRT: { status: 'no_data', rawRows: 0, acceptedRows: 0 },
                        VIIRS_NOAA20_NRT: { status: 'ok', rawRows: 80, acceptedRows: 80 },
                    },
                },
                true,
                nowMs,
            ),
        ).toBe('FIRMS VIIRS (142 cells, partial · VIIRS_SNPP_NRT lagging)');

        expect(
            formatFireCellsSubtitle(
                142,
                {
                    ...ok,
                    firms: 'stale',
                    firmsGeneratedAt: '2026-11-06T05:00:00.000Z',
                },
                true,
                nowMs,
            ),
        ).toBe('FIRMS VIIRS (142 cells, stale · 7h old)');
    });
});

describe('legacy fallback window filtering and one-time warning', () => {
    const now = new Date('2026-11-06T12:00:00.000Z');
    const sampleLegacyRecords: Disaster[] = [
        {
            id: 'fire_recent',
            type: 'fire',
            title: 'Recent Fire (6h ago)',
            lat: 34,
            lng: -118,
            date: '2026-11-06T06:00:00.000Z',
            severity: 'high',
        },
        {
            id: 'fire_3d',
            type: 'fire',
            title: '3-Day Fire',
            lat: 35,
            lng: -119,
            date: '2026-11-03T12:00:00.000Z',
            severity: 'medium',
        },
        {
            id: 'fire_30d',
            type: 'fire',
            title: '30-Day Old EONET Fire',
            lat: 36,
            lng: -120,
            date: '2026-10-07T12:00:00.000Z',
            severity: 'low',
        },
        {
            id: 'quake_recent',
            type: 'earthquake',
            title: 'Recent Quake (2h ago)',
            lat: 37,
            lng: -122,
            date: '2026-11-06T10:00:00.000Z',
            severity: 'medium',
            magnitude: 4.8,
        },
        {
            id: 'volc_old',
            type: 'volcano',
            title: 'Active Volcano (20d ago)',
            lat: -36.8,
            lng: -71.3,
            date: '2026-10-17T00:00:00.000Z',
            severity: 'medium',
        },
    ];

    afterEach(() => {
        vi.restoreAllMocks();
        resetV2FallbackWarning();
    });

    it('retains open EONET wildfires and volcanoes in context mode and filters strictly by window in strict mode', () => {
        const res24hContext = filterLegacyDisastersByWindow(sampleLegacyRecords, '24h', 'context', now);
        expect(res24hContext.wildfires.map((d) => d.id)).toEqual(['fire_recent', 'fire_3d', 'fire_30d']);
        expect(res24hContext.wildfires[0].isHistoricalContext).toBeUndefined();
        expect(res24hContext.wildfires[1].isHistoricalContext).toBe(true);
        expect(res24hContext.earthquakes.map((d) => d.id)).toEqual(['quake_recent']);
        expect(res24hContext.volcanoes).toHaveLength(1);
        expect(res24hContext.volcanoes[0].isHistoricalContext).toBe(true);
        expect(res24hContext.legacyNotice).toContain('Legacy fallback (24h)');

        const res24hStrict = filterLegacyDisastersByWindow(sampleLegacyRecords, '24h', 'strict', now);
        expect(res24hStrict.wildfires.map((d) => d.id)).toEqual(['fire_recent']);
        expect(res24hStrict.volcanoes).toHaveLength(0);

        const res7dStrict = filterLegacyDisastersByWindow(sampleLegacyRecords, '7d', 'strict', now);
        expect(res7dStrict.wildfires.map((d) => d.id)).toEqual(['fire_recent', 'fire_3d']);
        expect(res7dStrict.volcanoes).toHaveLength(0);
        expect(res7dStrict.legacyNotice).toContain('earthquakes limited to ~24h feed');
    });

    it('logs v2 failure status once via console.warn and applies window filter on fallback', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/api/v2/disasters')) {
                return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
            }
            return new Response(JSON.stringify(sampleLegacyRecords), {
                status: 200,
                headers: {
                    'X-Disaster-Sources': 'eonet=ok;usgs=ok',
                    'X-Disaster-Fetched-At': now.toISOString(),
                },
            });
        });

        const first = await fetchDisastersData({ window: '24h', volcanoMode: 'strict' });
        expect(first.isV2).toBe(false);
        expect(first.wildfires.map((d) => d.id)).toEqual(['fire_recent']);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain('HTTP 404');

        const second = await fetchDisastersData({ window: '7d', volcanoMode: 'strict' });
        expect(second.isV2).toBe(false);
        expect(second.wildfires.map((d) => d.id)).toEqual(['fire_recent', 'fire_3d']);
        // Logged only once across repeated fallback calls
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });
});

