/** @deprecated Replaced by analyze.spec.ts — kept empty so old paths do not resurrect Hello World stubs. */
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('removed Hello World routes', () => {
	it('does not expose /message or /random', async () => {
		expect((await SELF.fetch('http://example.com/message')).status).toBe(404);
		expect((await SELF.fetch('http://example.com/random')).status).toBe(404);
	});
});
