import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SW_PATH = path.resolve(__dirname, '../../public/sw.js');

interface MockCacheStore {
	buckets: Map<string, Map<string, Response>>;
	failPutForUrl?: string;
}

function createSwHarness(options: {
	version: string;
	assets: string[];
	store: MockCacheStore;
	fetchImpl: (req: Request) => Promise<Response>;
}) {
	const listeners = new Map<string, (event: unknown) => void>();
	const skipWaiting = vi.fn(async () => {});
	const claim = vi.fn(async () => {});

	const cachesMock = {
		async open(name: string) {
			if (!options.store.buckets.has(name)) {
				options.store.buckets.set(name, new Map());
			}
			const bucket = options.store.buckets.get(name)!;
			return {
				async put(urlOrReq: string | Request, res: Response) {
					const key = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq.url;
					if (options.store.failPutForUrl && key.includes(options.store.failPutForUrl)) {
						throw new Error('QuotaExceededError: simulated cache write failure');
					}
					bucket.set(key, res);
				},
				async match(urlOrReq: string | Request) {
					const key = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq.url;
					return bucket.get(key);
				},
			};
		},
		async keys() {
			return Array.from(options.store.buckets.keys());
		},
		async delete(name: string) {
			return options.store.buckets.delete(name);
		},
	};

	const selfObj = {
		__AEGIS_PRECACHE__: { version: options.version, assets: options.assets },
		location: new URL('http://127.0.0.1:4173/aegis-map/sw.js'),
		registration: { scope: 'http://127.0.0.1:4173/aegis-map/' },
		skipWaiting,
		clients: { claim },
		addEventListener(type: string, handler: (event: unknown) => void) {
			listeners.set(type, handler);
		},
	};

	const rawSw = fs.readFileSync(SW_PATH, 'utf-8');
	const context = vm.createContext({
		self: selfObj,
		caches: cachesMock,
		fetch: options.fetchImpl,
		URL,
		Request,
		Response,
	});
	vm.runInContext(rawSw, context);

	return {
		skipWaiting,
		claim,
		async runInstall() {
			let pending: Promise<unknown> = Promise.resolve();
			listeners.get('install')?.({
				waitUntil(p: Promise<unknown>) {
					pending = p;
				},
			});
			await pending;
		},
		async runActivate() {
			let pending: Promise<unknown> = Promise.resolve();
			listeners.get('activate')?.({
				waitUntil(p: Promise<unknown>) {
					pending = p;
				},
			});
			await pending;
		},
	};
}

describe('Service Worker atomic install & scoped cleanup (public/sw.js)', () => {
	const manifestAssets = [
		'./',
		'index.html',
		'manifest.webmanifest',
		'assets/index-new.css',
		'assets/index-new.js',
		'assets/NearMeView-new.js',
	];

	function makeOkResponse(url: string): Response {
		if (url.endsWith('.js')) {
			return new Response('export default 1;', {
				status: 200,
				headers: { 'Content-Type': 'application/javascript' },
			});
		}
		if (url.endsWith('.css')) {
			return new Response('body { color: #fff; }', {
				status: 200,
				headers: { 'Content-Type': 'text/css' },
			});
		}
		if (url.endsWith('.webmanifest')) {
			return new Response('{"name":"AegisMap"}', {
				status: 200,
				headers: { 'Content-Type': 'application/manifest+json' },
			});
		}
		return new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
			status: 200,
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
		});
	}

	it('keeps previous shell intact and deletes staging cache when a required asset fetch fails', async () => {
		const store: MockCacheStore = { buckets: new Map() };
		store.buckets.set(
			'aegis-shell-prev111',
			new Map([['http://127.0.0.1:4173/aegis-map/', makeOkResponse('index.html')]]),
		);
		store.buckets.set('unrelated-third-party-cache', new Map());

		const sw = createSwHarness({
			version: 'next222',
			assets: manifestAssets,
			store,
			fetchImpl: async (req) => {
				if (req.url.includes('NearMeView-new.js')) {
					return new Response('Service Unavailable', { status: 503 });
				}
				return makeOkResponse(req.url);
			},
		});

		await expect(sw.runInstall()).rejects.toThrow(/503/);
		expect(sw.skipWaiting).not.toHaveBeenCalled();
		expect(store.buckets.has('aegis-shell-next222')).toBe(false);
		expect(store.buckets.has('aegis-shell-prev111')).toBe(true);
		expect(store.buckets.has('unrelated-third-party-cache')).toBe(true);
	});

	it('rolls back staging cache when a cache.put write fails mid-install', async () => {
		const store: MockCacheStore = {
			buckets: new Map([['aegis-shell-prev111', new Map()]]),
			failPutForUrl: 'NearMeView-new.js',
		};

		const sw = createSwHarness({
			version: 'next333',
			assets: manifestAssets,
			store,
			fetchImpl: async (req) => makeOkResponse(req.url),
		});

		await expect(sw.runInstall()).rejects.toThrow(/QuotaExceededError/);
		expect(sw.skipWaiting).not.toHaveBeenCalled();
		expect(store.buckets.has('aegis-shell-next333')).toBe(false);
		expect(store.buckets.has('aegis-shell-prev111')).toBe(true);
	});

	it('rejects HTML SPA-fallback responses served for missing JS chunks', async () => {
		const store: MockCacheStore = { buckets: new Map([['aegis-shell-prev111', new Map()]]) };

		const sw = createSwHarness({
			version: 'next444',
			assets: manifestAssets,
			store,
			fetchImpl: async (req) => {
				if (req.url.includes('NearMeView-new.js')) {
					return new Response('<!doctype html><title>404</title>', {
						status: 200,
						headers: { 'Content-Type': 'text/html' },
					});
				}
				return makeOkResponse(req.url);
			},
		});

		await expect(sw.runInstall()).rejects.toThrow(/Invalid content-type/);
		expect(store.buckets.has('aegis-shell-next444')).toBe(false);
		expect(store.buckets.has('aegis-shell-prev111')).toBe(true);
	});

	it('retires older aegis-shell-* caches only after full install + activate while preserving non-app caches', async () => {
		const store: MockCacheStore = {
			buckets: new Map([
				['aegis-shell-v1.5.0', new Map()],
				['unrelated-origin-cache-v1', new Map()],
			]),
		};

		const sw = createSwHarness({
			version: 'next555',
			assets: manifestAssets,
			store,
			fetchImpl: async (req) => makeOkResponse(req.url),
		});

		await sw.runInstall();
		expect(sw.skipWaiting).toHaveBeenCalledTimes(1);
		// Before activate runs, both old and new caches exist
		expect(store.buckets.has('aegis-shell-v1.5.0')).toBe(true);
		expect(store.buckets.has('aegis-shell-next555')).toBe(true);
		expect(store.buckets.get('aegis-shell-next555')?.size).toBe(manifestAssets.length);

		await sw.runActivate();
		expect(sw.claim).toHaveBeenCalledTimes(1);
		expect(store.buckets.has('aegis-shell-v1.5.0')).toBe(false);
		expect(store.buckets.has('aegis-shell-next555')).toBe(true);
		expect(store.buckets.has('unrelated-origin-cache-v1')).toBe(true);
	});
});
