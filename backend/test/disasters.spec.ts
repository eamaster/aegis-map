import { describe, it, expect } from 'vitest';
import {
	extractEonetCoordinates,
	normalizeEonetEvents,
	normalizeUsgsFeatures,
	EonetRawEvent,
	UsgsRawFeature,
} from '../src/disasters';

describe('EONET Coordinate Extraction', () => {
	it('extracts valid Point coordinates [lng, lat]', () => {
		const pt = {
			type: 'Point',
			coordinates: [-115.2, 41.0],
		};
		const res = extractEonetCoordinates(pt);
		expect(res).not.toBeNull();
		expect(res?.lng).toBeCloseTo(-115.2, 3);
		expect(res?.lat).toBeCloseTo(41.0, 3);
	});

	it('computes representative centroid from Polygon outer ring coordinates', () => {
		const poly = {
			type: 'Polygon',
			coordinates: [
				[
					[-120.0, 38.0],
					[-118.0, 38.0],
					[-118.0, 40.0],
					[-120.0, 40.0],
					[-120.0, 38.0],
				],
			],
		};
		const res = extractEonetCoordinates(poly);
		expect(res).not.toBeNull();
		// Average of the vertices
		expect(res?.lng).toBeCloseTo(-119.2, 1);
		expect(res?.lat).toBeCloseTo(38.8, 1);
	});

	it('returns null for invalid/out-of-range coordinates', () => {
		expect(extractEonetCoordinates({ type: 'Point', coordinates: [200, 45] })).toBeNull();
		expect(extractEonetCoordinates({ type: 'Point', coordinates: [10, 95] })).toBeNull();
		expect(extractEonetCoordinates({ type: 'Point', coordinates: [NaN, 45] })).toBeNull();
	});
});

describe('EONET Event Normalization', () => {
	it('checks all categories so multi-category events are not misclassified', () => {
		const event: EonetRawEvent = {
			id: 'EONET_9999',
			title: 'Multi-category Fire',
			categories: [{ id: 'severeStorms' }, { id: 'wildfires' }],
			geometry: [
				{
					date: '2026-10-01T12:00:00Z',
					type: 'Point',
					coordinates: [-115.0, 40.0],
				},
			],
		};

		const res = normalizeEonetEvents([event]);
		expect(res).toHaveLength(1);
		expect(res[0].type).toBe('fire'); // Correctly identified as fire!
	});

	it('selects the most recent observation date from geometry series', () => {
		const event: EonetRawEvent = {
			id: 'EONET_1234',
			title: 'Long-running Fire',
			categories: [{ id: 'wildfires' }],
			geometry: [
				{
					date: '2026-08-01T00:00:00Z', // Old observation
					type: 'Point',
					coordinates: [-110.0, 35.0],
				},
				{
					date: '2026-10-05T12:00:00Z', // Latest observation
					type: 'Point',
					coordinates: [-110.5, 35.5],
				},
			],
		};

		const res = normalizeEonetEvents([event]);
		expect(res).toHaveLength(1);
		expect(res[0].date).toBe('2026-10-05T12:00:00Z');
		expect(res[0].lng).toBeCloseTo(-110.5, 3);
	});
});

describe('USGS Earthquake Normalization', () => {
	it('preserves valid zero magnitude (0.0 is not treated as null or missing)', () => {
		const feature: UsgsRawFeature = {
			id: 'nc75000001',
			properties: {
				mag: 0.0,
				place: '1km NW of The Geysers, CA',
				time: 1728500000000,
			},
			geometry: {
				coordinates: [-122.75, 38.77, 2.5],
			},
		};

		const res = normalizeUsgsFeatures([feature]);
		expect(res).toHaveLength(1);
		expect(res[0].magnitude).toBe(0.0);
		expect(res[0].severity).toBe('low');
		expect(res[0].lng).toBeCloseTo(-122.75, 2);
		expect(res[0].lat).toBeCloseTo(38.77, 2);
	});

	it('handles null/unknown magnitude honestly without crashing', () => {
		const feature: UsgsRawFeature = {
			id: 'nc75000002',
			properties: {
				mag: null,
				place: 'Northern California',
				time: 1728500000000,
			},
			geometry: {
				coordinates: [-122.0, 38.0, 5.0],
			},
		};

		const res = normalizeUsgsFeatures([feature]);
		expect(res).toHaveLength(1);
		expect(res[0].magnitude).toBeUndefined();
		expect(res[0].severity).toBe('low');
	});

	it('maps severity thresholds (mag >= 6 -> high, >= 4.5 -> medium, else low)', () => {
		const mkQuake = (id: string, mag: number): UsgsRawFeature => ({
			id,
			properties: { mag, place: 'Test', time: 1728500000000 },
			geometry: { coordinates: [0, 0, 0] },
		});

		const res = normalizeUsgsFeatures([
			mkQuake('q1', 6.2),
			mkQuake('q2', 4.8),
			mkQuake('q3', 3.1),
		]);

		expect(res[0].severity).toBe('high');
		expect(res[1].severity).toBe('medium');
		expect(res[2].severity).toBe('low');
	});
});
