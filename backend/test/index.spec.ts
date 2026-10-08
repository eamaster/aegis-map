import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { reflectCorsOrigin, resolveAllowedOrigins } from '../src/config';

describe('removed Hello World routes', () => {
	it('does not expose /message or /random', async () => {
		expect((await SELF.fetch('http://example.com/message')).status).toBe(404);
		expect((await SELF.fetch('http://example.com/random')).status).toBe(404);
	});
});

describe('CORS origin resolution', () => {
	it('merges defaults with comma-separated CORS_ORIGINS without duplicates', () => {
		const allowed = resolveAllowedOrigins('https://hesam.me, https://www.hesam.me ,https://eamaster.github.io');
		expect(allowed).toContain('http://localhost:5173');
		expect(allowed).toContain('https://eamaster.github.io');
		expect(allowed).toContain('https://hesam.me');
		expect(allowed).toContain('https://www.hesam.me');
		expect(allowed.filter((o) => o === 'https://eamaster.github.io')).toHaveLength(1);
	});

	it('reflects only allowlisted Origins', () => {
		const allowed = resolveAllowedOrigins('https://hesam.me');
		expect(reflectCorsOrigin('https://hesam.me', allowed)).toBe('https://hesam.me');
		expect(reflectCorsOrigin('https://evil.example', allowed)).toBeUndefined();
		expect(reflectCorsOrigin(undefined, allowed)).toBeUndefined();
	});

	it('reflects configured production Origin on health responses', async () => {
		const response = await SELF.fetch('http://example.com/', {
			headers: { Origin: 'https://hesam.me' },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://hesam.me');
	});

	it('omits ACAO for unknown Origin', async () => {
		const response = await SELF.fetch('http://example.com/', {
			headers: { Origin: 'https://evil.example' },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});
});
