import { describe, expect, it } from 'vitest';
import {
	FIRMS_INTENSITY_THRESHOLDS,
	GLOBAL_FIRMS_PRODUCTS,
} from '../src/config';
import {
	calculateWindowRange,
	computeCellBounds,
	computeIntensity,
	FirmsGlobalSnapshot,
	ingestGlobalFirms,
	isValidSnapshot,
	loadGlobalFirmsSnapshot,
	planWorldFirmsRequests,
	saveGlobalFirmsSnapshot,
	WorldGridAggregator,
} from '../src/firmsGlobal';
import { csvResponse, memoryKv } from './helpers';

const SAMPLE_HEADER =
	'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';

describe('firmsGlobal - Grid partitioning', () => {
	it('partitions coordinates into deterministic 0.5° grid cells', () => {
		const cell1 = computeCellBounds(34.2, -118.3);
		expect(cell1.centerLat).toBe(34.25);
		expect(cell1.centerLng).toBe(-118.25);
		expect(cell1.cellId).toBe('cell:34.25:-118.25');
		expect(cell1.bounds).toEqual([-118.5, 34.0, -118.0, 34.5]);

		// Equator and prime meridian
		const cell2 = computeCellBounds(0.1, 0.1);
		expect(cell2.centerLat).toBe(0.25);
		expect(cell2.centerLng).toBe(0.25);
		expect(cell2.cellId).toBe('cell:0.25:0.25');
		expect(cell2.bounds).toEqual([0.0, 0.0, 0.5, 0.5]);
	});

	it('safely handles antimeridian and pole edges', () => {
		// Antimeridian
		const westEdge = computeCellBounds(10.0, -180.0);
		expect(westEdge.bounds[0]).toBe(-180.0);
		expect(westEdge.centerLng).toBe(-179.75);

		const eastEdge = computeCellBounds(10.0, 180.0);
		expect(eastEdge.bounds[0]).toBe(-180.0);

		// North Pole clamping
		const northPole = computeCellBounds(90.0, 0.0);
		expect(northPole.bounds[3]).toBe(90.0);
		expect(northPole.centerLat).toBe(89.75);

		// South Pole clamping
		const southPole = computeCellBounds(-90.0, 0.0);
		expect(southPole.bounds[1]).toBe(-90.0);
		expect(southPole.centerLat).toBe(-89.75);
	});
});

describe('firmsGlobal - Intensity thresholds', () => {
	it('classifies intensity accurately according to thresholds', () => {
		// Low
		expect(computeIntensity(1, 5)).toBe('low');
		expect(computeIntensity(4, 19)).toBe('low');

		// Medium
		expect(computeIntensity(FIRMS_INTENSITY_THRESHOLDS.medium.minDetections, 10)).toBe('medium');
		expect(computeIntensity(2, FIRMS_INTENSITY_THRESHOLDS.medium.minFrp)).toBe('medium');

		// High
		expect(computeIntensity(FIRMS_INTENSITY_THRESHOLDS.high.minDetections, 10)).toBe('high');
		expect(computeIntensity(2, FIRMS_INTENSITY_THRESHOLDS.high.minFrp)).toBe('high');
	});
});

describe('firmsGlobal - Temporal planning', () => {
	it('plans 24h world requests with 1 request per sensor (dayRange=2)', () => {
		const now = new Date('2026-10-13T12:00:00Z');
		const plans = planWorldFirmsRequests('24h', now);
		expect(plans).toHaveLength(GLOBAL_FIRMS_PRODUCTS.length);
		for (const p of plans) {
			expect(p.dayRange).toBe(2);
			expect(p.startDate).toBe('2026-10-12');
		}
	});

	it('plans 7d world requests with 2 requests per sensor (dayRange=4 and dayRange=3)', () => {
		const now = new Date('2026-10-13T12:00:00Z');
		const plans = planWorldFirmsRequests('7d', now);
		expect(plans).toHaveLength(GLOBAL_FIRMS_PRODUCTS.length * 2);
		const snppPlans = plans.filter((p) => p.product === 'VIIRS_SNPP_NRT');
		expect(snppPlans).toHaveLength(2);
		expect(snppPlans[0].dayRange).toBe(4);
		expect(snppPlans[0].startDate).toBe('2026-10-10');
		expect(snppPlans[1].dayRange).toBe(3);
		expect(snppPlans[1].startDate).toBe('2026-10-07');
	});

	it('computes strict rolling window intervals', () => {
		const now = new Date('2026-10-13T14:30:00.000Z');
		const range24h = calculateWindowRange('24h', now);
		expect(range24h.startInclusive).toBe('2026-10-12T14:30:00.000Z');
		expect(range24h.endExclusive).toBe('2026-10-13T14:30:00.000Z');

		const range7d = calculateWindowRange('7d', now);
		expect(range7d.startInclusive).toBe('2026-10-06T14:30:00.000Z');
		expect(range7d.endExclusive).toBe('2026-10-13T14:30:00.000Z');
	});
});

