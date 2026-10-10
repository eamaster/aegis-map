import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';

describe('Application Routes Integration', () => {
	beforeEach(async () => {
		// Pre-populate cache so route integration tests are fast and deterministic
		await env.AEGIS_CACHE.put(
			'tles_v2',
			'LANDSAT 8\n1 39084U 13008A   26282.90944219  .00000228  00000+0  60785-4 0  9995\n2 39084  98.2190 351.6114 0001302  94.7208 265.4139 14.57110728714606',
		);
		await env.AEGIS_CACHE.put(
			'disasters',
			JSON.stringify([
				{
					id: 'mock-fire-1',
					type: 'fire',
					title: 'Mock Prescribed Fire',
					lat: 31.12,
					lng: -86.53,
					date: '2026-10-07T10:45:00Z',
					severity: 'medium',
				},
			]),
		);
		await env.AEGIS_CACHE.put(
			'firms:45.72:37.95',
			JSON.stringify({
				hotspots: [],
				totalCount: 0,
				highConfidence: 0,
				maxBrightness: 0,
				maxPower: 0,
			}),
		);
	});

	describe('GET /api/fire-hotspots', () => {
		it('returns 400 when lat or lng query parameter is missing', async () => {
			const res1 = await SELF.fetch('http://example.com/api/fire-hotspots');
			expect(res1.status).toBe(400);
			const body1 = (await res1.json()) as { error?: string };
			expect(body1.error).toContain('Missing lat or lng');

			const res2 = await SELF.fetch('http://example.com/api/fire-hotspots?lat=45.0');
			expect(res2.status).toBe(400);
		});

		it('returns 400 when coordinates are non-numeric or out of range', async () => {
			const resNaN = await SELF.fetch('http://example.com/api/fire-hotspots?lat=abc&lng=10.0');
			expect(resNaN.status).toBe(400);

			const resOutOfRange = await SELF.fetch('http://example.com/api/fire-hotspots?lat=95.0&lng=10.0');
			expect(resOutOfRange.status).toBe(400);
		});

		it('maintains CORS headers on 400 validation error', async () => {
			const res = await SELF.fetch('http://example.com/api/fire-hotspots?lat=invalid&lng=10.0', {
				headers: { Origin: 'https://hesam.me' },
			});
			expect(res.status).toBe(400);
			expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://hesam.me');
		});

		it('serves cached fire hotspot data with CORS headers', async () => {
			const res = await SELF.fetch('http://example.com/api/fire-hotspots?lat=45.72&lng=37.95', {
				headers: { Origin: 'https://hesam.me' },
			});
			expect(res.status).toBe(200);
			expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://hesam.me');
			const body = (await res.json()) as { totalCount: number };
			expect(body.totalCount).toBe(0);
		});
	});

	describe('GET /api/tles', () => {
		it('serves cached TLE data as text/plain with CORS headers', async () => {
			const res = await SELF.fetch('http://example.com/api/tles', {
				headers: { Origin: 'https://hesam.me' },
			});
			expect(res.status).toBe(200);
			expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://hesam.me');
			expect(res.headers.get('Content-Type')).toContain('text/plain');
			const text = await res.text();
			expect(text).toContain('LANDSAT 8');
		});

		it('supports OPTIONS preflight for /api/tles', async () => {
			const res = await SELF.fetch('http://example.com/api/tles', {
				method: 'OPTIONS',
				headers: {
					Origin: 'https://hesam.me',
					'Access-Control-Request-Method': 'GET',
				},
			});
			expect(res.status).toBe(204);
			expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://hesam.me');
		});
	});

	describe('GET /api/disasters', () => {
		it('serves cached disaster data with CORS headers', async () => {
			const res = await SELF.fetch('http://example.com/api/disasters', {
				headers: { Origin: 'https://hesam.me' },
			});
			expect(res.status).toBe(200);
			expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://hesam.me');
			const data = (await res.json()) as Array<{ id: string; type: string }>;
			expect(data).toHaveLength(1);
			expect(data[0].id).toBe('mock-fire-1');
		});

		it('supports OPTIONS preflight for /api/disasters', async () => {
			const res = await SELF.fetch('http://example.com/api/disasters', {
				method: 'OPTIONS',
				headers: {
					Origin: 'https://hesam.me',
					'Access-Control-Request-Method': 'GET',
				},
			});
			expect(res.status).toBe(204);
			expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://hesam.me');
		});
	});
});

