import { useEffect, useState } from 'react';
import { X, History, Activity, Play, Pause, SkipBack, SkipForward, Crosshair } from 'lucide-react';
import type { Disaster } from '../types';
import type {
	ArchivedDisasterEvent as SharedArchivedEvent,
	ProviderHealthSummary as SharedProviderHealth,
} from '../../../shared/contracts';
import { fetchArchivedHistory, fetchSourceAnalytics } from '../utils/researchClient';
import { useDesignSystem } from '../hooks/useDesignSystem';

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
	const [expandedRevId, setExpandedRevId] = useState<string | null>(null);

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
		if (!playing || events.length === 0) return;
		const id = window.setInterval(() => {
			setPlayIndex((idx) => (idx + 1) % events.length);
		}, 1600);
		return () => window.clearInterval(id);
	}, [playing, events.length]);

	if (!isOpen) return null;

	const currentEvent = events[playIndex] ?? null;

	const focusOnMap = (ev: ArchivedRow) => {
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
		});
	};

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="timeline-analytics-title"
			data-testid="timeline-analytics-drawer"
			className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
		>
			<div
				className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden"
				style={{
					...ds.glass.panel,
					borderColor: ds.surface.border,
					color: ds.text.primary,
				}}
			>
				<div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: ds.surface.border }}>
					<div>
						<h2 id="timeline-analytics-title" className="text-base font-bold flex items-center gap-2">
							<History size={18} className="text-blue-400" aria-hidden="true" />
							<span>Historical Archive & Source Health</span>
						</h2>
						<p className="text-xs mt-0.5" style={{ color: ds.text.tertiary }}>
							Distinguishes live-captured observations from reconstructed backfill
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close timeline and analytics drawer"
						className="p-2 rounded-lg border"
						style={{ background: ds.surface.overlaySubtle, borderColor: ds.surface.border }}
					>
						<X size={16} />
					</button>
				</div>

				<div className="flex items-center justify-between gap-2 px-5 py-2.5 border-b" style={{ borderColor: ds.surface.borderSubtle }}>
					<div className="flex gap-2">
						<button
							type="button"
							data-testid="tab-timeline"
							onClick={() => setActiveTab('timeline')}
							className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${
								activeTab === 'timeline' ? 'bg-blue-600 text-white' : 'border border-slate-600'
							}`}
						>
							<History size={13} aria-hidden="true" />
							<span>Archive Playback ({events.length})</span>
						</button>
						<button
							type="button"
							data-testid="tab-analytics"
							onClick={() => setActiveTab('analytics')}
							className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${
								activeTab === 'analytics' ? 'bg-blue-600 text-white' : 'border border-slate-600'
							}`}
						>
							<Activity size={13} aria-hidden="true" />
							<span>Source Health ({providers.length})</span>
						</button>
					</div>

					{activeTab === 'timeline' && (
						<select
							aria-label="Filter archive by hazard type"
							value={typeFilter}
							onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
							className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border"
							style={{
								background: ds.surface.overlaySubtle,
								borderColor: ds.surface.border,
								color: ds.text.primary,
							}}
						>
							<option value="all" style={{ background: '#111827' }}>All Hazards</option>
							<option value="fire" style={{ background: '#111827' }}>Wildfires</option>
							<option value="earthquake" style={{ background: '#111827' }}>Earthquakes</option>
							<option value="volcano" style={{ background: '#111827' }}>Volcanoes</option>
						</select>
					)}
				</div>

				<div className="flex-1 overflow-y-auto p-5 space-y-4">
					{!storageAvailable && (
						<div className="rounded-lg p-3 border border-amber-500/40 bg-amber-500/10 text-xs text-amber-200">
							{note ?? 'D1 archive binding (AEGIS_DB) is not configured in this Worker environment.'}
						</div>
					)}

					{errorMsg && (
						<div className="rounded-lg p-3 border border-red-500/40 bg-red-500/10 text-xs text-red-200">
							{errorMsg}
						</div>
					)}

					{loading ? (
						<p className="text-xs" style={{ color: ds.text.tertiary }}>Loading D1 archive…</p>
					) : activeTab === 'timeline' ? (
						events.length === 0 ? (
							<p className="text-xs" style={{ color: ds.text.secondary }}>
								No archived events recorded yet for this filter. Live queries or bounded backfill will populate the archive.
							</p>
						) : (
							<>
								{/* Playback Bar */}
								<div
									className="rounded-xl p-3 border flex flex-wrap items-center justify-between gap-3"
									style={{ background: ds.surface.overlay, borderColor: ds.surface.border }}
								>
									<div className="flex items-center gap-2">
										<button
											type="button"
											onClick={() => setPlayIndex((i) => Math.max(0, i - 1))}
											aria-label="Previous archived event"
											className="p-1.5 rounded border border-slate-600"
										>
											<SkipBack size={13} />
										</button>
										<button
											type="button"
											onClick={() => setPlaying((p) => !p)}
											aria-label={playing ? 'Pause playback' : 'Play playback'}
											className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-bold bg-blue-600 text-white"
										>
											{playing ? <Pause size={12} /> : <Play size={12} />}
											<span>{playing ? 'Pause' : 'Play'}</span>
										</button>
										<button
											type="button"
											onClick={() => setPlayIndex((i) => (i + 1) % events.length)}
											aria-label="Next archived event"
											className="p-1.5 rounded border border-slate-600"
										>
											<SkipForward size={13} />
										</button>
										<span className="text-xs font-mono" style={{ color: ds.text.secondary }}>
											{playIndex + 1} / {events.length}
										</span>
									</div>

									{currentEvent && (
										<button
											type="button"
											onClick={() => focusOnMap(currentEvent)}
											className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
										>
											<Crosshair size={12} aria-hidden="true" />
											<span>Inspect Selected ({currentEvent.title.slice(0, 28)})</span>
										</button>
									)}
								</div>

								{/* Event list */}
								<ul className="space-y-2">
									{events.map((ev, idx) => (
										<li
											key={ev.id}
											className="rounded-xl p-3 border text-xs space-y-1.5"
											style={{
												background: idx === playIndex ? 'rgba(37, 99, 235, 0.12)' : ds.surface.overlay,
												borderColor: idx === playIndex ? 'rgba(59, 130, 246, 0.55)' : ds.surface.borderSubtle,
											}}
										>
											<div className="flex flex-wrap items-center justify-between gap-2">
												<div className="flex flex-wrap items-center gap-1.5">
													<span className="font-bold">{ev.title}</span>
													<span
														className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
															ev.provenance === 'live_captured'
																? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35'
																: 'bg-amber-500/20 text-amber-300 border border-amber-500/35'
														}`}
													>
														{ev.provenance === 'live_captured' ? 'Live captured' : 'Reconstructed backfill'}
													</span>
													{ev.gdacsMatchId && (
														<span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-700 text-slate-200">
															GDACS #{ev.gdacsMatchId}
														</span>
													)}
												</div>
												<button
													type="button"
													onClick={() => focusOnMap(ev)}
													className="text-[11px] font-semibold text-blue-300 hover:underline"
												>
													Fly to event
												</button>
											</div>

											<div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]" style={{ color: ds.text.secondary }}>
												<span>Event: {ev.eventTime.slice(0, 16).replace('T', ' ')} UTC</span>
												<span>First seen: {ev.firstSeenAt.slice(0, 16).replace('T', ' ')} UTC</span>
												<span>Source: {ev.attribution}</span>
												<span>Revisions: {ev.revisions?.length ?? 1}</span>
											</div>

											{ev.revisions && ev.revisions.length > 1 && (
												<div>
													<button
														type="button"
														onClick={() => setExpandedRevId(expandedRevId === ev.id ? null : ev.id)}
														className="text-[11px] underline"
														style={{ color: ds.colors.accent.blueLight }}
													>
														{expandedRevId === ev.id ? 'Hide revision trail' : 'Show revision trail'}
													</button>
													{expandedRevId === ev.id && (
														<ul className="mt-1.5 pl-3 border-l space-y-1 text-[11px]" style={{ borderColor: ds.surface.border }}>
															{ev.revisions.map((rv) => (
																<li key={`${ev.id}-rev-${rv.revisionNumber}`} style={{ color: ds.text.tertiary }}>
																	v{rv.revisionNumber} ({rv.observedAt.slice(0, 16).replace('T', ' ')} UTC):{' '}
																	{rv.title} · severity={rv.severity}
																</li>
															))}
														</ul>
													)}
												</div>
											)}
										</li>
									))}
								</ul>
							</>
						)
					) : providers.length === 0 ? (
						<p className="text-xs" style={{ color: ds.text.secondary }}>
							No provider telemetry runs recorded in D1 yet.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-left text-xs border-collapse">
								<thead>
									<tr className="border-b" style={{ borderColor: ds.surface.border, color: ds.text.tertiary }}>
										<th className="py-2 pr-3">Provider</th>
										<th className="py-2 pr-3">OK / Total Runs</th>
										<th className="py-2 pr-3">Avg Latency</th>
										<th className="py-2 pr-3">Records / Rejected</th>
										<th className="py-2 pr-3">Latest</th>
									</tr>
								</thead>
								<tbody>
									{providers.map((p) => (
										<tr key={p.provider} className="border-b" style={{ borderColor: ds.surface.borderSubtle }}>
											<td className="py-2 pr-3 font-bold uppercase">{p.provider}</td>
											<td className="py-2 pr-3 font-mono">{p.okRuns} / {p.runs}</td>
											<td className="py-2 pr-3 font-mono">{p.avgLatencyMs !== null ? `${p.avgLatencyMs} ms` : '—'}</td>
											<td className="py-2 pr-3 font-mono">{p.totalRecords} / {p.totalRejected}</td>
											<td className="py-2 pr-3">{p.lastStatus ?? '—'}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
