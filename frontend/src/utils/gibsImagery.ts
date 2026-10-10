/**
 * Imagery request specs for the sidebar panel. The product and date shown
 * to the user come from the same spec that builds the request URL.
 *
 * Layer identifiers are listed in the GIBS WMS GetCapabilities document
 * (epsg4326/best). Dates are requested UTC days chosen by a fixed lag, not
 * an availability lookup: the MODIS layers advertise daily extents with
 * nearestValue="0" (no snapping), but swath gaps and cloud are not checked,
 * and the VIIRS thermal anomaly layer advertises no WMS time dimension.
 */

export type ImageryLayer = 'fire' | 'falsecolor' | 'visual';

export interface ImageryProduct {
    product: string;
    label: string;
    /** Requested UTC date (YYYY-MM-DD); null when the provider exposes none. Not a confirmed observation date. */
    date: string | null;
    url: string;
}

export interface ImagerySpec extends ImageryProduct {
    layer: ImageryLayer;
    provider: 'NASA GIBS' | 'Mapbox';
    /** Half-width in degrees of the requested bbox (null for Mapbox zoom tiles). */
    halfSizeDeg: number | null;
    overlay?: ImageryProduct;
    /** Set when the requested box extends past a pole or the antimeridian. */
    limitation: string | null;
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

/** GIBS does not wrap EPSG:4326 requests, so parts of a box past ±180° / ±90° render empty. */
export function bboxLimitation(lat: number, lng: number, half: number): string | null {
    const crossesAntimeridian = lng - half < -180 || lng + half > 180;
    const crossesPole = lat - half < -90 || lat + half > 90;
    if (!crossesAntimeridian && !crossesPole) return null;
    const edge = crossesAntimeridian ? 'the antimeridian' : 'a pole';
    return `This view extends past ${edge}; that part of the image is empty and detections there are not drawn.`;
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
                label: 'VIIRS S-NPP thermal anomalies (single requested UTC day)',
                date: overlayDate,
                url: gibsUrl('VIIRS_SNPP_Thermal_Anomalies_375m_All', overlayDate, lat, lng, FIRE_BBOX_HALF_DEG, 'image/png'),
            },
            limitation: bboxLimitation(lat, lng, FIRE_BBOX_HALF_DEG),
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
            limitation: bboxLimitation(lat, lng, FALSE_COLOR_BBOX_HALF_DEG),
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
        limitation: null,
    };
}

/**
 * Position of a detection inside the image requested for center ± half degrees,
 * as CSS percentages (top grows southward). Longitudes are not wrapped because
 * the requested image is not; points outside the image return null.
 */
export function hotspotImagePosition(
    hotspot: { latitude: number; longitude: number },
    centerLat: number,
    centerLng: number,
    half: number,
): { leftPct: number; topPct: number } | null {
    const leftPct = 50 + ((hotspot.longitude - centerLng) / (2 * half)) * 100;
    const topPct = 50 - ((hotspot.latitude - centerLat) / (2 * half)) * 100;
    if (leftPct < 0 || leftPct > 100 || topPct < 0 || topPct > 100) return null;
    return { leftPct, topPct };
}
