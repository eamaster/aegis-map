import { describe, expect, it } from 'vitest';
import {
	assertSafeXml,
	parseCapAlertXml,
	parseCapPolygonToGeoJsonRing,
	resolveCapLifecycle,
	sanitizeBulletinUrl,
} from '../src/warnings/capParser';
import { matchMalaysiaWarningText, matchPointToCapAreas, pointInPolygonRing } from '../src/warnings/geoMatch';
import { queryOfficialWarnings } from '../src/warnings/service';
import { callWorker, memoryKv, withFetch } from './helpers';

const SAMPLE_CAP_ALERT = (overrides: {
	id?: string;
	sent?: string;
	status?: string;
	msgType?: string;
	scope?: string;
	refs?: string;
	expires?: string;
	onset?: string;
	polygon?: string;
	lang?: string;
	web?: string;
}) => `<?xml version="1.0" encoding="UTF-8"?>
<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
  <cap:identifier>${overrides.id ?? 'ALERT-1'}</cap:identifier>
  <cap:sender>meteorologi@met.no</cap:sender>
  <cap:sent>${overrides.sent ?? '2026-11-27T10:00:00Z'}</cap:sent>
  <cap:status>${overrides.status ?? 'Actual'}</cap:status>
  <cap:msgType>${overrides.msgType ?? 'Alert'}</cap:msgType>
  <cap:scope>${overrides.scope ?? 'Public'}</cap:scope>
  ${overrides.refs ? `<cap:references>${overrides.refs}</cap:references>` : ''}
  <cap:info>
    <cap:language>${overrides.lang ?? 'no'}</cap:language>
    <cap:category>Met</cap:category>
    <cap:event>Gale</cap:event>
    <cap:urgency>Expected</cap:urgency>
    <cap:severity>Severe</cap:severity>
    <cap:certainty>Likely</cap:certainty>
    ${overrides.onset ? `<cap:onset>${overrides.onset}</cap:onset>` : ''}
    ${overrides.expires !== undefined ? (overrides.expires ? `<cap:expires>${overrides.expires}</cap:expires>` : '') : '<cap:expires>2026-11-28T12:00:00Z</cap:expires>'}
    <cap:headline>Severe Gale Warning</cap:headline>
    <cap:description>Strong coastal winds expected.</cap:description>
    <cap:instruction>Secure loose items.</cap:instruction>
    <cap:web>${overrides.web ?? 'www.met.no'}</cap:web>
    <cap:area>
      <cap:areaDesc>Oslo Coast</cap:areaDesc>
      <cap:polygon>${overrides.polygon ?? '59.5,10.0 59.5,11.5 60.5,11.5 60.5,10.0 59.5,10.0'}</cap:polygon>
    </cap:area>
  </cap:info>
</cap:alert>`;