describe('firmsGlobal - WorldGridAggregator & Accounting', () => {
	const windowRange = {
		startInclusive: '2026-10-12T12:00:00.000Z',
		endExclusive: '2026-10-13T12:00:00.000Z',
	};

	it('strictly accounts for all row categories and maintains the accounting identity', () => {
		const agg = new WorldGridAggregator(windowRange);

		const csv = [
			SAMPLE_HEADER,
			// Valid 1 in cell:34.25:-118.25
			'34.12,-118.35,320.5,0.4,0.4,2026-10-12,1430,N20,VIIRS,nominal,2.0NRT,290.1,15.2,D',
			// Valid 2 in cell:34.25:-118.25
			'34.18,-118.40,345.2,0.4,0.4,2026-10-12,1430,N20,VIIRS,high,2.0NRT,295.4,32.8,D',
			// Duplicate of Valid 2
			'34.18000,-118.40000,345.2,0.4,0.4,2026-10-12,1430,N20,VIIRS,high,2.0NRT,295.4,32.8,D',
			// Out of window (prior to startInclusive)
			'34.10,-118.20,310.0,0.4,0.4,2026-10-11,1000,N20,VIIRS,nominal,2.0NRT,290.0,10.0,D',
			// Out of window (after endExclusive)
			'34.10,-118.20,310.0,0.4,0.4,2026-10-13,1300,N20,VIIRS,nominal,2.0NRT,290.0,10.0,D',
			// Malformed coordinate
			'not-a-lat,-118.20,310.0,0.4,0.4,2026-10-12,1500,N20,VIIRS,nominal,2.0NRT,290.0,10.0,D',
			// Malformed column count
			'34.10,-118.20,310.0,0.4',
			// Valid 3 in cell:-5.25:25.25 (Africa)
			'-5.15,25.30,360.0,0.4,0.4,2026-10-13,0100,NPP,VIIRS,high,2.0NRT,300.0,120.0,N',
		].join('\n');

		const result = agg.ingestCsv(csv);
		expect(result.ok).toBe(true);
		expect(result.acceptedRows).toBe(3);

		// Assert accounting numbers:
		// Raw rows = 8
		expect(agg.accounting.rawRows).toBe(8);
		// Malformed rows = 2 (not-a-lat, short row)
		expect(agg.accounting.malformedRows).toBe(2);
		// Out of window rows = 2 (2026-10-11 10:00, 2026-10-13 13:00)
		expect(agg.accounting.outOfWindowRows).toBe(2);
		// Duplicate rows = 1
		expect(agg.accounting.duplicateRows).toBe(1);
		// Accepted detections = 3
		expect(agg.accounting.acceptedDetections).toBe(3);

		// Invariant: raw = malformed + outOfWindow + duplicate + accepted
		expect(agg.assertAccountingIdentity()).toBe(true);

		const cells = agg.buildCells();
		expect(cells).toHaveLength(2);

		// Check cell 1 (LA cell: 2 detections)
		const laCell = cells.find((c) => c.cellId === 'cell:34.25:-118.25');
		expect(laCell).toBeDefined();
		expect(laCell!.detectionCount).toBe(2);
		expect(laCell!.maxFrp).toBe(32.8);
		expect(laCell!.avgFrp).toBe(24.0); // (15.2 + 32.8) / 2 = 24.0
		expect(laCell!.maxBrightTi4).toBe(345.2);
		expect(laCell!.intensity).toBe('medium'); // maxFrp 32.8 >= 20
		expect(laCell!.confidenceCounts).toEqual({ high: 1, nominal: 1, low: 0, unknown: 0 });
		expect(laCell!.dayNightCounts).toEqual({ day: 2, night: 0, unknown: 0 });
		expect(laCell!.satelliteCounts).toEqual({ N20: 2 });

		// Check cell 2 (Africa cell: 1 detection, frp=120)
		const afCell = cells.find((c) => c.cellId === 'cell:-5.25:25.25');
		expect(afCell).toBeDefined();
		expect(afCell!.detectionCount).toBe(1);
		expect(afCell!.maxFrp).toBe(120.0);
		expect(afCell!.intensity).toBe('high'); // frp >= 100
		expect(afCell!.dayNightCounts).toEqual({ day: 0, night: 1, unknown: 0 });
		expect(afCell!.satelliteCounts).toEqual({ NPP: 1 });
	});

	it('rejects completely malformed CSV missing required columns', () => {
		const agg = new WorldGridAggregator(windowRange);
		const badCsv = 'some,other,headers\n1,2,3';
		const result = agg.ingestCsv(badCsv);
		expect(result.ok).toBe(false);
		expect(result.error).toContain('Missing required columns');
	});
});

