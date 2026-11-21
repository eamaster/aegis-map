import { describe, expect, it } from 'vitest';
import {
    classifyMapboxError,
    DISASTER_LAYER_PRIORITY,
    MAP_STYLES,
    rewriteSatelliteTileUrl,
} from './map';

describe('map config and satellite fallback', () => {
    it('uses official Mapbox Standard Satellite style as primary', () => {
        expect(MAP_STYLES.primary).toBe('mapbox://styles/mapbox/standard-satellite');
        expect(DISASTER_LAYER_PRIORITY[0]).toBe('fires-layer');
        expect(DISASTER_LAYER_PRIORITY[DISASTER_LAYER_PRIORITY.length - 1]).toBe('fire-cells-layer');
    });

    it('rewrites Mapbox satellite raster tile URLs to Esri World Imagery z/y/x and ignores non-satellite URLs', () => {
        expect(
            rewriteSatelliteTileUrl(
                'https://api.mapbox.com/v4/mapbox.satellite/2/3/1.webp?sku=101TsvY8Qd0rt&access_token=pk.test',
            ),
        ).toBe('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/2/1/3');

        expect(
            rewriteSatelliteTileUrl(
                'https://api.mapbox.com/v4/mapbox.satellite/5/12/18@2x.jpg90?access_token=pk.test',
            ),
        ).toBe('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/18/12');

        // Vector tiles, styles, sprites, and glyphs must pass through untouched
        expect(
            rewriteSatelliteTileUrl(
                'https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/2/3/1.vector.pbf?access_token=pk.test',
            ),
        ).toBeNull();
        expect(
            rewriteSatelliteTileUrl('https://api.mapbox.com/styles/v1/mapbox/standard-satellite?access_token=pk.test'),
        ).toBeNull();
    });

    it('triggers satellite tile fallback once on HTTP 429 and ignores duplicate tile 429s', () => {
        const first = classifyMapboxError(
            {
                sourceId: 'mapbox://mapbox.satellite',
                error: {
                    status: 429,
                    message: 'Too Many Requests',
                    url: 'https://api.mapbox.com/v4/mapbox.satellite/2/2/1.webp',
                },
            },
            { hasFallbackApplied: false },
        );
        expect(first.kind).toBe('fallback_satellite_tiles');

        const subsequent = classifyMapboxError(
            { error: { status: 429, message: 'Too Many Requests' } },
            { hasFallbackApplied: true },
        );
        expect(subsequent.kind).toBe('ignore');
    });

    it('classifies auth (401/403) and WebGL failures as fatal', () => {
        expect(
            classifyMapboxError({ error: { status: 401, message: 'Unauthorized' } }, { hasFallbackApplied: false }),
        ).toEqual({ kind: 'fatal', message: 'Map error: Unauthorized' });

        expect(
            classifyMapboxError({ error: { status: 403, message: 'Forbidden' } }, { hasFallbackApplied: false }).kind,
        ).toBe('fatal');

        expect(
            classifyMapboxError(
                { error: { message: 'Failed to initialize WebGL' } },
                { hasFallbackApplied: false },
            ).kind,
        ).toBe('fatal');
    });

    it('treats transient tile/source errors as non-fatal so MapLegend stays visible', () => {
        expect(
            classifyMapboxError(
                { sourceId: 'mapbox', error: { status: 404, message: 'Not Found' } },
                { hasFallbackApplied: false },
            ).kind,
        ).toBe('ignore');

        expect(classifyMapboxError({ error: {} }, { hasFallbackApplied: false }).kind).toBe('ignore');
        expect(classifyMapboxError(undefined, { hasFallbackApplied: false }).kind).toBe('ignore');
    });
});
