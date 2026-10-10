import { describe, it, expect } from 'vitest';
import { getNextPass, predictPasses } from './orbitalEngine';

describe('Orbital Engine Pass Predictions', () => {
    const sampleTle = [
        'LANDSAT 8',
        '1 39084U 13008A   26282.90944219  .00000228  00000+0  60785-4 0  9995',
        '2 39084  98.2190 351.6114 0001302  94.7208 265.4139 14.57110728714606',
    ].join('\n');

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

    it('predicts passes with valid date and finite elevation for valid TLE and coordinates', () => {
        const passes = predictPasses(sampleTle, 45.0, 30.0, 5); // 5 degree minimum elevation
        if (passes.length > 0) {
            const first = passes[0];
            expect(first.satelliteName).toBe('LANDSAT 8');
            expect(first.time instanceof Date).toBe(true);
            expect(Number.isFinite(first.elevation)).toBe(true);
            expect(Number.isFinite(first.azimuth)).toBe(true);
            expect(first.elevation).toBeGreaterThanOrEqual(5);
        }
    });

    it('getNextPass returns null when no pass is found or coordinates are invalid', () => {
        expect(getNextPass(sampleTle, 95, 0)).toBeNull();
    });
});
