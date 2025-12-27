/**
 * Coordinate Utilities
 * Normalizes coordinate properties from various formats
 */

export interface Coordinates {
    lat: number;
    lng: number;
}

/**
 * Normalizes coordinate object that may have uppercase or lowercase property names
 * @param obj Object with coordinate properties
 * @returns Normalized coordinates with lowercase lat/lng
 */
export const normalizeCoords = (obj: any): Coordinates => ({
    lat: obj.lat ?? obj.Lat ?? obj.latitude ?? obj.Latitude ?? 0,
    lng: obj.lng ?? obj.Lng ?? obj.longitude ?? obj.Longitude ?? 0
});

/**
 * Validates coordinate values are within valid ranges
 * @param lat Latitude value
 * @param lng Longitude value
 * @returns True if coordinates are valid
 */
export const isValidCoordinate = (lat: number, lng: number): boolean => {
    return !isNaN(lat) && !isNaN(lng) &&
        Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
};