describe('CAP v1.2 parser & security', () => {
	it('rejects DOCTYPE/ENTITY declarations and unsafe URL schemes', () => {
		expect(() => assertSafeXml('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><alert/>')).toThrow();
		expect(sanitizeBulletinUrl('javascript:alert(1)')).toBeNull();
		expect(sanitizeBulletinUrl('data:text/html,hi')).toBeNull();
		expect(sanitizeBulletinUrl('www.irimo.ir')).toBe('https://www.irimo.ir/');
	});

	it('rejects non-Actual or non-Public CAP alerts and converts lat,lng to GeoJSON [lng,lat]', () => {
		expect(parseCapAlertXml(SAMPLE_CAP_ALERT({ status: 'Test' }))).toBeNull();
		expect(parseCapAlertXml(SAMPLE_CAP_ALERT({ scope: 'Restricted' }))).toBeNull();
		const ring = parseCapPolygonToGeoJsonRing('59.5,10.0 59.5,11.5 60.5,11.5');
		expect(ring).toEqual([
			[10.0, 59.5],
			[11.5, 59.5],
			[11.5, 60.5],
		]);
	});

	it('resolves Update/Cancel chains out-of-order, merges mirrored languages, and detects missing expiry/skew', () => {
		const a1 = parseCapAlertXml(SAMPLE_CAP_ALERT({ id: 'A1', sent: '2026-11-27T08:00:00Z', lang: 'fa' }))!;
		const a1Mirror = parseCapAlertXml(SAMPLE_CAP_ALERT({ id: 'A1', sent: '2026-11-27T08:00:00Z', lang: 'en' }))!;
		const cancelA1 = parseCapAlertXml(
			SAMPLE_CAP_ALERT({
				id: 'A1-CANCEL',
				msgType: 'Cancel',
				sent: '2026-11-27T09:00:00Z',
				refs: 'meteorologi@met.no,A1,2026-11-27T08:00:00Z',
			}),
		)!;
		const futureSkewNoExpiry = parseCapAlertXml(
			SAMPLE_CAP_ALERT({
				id: 'A2',
				sent: '2026-11-27T14:00:00Z',
				expires: '',
			}),
		)!;

		// Feed in out-of-order (cancel arrives before original + mirror)
		const resolved = resolveCapLifecycle(
			[cancelA1, a1, a1Mirror, futureSkewNoExpiry],
			new Date('2026-11-27T12:00:00Z'),
		);
		const resA1 = resolved.find((r) => r.alert.identifier === 'A1')!;
		expect(resA1.lifecycleState).toBe('cancelled');
		expect(resA1.mergedLanguages.map((l) => l.language)).toEqual(['fa', 'en']);

		const resA2 = resolved.find((r) => r.alert.identifier === 'A2')!;
		expect(resA2.missingExpiry).toBe(true);
		expect(resA2.clockSkewFlag).toBe(true);
		expect(resA2.lifecycleState).toBe('active');
	});

	it('carries transitive CAP references and inherits parent geometry when Update/Cancel omits areas', () => {
		const a1 = parseCapAlertXml(SAMPLE_CAP_ALERT({ id: 'A1', sent: '2026-11-27T08:00:00Z' }))!;
		const u1 = parseCapAlertXml(
			SAMPLE_CAP_ALERT({
				id: 'A2',
				msgType: 'Update',
				sent: '2026-11-27T09:00:00Z',
				refs: 'meteorologi@met.no,A1,2026-11-27T08:00:00Z',
			}).replace(/<cap:area>[\s\S]*?<\/cap:area>/, ''),
		)!;
		const u2 = parseCapAlertXml(
			SAMPLE_CAP_ALERT({
				id: 'A3',
				msgType: 'Update',
				sent: '2026-11-27T10:00:00Z',
				refs: 'meteorologi@met.no,A2,2026-11-27T09:00:00Z',
			}).replace(/<cap:area>[\s\S]*?<\/cap:area>/, ''),
		)!;

		const resolved = resolveCapLifecycle([u2, a1, u1], new Date('2026-11-27T12:00:00Z'));
		const resA3 = resolved.find((r) => r.alert.identifier === 'A3')!;
		expect(resA3.lifecycleState).toBe('active');
		expect(resA3.referencedIdentifiers).toEqual(['A2', 'A1']);
		expect(resA3.alert.infos[0].areas[0].polygons.length).toBeGreaterThan(0);

		const resA1 = resolved.find((r) => r.alert.identifier === 'A1')!;
		const resA2 = resolved.find((r) => r.alert.identifier === 'A2')!;
		expect(resA1.lifecycleState).toBe('superseded');
		expect(resA2.lifecycleState).toBe('superseded');
	});
});

