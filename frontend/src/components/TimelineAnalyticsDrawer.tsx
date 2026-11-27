import { useEffect, useRef, useState } from 'react';
import {
	X,
	History,
	Activity,
	Play,
	Pause,
	SkipBack,
	SkipForward,
	Crosshair,
	CheckCircle2,
	RotateCcw,
} from 'lucide-react';
import type { Disaster } from '../types';
import type {
	ArchivedDisasterEvent as SharedArchivedEvent,
	ProviderHealthSummary as SharedProviderHealth,
} from '../../../shared/contracts';
import { fetchArchivedHistory, fetchSourceAnalytics } from '../utils/researchClient';
import { useDesignSystem } from '../hooks/useDesignSystem';
import { useLocale } from '../hooks/useLocale';
import { getHazardMeta } from '../utils/eventFormatters';
import { BdiLtr } from './BdiLtr';

type ArchivedRow = SharedArchivedEvent;
type ProviderRow = SharedProviderHealth;

interface TimelineAnalyticsDrawerProps {
	isOpen: boolean;
	onClose: () => void;
	onSelectEvent: (disaster: Disaster) => void;
}

export default function TimelineAnalyticsDrawer({
	isOpen,
	onClose,
	onSelectEvent,
}: TimelineAnalyticsDrawerProps) {
	const ds = useDesignSystem();
	const { t } = useLocale();
	const closeBtnRef = useRef<HTMLButtonElement>(null);
	const triggerElRef = useRef<HTMLElement | null>(null);

	const [activeTab, setActiveTab] = useState<'timeline' | 'analytics'>('timeline');
	const [typeFilter, setTypeFilter] = useState<'all' | 'fire' | 'volcano' | 'earthquake'>('all');
	const [events, setEvents] = useState<ArchivedRow[]>([]);
	const [providers, setProviders] = useState<ProviderRow[]>([]);
	const [storageAvailable, setStorageAvailable] = useState(true);
	const [note, setNote] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const [playIndex, setPlayIndex] = useState(0);
	const [playing, setPlaying] = useState(false);

	// Capture triggering element on open, focus dialog close control, and always stop playback on close
	useEffect(() => {
		if (isOpen) {
			triggerElRef.current = document.activeElement as HTMLElement | null;
			const id = requestAnimationFrame(() => closeBtnRef.current?.focus());
			return () => cancelAnimationFrame(id);
		}
		setPlaying(false);
		return undefined;
	}, [isOpen]);

	const handleClose = () => {
		setPlaying(false);
		onClose();
		const prev = triggerElRef.current;
		if (prev && typeof prev.focus === 'function') {
			requestAnimationFrame(() => prev.focus());
		}
	};

	useEffect(() => {
		if (!isOpen) return;
		const controller = new AbortController();
		const timer = window.setTimeout(async () => {
			setLoading(true);
			setErrorMsg(null);
			try {
				const [hist, analytics] = await Promise.all([
					fetchArchivedHistory({ type: typeFilter, limit: 40, signal: controller.signal }),
					fetchSourceAnalytics(controller.signal),
				]);
				setStorageAvailable(hist.storageAvailable && analytics.storageAvailable);
				setNote(hist.note ?? analytics.note ?? null);
				setEvents(hist.events);
				setProviders(analytics.providers);
				setPlayIndex(0);
			} catch (err) {
				if (err instanceof DOMException && err.name === 'AbortError') return;
				setErrorMsg(err instanceof Error ? err.message : 'Unable to load archive');
			} finally {
				setLoading(false);
			}
		}, 0);

		return () => {
			window.clearTimeout(timer);
			controller.abort();
		};
	}, [isOpen, typeFilter]);

	useEffect(() => {
		if (!isOpen || !playing || events.length === 0) return;
		const id = window.setInterval(() => {
			setPlayIndex((idx) => (idx + 1) % events.length);
		}, 1600);
		return () => window.clearInterval(id);
	}, [isOpen, playing, events.length]);

	if (!isOpen) return null;

	const currentEvent = events[playIndex] ?? null;

	const focusOnMap = (ev: ArchivedRow) => {
		setPlaying(false);
		onSelectEvent({
			id: ev.upstreamId,
			type: ev.type,
			title: ev.title,
			lat: ev.lat,
			lng: ev.lng,
			date: ev.eventTime,
			severity: ev.severity,
			magnitude: ev.magnitude ?? undefined,
			areaAcres: ev.areaAcres ?? undefined,
			isArchived: true,
			archiveProvenance: ev.provenance,
			archiveAttribution: ev.attribution,
		});
	};

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="timeline-analytics-title"
			data-testid="timeline-analytics-drawer"
			data-playing={playing ? 'true' : 'false'}
			onClick={handleClose}
			className="fixed inset-0 z-[140] flex items-end md:items-center justify-center p-0 md:p-4 bg-black/65 backdrop-blur-sm"
		>
			<div
				onClick={(e) => e.stopPropagation()}
				className="w-full h-[100dvh] md:h-auto md:max-w-3xl md:max-h-[86dvh] flex flex-col rounded-none md:rounded-2xl border shadow-2xl overflow-hidden"
				style={{
					...ds.glass.panel,
					borderColor: ds.surface.border,
					color: ds.text.primary,
				}}
			>
				{/* Non-scrolling Header */}
				<div
					className="shrink-0 flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5 border-b"
					style={{ borderColor: ds.surface.border }}
				>
					<div className="min-w-0">
						<h2
							id="timeline-analytics-title"
							className="text-sm sm:text-base font-extrabold flex items-center gap-2"
						>
							<History size={18} className="text-blue-400 shrink-0" aria-hidden="true" />
							<span>Historical Archive & Source Health</span>
						</h2>
						<p className="text-xs mt-0.5" style={{ color: ds.text.tertiary }}>
							Distinguishes live-captured observations from reconstructed backfill
						</p>
					</div>
					<button
						ref={closeBtnRef}
						type="button"
						data-testid="close-timeline-drawer-btn"
						onClick={handleClose}
						aria-label="Close timeline and analytics drawer"
						className="min-h-[38px] min-w-[38px] shrink-0 rounded-lg border flex items-center justify-center"
						style={{ background: ds.surface.overlaySubtle, borderColor: ds.surface.border }}
					>
						<X size={16} aria-hidden="true" />
					</button>
				</div>

				{/* Non-scrolling Tab & Filter Controls */}
				<div
					className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-2.5 border-b"
					style={{ borderColor: ds.surface.borderSubtle, background: ds.surface.overlaySubtle }}
				>
					<div className="flex flex-wrap gap-1.5">
						<button
							type="button"
							data-testid="tab-timeline"
							onClick={() => setActiveTab('timeline')}
							className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${
								activeTab === 'timeline' ? 'bg-blue-600 text-white' : 'border'
							}`}
							style={
								activeTab === 'timeline'
									? undefined
									: { borderColor: ds.surface.border, color: ds.text.secondary }
							}
						>
							<History size={13} aria-hidden="true" />
							<span>
								Archive (<BdiLtr mono>{events.length}</BdiLtr>)
							</span>
						</button>
						<button
							type="button"
							data-testid="tab-analytics"
							onClick={() => setActiveTab('analytics')}
							className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${
								activeTab === 'analytics' ? 'bg-blue-600 text-white' : 'border'
							}`}
							style={
								activeTab === 'analytics'
									? undefined
									: { borderColor: ds.surface.border, color: ds.text.secondary }
							}
						>
							<Activity size={13} aria-hidden="true" />
							<span>
								Source Health (<BdiLtr mono>{providers.length}</BdiLtr>)
							</span>
						</button>
					</div>

					{activeTab === 'timeline' && (
						<select
							data-testid="archive-type-filter"
							aria-label="Filter archive by hazard type"
							value={typeFilter}
							onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
							className="min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-semibold border"
							style={{
								background: ds.surface.overlay,
								borderColor: ds.surface.border,
								color: ds.text.primary,
							}}
						>
							<option value="all" style={{ background: '#111827', color: '#fff' }}>
								All Hazards
							</option>
							<option value="fire" style={{ background: '#111827', color: '#fff' }}>
								Wildfires
							</option>
							<option value="earthquake" style={{ background: '#111827', color: '#fff' }}>
								Earthquakes
							</option>
							<option value="volcano" style={{ background: '#111827', color: '#fff' }}>
								Volcanoes
							</option>
						</select>
					)}
				</div>

				{/* Non-scrolling Playback Bar when Timeline has events */}
				{activeTab === 'timeline' && !loading && events.length > 0 && (
					<div
						data-testid="archive-playback-bar"
						className="shrink-0 px-4 sm:px-5 py-2.5 border-b flex flex-wrap items-center justify-between gap-2"
						style={{ background: ds.surface.overlay, borderColor: ds.surface.border }}
					>
						<div className="flex items-center gap-1.5">
							<button
								type="button"
								onClick={() => setPlayIndex((i) => Math.max(0, i - 1))}
								aria-label="Previous archived event"
								className="min-h-[34px] min-w-[34px] rounded-lg border flex items-center justify-center"
								style={{ borderColor: ds.surface.border }}
							>
								<SkipBack size={13} aria-hidden="true" />
							</button>
							<button
								type="button"
								data-testid="archive-play-toggle-btn"
								onClick={() => setPlaying((p) => !p)}
								aria-label={playing ? 'Pause playback' : 'Play playback'}
								className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white"
							>
								{playing ? (
									<Pause size={12} aria-hidden="true" />
								) : (
									<Play size={12} aria-hidden="true" />
								)}
								<span>{playing ? 'Pause' : 'Play'}</span>
							</button>
							<button
								type="button"
								onClick={() => setPlayIndex((i) => (i + 1) % events.length)}
								aria-label="Next archived event"
								className="min-h-[34px] min-w-[34px] rounded-lg border flex items-center justify-center"
								style={{ borderColor: ds.surface.border }}
							>
								<SkipForward size={13} aria-hidden="true" />
							</button>
							<BdiLtr mono className="text-xs ps-1">
								<span style={{ color: ds.text.secondary }}>
									{playIndex + 1} / {events.length}
								</span>
							</BdiLtr>
						</div>

						{currentEvent && (
							<button
								type="button"
								data-testid="archive-inspect-current-btn"
								onClick={() => focusOnMap(currentEvent)}
								className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white max-w-full"
							>
								<Crosshair size={13} className="shrink-0" aria-hidden="true" />
								<span className="truncate max-w-[180px] sm:max-w-[260px]">
									{t.inspectEventButton}: {currentEvent.title}
								</span>
							</button>
						)}
					</div>
				)}

				{/* Independently Scrolling Body */}
				<div
					data-testid="archive-scroll-body"
					className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-5 space-y-3"
				>
					{!storageAvailable && (
						<div className="rounded-lg p-3 border border-amber-500/40 bg-amber-500/10 text-xs text-amber-300">
							{note ?? 'Historical archive storage is not enabled on this deployment.'}
						</div>
					)}

					{errorMsg && (
						<div
							data-testid="archive-error-banner"
							className="rounded-lg p-3 border border-red-500/40 bg-red-500/10 text-xs text-red-300"
						>
							{errorMsg}
						</div>
					)}

					{loading ? (
						<p className="text-xs" style={{ color: ds.text.tertiary }}>
							Loading historical archive…
						</p>
					) : activeTab === 'timeline' ? (
						events.length === 0 ? (
							<p className="text-xs" style={{ color: ds.text.secondary }}>
								No archived events recorded yet for this filter. Live queries or bounded backfill will
								populate the archive.
							</p>
						) : (
							<ul className="space-y-2.5" data-testid="archive-events-list">
								{events.map((ev, idx) => {
									const meta = getHazardMeta(ev.type);
									const isCurrent = idx === playIndex;
									const isLive = ev.provenance === 'live_captured';

									return (
										<li
											key={ev.id}
											data-testid={`archive-row-${ev.id}`}
											className="rounded-xl p-3.5 border text-xs space-y-2"
											style={{
												background: isCurrent
													? 'rgba(37, 99, 235, 0.14)'
													: ds.surface.overlay,
												borderColor: isCurrent
													? 'rgba(59, 130, 246, 0.6)'
													: ds.surface.borderSubtle,
											}}
										>
											<div className="flex flex-wrap items-start justify-between gap-2">
												<div className="min-w-0 flex-1 space-y-1">
													<div className="flex flex-wrap items-center gap-1.5">
														<span
															className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase"
															style={{
																background: `${meta.accentHex}22`,
																border: `1px solid ${meta.accentHex}55`,
															}}
														>
															<span aria-hidden="true">{meta.icon}</span>
															<span>{meta.typeLabel}</span>
														</span>
														<span
															className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
																isLive
																	? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
																	: 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
															}`}
														>
															{isLive ? (
																<CheckCircle2 size={10} aria-hidden="true" />
															) : (
																<RotateCcw size={10} aria-hidden="true" />
															)}
															<span>
																{isLive ? 'Live captured' : 'Reconstructed backfill'}
															</span>
														</span>
													</div>

													<div
														className="font-extrabold text-xs sm:text-sm leading-snug break-words"
														style={{ color: ds.text.primary }}
													>
														{ev.title}
													</div>
												</div>

												<button
													type="button"
													data-testid={`inspect-archive-${ev.id}`}
													onClick={() => focusOnMap(ev)}
													className="min-h-[36px] shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white"
												>
													<Crosshair size={12} aria-hidden="true" />
													<span>{t.inspectEventButton}</span>
												</button>
											</div>

											<div
												className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
												style={{ color: ds.text.secondary }}
											>
												<span>
													Event:{' '}
													<BdiLtr mono>
														{ev.eventTime.slice(0, 16).replace('T', ' ')} UTC
													</BdiLtr>
												</span>
												<span>Source: {ev.attribution}</span>
											</div>

											<details
												className="text-[11px] pt-1 border-t"
												style={{ borderColor: ds.surface.borderSubtle }}
											>
												<summary
													className="font-semibold select-none py-0.5"
													style={{ color: ds.text.tertiary }}
												>
													Details & revisions ({ev.revisions?.length ?? 1})
												</summary>
												<div
													className="mt-1.5 space-y-1"
													style={{ color: ds.text.tertiary }}
												>
													<div>
														First seen:{' '}
														<BdiLtr mono>
															{ev.firstSeenAt.slice(0, 16).replace('T', ' ')} UTC
														</BdiLtr>
													</div>
													{ev.gdacsMatchId && (
														<div>
															GDACS match: <BdiLtr mono>#{ev.gdacsMatchId}</BdiLtr>
														</div>
													)}
													{ev.revisions && ev.revisions.length > 0 && (
														<ul
															className="mt-1 ps-3 border-s space-y-1"
															style={{ borderColor: ds.surface.border }}
														>
															{ev.revisions.map((rv) => (
																<li key={`${ev.id}-rev-${rv.revisionNumber}`}>
																	<BdiLtr mono>
																		v{rv.revisionNumber} (
																		{rv.observedAt.slice(0, 16).replace('T', ' ')}{' '}
																		UTC)
																	</BdiLtr>
																	: {rv.title} · severity={rv.severity}
																</li>
															))}
														</ul>
													)}
												</div>
											</details>
										</li>
									);
								})}
							</ul>
						)
					) : providers.length === 0 ? (
						<p className="text-xs" style={{ color: ds.text.secondary }}>
							No provider telemetry runs recorded in D1 yet.
						</p>
					) : (
						<>
							{/* Desktop/Tablet Table */}
							<div className="hidden sm:block overflow-x-auto">
								<table className="w-full text-start text-xs border-collapse">
									<thead>
										<tr
											className="border-b"
											style={{ borderColor: ds.surface.border, color: ds.text.tertiary }}
										>
											<th className="py-2 pe-3 text-start">Provider</th>
											<th className="py-2 pe-3 text-start">OK / Runs</th>
											<th className="py-2 pe-3 text-start">Avg Latency</th>
											<th className="py-2 pe-3 text-start">Records / Rejected</th>
											<th className="py-2 text-start">Latest</th>
										</tr>
									</thead>
									<tbody>
										{providers.map((p) => (
											<tr
												key={p.provider}
												className="border-b"
												style={{ borderColor: ds.surface.borderSubtle }}
											>
												<td className="py-2 pe-3 font-bold uppercase">{p.provider}</td>
												<td className="py-2 pe-3">
													<BdiLtr mono>
														{p.okRuns} / {p.runs}
													</BdiLtr>
												</td>
												<td className="py-2 pe-3">
													<BdiLtr mono>
														{p.avgLatencyMs !== null ? `${p.avgLatencyMs} ms` : '—'}
													</BdiLtr>
												</td>
												<td className="py-2 pe-3">
													<BdiLtr mono>
														{p.totalRecords} / {p.totalRejected}
													</BdiLtr>
												</td>
												<td className="py-2">{p.lastStatus ?? '—'}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>

							{/* Phone Stacked Provider Cards */}
							<div className="sm:hidden space-y-2">
								{providers.map((p) => (
									<div
										key={`m-${p.provider}`}
										className="rounded-xl p-3 border text-xs space-y-1"
										style={{
											background: ds.surface.overlay,
											borderColor: ds.surface.borderSubtle,
										}}
									>
										<div className="flex items-center justify-between">
											<span className="font-bold uppercase">{p.provider}</span>
											<span className="text-[11px]" style={{ color: ds.text.secondary }}>
												{p.lastStatus ?? '—'}
											</span>
										</div>
										<div
											className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]"
											style={{ color: ds.text.tertiary }}
										>
											<span>
												Runs:{' '}
												<BdiLtr mono>
													{p.okRuns}/{p.runs}
												</BdiLtr>
											</span>
											<span>
												Latency:{' '}
												<BdiLtr mono>
													{p.avgLatencyMs !== null ? `${p.avgLatencyMs} ms` : '—'}
												</BdiLtr>
											</span>
											<span>
												Records:{' '}
												<BdiLtr mono>
													{p.totalRecords} ({p.totalRejected} rej)
												</BdiLtr>
											</span>
										</div>
									</div>
								))}
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
