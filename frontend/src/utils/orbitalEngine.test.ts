import { describe, it, expect } from 'vitest';
import * as satellite from 'satellite.js';
import { getNextPass, predictPasses } from './orbitalEngine';

const L8_LINE1 = '1 39084U 13008A   26282.90944219  .00000228  00000+0  60785-4 0  9995';
const L8_LINE2 = '2 39084  98.2190 351.6114 0001302  94.7208 265.4139 14.57110728714606';
/** Line-1 epoch 26282.90944219 as UTC. */
const L8_EPOCH = new Date('2026-10-09T21:49:35.805Z');

function tleChecksum(body68: string): string {
    let sum = 0;
    for (const ch of body68) {
        if (ch >= '0' && ch <= '9') sum += Number(ch);
        else if (ch === '-') sum += 1;
    }
    return String(sum % 10);
}

function subSatellitePoint(line1: string, line2: string, at: Date): { lat: number; lng: number } {
    const satrec = satellite.twoline2satrec(line1, line2);
    const pv = satellite.propagate(satrec, at);
    if (!pv || !pv.position || typeof pv.position === 'boolean') throw new Error('propagation failed');
    const geo = satellite.eciToGeodetic(pv.position, satellite.gstime(at));
    return { lat: satellite.degreesLat(geo.latitude), lng: satellite.degreesLong(geo.longitude) };
}

describe('Orbital Engine Pass Predictions', () => {
    const sampleTle = ['LANDSAT 8', L8_LINE1, L8_LINE2].join('\n');

    it('rejects invalid or non-finite observer coordinates', () => {
        expect(predictPasses(sampleTle, NaN, 0)).toEqual([]);
        expect(predictPasses(sampleTle, 0, Infinity)).toEqual([]);
        expect(predictPasses(sampleTle, 95, 0)).toEqual([]);
        expect(predictPasses(sampleTle, 0, -200)).toEqual([]);
    });

    it('returns empty array when raw TLE data has fewer than 3 lines', () => {
        expect(predictPasses('NOT_ENOUGH_LINES', 34.0, -118.0)).toEqual([]);
        expect(predictPasses('', 34.0, -118.0)).toEqual([]);
    });

    it('finds an overhead pass for an observer under the satellite at a fixed time', () => {
        const start = new Date(L8_EPOCH.getTime() - 60 * 1000);
        const observer = subSatellitePoint(L8_LINE1, L8_LINE2, L8_EPOCH);

        const passes = predictPasses(sampleTle, observer.lat, observer.lng, 25, start);
        expect(passes.length).toBeGreaterThan(0);
        const first = passes[0];
        expect(first.satelliteName).toBe('LANDSAT 8');
        expect(first.time.getTime()).toBe(start.getTime());
        // First 5-minute sample is 1 min (~440 km along-track) before overhead.
        expect(first.elevation).toBeGreaterThan(45);
        expect(Number.isFinite(first.azimuth)).toBe(true);

        const next = getNextPass(sampleTle, observer.lat, observer.lng, start);
        expect(next?.time.toISOString()).toBe(first.time.toISOString());
    });

    it('legitimately finds no pass for a low-inclination orbit seen from high latitude', () => {
        const lowIncLine2Body = `${L8_LINE2.slice(0, 8)}  5.0000${L8_LINE2.slice(16, 68)}`;
        const lowIncLine2 = lowIncLine2Body + tleChecksum(lowIncLine2Body);
        expect(lowIncLine2).toHaveLength(69);
        const lowIncTle = ['EQUATORIAL TEST', L8_LINE1, lowIncLine2].join('\n');

        const start = new Date(L8_EPOCH.getTime() - 60 * 1000);
        const subPoint = subSatellitePoint(L8_LINE1, lowIncLine2, L8_EPOCH);
        expect(predictPasses(lowIncTle, subPoint.lat, subPoint.lng, 25, start).length).toBeGreaterThan(0);
        expect(predictPasses(lowIncTle, 75, 0, 5, start)).toEqual([]);
        expect(getNextPass(lowIncTle, 75, 0, start)).toBeNull();
    });

    it('getNextPass returns null when coordinates are invalid', () => {
        expect(getNextPass(sampleTle, 95, 0)).toBeNull();
    });
});
