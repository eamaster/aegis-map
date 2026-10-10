import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src';
import { computeTleChecksum } from '../src/satellites';

const LANDSAT8_LINE1 = '1 39084U 13008A   26282.90944219  .00000228  00000+0  60785-4 0  9995';
const LANDSAT8_LINE2 = '2 39084  98.2190 351.6114 0001302  94.7208 265.4139 14.57110728714606';

export function withChecksum(body68: string): string {
	return body68 + computeTleChecksum(body68);
}

export function tleEpochField(date: Date): string {
	const year = date.getUTCFullYear();
	const dayOfYear = (date.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1;
	return `${String(year % 100).padStart(2, '0')}${dayOfYear.toFixed(8).padStart(12, '0')}`;
}

/** Valid-format 3-line TLE for any NORAD ID and epoch (Landsat-8 orbit elements). */
export function makeTle(noradId: number, name: string, epoch: Date): [string, string, string] {
	const id = String(noradId).padStart(5, '0');
	const line1 = withChecksum(LANDSAT8_LINE1.slice(0, 2) + id + LANDSAT8_LINE1.slice(7, 18) + tleEpochField(epoch) + LANDSAT8_LINE1.slice(32, 68));
	const line2 = withChecksum(LANDSAT8_LINE2.slice(0, 2) + id + LANDSAT8_LINE2.slice(7, 68));
	return [name, line1, line2];
}

export interface MemoryKv {
	kv: KVNamespace;
	store: Map<string, string>;
	puts: Array<{ key: string; value: string; options?: { expirationTtl?: number } }>;
	gets: string[];
}

export function memoryKv(options: { failGet?: boolean; failPut?: boolean; initial?: Record<string, string> } = {}): MemoryKv {
	const store = new Map<string, string>(Object.entries(options.initial ?? {}));
	const puts: MemoryKv['puts'] = [];
	const gets: string[] = [];
	const kv = {
		async get(key: string) {
			gets.push(key);
			if (options.failGet) throw new Error('KV get unavailable');
			return store.get(key) ?? null;
		},
		async put(key: string, value: string, putOptions?: { expirationTtl?: number }) {
			puts.push({ key, value, options: putOptions });
			if (options.failPut) throw new Error('KV put unavailable');
			store.set(key, value);
		},
	} as unknown as KVNamespace;
	return { kv, store, puts, gets };
}

export type FetchHandler = (url: string) => Response | Promise<Response>;

/** Replace global fetch for the duration of fn; records requested URLs. */
export async function withFetch<T>(handler: FetchHandler, fn: () => Promise<T>): Promise<{ result: T; calls: string[] }> {
	const original = globalThis.fetch;
	const calls: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		calls.push(url);
		return handler(url);
	}) as typeof fetch;
	try {
		return { result: await fn(), calls };
	} finally {
		globalThis.fetch = original;
	}
}

export async function callWorker(
	path: string,
	overrides: Record<string, unknown>,
	headers: Record<string, string> = {},
): Promise<Response> {
	const ctx = createExecutionContext();
	const response = await worker.fetch(
		new Request(`http://example.com${path}`, { headers }),
		{ ...env, ...overrides } as typeof env,
		ctx,
	);
	await waitOnExecutionContext(ctx);
	return response;
}

export const FIRMS_HEADER =
	'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';

export function csvResponse(body: string, status = 200): Response {
	return new Response(body, { status, headers: { 'Content-Type': 'text/csv' } });
}
