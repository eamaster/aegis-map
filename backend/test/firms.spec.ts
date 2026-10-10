import { describe, it, expect } from 'vitest';
import {
	buildFirmsBbox,
	computeHotspotStats,
	deduplicateHotspots,
	parseFirmsCsv,
	validateCoordinates,
	FireHotspot,
} from '../src/firms';

describe('FIRMS Coordinate Validation', () => {
	it('accepts valid coordinates within global bounds', () => {
		expect(validateCoordinates(45.72, 37.95).valid).toBe(true);
		expect(validateCoordinates(0, 0).valid).toBe(true);
		expect(validateCoordinates(-90, -180).valid).toBe(true);
		expect(validateCoordinates(90, 180).valid).toBe(true);
	});

	it('rejects non-finite coordinate values', () => {
		expect(validateCoordinates(Number.NaN, 0).valid).toBe(false);
		expect(validateCoordinates(0, Number.POSITIVE_INFINITY).valid).toBe(false);
	});

	it('rejects out of range latitude and longitude', () => {
		expect(validateCoordinates(90.1, 0).valid).toBe(false);
		expect(validateCoordinates(-90.1, 0).valid).toBe(false);
		expect(validateCoordinates(0, 180.1).valid).toBe(false);
		expect(validateCoordinates(0, -180.1).valid).toBe(false);
	});
});

describe('FIRMS Bounding Box Construction', () => {
	it('orders bbox as west,south,east,north', () => {
		const bbox = buildFirmsBbox(45.0, 30.0, 0.5);
		const parts = bbox.split(',').map(Number);
		expect(parts).toHaveLength(4);
		const [west, south, east, north] = parts;
		expect(west).toBeCloseTo(29.5, 3);
		expect(south).toBeCloseTo(44.5, 3);
		expect(east).toBeCloseTo(30.5, 3);
		expect(north).toBeCloseTo(45.5, 3);
	});

	it('clamps at poles and bounds at antimeridian', () => {
		const bboxNorthPole = buildFirmsBbox(89.8, 10.0, 0.5);
		const [w, s, e, n] = bboxNorthPole.split(',').map(Number);
		expect(n).toBe(90.0);
		expect(s).toBeCloseTo(89.3, 3);

		const bboxSouthPole = buildFirmsBbox(-89.9, 10.0, 0.5);
		const [sw, ss, se, sn] = bboxSouthPole.split(',').map(Number);
		expect(ss).toBe(-90.0);
	});
});

describe('FIRMS Header-Based CSV Parsing', () => {
	const sampleCsvWithInstrument = [
		'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
		'45.22203,38.39170,353.44,0.39,0.36,2026-10-06,1026,N,VIIRS,h,2.0NRT,293.15,10.81,D',
		'45.26015,37.81487,337.45,0.39,0.36,2026-10-06,1026,N,VIIRS,n,2.0NRT,294.51,3.40,D',
	].join('\r\n');

	it('parses CSV rows mapped by header names (not column index offsets)', () => {
		const hotspots = parseFirmsCsv(sampleCsvWithInstrument);
		expect(hotspots).toHaveLength(2);

		const first = hotspots[0];
		expect(first.latitude).toBeCloseTo(45.22203, 5);
		expect(first.longitude).toBeCloseTo(38.3917, 5);
		expect(first.bright_ti4).toBeCloseTo(353.44, 2);
		expect(first.confidence).toBe('h'); // Correctly parsed confidence, not 'VIIRS'!
		expect(first.version).toBe('2.0NRT');
		expect(first.bright_ti5).toBeCloseTo(293.15, 2);
		expect(first.frp).toBeCloseTo(10.81, 2);
		expect(first.daynight).toBe('D');
	});

	it('returns empty array for empty or header-only CSV', () => {
		expect(parseFirmsCsv('')).toEqual([]);
		expect(parseFirmsCsv('   \n\n ')).toEqual([]);
		expect(
			parseFirmsCsv('latitude,longitude,bright_ti4,confidence,frp\n'),
		).toEqual([]);
	});

	it('skips rows with non-finite coordinates', () => {
		const invalidCsv = [
			'latitude,longitude,bright_ti4,confidence,frp',
			'NaN,38.0,300,n,1.0',
			'45.0,invalid,300,n,1.0',
			'45.0,38.0,320,h,5.0',
		].join('\n');
		const result = parseFirmsCsv(invalidCsv);
		expect(result).toHaveLength(1);
		expect(result[0].latitude).toBe(45.0);
	});
});

describe('FIRMS Observation Deduplication', () => {
	it('deduplicates identical observations by coordinates, date, time, and satellite', () => {
		const h1: FireHotspot = {
			latitude: 45.22,
			longitude: 38.39,
			bright_ti4: 350,
			scan: 0.4,
			track: 0.4,
			acq_date: '2026-10-06',
			acq_time: '1026',
			satellite: 'N',
			confidence: 'h',
			version: '2.0NRT',
			bright_ti5: 290,
			frp: 10,
			daynight: 'D',
		};
		const h2: FireHotspot = { ...h1 }; // duplicate
		const h3: FireHotspot = { ...h1, acq_time: '1200' }; // different time

		const deduped = deduplicateHotspots([h1, h2, h3]);
		expect(deduped).toHaveLength(2);
	});
});

describe('FIRMS Statistics Computation', () => {
	it('returns zero values (never NaN or -Infinity) for empty hotspot list', () => {
		const stats = computeHotspotStats([]);
		expect(stats.totalCount).toBe(0);
		expect(stats.highConfidence).toBe(0);
		expect(stats.maxBrightness).toBe(0);
		expect(stats.maxPower).toBe(0);
	});

	it('computes correct max brightness, max power, and high confidence count', () => {
		const hotspots: FireHotspot[] = [
			{
				latitude: 45.1,
				longitude: 38.1,
				bright_ti4: 340.5,
				scan: 0.4,
				track: 0.4,
				acq_date: '2026-10-06',
				acq_time: '1026',
				satellite: 'N',
				confidence: 'h',
				version: '2.0NRT',
				bright_ti5: 290,
				frp: 12.5,
				daynight: 'D',
			},
			{
				latitude: 45.2,
				longitude: 38.2,
				bright_ti4: 365.2,
				scan: 0.4,
				track: 0.4,
				acq_date: '2026-10-06',
				acq_time: '1026',
				satellite: 'N',
				confidence: 'n',
				version: '2.0NRT',
				bright_ti5: 295,
				frp: 25.8,
				daynight: 'D',
			},
		];

		const stats = computeHotspotStats(hotspots);
		expect(stats.totalCount).toBe(2);
		expect(stats.highConfidence).toBe(1);
		expect(stats.maxBrightness).toBeCloseTo(365.2, 1);
		expect(stats.maxPower).toBeCloseTo(25.8, 1);
	});
});
