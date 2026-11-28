import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { buildSarBboxes, isValidStacNextToken, searchSentinel1GrdScenes } from '../src/sarStac';
import {
	queryArchivedHistory,
	querySourceAnalytics,
	runBoundedHistoryBackfill,
	upsertArchivedEvents,
} from '../src/history';
import {
	confirmSubscription,
	createEmailTransport,
	createSubscription,
	dispatchVerifiedWarningAlerts,
	getSubscriptionServiceStatus,
	unsubscribeSubscription,
} from '../src/subscriptions';
import { queryOfficialWarnings } from '../src/warnings/service';
import { EONET_QUERIES, USGS_URL } from '../src/disasters';
import { callWorker, memoryKv, withFetch } from './helpers';

const ORIGIN = { Origin: 'https://hesam.me' };

async function clearArchiveAndSubTables() {
	const db = (env as typeof env & { AEGIS_DB: D1Database }).AEGIS_DB;
	await db.batch([
		db.prepare('DELETE FROM subscription_deliveries'),
		db.prepare('DELETE FROM subscriptions'),
		db.prepare('DELETE FROM disaster_revisions'),
		db.prepare('DELETE FROM disaster_events'),
		db.prepare('DELETE FROM ingestion_checkpoints'),
		db.prepare('DELETE FROM provider_health_runs'),
	]);
}

describe('Sentinel-1 STAC SAR scenes (/api/v1/sar-scenes)', () => {
	it('splits bounding boxes across the antimeridian and validates STAC pagination tokens', () => {
		const single = buildSarBboxes(59.9, 10.7);
		expect(single).toHaveLength(1);
		const splitWest = buildSarBboxes(10, -179.9);
		expect(splitWest).toHaveLength(2);
		expect(splitWest[0][0]).toBeGreaterThan(179);
		expect(splitWest[1][0]).toBe(-180);

		expect(isValidStacNextToken('next:sentinel-1-grd:S1A_IW_GRDH_1SDV_20261125')).toBe(true);
		expect(isValidStacNextToken('https://evil.example.com/inject')).toBe(false);
		expect(isValidStacNextToken(null)).toBe(false);
	});

	it('returns confirmed Sentinel-1 acquisitions, caches in KV, and handles invalid/502 states', async () => {
		const badCoord = await SELF.fetch('http://example.com/api/v1/sar-scenes?lat=99&lng=10');
		expect(badCoord.status).toBe(400);

		const kv = memoryKv();
		const stacBody = {
			features: [
				{
					id: 'S1A_IW_GRDH_1SDV_20261125T053000',
					bbox: [10.2, 59.5, 11.1, 60.2],
					geometry: {
						type: 'Polygon',
						coordinates: [[[10.2, 59.5], [11.1, 59.5], [11.1, 60.2], [10.2, 60.2], [10.2, 59.5]]],
					},
					properties: {
						platform: 'sentinel-1a',
						datetime: '2026-11-25T05:30:00Z',
						start_datetime: '2026-11-25T05:29:45Z',
						end_datetime: '2026-11-25T05:30:10Z',
						'sar:instrument_mode': 'IW',
						'sar:polarizations': ['VV', 'VH'],
						'sat:orbit_state': 'descending',
						'sat:relative_orbit': 66,
						'view:incidence_angle': 38.44,
					},
					assets: {
						thumbnail: { href: 'https://stac.dataspace.copernicus.eu/thumb.png' },
						Product: { href: 'https://stac.dataspace.copernicus.eu/product.zip' },
					},
				},
			],
			links: [
				{
					rel: 'next',
					body: { token: 'next:sentinel-1-grd:page2token_abc' },
				},
			],
		};

		let stacCalls = 0;
		const res1 = await searchSentinel1GrdScenes({
			lat: 59.91,
			lng: 10.75,
			startIso: '2026-11-20T00:00:00Z',
			endIso: '2026-11-26T00:00:00Z',
			kv: kv.kv,
			now: new Date('2026-11-26T01:00:00Z'),
			fetchImpl: async () => {
				stacCalls++;
				return new Response(JSON.stringify(stacBody), { status: 200 });
			},
		});

		expect(stacCalls).toBe(1);
		expect(res1.epistemicLabel).toBe('confirmed_acquisition');
		expect(res1.cached).toBe(false);
		expect(res1.nextToken).toBe('next:sentinel-1-grd:page2token_abc');
		expect(res1.scenes).toHaveLength(1);
		expect(res1.scenes[0]).toMatchObject({
			id: 'S1A_IW_GRDH_1SDV_20261125T053000',
			polarizations: ['VV', 'VH'],
			incidenceAngleDeg: 38.4,
			orbitState: 'descending',
		});

		const res2 = await searchSentinel1GrdScenes({
			lat: 59.91,
			lng: 10.75,
			startIso: '2026-11-20T00:00:00Z',
			endIso: '2026-11-26T00:00:00Z',
			kv: kv.kv,
			now: new Date('2026-11-26T01:02:00Z'),
			fetchImpl: async () => {
				throw new Error('should not hit upstream on KV hit');
			},
		});
		expect(res2.cached).toBe(true);
		expect(res2.scenes).toHaveLength(1);

		const failRoute = await withFetch(
			() => new Response('down', { status: 503 }),
			() => callWorker('/api/v1/sar-scenes?lat=10&lng=20', { AEGIS_CACHE: memoryKv().kv }, ORIGIN),
		);
		expect(failRoute.result.status).toBe(502);
		expect(await failRoute.result.json()).toMatchObject({ code: 'sar_stac_unavailable' });
	});
});

