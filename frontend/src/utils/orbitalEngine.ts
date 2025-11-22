/**
 * Orbital Math Engine using Satellite.js
 * Calculates satellite pass predictions for disaster locations
 */

import * as satellite from 'satellite.js';

export interface SatellitePass {
    satelliteName: string;
    time: Date;
    elevation: number;
    azimuth: number;
}

/**
 * Parse raw TLE data into satellite records
 */
function parseTLEs(tleData: string): Array<{ name: string; line1: string; line2: string }> {
    const lines = tleData.trim().split('\n');
    const satellites = [];

    for (let i = 0; i < lines.length; i += 3) {
        if (i + 2 < lines.length) {
            satellites.push({
                name: lines[i].trim(),
                line1: lines[i + 1].trim(),
                line2: lines[i + 2].trim(),
            });
        }
    }

    return satellites;
}

/**
 * Predict satellite passes over a given location
 * @param tleRawData - Raw TLE string from CelesTrak
 * @param observerLat - Observer latitude in degrees
 * @param observerLng - Observer longitude in degrees
 * @param minElevation - Minimum elevation angle in degrees (default 25)
 * @returns Array of upcoming passes sorted by time
 */
export function predictPasses(
    tleRawData: string,
    observerLat: number,
    observerLng: number,
    minElevation: number = 25
): SatellitePass[] {
    const satellites = parseTLEs(tleRawData);
    const passes: SatellitePass[] = [];

    // Observer position
    const observerGd = {
        longitude: satellite.degreesToRadians(observerLng),
        latitude: satellite.degreesToRadians(observerLat),
        height: 0, // kilometers above sea level
    };

    const now = new Date();
    const endTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Next 24 hours

    satellites.forEach((sat) => {
        try {
            // Initialize satellite record
            const satrec = satellite.twoline2satrec(sat.line1, sat.line2);

            let currentTime = new Date(now.getTime());
            let inPass = false;
            let skipUntil: Date | null = null;

            // Step through time in 5-minute increments
            while (currentTime < endTime) {
                // Optimization: Skip forward if we just found a pass
                if (skipUntil && currentTime < skipUntil) {
                    currentTime = new Date(skipUntil.getTime());
                    skipUntil = null;
                    continue;
                }

                // Propagate satellite to current time
                const positionAndVelocity = satellite.propagate(satrec, currentTime);

                if (positionAndVelocity.position && typeof positionAndVelocity.position !== 'boolean') {
                    // Convert ECI to geodetic
                    const gmst = satellite.gstime(currentTime);
                    const positionEcf = satellite.eciToEcf(positionAndVelocity.position, gmst);

                    // Calculate look angles
                    const lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);

                    const elevationDeg = satellite.radiansToDegrees(lookAngles.elevation);
                    const azimuthDeg = satellite.radiansToDegrees(lookAngles.azimuth);

                    // Check if satellite is above minimum elevation
                    if (elevationDeg >= minElevation) {
                        if (!inPass) {
                            // Start of a new pass
                            passes.push({
                                satelliteName: sat.name,
                                time: new Date(currentTime.getTime()),
                                elevation: elevationDeg,
                                azimuth: azimuthDeg,
                            });
                            inPass = true;

                            // Optimization: Skip 90 minutes (approximate orbital period)
                            skipUntil = new Date(currentTime.getTime() + 90 * 60 * 1000);
                        }
                    } else {
                        inPass = false;
                    }
                }

                // Increment time by 5 minutes
                currentTime = new Date(currentTime.getTime() + 5 * 60 * 1000);
            }
        } catch (error) {
            console.error(`Error processing satellite ${sat.name}:`, error);
        }
    });

    // Sort passes by time
    return passes.sort((a, b) => a.time.getTime() - b.time.getTime());
}

/**
 * Get the next pass for any satellite over a location
 */
export function getNextPass(
    tleRawData: string,
    observerLat: number,
    observerLng: number
): SatellitePass | null {
    const passes = predictPasses(tleRawData, observerLat, observerLng);
    return passes.length > 0 ? passes[0] : null;
}
