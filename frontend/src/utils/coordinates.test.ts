import { describe, it, expect } from 'vitest';
import { isValidCoordinate } from './coordinates';

describe('Coordinates Utilities', () => {
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
});