describe('Geographic matching (polygons, circles, antimeridian, East Malaysia)', () => {
	it('matches points inside polygons including across the antimeridian and rejects outside', () => {
		const antimeridianRing: Array<[number, number]> = [
			[179.0, -19.0],
			[-179.0, -19.0],
			[-179.0, -17.0],
			[179.0, -17.0],
			[179.0, -19.0],
		];
		expect(pointInPolygonRing(-18.0, 179.5, antimeridianRing)).toBe(true);
		expect(pointInPolygonRing(-18.0, -179.5, antimeridianRing)).toBe(true);
		expect(pointInPolygonRing(-18.0, 170.0, antimeridianRing)).toBe(false);
	});

	it('matches circles and marks zone-only alerts uncertain', () => {
		const circleMatch = matchPointToCapAreas(59.95, 10.75, [
			{ areaDesc: 'Oslo Circle', polygons: [], circles: [{ lat: 59.91, lng: 10.75, radiusKm: 20 }], geocodes: [] },
		]);
		expect(circleMatch.matched).toBe(true);
		expect(circleMatch.method).toBe('circle');

		const zoneOnly = matchPointToCapAreas(5.98, 116.07, [
			{ areaDesc: 'Sabah West Coast', polygons: [], circles: [], geocodes: [{ valueName: 'ISO', value: 'MY-12' }] },
		]);
		expect(zoneOnly.matched).toBe(true);
		expect(zoneOnly.uncertain).toBe(true);
	});

	it('matches East Malaysia (Sabah & Sarawak) warnings without matching Peninsular-only warnings', () => {
		const sabahWarning = 'Thunderstorms over Sabah (Kota Kinabalu, Kudat) and Labuan';
		expect(matchMalaysiaWarningText(5.9804, 116.0735, sabahWarning).matched).toBe(true);
		expect(matchMalaysiaWarningText(3.139, 101.6869, sabahWarning).matched).toBe(false);
	});
});

