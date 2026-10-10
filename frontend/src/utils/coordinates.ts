/**
 * Coordinate Utilities
 * Normalizes coordinate properties from various formats and validates ranges.
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
export const normalizeCoords = (obj: Record<string, unknown> | null | undefined): Coordinates => {
    if (!obj) return { lat: 0, lng: 0 };
    const rawLat = obj.lat ?? obj.Lat ?? obj.latitude ?? obj.Latitude ?? 0;
    const rawLng = obj.lng ?? obj.Lng ?? obj.longitude ?? obj.Longitude ?? 0;
    const lat = typeof rawLat === 'number' ? rawLat : Number(rawLat) || 0;
    const lng = typeof rawLng === 'number' ? rawLng : Number(rawLng) || 0;
    return { lat, lng };
};

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

/**
 * Derives a representative center point (centroid) from an array of [lng, lat] polygon vertices.
 */
export const calculatePolygonCentroid = (ring: number[][]): Coordinates | null => {
    if (!Array.isArray(ring) || ring.length === 0) return null;

    let sumLng = 0;
    let sumLat = 0;
    let count = 0;

    for (const pt of ring) {
        if (Array.isArray(pt) && pt.length >= 2) {
            const lng = Number(pt[0]);
            const lat = Number(pt[1]);
            if (isValidCoordinate(lat, lng)) {
                sumLng += lng;
                sumLat += lat;
                count++;
            }
        }
    }

    if (count === 0) return null;
    return {
        lat: sumLat / count,
        lng: sumLng / count,
    };
};
