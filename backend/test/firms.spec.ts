import { afterEach, describe, it, expect, vi } from 'vitest';
import {
	buildFirmsBboxes,
	buildFirmsCacheKey,
	computeHotspotStats,
	deduplicateHotspots,
	fetch7DayFirmsHotspots,
	FireHotspot,
	parseCoordinateQuery,
	parseFirmsCsv,
	parseStrictNumber,
	planFirmsWindows,
	validateCoordinates,
} from '../src/firms';
import { csvResponse, FIRMS_HEADER } from './helpers';

const NOW = new Date('2026-10-10T12:00:00Z');
const MAP_KEY = 'secret-map-key-123';

const ROW_A = '45.22203,38.39170,353.44,0.39,0.36,2026-10-06,1026,N,VIIRS,h,2.0NRT,293.15,10.81,D';
const ROW_B = '45.26015,37.81487,337.45,0.39,0.36,2026-10-05,1026,N,VIIRS,n,2.0NRT,294.51,3.40,N';
const ROW_PRIOR = '45.30000,38.00000,330.00,0.40,0.37,2026-10-04,0215,N,VIIRS,l,2.0NRT,290.00,1.20,N';
const ROW_VALID = '45.0,38.0,320,0.4,0.4,2026-10-06,1026,N,VIIRS,h,2.0NRT,290,5.0,D';

function mustParse(csv: string) {
	const parsed = parseFirmsCsv(csv);
	if (!parsed.ok) throw new Error(`expected ok parse, got: ${parsed.reason}`);
	return parsed;
}

function hotspot(overrides: Partial<FireHotspot> = {}): FireHotspot {
	return {
		latitude: 45.22,
		longitude: 38.39,
		bright_ti4: 350,
		bright_ti5: 290,
		scan: 0.4,
		track: 0.4,
		acq_date: '2026-10-06',
		acq_time: '1026',
		satellite: 'N',
		confidence: 'h',
		version: '2.0NRT',
		frp: 10,
		daynight: 'D',
		...overrides,
	};
}

const hotspotKey = (h: FireHotspot) => `${h.latitude}|${h.longitude}|${h.acq_date}|${h.acq_time}|${h.satellite}`;

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Strict numeric and coordinate query parsing', () => {
	it('rejects numeric prefixes, hex, empty, and non-finite strings', () => {
		expect(parseStrictNumber('45garbage')).toBeNull();
		expect(parseStrictNumber('0x10')).toBeNull();
		expect(parseStrictNumber('')).toBeNull();
		expect(parseStrictNumber('Infinity')).toBeNull();
		expect(parseStrictNumber('1e400')).toBeNull();
		expect(parseStrictNumber('-12.5')).toBe(-12.5);
		expect(parseStrictNumber('0')).toBe(0);
	});

	it('parses lat/lng query strings strictly', () => {
		expect(parseCoordinateQuery('45garbage', '10')).toMatchObject({ ok: false });
		expect(parseCoordinateQuery('45', '10abc')).toMatchObject({ ok: false });
		expect(parseCoordinateQuery(undefined, '10')).toMatchObject({ ok: false });
		expect(parseCoordinateQuery('95', '10')).toMatchObject({ ok: false });
		expect(parseCoordinateQuery('0', '0')).toEqual({ ok: true, lat: 0, lng: 0 });
	});

	it('validates geographic ranges', () => {
		expect(validateCoordinates(90, 180).valid).toBe(true);
		expect(validateCoordinates(90.1, 0).valid).toBe(false);
		expect(validateCoordinates(0, -180.1).valid).toBe(false);
		expect(validateCoordinates(Number.NaN, 0).valid).toBe(false);
	});
});

