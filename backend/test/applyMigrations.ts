import { applyD1Migrations, env } from 'cloudflare:test';

const testEnv = env as typeof env & {
	AEGIS_DB: D1Database;
	TEST_MIGRATIONS?: Parameters<typeof applyD1Migrations>[1];
};

if (testEnv.AEGIS_DB && testEnv.TEST_MIGRATIONS) {
	await applyD1Migrations(testEnv.AEGIS_DB, testEnv.TEST_MIGRATIONS);
}
