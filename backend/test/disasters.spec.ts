import { describe, it, expect } from 'vitest';
import {
	DisasterUpstreamError,
	EONET_QUERIES,
	EONET_WILDFIRE_DAYS,
	extractEonetCoordinates,
	fetchDisasters,
	formatDisasterSourcesHeader,
	normalizeEonetEvents,
	normalizeUsgsFeatures,
	polygonRepresentativePoint,
	USGS_URL,
} from '../src/disasters';

const quake = (overrides: Record<string, unknown> = {}, props: Record<string, unknown> = {}, coords: unknown = [-122.75, 38.77, 2.5]) => ({
	id: 'nc75000001',
	properties: { mag: 3.1, place: '1km NW of The Geysers, CA', time: 1728500000000, ...props },
	geometry: { type: 'Point', coordinates: coords },
	...overrides,
});

const fireEvent = (geometry: unknown[], overrides: Record<string, unknown> = {}) => ({
	id: 'EONET_1',
	title: 'Test Fire',
	categories: [{ id: 'wildfires' }],
	geometry,
	...overrides,
});

describe('Polygon representative point (bounding-box center)', () => {
	it('uses the bounding-box center, unaffected by the duplicated closing vertex', () => {
		const ring = [
			[-120, 38],
			[-118, 38],
			[-118, 40],
			[-120, 40],
			[-120, 38],
		];
		expect(polygonRepresentativePoint(ring)).toEqual({ lng: -119, lat: 39 });
		expect(polygonRepresentativePoint(ring.slice(0, 4))).toEqual({ lng: -119, lat: 39 });
	});

	it('measures rings across the antimeridian instead of averaging to the far side', () => {
		const ring = [
			[179, -17],
			[-179, -17],
			[-179, -15],
			[179, -15],
			[179, -17],
		];
		const p = polygonRepresentativePoint(ring);
		expect(Math.abs(p!.lng)).toBeCloseTo(180, 6);
		expect(p!.lat).toBe(-16);
	});

	it('rejects rings with any invalid vertex or fewer than three distinct vertices', () => {
		expect(polygonRepresentativePoint([[-120, 38], [null, 38], [-118, 40], [-120, 38]])).toBeNull();
		expect(polygonRepresentativePoint([[-120, 38], [-118, 38], [-120, 38]])).toBeNull();
		expect(polygonRepresentativePoint('nope')).toBeNull();
	});
});

describe('EONET normalization', () => {
	it('extracts Point coordinates strictly and preserves valid zero', () => {
		expect(extractEonetCoordinates({ type: 'Point', coordinates: [0, 0] })).toEqual({ lng: 0, lat: 0 });
		expect(extractEonetCoordinates({ type: 'Point', coordinates: [null, null] })).toBeNull();
		expect(extractEonetCoordinates({ type: 'Point', coordinates: ['10', '20'] })).toBeNull();
		expect(extractEonetCoordinates({ type: 'Point', coordinates: [200, 45] })).toBeNull();
		expect(extractEonetCoordinates({ coordinates: [10, 20] })).toBeNull();
	});

	it('classifies multi-category events by any matching category', () => {
		const { records } = normalizeEonetEvents([
			fireEvent([{ date: '2026-10-01T12:00:00Z', type: 'Point', coordinates: [-115, 40] }], {
				categories: [{ id: 'severeStorms' }, { id: 'wildfires' }],
			}),
		]);
		expect(records).toHaveLength(1);
		expect(records[0].type).toBe('fire');
	});

	it('uses the latest geometry with a valid date and coordinates', () => {
		const { records, rejected } = normalizeEonetEvents([
			fireEvent([
				{ date: '2026-08-01T00:00:00Z', type: 'Point', coordinates: [-110, 35] },
				{ date: '2026-10-05T12:00:00Z', type: 'Point', coordinates: [-110.5, 35.5] },
				{ date: 'not-a-date', type: 'Point', coordinates: [-111, 36] },
				{ date: '2026-10-09T00:00:00Z', type: 'Point', coordinates: [null, 36] },
			]),
		]);
		expect(rejected).toBe(0);
		expect(records[0]).toMatchObject({ date: '2026-10-05T12:00:00.000Z', lng: -110.5, lat: 35.5 });
	});

	it('rejects events with no valid geometry instead of inventing time or (0,0)', () => {
		const { records, rejected } = normalizeEonetEvents([
			fireEvent([{ date: '', type: 'Point', coordinates: [-110, 35] }], { id: 'no-date' }),
			fireEvent([{ date: '2026-10-05T12:00:00Z', type: 'Point', coordinates: [] }], { id: 'no-coords' }),
			fireEvent([], { id: 'empty' }),
			{ title: 'no id', categories: [{ id: 'wildfires' }], geometry: [] },
		]);
		expect(records).toEqual([]);
		expect(rejected).toBe(4);
	});

	it('normalizes polygon geometry to its bounding-box center', () => {
		const { records } = normalizeEonetEvents([
			fireEvent([
				{
					date: '2026-10-05T12:00:00Z',
					type: 'Polygon',
					coordinates: [[[-120, 38], [-118, 38], [-118, 40], [-120, 40], [-120, 38]]],
				},
			]),
		]);
		expect(records[0]).toMatchObject({ lng: -119, lat: 39 });
	});
});