describe('D1 Historical Archive & Source Analytics (/api/v1/history, /api/v1/analytics/sources)', () => {
	beforeEach(async () => {
		await clearArchiveAndSubTables();
	});

	it('handles unconfigured D1 gracefully without throwing', async () => {
		const hist = await queryArchivedHistory({ db: undefined });
		expect(hist.storageAvailable).toBe(false);
		expect(hist.events).toEqual([]);

		const analytics = await querySourceAnalytics(undefined);
		expect(analytics.storageAvailable).toBe(false);
		expect(analytics.providers).toEqual([]);
	});

	it('preserves live first_seen_at provenance across backfill and records revisions', async () => {
		const db = (env as typeof env & { AEGIS_DB: D1Database }).AEGIS_DB;

		const liveTime = new Date('2026-11-25T10:00:00Z');
		await upsertArchivedEvents(
			db,
			[
				{
					id: 'us1000test1',
					title: 'M 5.4 - Coastal Ecuador',
					type: 'earthquake',
					lat: -1.2,
					lng: -80.4,
					date: '2026-11-25T09:50:00Z',
					severity: 'medium',
					magnitude: 5.4,
				},
			],
			{ isBackfill: false, now: liveTime },
		);

		// Later backfill sees revised magnitude/severity for the same event, plus a new historical event
		const backfillTime = new Date('2026-11-26T12:00:00Z');
		await upsertArchivedEvents(
			db,
			[
				{
					id: 'us1000test1',
					title: 'M 6.1 - Coastal Ecuador (Reviewed)',
					type: 'earthquake',
					lat: -1.21,
					lng: -80.42,
					date: '2026-11-25T09:50:00Z',
					severity: 'high',
					magnitude: 6.1,
				},
				{
					id: 'EONET_9901',
					title: 'Wildfire Historical Test',
					type: 'fire',
					lat: 38.5,
					lng: -120.2,
					date: '2026-11-20T04:00:00Z',
					severity: 'high',
					areaAcres: 1200,
				},
			],
			{ isBackfill: true, now: backfillTime },
		);

		const histRes = await SELF.fetch('http://example.com/api/v1/history?limit=10');
		expect(histRes.status).toBe(200);
		const hist = (await histRes.json()) as {
			storageAvailable: boolean;
			events: Array<{
				id: string;
				provenance: string;
				firstSeenAt: string;
				severity: string;
				revisions: Array<{ revisionNumber: number; severity: string }>;
			}>;
		};
		expect(hist.storageAvailable).toBe(true);
		const eq = hist.events.find((e) => e.id === 'usgs:us1000test1');
		const wf = hist.events.find((e) => e.id === 'eonet:EONET_9901');
		expect(eq?.provenance).toBe('live_captured');
		expect(eq?.firstSeenAt).toBe('2026-11-25T10:00:00.000Z');
		expect(eq?.severity).toBe('high');
		expect(eq?.revisions).toHaveLength(2);
		expect(wf?.provenance).toBe('reconstructed_backfill');
	});

	it('runs bounded backfill with optional GDACS match and logs provider analytics on /api/disasters', async () => {
		const db = (env as typeof env & { AEGIS_DB: D1Database }).AEGIS_DB;

		const bf = await runBoundedHistoryBackfill({
			db,
			days: 7,
			limit: 20,
			now: new Date('2026-11-26T00:00:00Z'),
			fetchImpl: async (url) => {
				if (url.includes('earthquake.usgs.gov')) {
					return new Response(
						JSON.stringify({
							features: [
								{
									id: 'us7000backfill',
									properties: { mag: 6.2, place: '60 km W of Sumatra', time: Date.parse('2026-11-24T08:00:00Z') },
									geometry: { type: 'Point', coordinates: [98.5, 1.2, 10] },
								},
							],
						}),
						{ status: 200 },
					);
				}
				if (url.includes('eonet.gsfc.nasa.gov')) {
					return new Response(
						JSON.stringify({
							events: [
								{
									id: 'EONET_BF_1',
									title: 'Sumatra Wildfire',
									categories: [{ id: 'wildfires' }],
									geometry: [{ date: '2026-11-23T12:00:00Z', type: 'Point', coordinates: [99.1, 1.4] }],
								},
							],
						}),
						{ status: 200 },
					);
				}
				// GDACS optional enrichment matching near (1.2, 98.5)
				return new Response(
					JSON.stringify({
						features: [
							{
								geometry: { coordinates: [98.55, 1.22] },
								properties: { eventid: 'GDACS-EQ-1449', eventtype: 'EQ' },
							},
						],
					}),
					{ status: 200 },
				);
			},
		});
		expect(bf.usgsFetched).toBe(1);
		expect(bf.eonetFetched).toBe(1);
		expect(bf.gdacsMatched).toBeGreaterThanOrEqual(1);

		const history = await queryArchivedHistory({ db, type: 'earthquake', limit: 10 });
		expect(history.events).toHaveLength(1);
		expect(history.events[0].gdacsMatchId).toBe('GDACS-EQ-1449');

		// Also verify /api/disasters cache-miss populates source analytics in D1
		const kv = memoryKv();
		await withFetch(
			(url) => {
				if (url === USGS_URL) {
					return new Response(
						JSON.stringify({
							type: 'FeatureCollection',
							features: [
								{
									id: 'uslive1',
									properties: { mag: 5.0, place: 'Aleutian Islands', time: Date.parse('2026-11-26T01:00:00Z') },
									geometry: { type: 'Point', coordinates: [-175.0, 51.5, 20] },
								},
							],
						}),
						{ status: 200 },
					);
				}
				if (EONET_QUERIES.some((q) => q.url === url)) {
					return new Response(JSON.stringify({ events: [] }), { status: 200 });
				}
				return new Response('not mocked', { status: 404 });
			},
			() => callWorker('/api/disasters', { AEGIS_CACHE: kv.kv, AEGIS_DB: db }, ORIGIN),
		);

		const analyticsRes = await SELF.fetch('http://example.com/api/v1/analytics/sources');
		expect(analyticsRes.status).toBe(200);
		const analytics = (await analyticsRes.json()) as {
			storageAvailable: boolean;
			providers: Array<{ provider: string; okRuns: number; totalRecords: number }>;
		};
		expect(analytics.storageAvailable).toBe(true);
		const usgsStat = analytics.providers.find((p) => p.provider === 'usgs');
		expect(usgsStat?.okRuns).toBeGreaterThanOrEqual(1);
		expect(usgsStat?.totalRecords).toBeGreaterThanOrEqual(1);
	});
});

