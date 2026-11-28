import { describe, it, expect, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src';
import {
	base64UrlDecode,
	buildPushTopic,
	buildVapidAuthorizationHeader,
	createWebPushTransport,
	decryptWebPushPayloadForTest,
	encryptWebPushPayload,
	validatePushEndpoint,
	validatePushKeyMaterial,
} from '../src/webPush';
import {
	createEmailTransport,
	createSubscription,
	dispatchVerifiedWarningAlerts,
	getSubscriptionServiceStatus,
	lookupPushRegistrations,
	unsubscribeSubscription,
} from '../src/subscriptions';
import {
	generateEphemeralClientPushKeys,
	generateEphemeralVapidKeys,
} from '../../shared/test-helpers/ephemeralWebPush.mjs';
import { memoryKv } from './helpers';

const generateVapidKeys = generateEphemeralVapidKeys;
const generateClientPushKeys = generateEphemeralClientPushKeys;

function makeCapRssAndEntry(opts: { id: string; msgType: 'Alert' | 'Update' | 'Cancel'; references?: string; headlineZh?: string; headlineEn?: string }) {
	const entryUrl = `https://www.irimo.ir/cap/${encodeURIComponent(opts.id)}.cap.xml`;
	const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>IRIMO Alerts</title>
<item><title>${opts.headlineEn ?? 'Gale warning'}</title><link>${entryUrl}</link><guid>${entryUrl}</guid></item>
</channel></rss>`;
	const refXml = opts.references ? `<cap:references>irimo@irimo.ir,${opts.references},2026-11-28T06:00:00Z</cap:references>` : '';
	const infoZh = opts.headlineZh
		? `<cap:info><cap:language>zh-CN</cap:language><cap:category>Met</cap:category><cap:event>大风预警</cap:event><cap:urgency>Expected</cap:urgency><cap:severity>Severe</cap:severity><cap:certainty>Likely</cap:certainty><cap:expires>2026-11-29T18:00:00Z</cap:expires><cap:headline>${opts.headlineZh}</cap:headline><cap:description>强风影响德黑兰地区</cap:description><cap:instruction>远离广告牌和高空坠物</cap:instruction><cap:area><cap:areaDesc>德黑兰</cap:areaDesc><cap:polygon>35.2,50.8 35.2,52.0 36.1,52.0 36.1,50.8 35.2,50.8</cap:polygon></cap:area></cap:info>`
		: '';
	const cap = `<?xml version="1.0" encoding="UTF-8"?>
<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
<cap:identifier>${opts.id}</cap:identifier>
<cap:sender>irimo@irimo.ir</cap:sender>
<cap:sent>2026-11-28T08:00:00Z</cap:sent>
<cap:status>Actual</cap:status>
<cap:msgType>${opts.msgType}</cap:msgType>
<cap:scope>Public</cap:scope>
${refXml}
<cap:info><cap:language>en</cap:language><cap:category>Met</cap:category><cap:event>Gale warning</cap:event><cap:urgency>Expected</cap:urgency><cap:severity>Severe</cap:severity><cap:certainty>Likely</cap:certainty><cap:headline>${opts.headlineEn ?? 'Yellow gale warning'}</cap:headline><cap:description>Strong gusts expected.</cap:description><cap:instruction>Secure loose outdoor items.</cap:instruction><cap:expires>2026-11-29T18:00:00Z</cap:expires><cap:area><cap:areaDesc>Tehran</cap:areaDesc><cap:polygon>35.2,50.8 35.2,52.0 36.1,52.0 36.1,50.8 35.2,50.8</cap:polygon></cap:area></cap:info>
${infoZh}
</cap:alert>`;
	return { rss, entryUrl, cap };
}

async function clearPushAndSubTables() {
	const db = (env as typeof env & { AEGIS_DB: D1Database }).AEGIS_DB;
	await db.batch([
		db.prepare('DELETE FROM subscription_deliveries'),
		db.prepare('DELETE FROM push_subscription_keys'),
		db.prepare('DELETE FROM subscriptions'),
		db.prepare('DELETE FROM ingestion_checkpoints'),
	]);
}

describe('Native Web Crypto Web Push (VAPID RFC 8292 + AES128GCM RFC 8291/8188)', () => {
	beforeEach(async () => {
		await clearPushAndSubTables();
	});

	it('signs VAPID Authorization headers and encrypts/decrypts payload roundtrip', async () => {
		const vapid = await generateVapidKeys();
		const client = await generateClientPushKeys();
		const endpoint = new URL('https://fcm.googleapis.com/fcm/send/example-token-1');

		const authHeader = await buildVapidAuthorizationHeader({
			endpointUrl: endpoint,
			config: {
				publicKey: vapid.publicKey,
				privateJwk: JSON.parse(vapid.privateKey) as JsonWebKey,
				subject: 'mailto:alerts@aegis-map.example',
			},
			nowSeconds: 1_764_300_000,
		});
		expect(authHeader).toMatch(/^vapid t=[^,]+, k=/);
		const token = authHeader.slice('vapid t='.length, authHeader.indexOf(', k='));
		const [hdrB64, payloadB64, sigB64] = token.split('.');
		const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as {
			aud: string;
			sub: string;
			exp: number;
		};
		expect(claims).toMatchObject({
			aud: 'https://fcm.googleapis.com',
			sub: 'mailto:alerts@aegis-map.example',
		});
		const verified = await crypto.subtle.verify(
			{ name: 'ECDSA', hash: 'SHA-256' },
			vapid.publicKeyObj,
			base64UrlDecode(sigB64),
			new TextEncoder().encode(`${hdrB64}.${payloadB64}`),
		);
		expect(verified).toBe(true);

		const originalJson = JSON.stringify({
			title: 'SEVERE: Gale warning',
			body: 'Secure loose outdoor items.',
			url: '/aegis-map/?view=near-me&lat=59.91&lng=10.75&warningId=cap-1',
		});
		const encrypted = await encryptWebPushPayload(
			new TextEncoder().encode(originalJson),
			client.p256dh,
			client.auth,
		);
		const decryptedBytes = await decryptWebPushPayloadForTest(
			encrypted,
			client.privateJwk,
			client.p256dh,
			client.auth,
		);
		expect(new TextDecoder().decode(decryptedBytes)).toBe(originalJson);
	});

	it('rejects private/non-HTTPS push endpoints and malformed key material while allowing FCM/Mozilla hosts', () => {
		expect(validatePushEndpoint('http://push.example/send').ok).toBe(false);
		expect(validatePushEndpoint('https://127.0.0.1/push').ok).toBe(false);
		expect(validatePushEndpoint('https://169.254.169.254/latest').ok).toBe(false);
		expect(validatePushEndpoint('https://[fd00::1]/push').ok).toBe(false);
		expect(validatePushEndpoint('https://localhost/push', { allowLocalTest: true }).ok).toBe(true);
		expect(validatePushEndpoint('https://fcm.googleapis.com/fcm/send/abc').ok).toBe(true);
		expect(validatePushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc').ok).toBe(true);

		expect(validatePushKeyMaterial('short', 'too-short').ok).toBe(false);
	});

	it('fails closed with 503 when VAPID keys are absent and sandbox push is off', async () => {
		const ctx = createExecutionContext();
		const res = await worker.fetch(
			new Request('http://example.com/api/v1/subscriptions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					channel: 'web_push',
					destination: 'https://updates.push.services.mozilla.com/wpush/v2/test',
					placeName: 'Oslo',
					lat: 59.91,
					lng: 10.75,
					countryCode: 'NO',
					sourceId: 'no-metalerts',
					pushSubscription: {
						endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/test',
						keys: { p256dh: 'dummy', auth: 'dummy' },
					},
				}),
			}),
			{ ...env, ALLOW_SANDBOX_PUSH: 'false', VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined } as typeof env,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(res.status).toBe(503);
		expect(await res.json()).toMatchObject({ ok: false, code: 'push_delivery_unavailable' });

		const db = (env as typeof env & { AEGIS_DB: D1Database }).AEGIS_DB;
		const status = await getSubscriptionServiceStatus(
			db,
			createEmailTransport({ allowSandbox: false }),
			createWebPushTransport({ allowSandbox: false }),
		);
		expect(status.pushAvailable).toBe(false);
		expect(status.pushMode).toBe('unavailable');
	});

	it('subscribes, dispatches encrypted localized Web Push, deduplicates, handles explicit Cancel, unsubscribes, and cleans up 410 Gone', async () => {
		const db = (env as typeof env & { AEGIS_DB: D1Database }).AEGIS_DB;
		const vapid = await generateVapidKeys();
		const client = await generateClientPushKeys();
		const endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/oslo-resident-1';

		let nextPushStatus = 201;
		const sentBodies: Uint8Array[] = [];
		const sentAuthHeaders: string[] = [];

		const pushTransport = createWebPushTransport({
			vapidPublicKey: vapid.publicKey,
			vapidPrivateKey: vapid.privateKey,
			vapidSubject: 'mailto:alerts@aegis-map.example',
			fetchImpl: async (_url, init) => {
				if (init?.body instanceof Uint8Array) {
					sentBodies.push(init.body);
				}
				const auth =
					init?.headers && !Array.isArray(init.headers)
						? (init.headers as Record<string, string>).Authorization
						: '';
				if (auth) sentAuthHeaders.push(auth);
				return new Response(null, { status: nextPushStatus, headers: { Location: 'msg-1' } });
			},
		});

		const status = await getSubscriptionServiceStatus(db, createEmailTransport({ allowSandbox: false }), pushTransport);
		expect(status.pushAvailable).toBe(true);
		expect(status.pushMode).toBe('web_push');
		expect(status.vapidPublicKey).toBe(vapid.publicKey);

		const createRes = await createSubscription({
			db,
			req: {
				channel: 'web_push',
				destination: endpoint,
				placeName: '德黑兰 Tehran',
				lat: 35.6892,
				lng: 51.389,
				countryCode: 'IR',
				sourceId: 'ir-irimo',
				locale: 'zh-Hans',
				pushSubscription: {
					endpoint,
					keys: { p256dh: client.p256dh, auth: client.auth },
				},
			},
			transport: createEmailTransport({ allowSandbox: false }),
			pushTransport,
		});
		expect(createRes.status, `createRes=${JSON.stringify(createRes)}`).toBe(201);
		expect(createRes.body).toMatchObject({ ok: true, status: 'active', transportMode: 'web_push' });

		// Dispatch encrypted localized CAP alert
		const cap1 = makeCapRssAndEntry({
			id: 'urn-irimo-cap-tehran-1',
			msgType: 'Alert',
			headlineEn: 'Yellow gale warning',
			headlineZh: '德黑兰大风黄色预警',
		});
		const kv = memoryKv();
		const dispatch1 = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: createEmailTransport({ allowSandbox: false }),
			pushTransport,
			now: new Date('2026-11-28T09:00:00Z'),
			fetchImpl: async (url) => {
				if (url === cap1.entryUrl) return new Response(cap1.cap, { status: 200 });
				if (url.includes('-fa/')) return new Response(cap1.rss, { status: 200 });
				return new Response('<?xml version="1.0"?><rss><channel/></rss>', { status: 200 });
			},
		});
		expect(dispatch1.sent).toBe(1);
		expect(sentBodies).toHaveLength(1);
		expect(sentAuthHeaders[0]).toMatch(/^vapid t=/);

		const decrypted = JSON.parse(
			new TextDecoder().decode(
				await decryptWebPushPayloadForTest(sentBodies[0], client.privateJwk, client.p256dh, client.auth),
			),
		) as {
			title: string;
			url: string;
			warningId: string;
			msgType: string;
			route: { view: string; lat: number; lng: number; countryCode: string; warningId: string; msgType: string };
		};
		expect(decrypted.title).toContain('德黑兰大风黄色预警');
		expect(decrypted.url.startsWith('./?view=near-me')).toBe(true);
		expect(decrypted.url).not.toContain('/aegis-map/');
		expect(decrypted.url).toContain('warningId=urn-irimo-cap-tehran-1');
		expect(decrypted.route).toMatchObject({
			view: 'near-me',
			countryCode: 'IR',
			warningId: 'urn-irimo-cap-tehran-1',
			msgType: 'Alert',
		});
		expect(decrypted.msgType).toBe('Alert');

		// Repeat dispatch deduplicates
		const dispatchDup = await dispatchVerifiedWarningAlerts({
			db,
			kv: memoryKv().kv,
			transport: createEmailTransport({ allowSandbox: false }),
			pushTransport,
			now: new Date('2026-11-28T09:05:00Z'),
			fetchImpl: async (url) => {
				if (url === cap1.entryUrl) return new Response(cap1.cap, { status: 200 });
				if (url.includes('-fa/')) return new Response(cap1.rss, { status: 200 });
				return new Response('<?xml version="1.0"?><rss><channel/></rss>', { status: 200 });
			},
		});
		expect(dispatchDup.sent).toBe(0);
		expect(dispatchDup.deduplicated).toBe(1);
		expect(sentBodies).toHaveLength(1);

		// Explicit Cancel emits cancellation push
		const capCancel = makeCapRssAndEntry({
			id: 'urn-irimo-cap-tehran-1-cancel',
			msgType: 'Cancel',
			references: 'urn-irimo-cap-tehran-1',
			headlineEn: 'Cancellation',
			headlineZh: '大风预警解除',
		});
		const dispatchCancel = await dispatchVerifiedWarningAlerts({
			db,
			kv: memoryKv().kv,
			transport: createEmailTransport({ allowSandbox: false }),
			pushTransport,
			now: new Date('2026-11-28T09:15:00Z'),
			fetchImpl: async (url) => {
				if (url === capCancel.entryUrl) return new Response(capCancel.cap, { status: 200 });
				if (url.includes('-fa/')) return new Response(capCancel.rss, { status: 200 });
				return new Response('<?xml version="1.0"?><rss><channel/></rss>', { status: 200 });
			},
		});
		expect(dispatchCancel.sent).toBe(1);
		const decryptedCancel = JSON.parse(
			new TextDecoder().decode(
				await decryptWebPushPayloadForTest(sentBodies[1], client.privateJwk, client.p256dh, client.auth),
			),
		) as {
			msgType: string;
			title: string;
			url: string;
			route: { warningId: string; msgType: string };
		};
		expect(decryptedCancel.msgType).toBe('Cancel');
		expect(decryptedCancel.title).toContain('Official Cancellation');
		expect(decryptedCancel.url.startsWith('./?view=near-me')).toBe(true);
		expect(decryptedCancel.url).toContain('noticeStatus=cancelled');
		expect(decryptedCancel.route).toMatchObject({
			warningId: 'urn-irimo-cap-tehran-1',
			msgType: 'Cancel',
		});

		// Gone 410 endpoint auto-unsubscribes and cleans push_subscription_keys
		const cap2 = makeCapRssAndEntry({
			id: 'urn-irimo-cap-tehran-2',
			msgType: 'Alert',
			headlineEn: 'Second alert',
		});
		nextPushStatus = 410;
		const dispatch410 = await dispatchVerifiedWarningAlerts({
			db,
			kv: memoryKv().kv,
			transport: createEmailTransport({ allowSandbox: false }),
			pushTransport,
			now: new Date('2026-11-28T09:30:00Z'),
			fetchImpl: async (url) => {
				if (url === cap2.entryUrl) return new Response(cap2.cap, { status: 200 });
				if (url.includes('-fa/')) return new Response(cap2.rss, { status: 200 });
				return new Response('<?xml version="1.0"?><rss><channel/></rss>', { status: 200 });
			},
		});
		expect(dispatch410.failed).toBe(1);

		const subAfter410 = await db
			.prepare(`SELECT status FROM subscriptions WHERE id = ?`)
			.bind(createRes.body.subscriptionId ?? '')
			.first<{ status: string }>();
		expect(subAfter410?.status).toBe('unsubscribed');
		const keysAfter410 = await db
			.prepare(`SELECT COUNT(*) AS cnt FROM push_subscription_keys WHERE subscription_id = ?`)
			.bind(createRes.body.subscriptionId ?? '')
			.first<{ cnt: number }>();
		expect(keysAfter410?.cnt).toBe(0);

		// Unsubscribing directly by endpoint succeeds when active
		const client2 = await generateClientPushKeys();
		const ep2 = 'https://fcm.googleapis.com/fcm/send/resident-2';
		const create2 = await createSubscription({
			db,
			req: {
				channel: 'web_push',
				destination: ep2,
				placeName: 'Oslo',
				lat: 59.91,
				lng: 10.75,
				countryCode: 'NO',
				sourceId: 'no-metalerts',
				pushSubscription: { endpoint: ep2, keys: { p256dh: client2.p256dh, auth: client2.auth } },
			},
			transport: createEmailTransport({ allowSandbox: false }),
			pushTransport,
		});
		expect(create2.status, `create2=${JSON.stringify(create2)}`).toBe(201);
		const unsubByEndpoint = await unsubscribeSubscription(db, '', new Date(), {
			endpoint: ep2,
			channel: 'web_push',
		});
		expect(unsubByEndpoint.status).toBe(200);
		expect(unsubByEndpoint.body).toMatchObject({ ok: true, status: 'unsubscribed', scope: 'device', remainingCount: 0 });
	});

	it('avoids Topic collisions for long prefixed CAP IDs and isolates sandbox push from external network fetch', async () => {
		const t1 = await buildPushTopic('urn:oid:2.49.0.1.578.0.20261128080000.shared-prefix.001', 'Alert');
		const t2 = await buildPushTopic('urn:oid:2.49.0.1.578.0.20261128080000.shared-prefix.002', 'Alert');
		const t1Again = await buildPushTopic('urn:oid:2.49.0.1.578.0.20261128080000.shared-prefix.001', 'Alert');
		expect(t1.length).toBeLessThanOrEqual(32);
		expect(t2.length).toBeLessThanOrEqual(32);
		expect(t1).toBe(t1Again);
		expect(t1).not.toBe(t2);

		// Sandbox transport without fetchImpl must never contact external push endpoints over the network
		const client = await generateClientPushKeys();
		const sandboxTransport = createWebPushTransport({ allowSandbox: true });
		const origFetch = globalThis.fetch;
		let externalCalls = 0;
		globalThis.fetch = (async () => {
			externalCalls++;
			throw new Error('Unexpected external network fetch from sandbox push transport');
		}) as typeof fetch;
		try {
			const res = await sandboxTransport.send({
				endpoint: 'https://fcm.googleapis.com/fcm/send/isolated-sandbox-test',
				p256dh: client.p256dh,
				auth: client.auth,
				payloadJson: JSON.stringify({ title: 'Sandbox check' }),
				topic: t1,
				urgency: 'normal',
			});
			expect(res.providerMessageId).toMatch(/^sandbox-push:/);
			expect(externalCalls).toBe(0);
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	it('supports per-place push enrollment, lookup, stable conflict identity, per-place removal, device removal, and atomic rollback on key failure', async () => {
		const db = (env as typeof env & { AEGIS_DB: D1Database }).AEGIS_DB;
		const vapid = await generateVapidKeys();
		const client = await generateClientPushKeys();
		const endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/multi-place-browser';
		const pushTransport = createWebPushTransport({
			vapidPublicKey: vapid.publicKey,
			vapidPrivateKey: vapid.privateKey,
			vapidSubject: 'mailto:alerts@aegis-map.example',
			fetchImpl: async () => new Response(null, { status: 201 }),
		});

		// Enroll Place A (Oslo) and Place B (Bergen) on the same browser endpoint
		const placeA = await createSubscription({
			db,
			req: {
				channel: 'web_push',
				destination: endpoint,
				placeName: 'Oslo, Norway',
				lat: 59.9139,
				lng: 10.7522,
				countryCode: 'NO',
				sourceId: 'no-metalerts',
				pushSubscription: { endpoint, keys: { p256dh: client.p256dh, auth: client.auth } },
			},
			pushTransport,
		});
		expect(placeA.status).toBe(201);

		// Concurrent / retry re-registration of Place A retains stable subscriptionId & unsubscribeToken
		const placeARetry = await createSubscription({
			db,
			req: {
				channel: 'web_push',
				destination: endpoint,
				placeName: 'Oslo, Norway',
				lat: 59.91391,
				lng: 10.75221,
				countryCode: 'NO',
				sourceId: 'no-metalerts',
				minSeverity: 'severe',
				pushSubscription: { endpoint, keys: { p256dh: client.p256dh, auth: client.auth } },
			},
			pushTransport,
		});
		expect(placeARetry.status).toBe(201);
		expect(placeARetry.body.subscriptionId).toBe(placeA.body.subscriptionId);
		expect(placeARetry.body.unsubscribeToken).toBe(placeA.body.unsubscribeToken);

		const placeB = await createSubscription({
			db,
			req: {
				channel: 'web_push',
				destination: endpoint,
				placeName: 'Bergen, Norway',
				lat: 60.3913,
				lng: 5.3221,
				countryCode: 'NO',
				sourceId: 'no-metalerts',
				pushSubscription: { endpoint, keys: { p256dh: client.p256dh, auth: client.auth } },
			},
			pushTransport,
		});
		expect(placeB.status).toBe(201);
		expect(placeB.body.subscriptionId).not.toBe(placeA.body.subscriptionId);

		// Server lookup returns both active places (even if browser local metadata was lost)
		const lookupBoth = await lookupPushRegistrations(db, endpoint);
		expect(lookupBoth.status).toBe(200);
		expect(lookupBoth.body.registrations).toHaveLength(2);

		// Atomic rollback: if push_subscription_keys insert fails, no new active row is created and existing Place A/B stay intact
		await db
			.prepare(
				`CREATE TRIGGER test_fail_push_keys BEFORE INSERT ON push_subscription_keys
				 BEGIN SELECT RAISE(ABORT, 'simulated_key_write_failure'); END`,
			)
			.run();
		try {
			await expect(
				createSubscription({
					db,
					req: {
						channel: 'web_push',
						destination: endpoint,
						placeName: 'Trondheim, Norway',
						lat: 63.4305,
						lng: 10.3951,
						countryCode: 'NO',
						sourceId: 'no-metalerts',
						pushSubscription: { endpoint, keys: { p256dh: client.p256dh, auth: client.auth } },
					},
					pushTransport,
				}),
			).rejects.toThrow(/simulated_key_write_failure/);
		} finally {
			await db.prepare(`DROP TRIGGER IF EXISTS test_fail_push_keys`).run();
		}

		const orphanCheck = await db
			.prepare(`SELECT COUNT(*) AS cnt FROM subscriptions WHERE place_name = 'Trondheim, Norway'`)
			.first<{ cnt: number }>();
		expect(orphanCheck?.cnt).toBe(0);
		const lookupAfterFail = await lookupPushRegistrations(db, endpoint);
		expect(lookupAfterFail.body.registrations).toHaveLength(2);

		// Per-place disable removes ONLY Place A and leaves Place B active with intact keys
		const unsubA = await unsubscribeSubscription(db, '', new Date(), {
			endpoint,
			channel: 'web_push',
			scope: 'place',
			sourceId: 'no-metalerts',
			lat: 59.9139,
			lng: 10.7522,
		});
		expect(unsubA.status).toBe(200);
		expect(unsubA.body).toMatchObject({ ok: true, scope: 'place', removedCount: 1, remainingCount: 1 });

		const lookupAfterA = await lookupPushRegistrations(db, endpoint);
		expect(lookupAfterA.body.registrations).toHaveLength(1);
		expect(lookupAfterA.body.registrations[0].placeName).toBe('Bergen, Norway');

		// Device-wide disable removes remaining Place B
		const unsubDevice = await unsubscribeSubscription(db, '', new Date(), {
			endpoint,
			channel: 'web_push',
			scope: 'device',
		});
		expect(unsubDevice.status).toBe(200);
		expect(unsubDevice.body).toMatchObject({ ok: true, scope: 'device', removedCount: 1, remainingCount: 0 });
		const lookupFinal = await lookupPushRegistrations(db, endpoint);
		expect(lookupFinal.body.registrations).toHaveLength(0);
	});

	it('retries transient 503 push failure and reports push unavailable when migration 0003 is absent', async () => {
		const db = (env as typeof env & { AEGIS_DB: D1Database }).AEGIS_DB;
		const vapid = await generateVapidKeys();
		const client = await generateClientPushKeys();
		const endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/retry-resident';

		let attempts = 0;
		const flakyTransport = createWebPushTransport({
			vapidPublicKey: vapid.publicKey,
			vapidPrivateKey: vapid.privateKey,
			vapidSubject: 'mailto:alerts@aegis-map.example',
			fetchImpl: async () => {
				attempts++;
				if (attempts === 1) return new Response('transient', { status: 503 });
				return new Response(null, { status: 201, headers: { Location: 'msg-retry-ok' } });
			},
		});

		const created = await createSubscription({
			db,
			req: {
				channel: 'web_push',
				destination: endpoint,
				placeName: 'Tehran',
				lat: 35.6892,
				lng: 51.389,
				countryCode: 'IR',
				sourceId: 'ir-irimo',
				pushSubscription: { endpoint, keys: { p256dh: client.p256dh, auth: client.auth } },
			},
			pushTransport: flakyTransport,
		});
		expect(created.status).toBe(201);

		const cap = makeCapRssAndEntry({ id: 'urn-irimo-retry-1', msgType: 'Alert', headlineEn: 'Retry Alert' });
		const feedFetch = async (url: string) => {
			if (url === cap.entryUrl) return new Response(cap.cap, { status: 200 });
			if (url.includes('-fa/')) return new Response(cap.rss, { status: 200 });
			return new Response('<?xml version="1.0"?><rss><channel/></rss>', { status: 200 });
		};

		const firstRun = await dispatchVerifiedWarningAlerts({
			db,
			kv: memoryKv().kv,
			transport: createEmailTransport({ allowSandbox: false }),
			pushTransport: flakyTransport,
			now: new Date('2026-11-28T10:00:00Z'),
			fetchImpl: feedFetch,
		});
		expect(firstRun.failed).toBe(1);
		expect(firstRun.sent).toBe(0);

		const secondRun = await dispatchVerifiedWarningAlerts({
			db,
			kv: memoryKv().kv,
			transport: createEmailTransport({ allowSandbox: false }),
			pushTransport: flakyTransport,
			now: new Date('2026-11-28T10:05:00Z'),
			fetchImpl: feedFetch,
		});
		expect(secondRun.sent).toBe(1);
		expect(attempts).toBe(2);

		// Missing migration 0003 fails closed cleanly without breaking core D1 status
		await db.prepare(`DROP TABLE IF EXISTS push_subscription_keys`).run();
		try {
			const status = await getSubscriptionServiceStatus(db, createEmailTransport({ allowSandbox: false }), flakyTransport);
			expect(status.pushAvailable).toBe(false);
			expect(status.pushReason).toContain('0003');
			const failCreate = await createSubscription({
				db,
				req: {
					channel: 'web_push',
					destination: endpoint,
					placeName: 'Oslo',
					lat: 59.91,
					lng: 10.75,
					countryCode: 'NO',
					sourceId: 'no-metalerts',
					pushSubscription: { endpoint, keys: { p256dh: client.p256dh, auth: client.auth } },
				},
				pushTransport: flakyTransport,
			});
			expect(failCreate.status).toBe(503);
			expect(failCreate.body.code).toBe('push_delivery_unavailable');
		} finally {
			await db
				.prepare(
					`CREATE TABLE IF NOT EXISTS push_subscription_keys (
						subscription_id TEXT PRIMARY KEY,
						p256dh TEXT NOT NULL,
						auth TEXT NOT NULL,
						expiration_time INTEGER,
						user_locale TEXT,
						updated_at TEXT NOT NULL,
						FOREIGN KEY(subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
					)`,
				)
				.run();
		}
	});
});