describe('FIRMS bounding boxes and windows', () => {
	it('orders a normal box as west,south,east,north', () => {
		expect(buildFirmsBboxes(45, 30, 0.5)).toEqual(['29.5000,44.5000,30.5000,45.5000']);
	});

	it('splits boxes crossing the antimeridian instead of clipping them', () => {
		expect(buildFirmsBboxes(10, 179.8, 0.5)).toEqual([
			'179.3000,9.5000,180.0000,10.5000',
			'-180.0000,9.5000,-179.7000,10.5000',
		]);
		expect(buildFirmsBboxes(10, -179.8, 0.5)).toEqual([
			'179.7000,9.5000,180.0000,10.5000',
			'-180.0000,9.5000,-179.3000,10.5000',
		]);
	});

	it('clamps latitude at the poles', () => {
		expect(buildFirmsBboxes(89.8, 10, 0.5)).toEqual(['9.5000,89.3000,10.5000,90.0000']);
	});

	it('plans two supported windows that tile exactly seven UTC days', () => {
		const [recent, prior] = planFirmsWindows(NOW);
		expect(recent).toEqual({ id: 'recent', startDate: '2026-10-06', endDate: '2026-10-10', dayRange: 5 });
		expect(prior).toEqual({ id: 'prior', startDate: '2026-10-04', endDate: '2026-10-05', dayRange: 2 });
	});

	it('binds the cache key to the exact queried boxes and window', () => {
		const a = buildFirmsCacheKey(buildFirmsBboxes(45.72, 37.95), '2026-10-04', '2026-10-10');
		const b = buildFirmsCacheKey(buildFirmsBboxes(45.724, 37.95), '2026-10-04', '2026-10-10');
		const c = buildFirmsCacheKey(buildFirmsBboxes(45.72, 37.95), '2026-10-05', '2026-10-11');
		expect(a).toMatch(/^firms:v4:VIIRS_SNPP_NRT:/);
		expect(a).not.toBe(b);
		expect(a).not.toBe(c);
	});
});

describe('FIRMS CSV parsing', () => {
	it('maps rows by header name, including an extra instrument column', () => {
		const parsed = mustParse([FIRMS_HEADER, ROW_A, ROW_B].join('\r\n'));
		expect(parsed.rejectedRows).toBe(0);
		expect(parsed.hotspots).toHaveLength(2);
		expect(parsed.hotspots[0]).toEqual({
			latitude: 45.22203,
			longitude: 38.3917,
			bright_ti4: 353.44,
			bright_ti5: 293.15,
			scan: 0.39,
			track: 0.36,
			acq_date: '2026-10-06',
			acq_time: '1026',
			satellite: 'N',
			confidence: 'h',
			version: '2.0NRT',
			frp: 10.81,
			daynight: 'D',
		});
		expect(parsed.hotspots[1].daynight).toBe('N');
	});

	it('accepts a valid header-only response as an empty dataset', () => {
		expect(parseFirmsCsv(`${FIRMS_HEADER}\n`)).toEqual({ ok: true, hotspots: [], rejectedRows: 0 });
	});

	it('rejects empty bodies, HTML, provider error text, and missing required columns', () => {
		expect(parseFirmsCsv('').ok).toBe(false);
		expect(parseFirmsCsv('<!DOCTYPE html><html><body>Service Unavailable</body></html>').ok).toBe(false);
		expect(parseFirmsCsv('Invalid MAP_KEY.').ok).toBe(false);
		expect(parseFirmsCsv('latitude,longitude,bright_ti4,confidence,frp\n45,38,300,n,1').ok).toBe(false);
	});

	it('rejects invalid coordinates, partial numerics, and invalid identities', () => {
		const rows = [
			'NaN,38.0,300,0.4,0.4,2026-10-06,1026,N,VIIRS,n,2.0NRT,290,1.0,D',
			'95.0,38.0,300,0.4,0.4,2026-10-06,1026,N,VIIRS,n,2.0NRT,290,1.0,D',
			'45garbage,38.0,300,0.4,0.4,2026-10-06,1026,N,VIIRS,n,2.0NRT,290,1.0,D',
			'45.0,38.0,300,0.4,0.4,2026-13-06,1026,N,VIIRS,n,2.0NRT,290,1.0,D',
			'45.0,38.0,300,0.4,0.4,2026-10-06,2460,N,VIIRS,n,2.0NRT,290,1.0,D',
			'45.0,38.0,300,0.4,0.4,2026-10-06,1026,,VIIRS,n,2.0NRT,290,1.0,D',
			'45.0,38.0,300,0.4,0.4,2026-10-06,1026,N,VIIRS,n,2.0NRT,290,1.0',
			'45.0,38.0,320,0.4,0.4,2026-10-06,1026,N,VIIRS,h,2.0NRT,290,5.0,D',
		];
		const parsed = mustParse([FIRMS_HEADER, ...rows].join('\n'));
		expect(parsed.rejectedRows).toBe(7);
		expect(parsed.hotspots).toHaveLength(1);
		expect(parsed.hotspots[0]).toMatchObject({ latitude: 45, longitude: 38, frp: 5 });
	});

	it('rejects invalid measurements instead of turning them into zero', () => {
		const rows = [
			'45.0,38.0,abc,0.4,0.4,2026-10-06,1026,N,VIIRS,n,2.0NRT,290,1.0,D',
			'45.0,38.0,300,0.4,0.4,2026-10-06,1026,N,VIIRS,n,2.0NRT,290,-3,D',
			'45.0,38.0,300,0.4,0.4,2026-10-06,1026,N,VIIRS,x,2.0NRT,290,1.0,D',
			'45.0,38.0,300,0.4,0.4,2026-10-06,1026,N,VIIRS,n,2.0NRT,290,1.0,X',
		];
		const parsed = mustParse([FIRMS_HEADER, ...rows, ROW_VALID].join('\n'));
		expect(parsed.rejectedRows).toBe(4);
		expect(parsed.hotspots).toHaveLength(1);
		expect(parsed.hotspots[0]).toMatchObject({ bright_ti4: 320, frp: 5, confidence: 'h', daynight: 'D' });
	});

	it('treats a body whose data rows are all invalid as malformed, not empty', () => {
		const parsed = parseFirmsCsv([FIRMS_HEADER, '45garbage,38,300,0.4,0.4,2026-10-06,1026,N,VIIRS,n,2.0NRT,290,1.0,D'].join('\n'));
		expect(parsed).toEqual({ ok: false, reason: 'all 1 data rows invalid' });
	});

	it('rejects rows outside the requested window dates or bbox', () => {
		const expectation = { startDate: '2026-10-06', endDate: '2026-10-10', bbox: '37.4500,44.5000,38.4500,45.5000' };
		const rows = [
			ROW_VALID,
			'45.0,38.0,320,0.4,0.4,2026-10-05,1026,N,VIIRS,h,2.0NRT,290,5.0,D',
			'45.0,38.0,320,0.4,0.4,2026-10-11,1026,N,VIIRS,h,2.0NRT,290,5.0,D',
			'45.0,39.0,320,0.4,0.4,2026-10-06,1026,N,VIIRS,h,2.0NRT,290,5.0,D',
			'46.0,38.0,320,0.4,0.4,2026-10-06,1026,N,VIIRS,h,2.0NRT,290,5.0,D',
		];
		const parsed = parseFirmsCsv([FIRMS_HEADER, ...rows].join('\n'), expectation);
		expect(parsed).toMatchObject({ ok: true, rejectedRows: 4 });
		if (parsed.ok) expect(parsed.hotspots.map((h) => `${h.latitude},${h.longitude},${h.acq_date}`)).toEqual(['45,38,2026-10-06']);
	});

	it('keeps missing optional values null — no nominal/daytime/zero defaults', () => {
		const parsed = mustParse([FIRMS_HEADER, '45.0,38.0,,,,2026-10-06,26,N,VIIRS,,,,,'].join('\n'));
		expect(parsed.rejectedRows).toBe(0);
		expect(parsed.hotspots[0]).toMatchObject({
			bright_ti4: null,
			bright_ti5: null,
			scan: null,
			track: null,
			frp: null,
			confidence: null,
			daynight: null,
			version: null,
			acq_time: '0026',
		});
	});
});

