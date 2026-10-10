import { describe, it, expect } from 'vitest';
import { buildImagerySpec, hotspotImagePosition, utcDateOffset } from './gibsImagery';

const NOW = new Date('2026-10-10T12:00:00Z');

const param = (url: string, name: string) => new URL(url).searchParams.get(name);

describe('buildImagerySpec', () => {
    it('requests exactly the product and date it labels for the fire view', () => {
        const spec = buildImagerySpec('fire', 45, 38, NOW, 'token');
        expect(spec).toMatchObject({ provider: 'NASA GIBS', product: 'MODIS_Aqua_CorrectedReflectance_TrueColor', date: '2026-10-07' });
        expect(param(spec.url, 'LAYERS')).toBe(spec.product);
        expect(param(spec.url, 'TIME')).toBe(spec.date);
        expect(param(spec.url, 'BBOX')).toBe('44.5,37.5,45.5,38.5');

        expect(spec.overlay).toMatchObject({ product: 'VIIRS_SNPP_Thermal_Anomalies_375m_All', date: '2026-10-09' });
        expect(param(spec.overlay!.url, 'LAYERS')).toBe(spec.overlay!.product);
        expect(param(spec.overlay!.url, 'TIME')).toBe(spec.overlay!.date);
        expect(spec.overlay!.label).toContain('single UTC day');
    });

    it('labels MODIS 7-2-1 as false-color reflectance, not temperature', () => {
        const spec = buildImagerySpec('falsecolor', 45, 38, NOW, 'token');
        expect(spec.product).toBe('MODIS_Terra_CorrectedReflectance_Bands721');
        expect(spec.label).toContain('false-color reflectance');
        expect(spec.label.toLowerCase()).not.toContain('temperature');
        expect(param(spec.url, 'TIME')).toBe(spec.date);
    });

    it('reports no acquisition date for the Mapbox basemap', () => {
        const spec = buildImagerySpec('visual', 45, 38, NOW, 'token');
        expect(spec).toMatchObject({ provider: 'Mapbox', date: null, halfSizeDeg: null });
    });

    it('computes UTC calendar offsets', () => {
        expect(utcDateOffset(new Date('2026-03-01T00:30:00Z'), 1)).toBe('2026-02-28');
    });
});

describe('hotspotImagePosition', () => {
    it('places the center at 50%/50% with north up', () => {
        expect(hotspotImagePosition({ latitude: 45, longitude: 38 }, 45, 38, 0.5)).toEqual({ leftPct: 50, topPct: 50 });
        const ne = hotspotImagePosition({ latitude: 45.25, longitude: 38.25 }, 45, 38, 0.5);
        expect(ne).toEqual({ leftPct: 75, topPct: 25 });
    });

    it('wraps across the antimeridian and drops points outside the image', () => {
        const p = hotspotImagePosition({ latitude: 10, longitude: -179.9 }, 10, 179.9, 0.5);
        expect(p?.leftPct).toBeCloseTo(70, 6);
        expect(hotspotImagePosition({ latitude: 46, longitude: 38 }, 45, 38, 0.5)).toBeNull();
    });
});
