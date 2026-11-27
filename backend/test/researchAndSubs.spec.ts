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
	unsubscribeSubscription,
} from '../src/subscriptions';
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
			subscriptionId: string;
		};
		expect(created.ok).toBe(true);
		expect(created.status).toBe('pending_confirmation');
		expect(created.transportMode).toBe('sandbox');
		expect(created.sandboxPreviewToken).toBeTruthy();

		const confirmRes = await SELF.fetch(
			`http://example.com/api/v1/subscriptions/confirm?token=${encodeURIComponent(created.sandboxPreviewToken)}`,
			{ method: 'POST' },
		);
		expect(confirmRes.status).toBe(200);
		expect(await confirmRes.json()).toMatchObject({ ok: true, status: 'active' });

		// 3. Dispatch against mocked MET Norway active alert for Oslo
		const delivered: Array<{ subject: string; idempotencyKey: string }> = [];
		const spyTransport = {
			mode: 'sandbox' as const,
			async send(msg: { to: string; subject: string; text: string; idempotencyKey: string }) {
				delivered.push({ subject: msg.subject, idempotencyKey: msg.idempotencyKey });
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

		// 4. Subsequent clear/empty OK snapshot triggers one Cancel/All-Clear notice
		const thirdDispatch = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport,
			now: new Date('2026-11-26T07:00:00Z'),
			fetchImpl: async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 }),
		});
		expect(thirdDispatch.sent).toBe(1);
		expect(delivered[1].subject).toContain('Cleared/Cancelled');

		// 5. Unsubscribe stops future deliveries
		const unsubRes = await SELF.fetch('http://example.com/api/v1/subscriptions/unsubscribe', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: created.subscriptionId }),
		});
		expect(unsubRes.status).toBe(200);
		expect(await unsubRes.json()).toMatchObject({ ok: true, status: 'unsubscribed' });

		const checkAfter = await dispatchVerifiedWarningAlerts({
			db,
			kv: kv.kv,
			transport: spyTransport,
			now: new Date('2026-11-26T08:00:00Z'),
			fetchImpl: async () => new Response(JSON.stringify(metGeoJson), { status: 200 }),
		});
		// Only resend-user (not confirmed) + resident (unsubscribed) -> 0 active for resident; resend-user was pending_confirmation
		expect(checkAfter.sent).toBe(0);
	});
});