describe('FIRMS deduplication and statistics', () => {
	it('deduplicates by observation identity only', () => {
		const h1 = hotspot();
		const deduped = deduplicateHotspots([h1, { ...h1 }, hotspot({ acq_time: '1200' }), hotspot({ satellite: '1' })]);
		expect(deduped).toHaveLength(3);
	});

	it('reports null maxima when no measurement is reported', () => {
		const stats = computeHotspotStats([hotspot({ bright_ti4: null, frp: null, confidence: null })]);
		expect(stats).toEqual({
			totalCount: 1,
			highConfidence: 0,
			nominalConfidence: 0,
			lowConfidence: 0,
			unknownConfidence: 1,
			maxBrightness: null,
			maxPower: null,
		});
		expect(computeHotspotStats([]).maxBrightness).toBeNull();
	});

	it('counts each confidence class and finds maxima over reported values', () => {
		const stats = computeHotspotStats([
			hotspot({ confidence: 'h', bright_ti4: 340.5, frp: 12.5 }),
			hotspot({ confidence: 'n', bright_ti4: 365.2, frp: null }),
			hotspot({ confidence: 'l', bright_ti4: null, frp: 25.8 }),
		]);
		expect(stats).toMatchObject({
			totalCount: 3,
			highConfidence: 1,
			nominalConfidence: 1,
			lowConfidence: 1,
			unknownConfidence: 0,
			maxBrightness: 365.2,
			maxPower: 25.8,
		});
	});
});

