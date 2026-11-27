/**
 * RFC 5545 (.ics) Calendar Snapshot Generator for Predicted Satellite Passes.
 *
 * All timestamps are serialized in UTC (`YYYYMMDDTHHMMSSZ`), UIDs are deterministic
 * for repeatable re-imports, text values are properly escaped, and content lines are
 * folded at <= 75 UTF-8 octets using CRLF + single space (`\r\n `).
 */

import type { EnrichedSatellitePass } from './orbitalEngine';

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

export function formatIcsUtcTimestamp(date: Date): string {
	return (
		`${date.getUTCFullYear()}` +
		`${pad2(date.getUTCMonth() + 1)}` +
		`${pad2(date.getUTCDate())}T` +
		`${pad2(date.getUTCHours())}` +
		`${pad2(date.getUTCMinutes())}` +
		`${pad2(date.getUTCSeconds())}Z`
	);
}

export function escapeIcsText(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/\r?\n/g, '\\n')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,');
}

/**
 * Fold an RFC 5545 content line so no physical line exceeds 75 UTF-8 octets
 * without splitting multi-byte UTF-8 characters.
 */
export function foldIcsLine(line: string, maxOctets = 75): string {
	const encoder = new TextEncoder();
	if (encoder.encode(line).length <= maxOctets) return line;

	const chunks: string[] = [];
	let current = '';
	let currentBytes = 0;

	for (const ch of line) {
		const chBytes = encoder.encode(ch).length;
		const limit = chunks.length === 0 ? maxOctets : maxOctets - 1; // leading space takes 1 octet
		if (currentBytes + chBytes > limit && current.length > 0) {
			chunks.push(chunks.length === 0 ? current : ` ${current}`);
			current = ch;
			currentBytes = chBytes;
		} else {
			current += ch;
			currentBytes += chBytes;
		}
	}
	if (current.length > 0) {
		chunks.push(chunks.length === 0 ? current : ` ${current}`);
	}
	return chunks.join('\r\n');
}

export interface PassIcsOptions {
	eventTitle: string;
	lat: number;
	lng: number;
	passes: readonly EnrichedSatellitePass[];
	includeReminderAlarm?: boolean;
	now?: Date;
}

export function generateSatellitePassesIcs(options: PassIcsOptions): string {
	const now = options.now ?? new Date();
	const dtStamp = formatIcsUtcTimestamp(now);
	const calName = escapeIcsText(`AegisMap Pass Snapshot — ${options.eventTitle}`);
	const lines: string[] = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//AegisMap//Orbital Pass Snapshot//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		`X-WR-CALNAME:${calName}`,
	];

	for (const pass of options.passes) {
		const start = pass.riseEstimateTime.getTime() <= pass.time.getTime() ? pass.riseEstimateTime : pass.time;
		const minEndMs = start.getTime() + 5 * 60 * 1000;
		const end = new Date(Math.max(pass.setEstimateTime.getTime(), minEndMs));

		const noradPart = pass.noradId ?? pass.satelliteName.replace(/[^A-Za-z0-9]/g, '');
		const startSec = Math.floor(start.getTime() / 1000);
		const uid = `aegis-pass-${noradPart}-${startSec}-${options.lat.toFixed(2)}-${options.lng.toFixed(2)}@aegis-map`;

		const sensorLabel = pass.capabilities
			? pass.capabilities.summary
			: 'Earth Observation Sensor';

		const summary = escapeIcsText(
			`[AegisMap Snapshot] ${pass.satelliteName} pass (${Math.round(pass.maxElevationDeg)} deg) — ${options.eventTitle}`,
		);
		const desc = escapeIcsText(
			[
				`SNAPSHOT ONLY: Propagated from orbital elements (TLE epoch: ${pass.tleEpochIso ?? 'unknown'}). A predicted overpass does NOT guarantee sensor acquisition or imaging.`,
				`Event: ${options.eventTitle} (${options.lat.toFixed(4)}, ${options.lng.toFixed(4)})`,
				`Satellite: ${pass.satelliteName} (NORAD ${pass.noradId ?? 'unknown'})`,
				`Sensor: ${sensorLabel}`,
				`Illumination at pass: ${pass.illumination}`,
				`First sample >= threshold: ${pass.time.toISOString()} (${pass.elevation.toFixed(1)} deg, az ${pass.azimuth.toFixed(0)} deg)`,
				`Estimated peak elevation: ${pass.maxElevationDeg.toFixed(1)} deg at ${pass.peakTime.toISOString()}`,
			].join('\n'),
		);

		lines.push('BEGIN:VEVENT');
		lines.push(`UID:${uid}`);
		lines.push(`DTSTAMP:${dtStamp}`);
		lines.push(`DTSTART:${formatIcsUtcTimestamp(start)}`);
		lines.push(`DTEND:${formatIcsUtcTimestamp(end)}`);
		lines.push(`SUMMARY:${summary}`);
		lines.push(`DESCRIPTION:${desc}`);
		lines.push(`LOCATION:${escapeIcsText(`${options.eventTitle} (${options.lat.toFixed(4)}, ${options.lng.toFixed(4)})`)}`);
		lines.push(`GEO:${options.lat.toFixed(5)};${options.lng.toFixed(5)}`);
		lines.push('STATUS:TENTATIVE');

		if (options.includeReminderAlarm) {
			lines.push('BEGIN:VALARM');
			lines.push('ACTION:DISPLAY');
			lines.push(`DESCRIPTION:${escapeIcsText(`Upcoming satellite overpass: ${pass.satelliteName}`)}`);
			lines.push('TRIGGER:-PT15M');
			lines.push('END:VALARM');
		}

		lines.push('END:VEVENT');
	}

	lines.push('END:VCALENDAR');

	return lines.map((l) => foldIcsLine(l)).join('\r\n') + '\r\n';
}

export function downloadIcsFile(filename: string, content: string): void {
	const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
