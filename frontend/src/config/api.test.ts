import { describe, expect, it } from 'vitest';
import { API_BASE, apiUrl } from './api';

describe('api config', () => {
    it('exposes a non-empty API base without a trailing slash', () => {
        expect(API_BASE.length).toBeGreaterThan(0);
        expect(API_BASE.endsWith('/')).toBe(false);
    });

    it('joins paths without duplicating slashes', () => {
        expect(apiUrl('/api/disasters')).toBe(`${API_BASE}/api/disasters`);
        expect(apiUrl('api/tles')).toBe(`${API_BASE}/api/tles`);
    });
});