describe('fetch7DayFirmsHotspots window outcomes', () => {
	const run = (handler: (url: string) => Response | Promise<Response>, lat = 45.72, lng = 37.95) => {
		const calls: string[] = [];
		const fetchImpl = async (url: string) => {
			calls.push(url);
			return handler(url);
		};
		return fetch7DayFirmsHotspots(lat, lng, MAP_KEY, { now: NOW, fetchImpl }).then((result) => ({ result, calls }));
	};

	it('requests both windows with explicit start dates and combines observations', async () => {
		const { result, calls } = await run((url) =>
			url.includes('/5/2026-10-06')
				? csvResponse([FIRMS_HEADER, ROW_A, ROW_A].join('\n'))
				: csvResponse([FIRMS_HEADER, ROW_PRIOR, ROW_B].join('\n')),
		);
		expect(calls).toHaveLength(2);
		expect(calls.some((u) => u.endsWith('/VIIRS_SNPP_NRT/37.4500,45.2200,38.4500,46.2200/5/2026-10-06'))).toBe(true);
		expect(calls.some((u) => u.endsWith('/VIIRS_SNPP_NRT/37.4500,45.2200,38.4500,46.2200/2/2026-10-04'))).toBe(true);
		expect(result.coverage).toMatchObject({
			status: 'complete',
			requestedStart: '2026-10-04',
			requestedEnd: '2026-10-10',
			missingDates: [],
		});
		expect(result.hotspots.map((h) => `${h.acq_date} ${h.acq_time} ${h.confidence}`).sort()).toEqual([
			'2026-10-04 0215 l',
			'2026-10-05 1026 n',
			'2026-10-06 1026 h',
		]);
		expect(result.totalCount).toBe(3);
		expect(result.lowConfidence).toBe(1);
	});

	it('treats valid header-only responses as complete, legitimately empty coverage', async () => {
		const { result } = await run(() => csvResponse(`${FIRMS_HEADER}\n`));
		expect(result.coverage.status).toBe('complete');
		expect(result.totalCount).toBe(0);
		expect(result.maxBrightness).toBeNull();
	});

	it('labels one failed window as partial coverage with its missing dates', async () => {
		const { result } = await run((url) =>
			url.includes('/2/2026-10-04') ? new Response('upstream error', { status: 500 }) : csvResponse([FIRMS_HEADER, ROW_A].join('\n')),
		);
		expect(result.coverage.status).toBe('partial');
		expect(result.coverage.missingDates).toEqual(['2026-10-04', '2026-10-05']);
		const prior = result.coverage.windows.find((w) => w.id === 'prior');
		expect(prior).toMatchObject({ status: 'http_error', httpStatus: 500, detections: 0 });
		expect(result.totalCount).toBe(1);
	});

	it('reports unavailable when both windows fail (timeout and network error)', async () => {
		const { result } = await run((url) => {
			if (url.includes('/5/')) throw new DOMException('The operation timed out.', 'TimeoutError');
			throw new TypeError('Network connection lost');
		});
		expect(result.coverage.status).toBe('unavailable');
		expect(result.coverage.windows.map((w) => w.status).sort()).toEqual(['network_error', 'timeout']);
		expect(result.hotspots).toEqual([]);
	});

	it('treats a 200 HTML or plain-text error body as malformed, not empty', async () => {
		const { result } = await run(() => new Response('Invalid MAP_KEY.', { status: 200 }));
		expect(result.coverage.status).toBe('unavailable');
		expect(result.coverage.windows.every((w) => w.status === 'malformed')).toBe(true);
	});

	it('fails a window whose rows all fall outside its requested dates', async () => {
		const { result } = await run(() => csvResponse([FIRMS_HEADER, ROW_A].join('\n')));
		expect(result.coverage.status).toBe('partial');
		expect(result.coverage.windows.find((w) => w.id === 'prior')?.status).toBe('malformed');
		expect(result.hotspots.map(hotspotKey)).toEqual(['45.22203|38.3917|2026-10-06|1026|N']);
	});

	it('queries both halves of an antimeridian box and fails the window if either half fails', async () => {
		const { result, calls } = await run(
			(url) => (url.includes('/-180.0000,') && url.includes('/2/') ? new Response('', { status: 503 }) : csvResponse(`${FIRMS_HEADER}\n`)),
			10,
			179.8,
		);
		expect(calls).toHaveLength(4);
		expect(result.bboxes).toHaveLength(2);
		expect(result.coverage.status).toBe('partial');
		expect(result.coverage.windows.find((w) => w.id === 'prior')?.status).toBe('http_error');
	});

	it('keeps the MAP_KEY out of logs, including exception messages that echo the URL', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await run((url) => {
			throw new TypeError(`fetch failed for ${url}`);
		});
		const logged = warn.mock.calls.flat().map(String).join('\n');
		expect(logged.length).toBeGreaterThan(0);
		expect(logged).not.toContain(MAP_KEY);
		expect(logged).toContain('[REDACTED]');
	});
});
