import { describe, it, expect } from 'vitest';
import {
    calculatePolygonCentroid,
    isValidCoordinate,
    normalizeCoords,
} from './coordinates';

describe('Coordinates Utilities', () => {
    describe('normalizeCoords', () => {
        it('normalizes lowercase lat/lng', () => {
            expect(normalizeCoords({ lat: 34.5, lng: -118.4 })).toEqual({ lat: 34.5, lng: -118.4 });
        });

        it('normalizes uppercase or alternative key names', () => {
            expect(normalizeCoords({ Latitude: 40.0, Longitude: -75.0 })).toEqual({ lat: 40.0, lng: -75.0 });
            expect(normalizeCoords({ Lat: 10, Lng: 20 })).toEqual({ lat: 10, lng: 20 });
        });

        it('handles null or empty object gracefully', () => {
            expect(normalizeCoords(null)).toEqual({ lat: 0, lng: 0 });
            expect(normalizeCoords({})).toEqual({ lat: 0, lng: 0 });
        });
    });

    describe('isValidCoordinate', () => {
        it('returns true for valid geographic ranges', () => {
            expect(isValidCoordinate(0, 0)).toBe(true);
            expect(isValidCoordinate(-90, -180)).toBe(true);
            expect(isValidCoordinate(90, 180)).toBe(true);
        });

        it('returns false for non-finite or out-of-range coordinates', () => {
            expect(isValidCoordinate(NaN, 0)).toBe(false);
            expect(isValidCoordinate(0, Infinity)).toBe(false);
            expect(isValidCoordinate(90.1, 0)).toBe(false);
            expect(isValidCoordinate(0, 180.1)).toBe(false);
        });
    });

    describe('calculatePolygonCentroid', () => {
        it('calculates average centroid from polygon ring vertices', () => {
            const ring = [
                [-120, 38],
                [-118, 38],
                [-118, 40],
                [-120, 40],
                [-120, 38],
            ];
            const centroid = calculatePolygonCentroid(ring);
            expect(centroid).not.toBeNull();
            expect(centroid?.lat).toBeCloseTo(38.8, 1);
            expect(centroid?.lng).toBeCloseTo(-119.2, 1);
        });

        it('returns null for empty or invalid rings', () => {
            expect(calculatePolygonCentroid([])).toBeNull();
            expect(calculatePolygonCentroid([[NaN, 38]])).toBeNull();
        });
    });
});
