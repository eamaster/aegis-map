import { useMemo, useState } from 'react';
import { Calendar, Download, Eye, Radio, Cloud, Clock } from 'lucide-react';
import type { WeatherData } from '../types';
import type { EnrichedSatellitePass } from '../utils/orbitalEngine';
import { downloadIcsFile, generateSatellitePassesIcs } from '../utils/icsExport';
import { useDesignSystem } from '../hooks/useDesignSystem';
import { BdiLtr } from './BdiLtr';

interface PassComparisonPanelProps {
	eventTitle: string;
	lat: number;
	lng: number;
	passes: EnrichedSatellitePass[];
	hourlyWeather: WeatherData['hourly'] | null | undefined;
	tleOldestEpoch: string | null;
}

function interpolateHourlyCloud(
	hourly: WeatherData['hourly'] | null | undefined,
	passTime: Date,
): number | null {
	if (
		!hourly ||
		!Array.isArray(hourly.time) ||
		!Array.isArray(hourly.cloud_cover) ||
		hourly.time.length === 0
	) {
		return null;
	}
	const targetMs = passTime.getTime();
	let bestIdx = -1;
	let minDiff = Infinity;
	for (let i = 0; i < hourly.time.length; i++) {
		const raw = hourly.time[i];
		const iso = raw.endsWith('Z') ? raw : `${raw}:00Z`.replace(/:00:00Z$/, ':00Z');
		const ms = Date.parse(iso);
		if (Number.isFinite(ms)) {
			const diff = Math.abs(ms - targetMs);
			if (diff < minDiff) {
				minDiff = diff;
				bestIdx = i;
			}
		}
	}
	if (bestIdx < 0 || minDiff > 2 * 60 * 60 * 1000) return null;
	const val = hourly.cloud_cover[bestIdx];
	return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function formatAgeHours(iso: string | null): string {
	if (!iso) return 'Unknown epoch';
	const ms = Date.parse(
		iso.replace(' ', 'T') + (iso.includes('T') || iso.endsWith('Z') ? '' : ':00Z'),
	);
	if (!Number.isFinite(ms)) return 'Unknown epoch';
	const hrs = Math.max(0, (Date.now() - ms) / 3_600_000);
	return hrs < 1 ? '<1h old' : `${Math.round(hrs)}h old`;
}

function formatLocalPassTimeWithTz(date: Date): string {
	try {
		return new Intl.DateTimeFormat(undefined, {
			hour: '2-digit',
			minute: '2-digit',
			timeZoneName: 'short',
		}).format(date);
	} catch {
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}
}

export default function PassComparisonPanel({
	eventTitle,
	lat,
	lng,
	passes,
	hourlyWeather,
	tleOldestEpoch,
}: PassComparisonPanelProps) {
	const ds = useDesignSystem();
	const [includeAlarm, setIncludeAlarm] = useState(true);
	const [expanded, setExpanded] = useState(false);

	const rows = useMemo(() => {
		return passes.slice(0, 6).map((p) => {
			const cloud = interpolateHourlyCloud(hourlyWeather, p.time);
			const family = p.capabilities?.sar
				? 'sar'
				: p.capabilities?.thermal && p.capabilities?.optical
					? 'optical+thermal'
					: p.capabilities?.optical
						? 'optical'
						: 'unknown';
			const canSeeThroughCloud = p.capabilities?.sar ?? false;
			return {
				pass: p,
				satDisplay: p.satelliteName.replace(/[-_]/g, ' '),
				utcHm: `${p.time.toISOString().slice(11, 16)} UTC`,
				localTz: formatLocalPassTimeWithTz(p.time),
				peakDeg: Math.round(p.maxElevationDeg),
				cloud,
				family,
				canSeeThroughCloud,
				epochAge: formatAgeHours(p.tleEpochIso ?? tleOldestEpoch),
			};
		});
	}, [passes, hourlyWeather, tleOldestEpoch]);

	const handleDownloadIcs = () => {
		if (passes.length === 0) return;
		const content = generateSatellitePassesIcs({
			eventTitle,
			lat,
			lng,
			passes: passes.slice(0, 8),
			includeReminderAlarm: includeAlarm,
		});
		const safeSlug =
			eventTitle
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.slice(0, 32) || 'event';
		downloadIcsFile(`aegis-passes-${safeSlug}.ics`, content);
	};

	if (passes.length === 0) {
		return null;
	}

	const visibleRows = expanded ? rows : rows.slice(0, 3);

	return (
		<section
			data-testid="pass-comparison-panel"
			aria-labelledby="pass-comparison-heading"
			className="rounded-xl p-3.5 border space-y-2.5 overflow-hidden"
			style={{
				background: ds.surface.overlay,
				borderColor: ds.surface.border,
			}}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/35">
						Predicted Overpass (Ephemeris Snapshot)
					</span>
					<h4
						id="pass-comparison-heading"
						className="text-xs font-bold mt-1"
						style={{ color: ds.text.primary }}
					>
						Multi-Satellite Fleet Comparison ({rows.length} upcoming)
					</h4>
				</div>
				<button
					type="button"
					data-testid="export-ics-btn"
					onClick={handleDownloadIcs}
					className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white"
				>
					<Download size={12} aria-hidden="true" />
					<span>Export .ics Snapshot</span>
				</button>
			</div>

			<div
				className="flex flex-wrap items-center justify-between gap-2 text-[11px]"
				style={{ color: ds.text.tertiary }}
			>
				<label className="inline-flex items-center gap-1.5 cursor-pointer min-h-[30px]">
					<input
						type="checkbox"
						checked={includeAlarm}
						onChange={(e) => setIncludeAlarm(e.target.checked)}
						className="rounded"
					/>
					<span>Include 15m VALARM reminder</span>
				</label>
				<span>
					TLE age: <BdiLtr>{tleOldestEpoch ? formatAgeHours(tleOldestEpoch) : 'current'}</BdiLtr>
				</span>
			</div>

			{/* Desktop / Tablet Compact Comparison Table (sm+) */}
			<div className="hidden sm:block overflow-x-auto">
				<table
					data-testid="pass-comparison-table"
					className="w-full text-start text-[11px] border-collapse"
				>
					<thead>
						<tr
							className="border-b text-[10px] uppercase tracking-wider"
							style={{ borderColor: ds.surface.border, color: ds.text.tertiary }}
						>
							<th className="py-1.5 pe-2 text-start font-bold">Satellite</th>
							<th className="py-1.5 px-2 text-start font-bold">Pass Window</th>
							<th className="py-1.5 px-2 text-start font-bold">Peak</th>
							<th className="py-1.5 ps-2 text-start font-bold">Cloud / TLE</th>
						</tr>
					</thead>
					<tbody>
						{visibleRows.map(
							({
								pass,
								satDisplay,
								utcHm,
								localTz,
								peakDeg,
								cloud,
								family,
								canSeeThroughCloud,
								epochAge,
							}) => (
								<tr
									key={`tbl-${pass.satelliteName}-${pass.time.toISOString()}`}
									className="border-b align-top"
									style={{ borderColor: ds.surface.borderSubtle }}
								>
									<td className="py-2 pe-2">
										<div
											className="font-bold flex items-center gap-1"
											style={{ color: ds.text.primary }}
										>
											{family === 'sar' ? (
												<Radio
													size={11}
													className="text-emerald-400 shrink-0"
													aria-hidden="true"
												/>
											) : (
												<Eye
													size={11}
													className="text-sky-400 shrink-0"
													aria-hidden="true"
												/>
											)}
											<span>{satDisplay}</span>
										</div>
										<span className="inline-block mt-0.5 uppercase text-[9px] px-1.5 py-0.5 rounded bg-slate-700/70 text-slate-200">
											{family}
										</span>
									</td>
									<td className="py-2 px-2" style={{ color: ds.text.secondary }}>
										<div>
											<BdiLtr mono>{utcHm}</BdiLtr>
										</div>
										<div className="text-[10px]" style={{ color: ds.text.tertiary }}>
											<BdiLtr>{localTz}</BdiLtr>
										</div>
									</td>
									<td className="py-2 px-2 font-bold" style={{ color: ds.text.primary }}>
										<BdiLtr mono>{peakDeg}° peak</BdiLtr>
									</td>
									<td className="py-2 ps-2" style={{ color: ds.text.secondary }}>
										<div>
											{cloud === null
												? 'Unknown'
												: canSeeThroughCloud
													? `${cloud}% (SAR)`
													: `${cloud}%`}
										</div>
										<div className="text-[10px]" style={{ color: ds.text.tertiary }}>
											TLE <BdiLtr>{epochAge}</BdiLtr>
										</div>
									</td>
								</tr>
							),
						)}
					</tbody>
				</table>
			</div>

			{/* Phone Labeled Stacked Cards (< 640px) — exact same memoized pass rows */}
			<div className="sm:hidden space-y-2" data-testid="pass-comparison-cards">
				{visibleRows.map(
					({
						pass,
						satDisplay,
						utcHm,
						localTz,
						peakDeg,
						cloud,
						family,
						canSeeThroughCloud,
						epochAge,
					}) => (
						<div
							key={`card-${pass.satelliteName}-${pass.time.toISOString()}`}
							className="rounded-lg p-2.5 border text-[11px] space-y-1.5"
							style={{
								background: ds.surface.overlaySubtle,
								borderColor: ds.surface.borderSubtle,
							}}
						>
							<div className="flex flex-wrap items-center justify-between gap-1.5">
								<span
									className="font-bold flex items-center gap-1.5"
									style={{ color: ds.text.primary }}
								>
									{family === 'sar' ? (
										<Radio size={12} className="text-emerald-400" aria-hidden="true" />
									) : (
										<Eye size={12} className="text-sky-400" aria-hidden="true" />
									)}
									<span>{satDisplay}</span>
									<span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-slate-700/70 text-slate-200">
										{family}
									</span>
								</span>
								<BdiLtr mono className="font-bold">
									{peakDeg}° peak
								</BdiLtr>
							</div>

							<div
								className="flex flex-wrap items-center gap-x-3 gap-y-1"
								style={{ color: ds.text.secondary }}
							>
								<span className="inline-flex items-center gap-1">
									<Clock size={11} aria-hidden="true" />
									<BdiLtr mono>{utcHm}</BdiLtr> (<BdiLtr>{localTz}</BdiLtr>)
								</span>
								<span className="inline-flex items-center gap-1">
									<Cloud size={11} aria-hidden="true" />
									{cloud === null
										? 'Cloud: Unknown'
										: canSeeThroughCloud
											? `Cloud: ${cloud}% (SAR penetrates)`
											: `Cloud: ${cloud}%`}
								</span>
								<span>
									TLE: <BdiLtr>{epochAge}</BdiLtr>
								</span>
							</div>
						</div>
					),
				)}
			</div>

			{rows.length > 3 && (
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="min-h-[32px] text-xs font-semibold underline"
					style={{ color: ds.colors.accent.blueLight }}
				>
					{expanded ? 'Show fewer passes' : `Compare all ${rows.length} fleet passes`}
				</button>
			)}

			<p className="text-[10px] leading-relaxed" style={{ color: ds.text.tertiary }}>
				<Calendar size={10} className="inline me-1" aria-hidden="true" />
				Predicted ephemeris snapshot only — overpasses do not confirm imaging acquisition.
			</p>
		</section>
	);
}
