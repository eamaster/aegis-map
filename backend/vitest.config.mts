import * as path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
	const migrationsPath = path.join(__dirname, 'migrations');
	const migrations = await readD1Migrations(migrationsPath);

	return {
		test: {
			setupFiles: ['./test/applyMigrations.ts'],
			poolOptions: {
				workers: {
					// Test-only config: production semantics live in wrangler.jsonc
					wrangler: { configPath: './vitest.wrangler.jsonc' },
					miniflare: {
						bindings: { TEST_MIGRATIONS: migrations },
					},
				},
			},
		},
	};
});
