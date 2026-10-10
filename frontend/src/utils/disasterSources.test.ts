import { describe, it, expect } from 'vitest';
import { describeDisasterSources, isDisasterRecord, parseDisasterSourceHeaders } from './disasterSources';

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
});
