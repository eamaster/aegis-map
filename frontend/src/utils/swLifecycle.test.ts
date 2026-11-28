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

	const shownNotifications: Array<{ title: string; options: Record<string, unknown> }> = [];
	const openWindowCalls: string[] = [];
	const clientFocusCalls: string[] = [];
	const clientNavigateCalls: string[] = [];
	const clientMessages: Array<{ clientUrl: string; message: unknown }> = [];
	let existingClientUrls: string[] = [];

	const selfObj = {
		__AEGIS_PRECACHE__: { version: options.version, assets: options.assets },
		location: new URL('http://127.0.0.1:4173/aegis-map/sw.js'),
		registration: {
			scope: 'http://127.0.0.1:4173/aegis-map/',
			showNotification: vi.fn(async (title: string, notifOptions: Record<string, unknown>) => {
				shownNotifications.push({ title, options: notifOptions });
			}),
		},
		skipWaiting,
		clients: {
			claim,
			matchAll: vi.fn(async () =>
				existingClientUrls.map((url) => ({
					url,
					async focus() {
						clientFocusCalls.push(url);
					},
					async navigate(nextUrl: string) {
						clientNavigateCalls.push(nextUrl);
					},
					postMessage(msg: unknown) {
						clientMessages.push({ clientUrl: url, message: msg });
					},
				})),
			),
			openWindow: vi.fn(async (url: string) => {
				openWindowCalls.push(url);
				return { url };
			}),
		},
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
		shownNotifications,
		openWindowCalls,
		clientFocusCalls,
		clientNavigateCalls,
		clientMessages,
		setExistingClients(urls: string[]) {
			existingClientUrls = urls;
		},
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
		async runPush(jsonPayload: Record<string, unknown>) {
			let pending: Promise<unknown> = Promise.resolve();
			listeners.get('push')?.({
				data: {
					json: () => jsonPayload,
					text: () => JSON.stringify(jsonPayload),
				},
				waitUntil(p: Promise<unknown>) {
					pending = p;
				},
			});
			await pending;
		},
		async runNotificationClick(data: Record<string, unknown>) {
			let pending: Promise<unknown> = Promise.resolve();
			listeners.get('notificationclick')?.({
				notification: {
					data,
					close: vi.fn(),
				},
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

	it('rejects HTML SPA-fallback served for SVG, PNG, ICO, and webmanifest assets', async () => {
		const iconAssets = ['favicon.svg', 'favicon.ico', 'icons/icon-192.png', 'manifest.webmanifest'];
		for (const badAsset of iconAssets) {
			const store: MockCacheStore = { buckets: new Map() };
			const sw = createSwHarness({
				version: 'icon-check',
				assets: iconAssets,
				store,
				fetchImpl: async (req) => {
					if (req.url.endsWith(badAsset)) {
						return new Response('<!doctype html><html></html>', {
							status: 200,
							headers: { 'Content-Type': 'text/html' },
						});
					}
					if (req.url.endsWith('.svg')) {
						return new Response('<svg/>', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } });
					}
					if (req.url.endsWith('.png')) {
						return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'Content-Type': 'image/png' } });
					}
					if (req.url.endsWith('.ico')) {
						return new Response(new Uint8Array([0, 0, 1, 0]), { status: 200, headers: { 'Content-Type': 'image/x-icon' } });
					}
					return makeOkResponse(req.url);
				},
			});
			await expect(sw.runInstall()).rejects.toThrow(/Invalid content-type/);
		}
	});

	it('enforces /aegis-map/ scope on push notifications, handles structured routes (Alert/Cancel), avoids fabricating warnings on malformed payloads, and supports focus vs cold openWindow', async () => {
		const store: MockCacheStore = { buckets: new Map() };
		const sw = createSwHarness({
			version: 'push-test',
			assets: manifestAssets,
			store,
			fetchImpl: async (req) => makeOkResponse(req.url),
		});

		// Cross-origin URL is rejected and clamped to registration scope
		await sw.runPush({
			title: 'SEVERE: Gale warning',
			body: 'Secure loose outdoor items.',
			url: 'https://evil.example/phish',
			warningId: 'cap-1',
			tag: 'aegis-cap-1',
		});
		expect(sw.shownNotifications).toHaveLength(1);
		expect(sw.shownNotifications[0].options.data).toMatchObject({
			url: 'http://127.0.0.1:4173/aegis-map/?view=near-me',
			warningId: 'cap-1',
			route: null,
		});

		// Structured route for active Alert & explicit Cancel resolves against registration.scope without backend hardcoded subpath
		await sw.runPush({
			title: 'Official Cancellation: MET Norway (Oslo)',
			body: 'Gale warning cancelled.',
			msgType: 'Cancel',
			warningId: 'cap-cancel-1',
			route: {
				view: 'near-me',
				lat: 59.914,
				lng: 10.752,
				countryCode: 'NO',
				warningId: 'cap-cancel-1',
				placeName: 'Oslo',
				msgType: 'Cancel',
			},
		});
		expect(sw.shownNotifications).toHaveLength(2);
		const cancelData = sw.shownNotifications[1].options.data as { url: string; warningId: string; route: Record<string, unknown> };
		expect(cancelData.url).toContain('http://127.0.0.1:4173/aegis-map/?view=near-me');
		expect(cancelData.url).toContain('lat=59.914');
		expect(cancelData.url).toContain('warningId=cap-cancel-1');
		expect(cancelData.url).toContain('noticeStatus=cancelled');

		// Missing or malformed push payload must NOT fabricate an official warning or warningId
		await sw.runPush({} as Record<string, unknown>);
		expect(sw.shownNotifications).toHaveLength(3);
		expect(sw.shownNotifications[2].title).toBe('AegisMap');
		expect(sw.shownNotifications[2].title).not.toMatch(/official warning/i);
		expect(sw.shownNotifications[2].options.data).toMatchObject({
			url: 'http://127.0.0.1:4173/aegis-map/?view=near-me',
			warningId: '',
			malformed: true,
		});

		// Existing window click focuses, navigates, and posts structured route message
		sw.setExistingClients(['http://127.0.0.1:4173/aegis-map/']);
		await sw.runNotificationClick({
			url: './?view=near-me&warningId=cap-1',
			warningId: 'cap-1',
			route: {
				view: 'near-me',
				lat: 59.914,
				lng: 10.752,
				countryCode: 'NO',
				warningId: 'cap-1',
				msgType: 'Alert',
			},
		});
		expect(sw.clientFocusCalls).toEqual(['http://127.0.0.1:4173/aegis-map/']);
		expect(sw.clientNavigateCalls[0]).toContain('http://127.0.0.1:4173/aegis-map/?view=near-me');
		expect(sw.clientNavigateCalls[0]).toContain('warningId=cap-1');
		expect(sw.clientMessages[0].message).toMatchObject({
			type: 'AEGIS_WARNING_CLICK',
			warningId: 'cap-1',
		});

		// Cold launch (no open windows) opens scoped window directly
		sw.setExistingClients([]);
		await sw.runNotificationClick({
			url: 'https://evil.example/phish',
			route: {
				view: 'near-me',
				lat: 60.391,
				lng: 5.322,
				countryCode: 'NO',
				warningId: 'cap-cold-2',
				msgType: 'Cancel',
			},
		});
		expect(sw.openWindowCalls).toHaveLength(1);
		expect(sw.openWindowCalls[0]).toContain('http://127.0.0.1:4173/aegis-map/?view=near-me');
		expect(sw.openWindowCalls[0]).toContain('lat=60.391');
		expect(sw.openWindowCalls[0]).toContain('warningId=cap-cold-2');
		expect(sw.openWindowCalls[0]).toContain('noticeStatus=cancelled');
	});
});