describe('USGS normalization', () => {
	it('preserves zero magnitude and zero coordinates', () => {
		const { records } = normalizeUsgsFeatures([quake({}, { mag: 0 }, [0, 0, 10])]);
		expect(records[0]).toMatchObject({ magnitude: 0, severity: 'low', lng: 0, lat: 0, date: '2024-10-09T18:53:20.000Z' });
	});

	it('reports null magnitude as unknown', () => {
		const { records } = normalizeUsgsFeatures([quake({}, { mag: null })]);
		expect(records[0].magnitude).toBeUndefined();
		expect(records[0].severity).toBe('low');
	});

	it('rejects unknown time and null/missing coordinates rather than substituting now or (0,0)', () => {
		const { records, rejected } = normalizeUsgsFeatures([
			quake({ id: 'no-time' }, { time: null }),
			quake({ id: 'null-coords' }, {}, [null, null, 5]),
			quake({ id: 'string-coords' }, {}, ['-122', '38']),
			quake({ id: 'bad-mag' }, { mag: 'big' }),
			quake({ id: '' }),
		]);
		expect(records).toEqual([]);
		expect(rejected).toBe(5);
	});

	it('rejects finite times outside the representable date range instead of throwing', () => {
		const { records, rejected } = normalizeUsgsFeatures([
			quake({ id: 'huge' }, { time: 1e20 }),
			quake({ id: 'huge-neg' }, { time: -8.65e15 }),
			quake({ id: 'string-time' }, { time: '1728500000000' }),
			quake({ id: 'ok' }),
		]);
		expect(records.map((r) => r.id)).toEqual(['ok']);
		expect(rejected).toBe(3);
	});

	it('maps severity thresholds', () => {
		const { records } = normalizeUsgsFeatures([
			quake({ id: 'q1' }, { mag: 6.2 }),
			quake({ id: 'q2' }, { mag: 4.8 }),
			quake({ id: 'q3' }, { mag: 3.1 }),
		]);
		expect(records.map((r) => r.severity)).toEqual(['high', 'medium', 'low']);
	});
});

/** Captured 2026-10-10 from EONET status=open&category=volcanoes (still open; single geometry dated 2026-06-15). */
const CAPTURED_VOLCANO = {
	id: 'EONET_20710',
	title: 'Nevados del Chillan Volcano, Chile',
	description: null,
	link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_20710',
	closed: null,
	categories: [{ id: 'volcanoes', title: 'Volcanoes' }],
	sources: [{ id: 'SIVolcano', url: 'https://volcano.si.edu/volcano.cfm?vn=357070' }],
	geometry: [{ magnitudeValue: null, magnitudeUnit: null, date: '2026-06-15T00:00:00Z', type: 'Point', coordinates: [-71.378, -36.868] }],
};

const FIRE_QUERY = EONET_QUERIES.find((q) => q.category === 'wildfires')!.url;
const VOLCANO_QUERY = EONET_QUERIES.find((q) => q.category === 'volcanoes')!.url;

describe('EONET query scope', () => {
	it('bounds wildfires by recent days but requests every open volcano', () => {
		expect(FIRE_QUERY).toContain('category=wildfires');
		expect(FIRE_QUERY).toContain(`days=${EONET_WILDFIRE_DAYS}`);
		expect(VOLCANO_QUERY).toContain('status=open');
		expect(VOLCANO_QUERY).toContain('category=volcanoes');
		expect(VOLCANO_QUERY).not.toContain('days=');
	});

	it('normalizes a real captured open volcano older than the wildfire window', () => {
		const { records, rejected } = normalizeEonetEvents([CAPTURED_VOLCANO]);
		expect(rejected).toBe(0);
		expect(records).toEqual([
			{
				id: 'EONET_20710',
				type: 'volcano',
				title: 'Nevados del Chillan Volcano, Chile',
				lng: -71.378,
				lat: -36.868,
				date: '2026-06-15T00:00:00.000Z',
				severity: 'medium',
			},
		]);
	});
});