describe('firmsGlobal - Snapshot KV Persistence & LKG Fallback', () => {
	it('saves and reads snapshot and falls back to last-known-good when snapshot missing', async () => {
		const { kv } = memoryKv();
		const now = new Date('2026-10-13T12:00:00Z');
		const snapshot: FirmsGlobalSnapshot = {
			version: 2,
			window: '24h',
			windowRange: {
				startInclusive: '2026-10-12T12:00:00Z',
				endExclusive: '2026-10-13T12:00:00Z',
			},
			generatedAt: now.toISOString(),
			sensors: {
				VIIRS_SNPP_NRT: { status: 'ok', rawRows: 10, acceptedRows: 10 },
				VIIRS_NOAA20_NRT: { status: 'ok', rawRows: 20, acceptedRows: 20 },
				VIIRS_NOAA21_NRT: { status: 'ok', rawRows: 15, acceptedRows: 15 },
			},
			accounting: {
				rawRows: 45,
				malformedRows: 0,
				outOfWindowRows: 0,
				duplicateRows: 0,
				acceptedDetections: 45,
			},
			totalDetections: 45,
			cells: [
				{
					cellId: 'cell:10.25:20.25',
					lat: 10.25,
					lng: 20.25,
					bounds: [20.0, 10.0, 20.5, 10.5],
					detectionCount: 45,
					maxFrp: 50,
					avgFrp: 25,
					maxBrightTi4: 330,
					latestAcqTime: '2026-10-13T10:00:00Z',
					confidenceCounts: { high: 45, nominal: 0, low: 0, unknown: 0 },
					dayNightCounts: { day: 45, night: 0, unknown: 0 },
					satelliteCounts: { N20: 45 },
					intensity: 'high',
				},
			],
		};

		expect(isValidSnapshot(snapshot)).toBe(true);

		// Save to KV
		await saveGlobalFirmsSnapshot(kv, snapshot);

		// Read active snapshot
		const res1 = await loadGlobalFirmsSnapshot(kv, '24h');
		expect(res1).not.toBeNull();
		expect(res1!.isLkg).toBe(false);
		expect(res1!.status).toBe('ok');
		expect(res1!.snapshot.totalDetections).toBe(45);

		// Simulate primary snapshot expiry or deletion (only LKG remains)
		await kv.delete('firms:global:snapshot:v2:24h');

		const res2 = await loadGlobalFirmsSnapshot(kv, '24h');
		expect(res2).not.toBeNull();
		expect(res2!.isLkg).toBe(true);
		expect(res2!.status).toBe('stale');
		expect(res2!.snapshot.totalDetections).toBe(45);

		// Unsaved window returns null
		const res3 = await loadGlobalFirmsSnapshot(kv, '7d');
		expect(res3).toBeNull();
	});
});

describe('firmsGlobal - Ingestion workflow with mocked fetch', () => {
	it('ingests world data across 3 sensors and builds aggregated snapshot', async () => {
		const now = new Date('2026-10-13T12:00:00Z');

		const mockCsv = (sat: string) => [
			SAMPLE_HEADER,
			`-1.2,36.8,330.0,0.4,0.4,2026-10-13,0600,${sat},VIIRS,high,2.0NRT,290.0,25.0,D`,
		].join('\n');

		const fetchImpl = async (url: string) => {
			if (url.includes('VIIRS_SNPP_NRT')) return csvResponse(mockCsv('NPP'));
			if (url.includes('VIIRS_NOAA20_NRT')) return csvResponse(mockCsv('N20'));
			if (url.includes('VIIRS_NOAA21_NRT')) return csvResponse(mockCsv('N21'));
			return new Response('Not found', { status: 404 });
		};

		const snapshot = await ingestGlobalFirms('test-key', '24h', { now, fetchImpl });
		expect(snapshot.window).toBe('24h');
		expect(snapshot.totalDetections).toBe(3);
		expect(snapshot.cells).toHaveLength(1);
		expect(snapshot.cells[0].detectionCount).toBe(3);
		expect(snapshot.cells[0].satelliteCounts).toEqual({ NPP: 1, N20: 1, N21: 1 });
		expect(snapshot.sensors.VIIRS_SNPP_NRT.status).toBe('ok');
		expect(snapshot.sensors.VIIRS_NOAA20_NRT.status).toBe('ok');
		expect(snapshot.sensors.VIIRS_NOAA21_NRT.status).toBe('ok');
	});
});
