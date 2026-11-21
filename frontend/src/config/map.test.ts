import { describe, expect, it } from 'vitest';
import { classifyMapboxError, MAP_STYLES } from './map';

describe('classifyMapboxError', () => {
    it('switches to vector fallback once when satellite tiles return HTTP 429', () => {
        const first = classifyMapboxError(
            {
                sourceId: 'mapbox',
                error: {
                    status: 429,
                    message: 'Too Many Requests',
                    url: 'https://api.mapbox.com/v4/mapbox.satellite/2/2/1.webp',
                },
            },
            { hasFallbackApplied: false },
        );
        expect(first.kind).toBe('fallback_basemap');
        expect(MAP_STYLES.fallback).toBe('mapbox://styles/mapbox/dark-v11');

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
