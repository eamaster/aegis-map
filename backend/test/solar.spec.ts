import { describe, it, expect } from 'vitest';
import { classifyIllumination, illuminationAt, solarElevationDeg } from '../src/solar';

describe('Solar elevation helper and illumination classification', () => {
	it('matches reference equator noon equinox ≈ 90° within ±1°', () => {
		// March equinox ~2026-03-20 12:00 UTC at (0, 0)
		const equinoxNoon = new Date('2026-03-20T12:07:00Z');
		const el = solarElevationDeg(0, 0, equinoxNoon);
		expect(el).toBeGreaterThan(88.5);
		expect(el).toBeLessThanOrEqual(90);
		expect(classifyIllumination(el)).toBe('day');
		expect(illuminationAt(0, 0, equinoxNoon)).toBe('day');
	});

	it('matches reference polar-night case (< -6°) within ±1°', () => {
		// North pole on December solstice ~2026-12-21 12:00 UTC
		// NOAA geometric elevation is ~-23.44°
		const polarNight = new Date('2026-12-21T12:00:00Z');
		const el = solarElevationDeg(90, 0, polarNight);
		expect(el).toBeCloseTo(-23.44, 0); // within ±1°
		expect(el).toBeLessThan(-6);
		expect(classifyIllumination(el)).toBe('night');
		expect(illuminationAt(90, 0, polarNight)).toBe('night');
	});

	it('matches reference twilight case (between -6° and 0°) within ±1°', () => {
		// London (51.5° N, 0° E) at civil dusk on 2026-03-20
		// Sunset is ~18:13 UTC; civil twilight ends ~18:45 UTC
		// At 18:25 UTC, sun elevation is ~ -2.5° (civil twilight)
		const twilightTime = new Date('2026-03-20T18:25:00Z');
		const el = solarElevationDeg(51.5074, -0.1278, twilightTime);
		expect(el).toBeGreaterThanOrEqual(-6);
		expect(el).toBeLessThanOrEqual(0);
		expect(classifyIllumination(el)).toBe('twilight');
		expect(illuminationAt(51.5074, -0.1278, twilightTime)).toBe('twilight');
	});

	it('classifies day, twilight, and night boundary thresholds strictly', () => {
		expect(classifyIllumination(0.01)).toBe('day');
		expect(classifyIllumination(0.0)).toBe('twilight');
		expect(classifyIllumination(-3.0)).toBe('twilight');
		expect(classifyIllumination(-6.0)).toBe('twilight');
		expect(classifyIllumination(-6.01)).toBe('night');
	});
});
