import { describe, it, expect } from 'vitest';
import {
    describeDisasterSources,
    displayCategoryCount,
    formatFireCellsSubtitle,
    getFirmsStatusNotice,
    isDisasterRecord,
    parseDisasterSourceHeaders,
} from './disasterSources';

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

    it('returns null when FIRMS status is ok or stale', () => {
        expect(getFirmsStatusNotice({ ...ok, firms: 'ok' }, true)).toBeNull();
        expect(getFirmsStatusNotice({ ...ok, firms: 'stale' }, true)).toBeNull();
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
});