describe('Subscriptions & Durable Alert Outbox (/api/v1/subscriptions*)', () => {
	beforeEach(async () => {
		await clearArchiveAndSubTables();
	});

	it('explicitly returns 501 sms_deferred for SMS and validates email/coords/authority', async () => {
		const smsRes = await SELF.fetch('http://example.com/api/v1/subscriptions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				channel: 'sms',
				destination: '+4712345678',
				placeName: 'Oslo',
				lat: 59.9139,
				lng: 10.7522,
				countryCode: 'NO',
				sourceId: 'no-metalerts',
			}),
		});
		expect(smsRes.status).toBe(501);
		expect(await smsRes.json()).toMatchObject({ ok: false, code: 'sms_deferred' });

		const badEmail = await SELF.fetch('http://example.com/api/v1/subscriptions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				channel: 'email',
				destination: 'not-an-email',
				placeName: 'Oslo',
				lat: 59.9139,
				lng: 10.7522,
				countryCode: 'NO',
				sourceId: 'no-metalerts',
			}),
		});
		expect(badEmail.status).toBe(400);
		expect(await badEmail.json()).toMatchObject({ ok: false, code: 'invalid_email' });
	});

	it('enforces double opt-in, omits preview token in resend mode, deduplicates alert dispatch & cancels', async () => {
		const db = (env as typeof env & { AEGIS_DB: D1Database }).AEGIS_DB;
		const kv = memoryKv();

		// 1. Live Resend transport mode must NOT return sandboxPreviewToken
		const sentConfirmEmails: Array<{ to: string; subject: string }> = [];
		const mockResend = createEmailTransport({
			resendApiKey: 're_test_dummy_key',
			fetchImpl: async (_url, init) => {
				const parsed = JSON.parse(String(init?.body ?? '{}')) as { to: string[]; subject: string };
				sentConfirmEmails.push({ to: parsed.to[0], subject: parsed.subject });
				return new Response(JSON.stringify({ id: 'resend-msg-confirm-1' }), { status: 200 });
			},
		});
		const resendCreate = await createSubscription({
			db,
			transport: mockResend,
			req: {
				channel: 'email',
				destination: 'resend-user@example.com',
				placeName: 'Bergen',
				lat: 60.39,
				lng: 5.32,
				countryCode: 'NO',
				sourceId: 'no-metalerts',
			},
		});
		expect(resendCreate.status).toBe(201);
		expect(resendCreate.body.transportMode).toBe('resend');
		expect(resendCreate.body.sandboxPreviewToken).toBeUndefined();
		expect(sentConfirmEmails).toHaveLength(1);

		// 2. Sandbox end-to-end HTTP create -> confirm -> active
		const createRes = await SELF.fetch('http://example.com/api/v1/subscriptions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				channel: 'email',
				destination: 'resident@example.com',
				placeName: 'Oslo',
				lat: 59.9139,
				lng: 10.7522,
				countryCode: 'NO',
				sourceId: 'no-metalerts',
				minSeverity: 'moderate',
			}),
		});
		expect(createRes.status).toBe(201);
		const created = (await createRes.json()) as {
			ok: boolean;
			status: string;
			transportMode: string;
			sandboxPreviewToken: string;
			sandboxUnsubscribeToken: string;
			subscriptionId: string;
		};
		expect(created.ok).toBe(true);
		expect(created.status).toBe('pending_confirmation');
		expect(created.transportMode).toBe('sandbox');
		expect(created.sandboxPreviewToken).toBeTruthy();
		expect(created.sandboxUnsubscribeToken).toBeTruthy();

		const confirmRes = await SELF.fetch(
			`http://example.com/api/v1/subscriptions/confirm?token=${encodeURIComponent(created.sandboxPreviewToken)}`,
			{ method: 'POST' },
		);
		expect(confirmRes.status).toBe(200);
		expect(await confirmRes.json()).toMatchObject({ ok: true, status: 'active' });

		// 3. Dispatch against mocked MET Norway active alert for Oslo
		const delivered: Array<{ to: string; subject: string; text: string; idempotencyKey: string }> = [];
		const spyTransport = {
			mode: 'sandbox' as const,
			async send(msg: { to: string; subject: string; text: string; idempotencyKey: string }) {
				delivered.push({ to: msg.to, subject: msg.subject, text: msg.text, idempotencyKey: msg.idempotencyKey });
				return { providerMessageId: `mock-${delivered.length}` };
			},
		};

		const metGeoJson = {
			type: 'FeatureCollection',
			features: [
				{
					id: 'met-oslo-gale-1',
					geometry: {
						type: 'Polygon',
						coordinates: [[[10.0, 59.5], [11.5, 59.5], [11.5, 60.5], [10.0, 60.5], [10.0, 59.5]]],
					},
					properties: {
						id: 'met-oslo-gale-1',
						title: 'Yellow gale warning for Oslofjord',
						event: 'gale',
						severity: 'Moderate',
						description: 'Strong gusts expected',
						instruction: 'Secure loose outdoor items',
						area: 'Oslo',
						eventEndingTime: '2026-11-30T00:00:00Z',
						onset: '2026-11-26T00:00:00Z',
					},
				},
			],
		};

		const firstDispatch = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport,
			now: new Date('2026-11-26T06:00:00Z'),
			fetchImpl: async () => new Response(JSON.stringify(metGeoJson), { status: 200 }),
		});
		expect(firstDispatch.sent).toBe(1);
		expect(delivered).toHaveLength(1);
		expect(delivered[0].subject).toContain('Official Alert');

		// Second dispatch with identical alert must deduplicate
		const secondDispatch = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport,
			now: new Date('2026-11-26T06:05:00Z'),
			fetchImpl: async () => new Response(JSON.stringify(metGeoJson), { status: 200 }),
		});
		expect(secondDispatch.sent).toBe(0);
		expect(secondDispatch.deduplicated).toBe(1);

		// 4a. An empty 200 feed without an explicit issuer Cancel MUST NOT trigger a false clearance email
		const emptyFeedDispatch = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport,
			now: new Date('2026-11-26T06:30:00Z'),
			fetchImpl: async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 }),
		});
		expect(emptyFeedDispatch.sent).toBe(0);
		expect(delivered).toHaveLength(1);

		// 4b. Explicit issuer Cancel message triggers ONE Official Cancellation notice
		const metCancelGeoJson = {
			type: 'FeatureCollection',
			features: [
				{
					id: 'met-oslo-gale-1-cancel',
					geometry: metGeoJson.features[0].geometry,
					properties: {
						...metGeoJson.features[0].properties,
						id: 'met-oslo-gale-1',
						type: 'Cancel',
						sent: '2026-11-26T07:00:00Z',
					},
				},
			],
		};
		const cancelDispatch = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport,
			now: new Date('2026-11-26T07:00:00Z'),
			fetchImpl: async () => new Response(JSON.stringify(metCancelGeoJson), { status: 200 }),
		});
		expect(cancelDispatch.sent).toBe(1);
		expect(delivered[1].subject).toContain('Official Cancellation');

		// 5. Unsubscribe rejects public subscriptionId and requires secret unsubscribeToken
		const forgedUnsubRes = await SELF.fetch('http://example.com/api/v1/subscriptions/unsubscribe', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: created.subscriptionId }),
		});
		expect(forgedUnsubRes.status).toBe(404);

		const unsubRes = await SELF.fetch('http://example.com/api/v1/subscriptions/unsubscribe', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: created.sandboxUnsubscribeToken }),
		});
		expect(unsubRes.status).toBe(200);
		expect(await unsubRes.json()).toMatchObject({ ok: true, status: 'unsubscribed' });

		// Old confirmation token cannot reactivate an unsubscribed address
		const replayConfirm = await SELF.fetch(
			`http://example.com/api/v1/subscriptions/confirm?token=${encodeURIComponent(created.sandboxPreviewToken)}`,
			{ method: 'POST' },
		);
		expect([404, 409]).toContain(replayConfirm.status);
		const persistedRow = await db
			.prepare(`SELECT status FROM subscriptions WHERE id = ?`)
			.bind(created.subscriptionId)
			.first<{ status: string }>();
		expect(persistedRow?.status).toBe('unsubscribed');

		const checkAfter = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport,
			now: new Date('2026-11-26T08:00:00Z'),
			fetchImpl: async () => new Response(JSON.stringify(metGeoJson), { status: 200 }),
		});
		expect(checkAfter.sent).toBe(0);
	});

	it('prevents false clearances across partial feeds, budget limits, malformed siblings, unresolved geometry, filter changes, out-of-order updates, and expiry', async () => {
		const db = (env as typeof env & { AEGIS_DB: D1Database }).AEGIS_DB;
		const kv = memoryKv();
		const spyTransport = (() => {
			const sent: Array<{ subject: string; text: string }> = [];
			return {
				sent,
				transport: {
					mode: 'sandbox' as const,
					async send(msg: { to: string; subject: string; text: string; idempotencyKey: string }) {
						sent.push({ subject: msg.subject, text: msg.text });
						return { providerMessageId: `msg-${sent.length}` };
					},
				},
			};
		})();

		const capXml = (opts: {
			id: string;
			sent: string;
			msgType?: 'Alert' | 'Update' | 'Cancel';
			refs?: string;
			severity?: string;
			expires?: string;
			includeArea?: boolean;
		}) => `<?xml version="1.0" encoding="UTF-8"?>
<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
  <cap:identifier>${opts.id}</cap:identifier>
  <cap:sender>irimo@irimo.ir</cap:sender>
  <cap:sent>${opts.sent}</cap:sent>
  <cap:status>Actual</cap:status>
  <cap:msgType>${opts.msgType ?? 'Alert'}</cap:msgType>
  <cap:scope>Public</cap:scope>
  ${opts.refs ? `<cap:references>${opts.refs}</cap:references>` : ''}
  <cap:info>
    <cap:language>en</cap:language>
    <cap:category>Met</cap:category>
    <cap:event>Heavy Snow &amp; Wind</cap:event>
    <cap:urgency>Expected</cap:urgency>
    <cap:severity>${opts.severity ?? 'Severe'}</cap:severity>
    <cap:certainty>Likely</cap:certainty>
    <cap:expires>${opts.expires ?? '2026-11-28T12:00:00Z'}</cap:expires>
    <cap:headline>${opts.id} Headline</cap:headline>
    <cap:description>Tehran highland blizzard warning.</cap:description>
    <cap:instruction>Avoid mountain passes.</cap:instruction>
    ${opts.includeArea === false ? '' : `<cap:area><cap:areaDesc>Tehran</cap:areaDesc><cap:polygon>35.2,50.8 35.2,52.0 36.1,52.0 36.1,50.8 35.2,50.8</cap:polygon></cap:area>`}
  </cap:info>
</cap:alert>`;

		const rssXml = (urls: string[]) =>
			`<?xml version="1.0"?><rss><channel>${urls.map((u, i) => `<item><title>Item ${i}</title><link>${u}</link></item>`).join('')}</channel></rss>`;

		// Subscribe and confirm Tehran resident for IRIMO CAP/RSS adapter
		const subCreate = await createSubscription({
			db,
			req: {
				channel: 'email',
				destination: 'tehran-resident@example.com',
				placeName: 'Tehran',
				lat: 35.6892,
				lng: 51.389,
				countryCode: 'IR',
				sourceId: 'ir-irimo',
				minSeverity: 'moderate',
			},
			transport: spyTransport.transport,
		});
		expect(subCreate.status).toBe(201);
		expect(subCreate.body.ok).toBe(true);
		if (subCreate.body.ok && subCreate.body.sandboxPreviewToken) {
			const confirmed = await confirmSubscription(db, subCreate.body.sandboxPreviewToken);
			expect(confirmed.status).toBe(200);
		}

		// Step 0: Complete feed delivers ALERT-1 once
		const alert1Url = 'https://www.irimo.ir/cap/alert-1.xml';
		const okFetch = async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith('/rss.xml')) {
				return new Response(url.includes('-fa/') ? rssXml([alert1Url]) : rssXml([]), { status: 200 });
			}
			if (url === alert1Url) return new Response(capXml({ id: 'ALERT-1', sent: '2026-11-27T06:00:00Z' }), { status: 200 });
			return new Response('not found', { status: 404 });
		};
		const r0 = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport.transport,
			now: new Date('2026-11-27T06:05:00Z'),
			fetchImpl: okFetch,
		});
		expect(r0.sent).toBe(1);
		expect(spyTransport.sent).toHaveLength(1);
		expect(spyTransport.sent[0].subject).toContain('Official Alert');

		// Step 1: Partial feed (RSS succeeded with uncached failed link returning 500, ALERT-1 omitted from RSS) -> partial_coverage, 0 false cancellations, LKG ALERT-1 retained
		const failedDetailUrl = 'https://www.irimo.ir/cap/detail-fail.xml';
		const partialFetch = async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith('/rss.xml')) {
				return new Response(url.includes('-fa/') ? rssXml([failedDetailUrl]) : rssXml([]), { status: 200 });
			}
			return new Response('upstream error', { status: 500 });
		};
		const w1 = await queryOfficialWarnings({
			lat: 35.6892,
			lng: 51.389,
			countryCode: 'IR',
			kv: kv.kv,
			fetchImpl: partialFetch,
			now: new Date('2026-11-27T06:20:00Z'),
			forceRefresh: true,
		});
		expect(w1.coverageStatus).toBe('partial_coverage');
		expect(w1.warnings.map((w) => w.identifier)).toContain('ALERT-1');
		const r1 = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport.transport,
			now: new Date('2026-11-27T06:21:00Z'),
			fetchImpl: partialFetch,
		});
		expect(r1.sent).toBe(0);
		expect(spyTransport.sent).toHaveLength(1);

		// Step 2: Budget exhaustion (18 RSS items, beyond 15-item budget, ALERT-1 omitted) -> partial_coverage, 0 cancellations
		const manyLinks = Array.from({ length: 18 }, (_, i) => `https://www.irimo.ir/cap/other-${i}.xml`);
		const budgetFetch = async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith('/rss.xml')) {
				return new Response(url.includes('-fa/') ? rssXml(manyLinks) : rssXml([]), { status: 200 });
			}
			return new Response(capXml({ id: 'OTHER', sent: '2026-11-27T06:00:00Z', includeArea: false }), { status: 200 });
		};
		const w2 = await queryOfficialWarnings({
			lat: 35.6892,
			lng: 51.389,
			countryCode: 'IR',
			kv: kv.kv,
			fetchImpl: budgetFetch,
			now: new Date('2026-11-27T06:35:00Z'),
			forceRefresh: true,
		});
		expect(w2.coverageStatus).toBe('partial_coverage');
		const r2 = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport.transport,
			now: new Date('2026-11-27T06:36:00Z'),
			fetchImpl: budgetFetch,
		});
		expect(r2.sent).toBe(0);
		expect(spyTransport.sent).toHaveLength(1);

		// Step 3: Malformed sibling XML -> partial_coverage, 0 false cancellations
		const malformedFetch = async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith('/rss.xml')) {
				return new Response(url.includes('-fa/') ? rssXml(['https://www.irimo.ir/cap/bad.xml']) : rssXml([]), { status: 200 });
			}
			return new Response('<cap:alert><broken', { status: 200 });
		};
		const w3 = await queryOfficialWarnings({
			lat: 35.6892,
			lng: 51.389,
			countryCode: 'IR',
			kv: kv.kv,
			fetchImpl: malformedFetch,
			now: new Date('2026-11-27T06:50:00Z'),
			forceRefresh: true,
		});
		expect(w3.coverageStatus).toBe('partial_coverage');
		const r3 = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport.transport,
			now: new Date('2026-11-27T06:51:00Z'),
			fetchImpl: malformedFetch,
		});
		expect(r3.sent).toBe(0);

		// Step 4: Severity filter tightened to 'extreme' (ALERT-1 is 'Severe') -> 0 false cancellations
		await db.prepare(`UPDATE subscriptions SET min_severity = 'extreme'`).run();
		const r4 = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport.transport,
			now: new Date('2026-11-27T07:05:00Z'),
			fetchImpl: okFetch,
		});
		expect(r4.sent).toBe(0);

		// Step 5: Duplicate & out-of-order superseding Update (Update arrives before parent, omits area -> inherits parent polygon!)
		await db.prepare(`UPDATE subscriptions SET min_severity = 'moderate'`).run();
		const updUrl = 'https://www.irimo.ir/cap/alert-2-update.xml';
		const updateFetch = async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith('/rss.xml')) {
				return new Response(url.includes('-fa/') ? rssXml([updUrl, alert1Url, updUrl]) : rssXml([]), { status: 200 });
			}
			if (url === updUrl) {
				return new Response(
					capXml({
						id: 'ALERT-2-UPDATE',
						sent: '2026-11-27T07:20:00Z',
						msgType: 'Update',
						refs: 'irimo@irimo.ir,ALERT-1,2026-11-27T06:00:00Z',
						severity: 'Extreme',
						expires: '2026-11-27T10:00:00Z',
						includeArea: false,
					}),
					{ status: 200 },
				);
			}
			return new Response(
				capXml({
					id: 'ALERT-1',
					sent: '2026-11-27T06:00:00Z',
					expires: '2026-11-27T10:00:00Z',
				}),
				{ status: 200 },
			);
		};
		const w5 = await queryOfficialWarnings({
			lat: 35.6892,
			lng: 51.389,
			countryCode: 'IR',
			kv: kv.kv,
			fetchImpl: updateFetch,
			now: new Date('2026-11-27T07:25:00Z'),
			forceRefresh: true,
		});
		expect(w5.coverageStatus).toBe('active_warnings');
		expect(w5.warnings.map((w) => w.identifier)).toEqual(['ALERT-2-UPDATE']);
		expect(w5.warnings[0].msgType).toBe('Update');
		const r5 = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport.transport,
			now: new Date('2026-11-27T07:26:00Z'),
			fetchImpl: updateFetch,
		});
		expect(r5.sent).toBe(1);
		expect(spyTransport.sent[1].subject).toContain('Official Update');

		// Step 6: Natural expiry (clock past 10:00Z) -> UI shows checked_no_warnings, dispatcher sends 0 false cancellations
		// Put ALERT-1-v2 expiring at 10:00Z fresh into CAP cache under new URLs so cached un-expired ALERT-1 isn't reused
		const alert1ExpUrl = 'https://www.irimo.ir/cap/alert-1-exp.xml';
		const updExpUrl = 'https://www.irimo.ir/cap/alert-2-update-exp.xml';
		const expiredFetch = async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith('/rss.xml')) {
				return new Response(url.includes('-fa/') ? rssXml([updExpUrl, alert1ExpUrl]) : rssXml([]), { status: 200 });
			}
			if (url === updExpUrl) {
				return new Response(
					capXml({
						id: 'ALERT-2-UPDATE',
						sent: '2026-11-27T07:20:00Z',
						msgType: 'Update',
						refs: 'irimo@irimo.ir,ALERT-1,2026-11-27T06:00:00Z',
						severity: 'Extreme',
						expires: '2026-11-27T10:00:00Z',
						includeArea: false,
					}),
					{ status: 200 },
				);
			}
			return new Response(
				capXml({
					id: 'ALERT-1',
					sent: '2026-11-27T06:00:00Z',
					expires: '2026-11-27T10:00:00Z',
				}),
				{ status: 200 },
			);
		};
		const w6 = await queryOfficialWarnings({
			lat: 35.6892,
			lng: 51.389,
			countryCode: 'IR',
			kv: kv.kv,
			fetchImpl: expiredFetch,
			now: new Date('2026-11-27T11:00:00Z'),
			forceRefresh: true,
		});
		expect(w6.coverageStatus).toBe('checked_no_warnings');
		const r6 = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport.transport,
			now: new Date('2026-11-27T11:01:00Z'),
			fetchImpl: expiredFetch,
		});
		expect(r6.sent).toBe(0);

		// Step 7: Explicit CAP Cancel referencing ALERT-2-UPDATE triggers ONE cancellation email and deduplicates on replay
		const cancelUrl = 'https://www.irimo.ir/cap/alert-3-cancel.xml';
		const explicitCancelFetch = async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith('/rss.xml')) {
				return new Response(url.includes('-fa/') ? rssXml([cancelUrl, updExpUrl, alert1ExpUrl]) : rssXml([]), { status: 200 });
			}
			if (url === cancelUrl) {
				return new Response(
					capXml({
						id: 'ALERT-3-CANCEL',
						sent: '2026-11-27T08:00:00Z',
						msgType: 'Cancel',
						refs: 'irimo@irimo.ir,ALERT-2-UPDATE,2026-11-27T07:20:00Z',
						includeArea: false,
					}),
					{ status: 200 },
				);
			}
			return expiredFetch(input);
		};
		const w7 = await queryOfficialWarnings({
			lat: 35.6892,
			lng: 51.389,
			countryCode: 'IR',
			kv: kv.kv,
			fetchImpl: explicitCancelFetch,
			now: new Date('2026-11-27T08:05:00Z'),
			forceRefresh: true,
		});
		expect(w7.warnings).toHaveLength(0);
		const r7 = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport.transport,
			now: new Date('2026-11-27T08:06:00Z'),
			fetchImpl: explicitCancelFetch,
		});
		expect(r7.sent).toBe(1);
		expect(spyTransport.sent).toHaveLength(3);
		expect(spyTransport.sent[2].subject).toContain('Official Cancellation');

		const r7Dup = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport.transport,
			now: new Date('2026-11-27T08:10:00Z'),
			fetchImpl: explicitCancelFetch,
		});
		expect(r7Dup.sent).toBe(0);
		expect(spyTransport.sent).toHaveLength(3);
	});

	it('processes 205 subscribers across resumable keyset batches, 55 prior deliveries, lease locks, and KV receipt healing', async () => {
		const db = (env as typeof env & { AEGIS_DB: D1Database }).AEGIS_DB;
		const kv = memoryKv();
		const deliveredTo: string[] = [];
		const spyTransport = {
			mode: 'sandbox' as const,
			async send(msg: { to: string; subject: string; text: string; idempotencyKey: string }) {
				deliveredTo.push(msg.to);
				return { providerMessageId: `batch-${deliveredTo.length}` };
			},
		};

		// Insert 205 active subscribers in chunks
		for (let start = 0; start < 205; start += 50) {
			const end = Math.min(205, start + 50);
			const stmts: D1PreparedStatement[] = [];
			for (let i = start; i < end; i++) {
				const id = `sub-${String(i).padStart(3, '0')}`;
				stmts.push(
					db
						.prepare(
							`INSERT INTO subscriptions (id, channel, destination, place_name, lat, lng, country_code, source_id, min_severity, status, confirm_token, unsubscribe_token, created_at, confirmed_at)
							 VALUES (?, 'email', ?, 'Oslo', 59.91, 10.75, 'NO', 'no-metalerts', 'moderate', 'active', ?, ?, '2026-11-26T00:00:00Z', '2026-11-26T00:01:00Z')`,
						)
						.bind(id, `user${i}@example.com`, `consumed:${id}`, `unsub-${i}`),
				);
			}
			await db.batch(stmts);
		}

		// Seed 55 prior 'sent' deliveries for the last subscriber (sub-204) to verify loadAllSentDeliveriesForSub > 50
		const priorStmts: D1PreparedStatement[] = [];
		for (let j = 0; j < 55; j++) {
			priorStmts.push(
				db
					.prepare(
						`INSERT INTO subscription_deliveries (id, subscription_id, alert_id, alert_revision_sent_at, msg_type, idempotency_key, status, attempts, provider_message_id, created_at, updated_at)
						 VALUES (?, 'sub-204', ?, '2026-11-25T00:00:00Z', 'Alert', ?, 'sent', 1, ?, '2026-11-25T00:00:00Z', '2026-11-25T00:00:00Z')`,
					)
					.bind(`del-${String(j).padStart(3, '0')}`, `alert-${j}`, `key-${j}`, `prov-${j}`),
			);
		}
		await db.batch(priorStmts);

		// Seed KV snapshot with version: 1 and an explicit cancellation for alert-54 (the 55th delivery!)
		await kv.kv.put(
			'warnings:source:v1:no-metalerts',
			JSON.stringify({
				version: 1,
				sourceId: 'no-metalerts',
				checkedAt: '2026-11-27T09:00:00Z',
				lastSuccessAt: '2026-11-27T09:00:00Z',
				completeness: 'complete',
				partialReasons: [],
				etag: null,
				lastModified: null,
				backoffUntil: null,
				lastError: null,
				records: [
					{
						id: 'no-alert-54-cancel',
						identifier: 'alert-54',
						sourceId: 'no-metalerts',
						issuerName: 'MET Norway',
						issuerUrl: 'https://www.met.no/',
						countryCode: 'NO',
						msgType: 'Cancel',
						lifecycleState: 'cancelled',
						references: ['alert-54'],
						category: 'Met',
						severity: 'severe',
						urgency: 'Expected',
						certainty: 'Likely',
						sentAt: '2026-11-27T09:00:00Z',
						effectiveAt: '2026-11-27T09:00:00Z',
						onsetAt: null,
						expiresAt: null,
						missingExpiry: true,
						clockSkewFlag: false,
						primaryLanguage: 'en',
						translations: [{ language: 'en', headline: 'Alert 54 cancelled', event: 'Gale', description: 'Cancelled', instruction: null, areaDesc: 'Oslo', web: null }],
						bulletinUrl: 'https://www.met.no/',
						attribution: 'MET Norway',
						areas: [{ areaDesc: 'Oslo', polygons: [[[10.0, 59.5], [11.5, 59.5], [11.5, 60.5], [10.0, 60.5], [10.0, 59.5]]], geocodes: [] }],
					},
				],
			}),
		);

		// Also verify active lease blocks an overlapping run
		await db
			.prepare(
				`INSERT INTO ingestion_checkpoints (source, window_key, cursor, updated_at, status)
				 VALUES ('subscription_dispatch', 'lease', 'other-worker|2026-11-27T09:00:45.000Z', '2026-11-27T09:00:00Z', 'running')`,
			)
			.run();
		const overlapped = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport,
			now: new Date('2026-11-27T09:00:10Z'),
			fetchImpl: async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 }),
		});
		expect(overlapped.skippedLease).toBe(true);
		expect(overlapped.sent).toBe(0);

		// Clear lease and update snapshot with an active gale warning so all 205 subscribers receive 1 alert + sub-204 ALSO gets Cancel for alert-54
		await db.prepare(`DELETE FROM ingestion_checkpoints WHERE source = 'subscription_dispatch' AND window_key = 'lease'`).run();
		const activeSnap = JSON.parse((await kv.kv.get('warnings:source:v1:no-metalerts'))!);
		activeSnap.records.push({
			id: 'no-active-wave',
			identifier: 'active-wave-1',
			sourceId: 'no-metalerts',
			issuerName: 'MET Norway',
			issuerUrl: 'https://www.met.no/',
			countryCode: 'NO',
			msgType: 'Alert',
			lifecycleState: 'active',
			references: [],
			category: 'Met',
			severity: 'severe',
			urgency: 'Expected',
			certainty: 'Likely',
			sentAt: '2026-11-27T09:00:00Z',
			effectiveAt: '2026-11-27T09:00:00Z',
			onsetAt: '2026-11-27T08:00:00Z',
			expiresAt: '2026-11-28T09:00:00Z',
			missingExpiry: false,
			clockSkewFlag: false,
			primaryLanguage: 'en',
			translations: [{ language: 'en', headline: 'Severe gale warning', event: 'Gale', description: 'Heavy wind', instruction: 'Stay indoors', areaDesc: 'Oslo', web: null }],
			bulletinUrl: 'https://www.met.no/',
			attribution: 'MET Norway',
			areas: [{ areaDesc: 'Oslo', polygons: [[[10.0, 59.5], [11.5, 59.5], [11.5, 60.5], [10.0, 60.5], [10.0, 59.5]]], geocodes: [] }],
		});
		await kv.kv.put('warnings:source:v1:no-metalerts', JSON.stringify(activeSnap));

		// Run 4 resumable invocations capped at 70 subscribers each within 180s poll cache window -> processes all 205 (70 + 70 + 65, then heal)
		const run1 = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport,
			now: new Date('2026-11-27T09:00:30Z'),
			pageSize: 70,
			maxSubscriptions: 70,
			maxSubrequests: 200,
		});
		expect(run1.subscriptionsVisited).toBe(70);
		expect(run1.sent).toBe(70);

		const run2 = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport,
			now: new Date('2026-11-27T09:01:00Z'),
			pageSize: 70,
			maxSubscriptions: 70,
			maxSubrequests: 200,
		});
		expect(run2.subscriptionsVisited).toBe(70);
		expect(run2.sent).toBe(70);

		const run3 = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport,
			now: new Date('2026-11-27T09:01:30Z'),
			pageSize: 70,
			maxSubscriptions: 70,
			maxSubrequests: 200,
		});
		expect(run3.subscriptionsVisited).toBe(65);
		// 65 active alerts + 1 Cancel for sub-204's 55th prior delivery ('alert-54')
		expect(run3.sent).toBe(66);
		expect(deliveredTo).toHaveLength(206);
		expect(deliveredTo.filter((x) => x === 'user204@example.com')).toHaveLength(2);

		// Also verify retry_pending with pre-existing KV receipt heals D1 without re-invoking transport.send
		await kv.kv.put('sub:sent:del-heal-1', 'provider-accepted-999');
		await db
			.prepare(
				`INSERT INTO subscription_deliveries (id, subscription_id, alert_id, alert_revision_sent_at, msg_type, idempotency_key, status, attempts, rendered_subject, rendered_body, created_at, updated_at)
				 VALUES ('del-heal-1', 'sub-000', 'heal-alert', '2026-11-27T09:00:00Z', 'Alert', 'heal-key-1', 'retry_pending', 1, 'Heal Subject', 'Body', '2026-11-27T09:00:00Z', '2026-11-27T09:00:00Z')`,
			)
			.run();
		const beforeCount = deliveredTo.length;
		const healRun = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport,
			now: new Date('2026-11-27T09:02:00Z'),
			pageSize: 70,
			maxSubscriptions: 70,
			maxSubrequests: 200,
		});
		expect(healRun.deduplicated).toBeGreaterThanOrEqual(1);
		expect(deliveredTo.length).toBe(beforeCount);
		const healedRow = await db
			.prepare(`SELECT status, provider_message_id FROM subscription_deliveries WHERE id = 'del-heal-1'`)
			.first<{ status: string; provider_message_id: string }>();
		expect(healedRow).toEqual({ status: 'sent', provider_message_id: 'provider-accepted-999' });
	}, 20_000);

	it('honestly reports unavailable subscription delivery when production mail config is absent and enforces single-use consent tokens', async () => {
		const db = (env as typeof env & { AEGIS_DB: D1Database }).AEGIS_DB;
		const disabled = createEmailTransport({ allowSandbox: false });
		expect(disabled.mode).toBe('disabled');
		expect(await getSubscriptionServiceStatus(db, disabled)).toMatchObject({
			available: false,
			mode: 'unavailable',
			smsAvailable: false,
			reason:
				'Automated email alert delivery is not configured in this deployment (RESEND_API_KEY missing). Official warnings remain available directly in Near me.',
			pushAvailable: false,
			pushMode: 'unavailable',
		});

		const blockedCreate = await createSubscription({
			db,
			req: {
				channel: 'email',
				destination: 'prod-user@example.com',
				placeName: 'Oslo',
				lat: 59.91,
				lng: 10.75,
				countryCode: 'NO',
				sourceId: 'no-metalerts',
			},
			transport: disabled,
		});
		expect(blockedCreate.status).toBe(503);
		expect(blockedCreate.body).toMatchObject({
			ok: false,
			code: 'delivery_unavailable',
		});

		// Sandbox consent token lifecycle: single-use confirm -> duplicate blocked -> unsubscribe -> reactivation blocked
		const sandbox = createEmailTransport({ allowSandbox: true });
		const okCreate = await createSubscription({
			db,
			req: {
				channel: 'email',
				destination: 'consent@example.com',
				placeName: 'Oslo',
				lat: 59.91,
				lng: 10.75,
				countryCode: 'NO',
				sourceId: 'no-metalerts',
			},
			transport: sandbox,
		});
		expect(okCreate.status).toBe(201);
		expect(okCreate.body.ok).toBe(true);
		if (okCreate.body.ok && okCreate.body.sandboxPreviewToken && okCreate.body.sandboxUnsubscribeToken) {
			const c1 = await confirmSubscription(db, okCreate.body.sandboxPreviewToken);
			expect(c1.status).toBe(200);
			expect(c1.body).toMatchObject({ ok: true, status: 'active' });

			// Reusing a consumed confirmation token is rejected (404 not_found)
			const c2 = await confirmSubscription(db, okCreate.body.sandboxPreviewToken);
			expect(c2.status).toBe(404);

			const u1 = await unsubscribeSubscription(db, okCreate.body.sandboxUnsubscribeToken);
			expect(u1.status).toBe(200);
			expect(u1.body).toMatchObject({ ok: true, status: 'unsubscribed' });

			// Unsubscribed subscription cannot be reactivated via old token
			const c3 = await confirmSubscription(db, okCreate.body.sandboxPreviewToken);
			expect([404, 409]).toContain(c3.status);
			const row = await db
				.prepare(`SELECT status FROM subscriptions WHERE id = ?`)
				.bind(okCreate.body.subscriptionId ?? '')
				.first<{ status: string }>();
			expect(row?.status).toBe('unsubscribed');
		}
	});
});
