/**
 * Solar geometry — the single place sun elevation and illumination are computed.
 *
 * Algorithm: NOAA General Solar Position Calculations (Meeus, "Astronomical
 * Algorithms", low-precision series). Accuracy is ~0.01° for 1800-2100, far
 * better than the ±1° the illumination classes need. Atmospheric refraction is
 * deliberately NOT applied: elevations are geometric (centre of the solar disc),
 * so the horizon-crossing value is 0°, not NOAA's refraction-corrected -0.833°.
 * Refraction is at most ~0.6° near the horizon, below class granularity.
 */

import { SUN_ELEVATION_DAY_MIN_DEG, SUN_ELEVATION_TWILIGHT_MIN_DEG } from './config';

export type Illumination = 'day' | 'twilight' | 'night';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function mod(value: number, divisor: number): number {
	return ((value % divisor) + divisor) % divisor;
}

/**
 * Geometric solar elevation in degrees above the horizon at a place and instant.
 * Pure: no I/O, no clock. Callers must pass validated finite inputs
 * (lat in [-90,90], lng in [-180,180]).
 */
export function solarElevationDeg(lat: number, lng: number, when: Date): number {
	const ms = when.getTime();
	const jd = ms / 86_400_000 + 2_440_587.5;
	const t = (jd - 2_451_545) / 36_525; // Julian centuries since J2000

	const meanLongitude = mod(280.46646 + t * (36_000.76983 + t * 0.0003032), 360);
	const meanAnomaly = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
	const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
	const mRad = meanAnomaly * RAD;

	const equationOfCenter =
		Math.sin(mRad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
		Math.sin(2 * mRad) * (0.019993 - 0.000101 * t) +
		Math.sin(3 * mRad) * 0.000289;
	const trueLongitude = meanLongitude + equationOfCenter;

	const omega = 125.04 - 1934.136 * t;
	const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * RAD);

	const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
	const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);

	const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLongitude * RAD));

	const y = Math.tan((obliquity * RAD) / 2) ** 2;
	const l0 = meanLongitude * RAD;
	const equationOfTimeMin =
		4 *
		DEG *
		(y * Math.sin(2 * l0) -
			2 * eccentricity * Math.sin(mRad) +
			4 * eccentricity * y * Math.sin(mRad) * Math.cos(2 * l0) -
			0.5 * y * y * Math.sin(4 * l0) -
			1.25 * eccentricity * eccentricity * Math.sin(2 * mRad));

	const utcMinutes = mod(ms / 60_000, 1440);
	const trueSolarTimeMin = mod(utcMinutes + equationOfTimeMin + 4 * lng, 1440);
	const hourAngle = (trueSolarTimeMin / 4 - 180) * RAD;

	const latRad = lat * RAD;
	const cosZenith =
		Math.sin(latRad) * Math.sin(declination) + Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
	return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) * DEG;
}

/**
 * Illumination class for a sun elevation (thresholds live in config.ts):
 * day: sun > 0°; twilight: -6° ≤ sun ≤ 0°; night: sun < -6°.
 */
export function classifyIllumination(sunElevationDeg: number): Illumination {
	if (sunElevationDeg > SUN_ELEVATION_DAY_MIN_DEG) return 'day';
	if (sunElevationDeg >= SUN_ELEVATION_TWILIGHT_MIN_DEG) return 'twilight';
	return 'night';
}

/** Convenience: illumination at a place and instant. */
export function illuminationAt(lat: number, lng: number, when: Date): Illumination {
	return classifyIllumination(solarElevationDeg(lat, lng, when));
}
