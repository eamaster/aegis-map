import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				// Test-only config: production semantics live in wrangler.jsonc
				wrangler: { configPath: './vitest.wrangler.jsonc' },
			},
		},
	},
});
