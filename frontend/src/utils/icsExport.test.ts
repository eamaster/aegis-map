import { describe, it, expect } from 'vitest';
import { escapeIcsText, foldIcsLine, formatIcsUtcTimestamp, generateSatellitePassesIcs } from './icsExport';
import type { EnrichedSatellitePass } from './orbitalEngine';

describe('RFC 5545 ICS Satellite Pass Export', () => {
	const samplePass: EnrichedSatellitePass = {
		satelliteName: 'SENTINEL-2A',
		noradId: 40697,
		time: new Date('2026-11-28T10:15:00Z'),
		peakTime: new Date('2026-11-28T10:18:00Z'),
		riseEstimateTime: new Date('2026-11-28T10:12:00Z'),
		setEstimateTime: new Date('2026-11-28T10:21:00Z'),
		elevation: 31.2,
		azimuth: 184,
		maxElevationDeg: 47.6,
		tleEpochIso: '2026-11-27T12:00:00Z',
		illumination: 'day',
		capabilities: {
			optical: true,
			thermal: false,
			sar: false,
			summary: 'Sentinel-2A: optical multispectral (MSI) only. No thermal. No SAR.',
		},
	};

	it('escapes special characters and folds multi-byte UTF-8 lines at <= 75 octets', () => {
		expect(escapeIcsText('Fire; North, Ridge\\East\nUpdate')).toBe('Fire\\; North\\, Ridge\\\\East\\nUpdate');

		const unicodeLine = `SUMMARY:${'آتش‌سوزی جنگلی شمال ایران '.repeat(6)}`;
		const folded = foldIcsLine(unicodeLine);
		const physicalLines = folded.split('\r\n');
		expect(physicalLines.length).toBeGreaterThan(1);
		const enc = new TextEncoder();
		for (let i = 0; i < physicalLines.length; i++) {
			expect(enc.encode(physicalLines[i]).length).toBeLessThanOrEqual(75);
			if (i > 0) {
				expect(physicalLines[i].startsWith(' ')).toBe(true);
			}
		}
	});

	it('produces deterministic UTC VEVENTs with snapshot disclaimer, valid DTEND > DTSTART, and optional VALARM', () => {
		const ics1 = generateSatellitePassesIcs({
			eventTitle: 'California Fire, North',
			lat: 39.1234,
			lng: -121.5678,
			passes: [samplePass],
			includeReminderAlarm: true,
			now: new Date('2026-11-27T12:00:00Z'),
		});
		const ics2 = generateSatellitePassesIcs({
			eventTitle: 'California Fire, North',
			lat: 39.1234,
			lng: -121.5678,
			passes: [samplePass],
			includeReminderAlarm: true,
			now: new Date('2026-11-27T12:00:00Z'),
		});

		expect(ics1).toBe(ics2);
		expect(ics1).toContain('\r\n');
		expect(ics1).toContain(`DTSTART:${formatIcsUtcTimestamp(samplePass.riseEstimateTime)}`);
		expect(ics1).toContain(`DTEND:${formatIcsUtcTimestamp(samplePass.setEstimateTime)}`);
		expect(ics1).toContain('UID:aegis-pass-40697-');
		expect(ics1).toContain('SNAPSHOT ONLY');
		expect(ics1).toContain('BEGIN:VALARM');
		expect(ics1).toContain('TRIGGER:-PT15M');

		// Verify every line respects CRLF 75-octet max
		const enc = new TextEncoder();
		for (const line of ics1.split('\r\n')) {
			expect(enc.encode(line).length).toBeLessThanOrEqual(75);
		}
	});
});
