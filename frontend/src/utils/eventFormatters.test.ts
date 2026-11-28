import { describe, expect, it, vi } from 'vitest';
import type { Disaster } from '../types';
import {
	buildDisasterPopupDom,
	formatCoordPair,
	formatEventDualTime,
	formatPrimaryMetric,
	getEventProvenanceLabel,
	isGlobePointOccluded,
} from './eventFormatters';

class FakeNode {
	tagName: string;
	attributes = new Map<string, string>();
	style: Record<string, string> = {};
	children: FakeNode[] = [];
	textContent = '';
	type = '';
	private listeners = new Map<string, Array<(ev: { preventDefault: () => void; stopPropagation: () => void }) => void>>();

	constructor(tagName: string) {
		this.tagName = tagName.toLowerCase();
	}

	setAttribute(name: string, value: string) {
		this.attributes.set(name, value);
	}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}

	appendChild(child: FakeNode) {
		this.children.push(child);
		return child;
	}

	addEventListener(
		event: string,
		cb: (ev: { preventDefault: () => void; stopPropagation: () => void }) => void,
	) {
		const list = this.listeners.get(event) ?? [];
		list.push(cb);
		this.listeners.set(event, list);
	}

	click() {
		for (const cb of this.listeners.get('click') ?? []) {
			cb({ preventDefault: () => {}, stopPropagation: () => {} });
		}
	}

	findAll(predicate: (node: FakeNode) => boolean): FakeNode[] {
		const results: FakeNode[] = [];
		const walk = (n: FakeNode) => {
			if (predicate(n)) results.push(n);
			for (const c of n.children) walk(c);
		};
		walk(this);
		return results;
	}
}

function createFakeDoc(): Document {
	return {
		createElement: (tag: string) => new FakeNode(tag),
	} as unknown as Document;
}

describe('eventFormatters', () => {
	it('formats coordinates with explicit hemisphere designators', () => {
		expect(formatCoordPair(5.9804, 116.0736, 3)).toBe('5.980°N, 116.074°E');
		expect(formatCoordPair(-33.8688, -70.6693, 2)).toBe('33.87°S, 70.67°W');
	});

	it('formats hazard-specific metrics accurately', () => {
		const quake: Disaster = {
			id: 'us1',
			type: 'earthquake',
			title: 'M 5.4 - Kermadec Islands',
			lat: -29.5,
			lng: -177.2,
			date: '2026-11-27T10:15:00Z',
			severity: 'medium',
			magnitude: 5.4,
		};
		expect(formatPrimaryMetric(quake)).toBe('M5.4');

		const fire: Disaster = {
			id: 'eo1',
			type: 'fire',
			title: 'Park Wildfire',
			lat: 39.9,
			lng: -121.8,
			date: '2026-11-27T08:00:00Z',
			severity: 'high',
			areaAcres: 12450.4,
		};
		expect(formatPrimaryMetric(fire)).toBe('12,450 ac');

		const cell: Disaster = {
			id: 'cell1',
			type: 'fire_detection',
			title: 'Thermal cell',
			lat: -12.25,
			lng: 132.75,
			date: '2026-11-27T06:00:00Z',
			severity: 'high',
			detectionCell: {
				cellId: 'cell1',
				lat: -12.25,
				lng: 132.75,
				bounds: [132.5, -12.5, 133.0, -12.0],
				detectionCount: 42,
				maxFrp: 118.5,
				avgFrp: 31.2,
				maxBrightTi4: 356.4,
				latestAcqTime: '2026-11-27T06:00:00Z',
				confidenceCounts: { high: 12, nominal: 30, low: 0, unknown: 0 },
				satelliteCounts: { N: 42 },
				dayNightCounts: { day: 30, night: 12, unknown: 0 },
				intensity: 'high',
			},
		};
		expect(formatPrimaryMetric(cell)).toBe('42 detections · Peak FRP 118.5 MW');
	});

	it('identifies globe far-side occlusion at low zoom and disables it in Mercator zoom', () => {
		expect(isGlobePointOccluded(0, 20, 10, 25, 1.5)).toBe(false);
		expect(isGlobePointOccluded(0, 20, 175, -15, 1.5)).toBe(true);
		expect(isGlobePointOccluded(0, 20, 175, -15, 6.0)).toBe(false);
	});

	it('builds safe DOM popup without innerHTML injection and wires pinned deselect callback', () => {
		const onClose = vi.fn();
		const xssAttempt: Disaster = {
			id: 'arch-1',
			type: 'volcano',
			title: '<img src=x onerror=alert(1)> Mount Etna',
			lat: 37.751,
			lng: 14.993,
			date: '2026-11-26T14:30:00Z',
			severity: 'high',
			isArchived: true,
			archiveProvenance: 'live_captured',
			archiveAttribution: 'NASA EONET Archive',
		};

		expect(getEventProvenanceLabel(xssAttempt)).toBe('Archived · Live captured');
		const dual = formatEventDualTime(xssAttempt.date);
		expect(dual.valid).toBe(true);
		expect(dual.utc).toBe('2026-11-26 14:30 UTC');

		const dom = buildDisasterPopupDom(xssAttempt, {
			mode: 'pinned',
			deselectLabel: 'Close event',
			onClose,
			doc: createFakeDoc(),
		}) as unknown as FakeNode;

		expect(dom.findAll((n) => n.tagName === 'img')).toHaveLength(0);
		const titleNode = dom.findAll((n) => n.getAttribute('data-testid') === 'popup-event-title')[0];
		expect(titleNode?.textContent).toContain('<img src=x onerror=alert(1)> Mount Etna');

		const provNode = dom.findAll((n) => n.getAttribute('data-testid') === 'popup-provenance-badge')[0];
		expect(provNode?.textContent).toBe('Archived · Live captured');

		const bdiNodes = dom.findAll((n) => n.tagName === 'bdi' && n.getAttribute('dir') === 'ltr');
		expect(bdiNodes.length).toBeGreaterThanOrEqual(2);

		const closeBtn = dom.findAll((n) => n.getAttribute('data-testid') === 'close-pinned-popup-btn')[0];
		expect(closeBtn).toBeDefined();
		closeBtn?.click();
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
