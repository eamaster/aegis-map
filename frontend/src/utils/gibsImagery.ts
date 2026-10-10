/**
 * Imagery request specs for the sidebar panel. The product and date shown
 * to the user come from the same spec that builds the request URL.
 */

export type ImageryLayer = 'fire' | 'falsecolor' | 'visual';

export interface ImageryProduct {
    product: string;
    label: string;
    /** UTC date (YYYY-MM-DD) requested from GIBS; null when the provider exposes none. */
    date: string | null;
    url: string;
}

export interface ImagerySpec extends ImageryProduct {
    layer: ImageryLayer;
    provider: 'NASA GIBS' | 'Mapbox';
    /** Half-width in degrees of the requested bbox (null for Mapbox zoom tiles). */
    halfSizeDeg: number | null;
    overlay?: ImageryProduct;
}

const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

export const FIRE_BBOX_HALF_DEG = 0.5;
const FALSE_COLOR_BBOX_HALF_DEG = 0.3;
/** MODIS corrected reflectance is typically complete a few days after acquisition. */
const MODIS_AQUA_LAG_DAYS = 3;
const MODIS_TERRA_LAG_DAYS = 4;
/** Previous UTC day: a full day of VIIRS passes rather than a partial current day. */
const VIIRS_OVERLAY_LAG_DAYS = 1;

export function utcDateOffset(now: Date, days: number): string {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
}

function gibsUrl(layer: string, date: string, lat: number, lng: number, half: number, format: 'image/jpeg' | 'image/png'): string {
    // WMS 1.3.0 with EPSG:4326 uses minLat,minLng,maxLat,maxLng axis order.
    const bbox = `${lat - half},${lng - half},${lat + half},${lng + half}`;
    const transparent = format === 'image/png' ? '&TRANSPARENT=true' : '';
    return `${GIBS_WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layer}&TIME=${date}&CRS=EPSG:4326&WIDTH=800&HEIGHT=600&BBOX=${bbox}&FORMAT=${format}${transparent}`;
}

export function buildImagerySpec(layer: ImageryLayer, lat: number, lng: number, now: Date, mapboxToken: string): ImagerySpec {
    if (layer === 'fire') {
        const date = utcDateOffset(now, MODIS_AQUA_LAG_DAYS);
        const overlayDate = utcDateOffset(now, VIIRS_OVERLAY_LAG_DAYS);
        return {
            layer,
            provider: 'NASA GIBS',
            product: 'MODIS_Aqua_CorrectedReflectance_TrueColor',
            label: 'MODIS Aqua true color',
            date,
            url: gibsUrl('MODIS_Aqua_CorrectedReflectance_TrueColor', date, lat, lng, FIRE_BBOX_HALF_DEG, 'image/jpeg'),
            halfSizeDeg: FIRE_BBOX_HALF_DEG,
            overlay: {
                product: 'VIIRS_SNPP_Thermal_Anomalies_375m_All',
                label: 'VIIRS S-NPP thermal anomalies (single UTC day)',
                date: overlayDate,
                url: gibsUrl('VIIRS_SNPP_Thermal_Anomalies_375m_All', overlayDate, lat, lng, FIRE_BBOX_HALF_DEG, 'image/png'),
            },
        };
    }
    if (layer === 'falsecolor') {
        const date = utcDateOffset(now, MODIS_TERRA_LAG_DAYS);
        return {
            layer,
            provider: 'NASA GIBS',
            product: 'MODIS_Terra_CorrectedReflectance_Bands721',
            label: 'MODIS Terra 7-2-1 false-color reflectance',
            date,
            url: gibsUrl('MODIS_Terra_CorrectedReflectance_Bands721', date, lat, lng, FALSE_COLOR_BBOX_HALF_DEG, 'image/jpeg'),
            halfSizeDeg: FALSE_COLOR_BBOX_HALF_DEG,
        };
    }
    return {
        layer,
        provider: 'Mapbox',
        product: 'mapbox/satellite-v9',
        label: 'Mapbox Satellite basemap (acquisition date not provided)',
        date: null,
        url: `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},15,0/800x600@2x?access_token=${mapboxToken}`,
        halfSizeDeg: null,
    };
}

/**
 * Position of a detection inside an image covering center ± half degrees,
 * as CSS percentages (top grows southward). Null when outside the image.
 */
export function hotspotImagePosition(
    hotspot: { latitude: number; longitude: number },
    centerLat: number,
    centerLng: number,
    half: number,
): { leftPct: number; topPct: number } | null {
    const dLng = ((((hotspot.longitude - centerLng + 180) % 360) + 360) % 360) - 180;
    const dLat = hotspot.latitude - centerLat;
    const leftPct = 50 + (dLng / (2 * half)) * 100;
    const topPct = 50 - (dLat / (2 * half)) * 100;
    if (leftPct < 0 || leftPct > 100 || topPct < 0 || topPct > 100) return null;
    return { leftPct, topPct };
}
