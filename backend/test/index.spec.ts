import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import {
	isValidCorsOrigin,
	reflectCorsOrigin,
	resolveAllowedOrigins,
} from '../src/config';

describe('removed Hello World routes', () => {
	it('does not expose /message or /random', async () => {
		expect((await SELF.fetch('http://example.com/message')).status).toBe(404);
		expect((await SELF.fetch('http://example.com/random')).status).toBe(404);
	});
});

describe('CORS origin resolution', () => {
	it('merges defaults with comma-separated CORS_ORIGINS without duplicates', () => {
		const allowed = resolveAllowedOrigins(
			'https://hesam.me, https://www.hesam.me ,https://eamaster.github.io',
		);
		expect(allowed).toContain('http://localhost:5173');
		expect(allowed).toContain('https://eamaster.github.io');
		expect(allowed).toContain('https://hesam.me');
		expect(allowed).toContain('https://www.hesam.me');
		expect(allowed.filter((o) => o === 'https://eamaster.github.io')).toHaveLength(1);
	});

	it('rejects path-bearing CORS_ORIGINS values', () => {
		expect(isValidCorsOrigin('https://hesam.me')).toBe(true);
		expect(isValidCorsOrigin('https://hesam.me/aegis-map/')).toBe(false);
		expect(isValidCorsOrigin('https://hesam.me?x=1')).toBe(false);
		const allowed = resolveAllowedOrigins('https://hesam.me/aegis-map/,https://hesam.me');
		expect(allowed).toContain('https://hesam.me');
		expect(allowed).not.toContain('https://hesam.me/aegis-map/');
	});

	it('reflects only allowlisted Origins (exact match, not suffix/lookalike)', () => {
		const allowed = resolveAllowedOrigins('https://hesam.me');
		expect(reflectCorsOrigin('https://hesam.me', allowed)).toBe('https://hesam.me');
		expect(reflectCorsOrigin('https://hesam.me.evil.example', allowed)).toBeUndefined();
		expect(reflectCorsOrigin('https://evil.example', allowed)).toBeUndefined();
		expect(reflectCorsOrigin(undefined, allowed)).toBeUndefined();
	});

	it('reflects configured production Origin on health responses', async () => {
		const response = await SELF.fetch('http://example.com/', {
			headers: { Origin: 'https://hesam.me' },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://hesam.me');
		expect(response.headers.get('Vary') ?? '').toMatch(/Origin/i);
	});

	it('omits ACAO for unknown Origin', async () => {
		const response = await SELF.fetch('http://example.com/', {
			headers: { Origin: 'https://evil.example' },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	it('serves no-Origin health requests without requiring ACAO', async () => {
		const response = await SELF.fetch('http://example.com/');
		expect(response.status).toBe(200);
		const body = (await response.json()) as { version?: string };
		expect(body.version).toBeTruthy();
	});

	it('allows analyze preflight for configured Origin', async () => {
		const response = await SELF.fetch('http://example.com/api/analyze', {
			method: 'OPTIONS',
			headers: {
				Origin: 'https://hesam.me',
				'Access-Control-Request-Method': 'POST',
				'Access-Control-Request-Headers': 'content-type',
			},
		});
		expect(response.status).toBeGreaterThanOrEqual(200);
		expect(response.status).toBeLessThan(300);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://hesam.me');
		expect(response.headers.get('Access-Control-Allow-Methods') ?? '').toMatch(/POST/i);
		expect(response.headers.get('Access-Control-Allow-Headers') ?? '').toMatch(/content-type/i);
	});

	it('keeps CORS on analyze validation errors for allowed Origin', async () => {
		const response = await SELF.fetch('http://example.com/api/analyze', {
			method: 'POST',
			headers: {
				Origin: 'https://hesam.me',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ disasterTitle: '' }),
		});
		expect(response.status).toBe(400);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://hesam.me');
	});
});
