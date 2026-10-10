/**
 * Coordinate Utilities
 * Disaster coordinates are normalized by the backend (/api/disasters); the
 * frontend only validates ranges and never substitutes a default position.
 */

export interface Coordinates {
    lat: number;
    lng: number;
}

/**
 * Validates coordinate values are within valid geographic ranges
 * @param lat Latitude value
 * @param lng Longitude value
 * @returns True if coordinates are finite and within valid ranges
 */
export const isValidCoordinate = (lat: number, lng: number): boolean => {
    return Number.isFinite(lat) && Number.isFinite(lng) &&
        Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
};