describe('GET /api/v1/warnings route and provider lifecycle states', () => {
	it('returns private no-store warnings for MET Norway polygon & preserves LKG on truncated/500 failure', async () => {
		const kv = memoryKv();
		const metnoPayload = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: {
						type: 'Polygon',
						coordinates: [[[10.0, 59.5], [11.5, 59.5], [11.5, 60.5], [10.0, 60.5], [10.0, 59.5]]],
					},
					when: { interval: ['2026-11-27T00:00:00Z', '2099-11-28T00:00:00Z'] },
					properties: {
						id: 'NO-TEST-1',
						status: 'Actual',
						type: 'Alert',
						eventAwarenessName: 'Kuling',
						title: 'Strong Gale Oslo',
						description: 'Gale force winds.',
						instruction: 'Secure boats.',
						area: 'Oslo',
						riskMatrixColor: 'Orange',
						web: 'https://www.met.no',
					},
				},
			],
		};

		const { result: res1 } = await withFetch(
			() => new Response(JSON.stringify(metnoPayload), { status: 200, headers: { ETag: '"v1"' } }),
			() => callWorker('/api/v1/warnings?lat=59.91&lng=10.75&country=NO', { AEGIS_CACHE: kv.kv }),
		);
		expect(res1.status).toBe(200);
		expect(res1.headers.get('Cache-Control')).toBe('private, no-store');
		const body1 = (await res1.json()) as any;
		expect(body1.coverageStatus).toBe('active_warnings');
		expect(body1.warnings).toHaveLength(1);
		expect(body1.warnings[0].severity).toBe('severe');

		// Ensure user coordinates are NOT stored in any KV key
		expect(kv.puts.every((p) => !p.key.includes('59.91') && !p.key.includes('10.75'))).toBe(true);

		// Healthy empty outside polygon (Bergen)
		const resBergen = await queryOfficialWarnings({
			lat: 60.39,
			lng: 5.32,
			countryCode: 'NO',
			kv: kv.kv,
			fetchImpl: async () => new Response(JSON.stringify(metnoPayload), { status: 200 }),
		});
		expect(resBergen.coverageStatus).toBe('checked_no_warnings');
		expect(resBergen.warnings).toHaveLength(0);

		// Simulated truncated/failed poll later must retain LKG as stale, never drop active alert
		const resStale = await queryOfficialWarnings({
			lat: 59.91,
			lng: 10.75,
			countryCode: 'NO',
			kv: kv.kv,
			now: new Date(Date.now() + 10 * 60 * 1000),
			forceRefresh: true,
			fetchImpl: async () => new Response('<truncated', { status: 502 }),
		});
		expect(resStale.coverageStatus).toBe('stale');
		expect(resStale.warnings).toHaveLength(1);
	});

	it('returns unsupported_jurisdiction cleanly for unsupported country codes', async () => {
		const res = await callWorker('/api/v1/warnings?lat=35.6762&lng=139.6503&country=JP', {
			AEGIS_CACHE: memoryKv().kv,
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.coverageStatus).toBe('unsupported_jurisdiction');
	});

	it('marks partial_coverage (never checked_no_warnings) on failed detail, budget exhaustion, malformed sibling, or unresolved SACHET polygon', async () => {
		const rssWrap = (links: string[]) =>
			`<?xml version="1.0"?><rss version="2.0"><channel>${links
				.map((l, i) => `<item><title>Alert ${i}</title><link>${l}</link></item>`)
				.join('')}</channel></rss>`;

		// 1. Partial CAP feed: first CAP XML succeeds for TEH, second fails 500, third is malformed, SACHET polygon fails 503
		const kvPartial = memoryKv();
		const sachetRss = rssWrap([
			'https://sachet.ndma.gov.in/cap/a1.xml',
			'https://sachet.ndma.gov.in/cap/a2-fail.xml',
			'https://sachet.ndma.gov.in/cap/a3-bad.xml',
		]);
		const capA1WithPolyUrl = SAMPLE_CAP_ALERT({
			id: 'IN-A1',
			sent: '2026-11-27T08:00:00Z',
			polygon: '',
		})
			.replace('<cap:polygon></cap:polygon>', '')
			.replace(
				'<cap:area>',
				`<cap:parameter><cap:valueName>polygon url</cap:valueName><cap:value>https://sachet.ndma.gov.in/cap/a1-poly.xml</cap:value></cap:parameter><cap:area>`,
			);

		const partialRes = await queryOfficialWarnings({
			lat: 28.6139,
			lng: 77.209,
			countryCode: 'IN',
			kv: kvPartial.kv,
			now: new Date('2026-11-27T12:00:00Z'),
			fetchImpl: async (url) => {
				if (url.includes('rss_india.xml')) return new Response(sachetRss, { status: 200 });
				if (url.endsWith('a1.xml')) return new Response(capA1WithPolyUrl, { status: 200 });
				if (url.endsWith('a2-fail.xml')) return new Response('err', { status: 500 });
				if (url.endsWith('a3-bad.xml')) return new Response('<!DOCTYPE evil><bad', { status: 200 });
				if (url.endsWith('a1-poly.xml')) return new Response('err', { status: 503 });
				return new Response('', { status: 404 });
			},
		});
		expect(partialRes.coverageStatus).toBe('partial_coverage');
		expect(partialRes.sources[0].status).toBe('partial');

		// 2. Budget exhaustion (> 15 RSS items)
		const kvBudget = memoryKv();
		const manyLinks = Array.from({ length: 18 }, (_, i) => `https://sachet.ndma.gov.in/cap/item-${i}.xml`);
		const budgetRes = await queryOfficialWarnings({
			lat: 28.6139,
			lng: 77.209,
			countryCode: 'IN',
			kv: kvBudget.kv,
			now: new Date('2026-11-27T12:00:00Z'),
			fetchImpl: async (url) => {
				if (url.includes('rss_india.xml')) return new Response(rssWrap(manyLinks), { status: 200 });
				return new Response(
					SAMPLE_CAP_ALERT({ id: `M-${url}`, polygon: '28.0,77.0 28.0,78.0 29.0,78.0 29.0,77.0 28.0,77.0' }),
					{ status: 200 },
				);
			},
		});
		expect(budgetRes.coverageStatus).toBe('partial_coverage');
		expect(budgetRes.sources[0].errorReason).toContain('rss_feed_truncated');
	});
});