describe('fetchDisasters source status', () => {
	const eonetOk = { events: [fireEvent([{ date: '2026-10-05T12:00:00Z', type: 'Point', coordinates: [-110, 35] }])] };
	const volcanoesOk = { events: [CAPTURED_VOLCANO] };
	const usgsOk = { type: 'FeatureCollection', features: [quake()] };
	const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
	const fetcher =
		(eonet: () => Response, usgs: () => Response, volcanoes: () => Response = () => json({ events: [] })) =>
		async (url: string) => {
			if (url === FIRE_QUERY) return eonet();
			if (url === VOLCANO_QUERY) return volcanoes();
			if (url === USGS_URL) return usgs();
			throw new Error(`unexpected ${url}`);
		};

	it('merges both EONET scopes into one source with volcanoes kept', async () => {
		const result = await fetchDisasters(fetcher(() => json(eonetOk), () => json(usgsOk), () => json(volcanoesOk)));
		expect(result.sources.eonet).toEqual({ status: 'ok', count: 2, rejected: 0 });
		expect(result.disasters.filter((d) => d.type === 'volcano').map((d) => d.id)).toEqual(['EONET_20710']);
		expect(result.partial).toBe(false);
	});

	it('marks EONET failed but keeps wildfire records when only the volcano query fails', async () => {
		const result = await fetchDisasters(fetcher(() => json(eonetOk), () => json(usgsOk), () => json({}, 503)));
		expect(result.sources.eonet.status).toBe('failed');
		expect(result.partial).toBe(true);
		expect(result.disasters.map((d) => d.id).sort()).toEqual(['EONET_1', 'nc75000001']);
	});

	it('reports both sources ok', async () => {
		const result = await fetchDisasters(fetcher(() => json(eonetOk), () => json(usgsOk)));
		expect(result.partial).toBe(false);
		expect(result.sources).toEqual({
			eonet: { status: 'ok', count: 1, rejected: 0 },
			usgs: { status: 'ok', count: 1, rejected: 0 },
		});
		expect(formatDisasterSourcesHeader(result.sources)).toBe('eonet=ok;usgs=ok');
	});

	it('treats a schema-invalid provider payload as malformed, not as an empty dataset', async () => {
		const result = await fetchDisasters(fetcher(() => json(eonetOk), () => json({ type: 'FeatureCollection' })));
		expect(result.partial).toBe(true);
		expect(result.sources.usgs.status).toBe('malformed');
		expect(result.disasters.map((d) => d.id)).toEqual(['EONET_1']);

		const nonJson = await fetchDisasters(fetcher(() => new Response('<html>busy</html>'), () => json(usgsOk)));
		expect(nonJson.sources.eonet.status).toBe('malformed');
	});

	it('treats a payload whose records are all invalid as malformed, and keeps valid empty payloads ok', async () => {
		const allBad = { type: 'FeatureCollection', features: [quake({}, { time: null }), quake({ id: 'x' }, {}, [null, null])] };
		const bad = await fetchDisasters(fetcher(() => json(eonetOk), () => json(allBad)));
		expect(bad.sources.usgs).toEqual({ status: 'malformed', count: 0, rejected: 2 });
		expect(bad.partial).toBe(true);

		const empty = await fetchDisasters(fetcher(() => json({ events: [] }), () => json({ type: 'FeatureCollection', features: [] })));
		expect(empty.sources).toEqual({
			eonet: { status: 'ok', count: 0, rejected: 0 },
			usgs: { status: 'ok', count: 0, rejected: 0 },
		});
		expect(empty.partial).toBe(false);
	});

	it('reports an HTTP failure on one source as partial', async () => {
		const result = await fetchDisasters(fetcher(() => json({}, 500), () => json(usgsOk)));
		expect(result.sources.eonet.status).toBe('failed');
		expect(result.partial).toBe(true);
	});

	it('throws with source status when both sources fail', async () => {
		await expect(fetchDisasters(fetcher(() => json({}, 503), () => json({ features: 'x' })))).rejects.toBeInstanceOf(
			DisasterUpstreamError,
		);
	});
});
