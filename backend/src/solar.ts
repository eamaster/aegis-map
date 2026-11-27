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

export {
	classifyIllumination,
	illuminationAt,
	solarElevationDeg,
	type Illumination,
} from '../../shared/contracts';
