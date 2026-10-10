import { describe, it, expect } from 'vitest';
import {
	computeTleChecksum,
	mergeTles,
	MONITORED_NORAD_IDS,
	parseTleText,
	serializeTles,
	validateTleRecord,
} from '../src/satellites';

describe('TLE Checksum Computation', () => {
	it('computes standard mod-10 checksum matching official NORAD samples', () => {
		// Landsat 8
		const l8_1 = '1 39084U 13008A   26282.90944219  .00000228  00000+0  60785-4 0  9995';
		const l8_2 = '2 39084  98.2190 351.6114 0001302  94.7208 265.4139 14.57110728714606';
		expect(computeTleChecksum(l8_1)).toBe(5);
		expect(computeTleChecksum(l8_2)).toBe(6);

		// Sentinel-2A
		const s2a_1 = '1 40697U 15028A   26282.89996329 -.00000069  00000+0 -96827-5 0  9990';
		const s2a_2 = '2 40697  98.5655 356.0779 0001043  91.2875 268.8427 14.30819922590137';
		expect(computeTleChecksum(s2a_1)).toBe(0);
		expect(computeTleChecksum(s2a_2)).toBe(7);
	});
});

describe('TLE Record Validation', () => {
	it('validates a correct 3-line record with matching catalog IDs', () => {
		const lines = [
			'LANDSAT 8',
			'1 39084U 13008A   26282.90944219  .00000228  00000+0  60785-4 0  9995',
			'2 39084  98.2190 351.6114 0001302  94.7208 265.4139 14.57110728714606',
		];
		const res = validateTleRecord(lines);
		expect(res.valid).toBe(true);
		expect(res.record?.noradId).toBe(39084);
		expect(res.record?.name).toBe('LANDSAT 8');
	});

	it('rejects records with fewer than 3 lines or empty name', () => {
		expect(validateTleRecord(['LANDSAT 8', '1 ...']).valid).toBe(false);
		expect(validateTleRecord(['', '1 ...', '2 ...']).valid).toBe(false);
	});

	it('rejects records with mismatched catalog numbers', () => {
		const lines = [
			'MISMATCH',
			'1 39084U 13008A   26282.90944219  .00000228  00000+0  60785-4 0  9995',
			'2 49260  98.2171 351.3910 0001365  88.0469 272.0886 14.57109328267674',
		];
		expect(validateTleRecord(lines).valid).toBe(false);
	});

	it('rejects records with corrupted checksums', () => {
		const lines = [
			'CORRUPTED',
			'1 39084U 13008A   26282.90944219  .00000228  00000+0  60785-4 0  9999', // should be 5
			'2 39084  98.2190 351.6114 0001302  94.7208 265.4139 14.57110728714606',
		];
		expect(validateTleRecord(lines).valid).toBe(false);
	});
});

describe('TLE Multi-Satellite Parsing and Merging', () => {
	const sampleTle1 = [
		'LANDSAT 8',
		'1 39084U 13008A   26282.90944219  .00000228  00000+0  60785-4 0  9995',
		'2 39084  98.2190 351.6114 0001302  94.7208 265.4139 14.57110728714606',
	].join('\n');

	const sampleTle2 = [
		'SENTINEL-2A',
		'1 40697U 15028A   26282.89996329 -.00000069  00000+0 -96827-5 0  9990',
		'2 40697  98.5655 356.0779 0001043  91.2875 268.8427 14.30819922590137',
	].join('\n');

	it('parses multi-satellite text blocks into record map', () => {
		const combined = `${sampleTle1}\n${sampleTle2}`;
		const map = parseTleText(combined);
		expect(map.size).toBe(2);
		expect(map.has(39084)).toBe(true);
		expect(map.has(40697)).toBe(true);
	});

	it('preserves cached satellites when fresh fetch only returns partial satellites', () => {
		// Existing cache contains Landsat 8 and Sentinel-2A
		const existingCache = `${sampleTle1}\n${sampleTle2}`;

		// Fresh fetch only fetched Terra (25994)
		const terraRec = {
			noradId: 25994,
			name: 'TERRA',
			line1: '1 25994U 99068A   26282.93987331  .00000272  00000+0  64302-4 0  9993',
			line2: '2 25994  97.9326 327.8638 0001614 190.9180 292.5402 14.61172684426369',
		};

		const merged = mergeTles(existingCache, [terraRec]);
		const mergedMap = parseTleText(merged);

		// All 3 satellites should exist now!
		expect(mergedMap.size).toBe(3);
		expect(mergedMap.has(39084)).toBe(true);
		expect(mergedMap.has(40697)).toBe(true);
		expect(mergedMap.has(25994)).toBe(true);
	});

	it('overwrites cached satellite with fresh observation for the same catalog ID', () => {
		const existing = sampleTle1;
		const freshL8 = {
			noradId: 39084,
			name: 'LANDSAT 8 UPDATED',
			line1: '1 39084U 13008A   26282.90944219  .00000228  00000+0  60785-4 0  9995',
			line2: '2 39084  98.2190 351.6114 0001302  94.7208 265.4139 14.57110728714606',
		};

		const merged = mergeTles(existing, [freshL8]);
		const mergedMap = parseTleText(merged);
		expect(mergedMap.get(39084)?.name).toBe('LANDSAT 8 UPDATED');
	});
});
