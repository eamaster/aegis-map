import { useEffect, useState } from 'react';
import {
	Flame,
	Mountain,
	Waves,
	RefreshCw,
	ChevronUp,
	ChevronDown,
	Clock,
	Radio,
	List,
} from 'lucide-react';
import { useDesignSystem } from '../hooks/useDesignSystem';
import { useLocale } from '../hooks/useLocale';
import { DEFAULT_OBSERVATION_WINDOW, DEFAULT_VOLCANO_MODE, OBSERVATION_WINDOWS } from '../config/disasters';
import type { Disaster, DisasterSourceStatus, ObservationWindow, VolcanoMode } from '../types';
import {
	describeDisasterSources,
	DISASTER_SCOPE,
	displayCategoryCount,
	formatFireCellsSubtitle,
	getFirmsStatusNotice,
} from '../utils/disasterSources';
import { formatPrimaryMetric, getHazardMeta } from '../utils/eventFormatters';
import { BdiLtr } from './BdiLtr';

interface DisasterCounts {
	fires: number;
	fireDetections?: number;
	fireCells?: number;
	volcanoes: number;
	earthquakes: number;
	total: number;
}

interface MapLegendProps {
	counts: DisasterCounts;
	lastUpdated?: Date;
	onRefresh?: () => void;
	isRefreshing?: boolean;
	activeFilters: Set<string>;
	onFilterToggle: (type: string) => void;
	sourceStatus?: DisasterSourceStatus | null;
	loadFailed?: boolean;
	observationWindow?: ObservationWindow;
	onObservationWindowChange?: (window: ObservationWindow) => void;
	volcanoMode?: VolcanoMode;
	onVolcanoModeChange?: (mode: VolcanoMode) => void;
	isV2?: boolean;
	events?: Disaster[];
	selectedDisasterId?: string | null;
	onSelectDisaster?: (disaster: Disaster) => void;
}

export default function MapLegend({
	counts,
	lastUpdated,
	onRefresh,
	isRefreshing = false,
	activeFilters,
	onFilterToggle,
	sourceStatus = null,
	loadFailed = false,
	observationWindow = DEFAULT_OBSERVATION_WINDOW,
	onObservationWindowChange,
	volcanoMode = DEFAULT_VOLCANO_MODE,
	onVolcanoModeChange,
	isV2 = true,
	events = [],
	selectedDisasterId = null,
	onSelectDisaster,
}: MapLegendProps) {
	const { t } = useLocale();
	const ds = useDesignSystem();
	const [viewportWidth, setViewportWidth] = useState(
		typeof window !== 'undefined' ? window.innerWidth : 1280,
	);
	const [desktopExpanded, setDesktopExpanded] = useState(true);
	const [mobileIdleExpanded, setMobileIdleExpanded] = useState(false);
	const [expandedForSelectionId, setExpandedForSelectionId] = useState<string | null>(null);
	const [showEventList, setShowEventList] = useState(false);

	useEffect(() => {
		const handleResize = () => {
			setViewportWidth(window.innerWidth);
		};
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	}, []);

	const isMobile = viewportWidth < 768;
	// On phones and narrow tablets (<1024px) where an open inspector narrows the map,
	// auto-collapse the legend to a compact pill on selection so the marker and pinned bubble stay unobstructed.
	const collapseOnSelection = viewportWidth < 1024;

	const isExpanded = showEventList
		? true
		: selectedDisasterId && collapseOnSelection
			? expandedForSelectionId === selectedDisasterId
			: isMobile
				? mobileIdleExpanded
				: desktopExpanded;

	const setLegendExpanded = (next: boolean) => {
		if (!next) {
			setShowEventList(false);
		}
		if (selectedDisasterId && collapseOnSelection) {
			setExpandedForSelectionId(next ? selectedDisasterId : null);
		} else if (isMobile) {
			setMobileIdleExpanded(next);
		} else {
			setDesktopExpanded(next);
		}
	};

	const sourceNotice = loadFailed
		? counts.total > 0
			? 'Latest refresh failed. Showing previously loaded events.'
			: 'Disaster data unavailable. Try refreshing.'
		: describeDisasterSources(sourceStatus);
	const dataState = loadFailed
		? 'failed'
		: sourceStatus?.partial
			? 'partial'
			: sourceStatus
				? 'complete'
				: 'unknown';

	const formatTime = (date: Date) => {
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		const diffHours = Math.floor(diffMins / 60);
		if (diffHours < 24) return `${diffHours}h ago`;
		return date.toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	};

	const isActive = (type: string) => activeFilters.has(type);
	const getDisasterColor = (type: 'fire' | 'fire_detection' | 'volcano' | 'earthquake') =>
		ds.colors.disaster[type];

	const addOpacity = (hex: string, opacity: number) => {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
	};

	const browseItems = events.slice(0, 24);

	return (
		<div
			className="legend-responsive"
			data-testid="map-legend"
			data-disaster-state={dataState}
			data-source-eonet={sourceStatus?.eonet ?? 'unknown'}
			data-source-usgs={sourceStatus?.usgs ?? 'unknown'}
			data-total={counts.total}
			data-count-fire={counts.fires}
			data-count-volcano={counts.volcanoes}
			data-count-earthquake={counts.earthquakes}
		>
			{!isExpanded ? (
				<button
					type="button"
					data-testid="expand-legend-btn"
					onClick={() => setLegendExpanded(true)}
					aria-expanded="false"
					aria-label={`Expand Live Monitor (${counts.total} active events)`}
					className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 rounded-xl transition-colors"
					style={{
						...ds.glass.panel,
						border: `1.5px solid ${addOpacity(ds.colors.accent.blue, 40)}`,
						boxShadow: ds.isDark
							? '0 8px 24px rgba(0, 0, 0, 0.7)'
							: '0 8px 24px rgba(15, 23, 42, 0.18)',
						color: ds.text.primary,
					}}
				>
					<span
						className="w-2 h-2 rounded-full shrink-0"
						style={{
							background: sourceNotice ? ds.colors.status.warning : ds.colors.status.success,
						}}
						aria-hidden="true"
					/>
					<BdiLtr mono className="font-black text-sm">
						{counts.total.toLocaleString()}
					</BdiLtr>
					<span className="text-xs font-bold" style={{ color: ds.text.secondary }}>
						Live
					</span>
					<ChevronDown size={14} style={{ color: ds.text.primary }} aria-hidden="true" />
				</button>
			) : (
				<div
					className="w-full max-h-[calc(100dvh-120px)] flex flex-col overflow-hidden"
					style={{
						...ds.glass.panel,
						borderRadius: ds.borderRadius.panel,
						border: `1.5px solid ${addOpacity(ds.colors.accent.blue, 40)}`,
						boxShadow: ds.isDark
							? '0 8px 32px rgba(0, 0, 0, 0.85)'
							: '0 8px 32px rgba(15, 23, 42, 0.2)',
					}}
				>
					{/* Header */}
					<div
						className="shrink-0 flex items-center justify-between gap-2 px-3.5 py-2.5 border-b"
						style={{
							borderColor: addOpacity(ds.colors.accent.blue, 28),
						}}
					>
						<div className="flex items-center gap-2">
							<span
								className="w-2 h-2 rounded-full shrink-0"
								style={{
									background: sourceNotice ? ds.colors.status.warning : ds.colors.status.success,
								}}
								aria-hidden="true"
							/>
							<span
								className="text-[11px] font-extrabold uppercase tracking-wider"
								style={{ color: ds.text.primary }}
							>
								Live Monitor
							</span>
						</div>
						<button
							type="button"
							data-testid="collapse-legend-btn"
							onClick={() => setLegendExpanded(false)}
							aria-expanded="true"
							aria-label="Collapse legend"
							className="min-h-[32px] min-w-[32px] rounded-lg flex items-center justify-center"
							style={{
								color: ds.text.primary,
								background: ds.surface.overlaySubtle,
								border: `1px solid ${ds.surface.border}`,
							}}
						>
							<ChevronUp size={14} strokeWidth={2.5} aria-hidden="true" />
						</button>
					</div>

					{/* Scrollable Body */}
					<div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3.5 py-3 space-y-2.5">
						<div>
							<BdiLtr
								mono
								className="block text-2xl font-black leading-none tracking-tight"
							>
								{counts.total.toLocaleString()}
							</BdiLtr>
							<span
								className="block text-xs font-bold mt-1"
								style={{ color: ds.text.secondary }}
							>
								Active Events
							</span>
							{sourceNotice && (
								<span
									data-testid="disaster-source-notice"
									role="status"
									className="block text-[11px] font-semibold mt-1.5 leading-snug"
									style={{ color: ds.colors.status.warning }}
								>
									{sourceNotice}
								</span>
							)}
						</div>

						{!isV2 && (
							<div
								data-testid="legacy-data-notice"
								className="px-2.5 py-1.5 rounded-md text-[11px] font-bold leading-snug"
								style={{
									background: addOpacity(ds.colors.status.warning, 15),
									border: `1px solid ${addOpacity(ds.colors.status.warning, 40)}`,
									color: ds.colors.status.warning,
								}}
							>
								{observationWindow === '7d'
									? 'Legacy (7d): quakes ~24h only; hotspots off'
									: 'Legacy (24h): satellite hotspots off'}
							</div>
						)}

						{isV2 && (sourceStatus?.firms === 'warming' || sourceStatus?.firms === 'unavailable') && (
							<div
								data-testid="firms-status-notice"
								className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold leading-snug"
								style={{
									background: addOpacity(ds.colors.status.warning, 12),
									border: `1px solid ${addOpacity(ds.colors.status.warning, 30)}`,
									color: ds.colors.status.warning,
								}}
							>
								{getFirmsStatusNotice(sourceStatus, isV2)}
							</div>
						)}

						{/* Window & Context Controls */}
						<div className="space-y-1.5">
							<div className="flex items-center justify-between gap-2">
								<div
									className="flex items-center gap-1 text-[11px] font-bold"
									style={{ color: ds.text.secondary }}
								>
									<Clock size={12} strokeWidth={2.5} aria-hidden="true" />
									<span>Window</span>
								</div>
								<div
									data-testid="window-toggle-container"
									className="flex gap-0.5 p-0.5 rounded-md border"
									style={{
										background: ds.surface.overlaySubtle,
										borderColor: ds.surface.border,
									}}
								>
									{OBSERVATION_WINDOWS.map((win) => (
										<button
											key={win}
											type="button"
											onClick={() => onObservationWindowChange?.(win)}
											className="min-h-[26px] px-2 rounded text-[11px] font-bold transition-colors"
											style={{
												background:
													observationWindow === win ? ds.colors.accent.blue : 'transparent',
												color: observationWindow === win ? '#ffffff' : ds.text.secondary,
											}}
										>
											<BdiLtr>{win}</BdiLtr>
										</button>
									))}
								</div>
							</div>

							<div className="flex items-center justify-between gap-2">
								<span className="text-[11px] font-semibold" style={{ color: ds.text.tertiary }}>
									Scope
								</span>
								<button
									type="button"
									onClick={() =>
										onVolcanoModeChange?.(volcanoMode === 'context' ? 'strict' : 'context')
									}
									className="min-h-[26px] px-2 rounded text-[11px] font-semibold border"
									style={{
										background: ds.surface.overlaySubtle,
										borderColor: ds.surface.border,
										color:
											volcanoMode === 'context'
												? ds.colors.accent.blueLight
												: ds.text.secondary,
									}}
									title="Toggle between all active open EONET incidents and strict time-window filtering"
								>
									{volcanoMode === 'context' ? 'Active' : 'Strict'}
								</button>
							</div>
						</div>

						{/* Disaster Type Filter Rows */}
						<div className="space-y-1.5">
							{/* Wildfires */}
							<button
								type="button"
								onClick={() => onFilterToggle('fire')}
								aria-pressed={isActive('fire')}
								aria-label={`Toggle wildfires filter - ${counts.fires} active`}
								className="w-full text-start rounded-lg px-3 py-2 border flex items-center justify-between gap-2.5 transition-opacity"
								style={{
									background: isActive('fire')
										? addOpacity(getDisasterColor('fire'), 15)
										: ds.surface.overlay,
									borderColor: isActive('fire')
										? addOpacity(getDisasterColor('fire'), 45)
										: ds.surface.border,
									opacity: isActive('fire') ? 1 : 0.65,
								}}
							>
								<div className="flex items-center gap-2.5 min-w-0">
									<div
										className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
										style={{
											background: isActive('fire')
												? getDisasterColor('fire')
												: ds.surface.overlaySubtle,
										}}
									>
										<Flame
											size={14}
											strokeWidth={2.5}
											style={{ color: isActive('fire') ? '#ffffff' : ds.text.secondary }}
											aria-hidden="true"
										/>
									</div>
									<div className="flex flex-col min-w-0">
										<span
											className="text-xs font-bold truncate"
											style={{ color: isActive('fire') ? ds.text.primary : ds.text.secondary }}
										>
											Wildfires
										</span>
										<span className="text-[10px] truncate" style={{ color: ds.text.tertiary }}>
											{volcanoMode === 'context'
												? 'NASA EONET · Open'
												: `NASA EONET · ${observationWindow}`}
										</span>
									</div>
								</div>
								<BdiLtr
									mono
									className="text-sm font-extrabold shrink-0"
								>
									<span
										style={{
											color: isActive('fire') ? getDisasterColor('fire') : ds.text.tertiary,
											marginInlineStart: 'auto',
										}}
									>
										{displayCategoryCount(counts.fires, 'fire', sourceStatus, loadFailed)}
									</span>
								</BdiLtr>
							</button>

							{/* Satellite Hotspots */}
							<button
								type="button"
								onClick={() => isV2 && onFilterToggle('fire_detection')}
								disabled={!isV2}
								aria-pressed={isActive('fire_detection')}
								aria-label={`Toggle satellite hotspots filter - ${counts.fireDetections ?? 0} active`}
								className="w-full text-start rounded-lg px-3 py-2 border flex items-center justify-between gap-2.5 transition-opacity disabled:cursor-not-allowed"
								style={{
									background: isActive('fire_detection')
										? addOpacity(getDisasterColor('fire_detection'), 15)
										: ds.surface.overlay,
									borderColor: isActive('fire_detection')
										? addOpacity(getDisasterColor('fire_detection'), 45)
										: ds.surface.border,
									opacity: isV2 ? (isActive('fire_detection') ? 1 : 0.65) : 0.45,
								}}
							>
								<div className="flex items-center gap-2.5 min-w-0">
									<div
										className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
										style={{
											background: isActive('fire_detection')
												? getDisasterColor('fire_detection')
												: ds.surface.overlaySubtle,
										}}
									>
										<Radio
											size={14}
											strokeWidth={2.5}
											style={{
												color: isActive('fire_detection') ? '#ffffff' : ds.text.secondary,
											}}
											aria-hidden="true"
										/>
									</div>
									<div className="flex flex-col min-w-0">
										<span
											className="text-xs font-bold truncate"
											style={{
												color: isActive('fire_detection')
													? ds.text.primary
													: ds.text.secondary,
											}}
										>
											Satellite Hotspots
										</span>
										<span
											data-testid="satellite-hotspots-subtitle"
											className="text-[10px] truncate"
											style={{ color: ds.text.tertiary }}
										>
											{formatFireCellsSubtitle(counts.fireCells, sourceStatus, isV2)}
										</span>
									</div>
								</div>
								<span
									data-testid="satellite-hotspots-count"
									className="text-sm font-extrabold font-mono tabular-nums shrink-0"
									style={{
										color: isActive('fire_detection')
											? getDisasterColor('fire_detection')
											: ds.text.tertiary,
										marginInlineStart: 'auto',
									}}
								>
									<BdiLtr mono>
										{displayCategoryCount(
											counts.fireDetections ?? 0,
											'fire_detection',
											sourceStatus,
											loadFailed,
											isV2,
										)}
									</BdiLtr>
								</span>
							</button>

							{/* Volcanoes */}
							<button
								type="button"
								onClick={() => onFilterToggle('volcano')}
								aria-pressed={isActive('volcano')}
								aria-label={`Toggle volcanoes filter - ${counts.volcanoes} active`}
								className="w-full text-start rounded-lg px-3 py-2 border flex items-center justify-between gap-2.5 transition-opacity"
								style={{
									background: isActive('volcano')
										? addOpacity(getDisasterColor('volcano'), 15)
										: ds.surface.overlay,
									borderColor: isActive('volcano')
										? addOpacity(getDisasterColor('volcano'), 45)
										: ds.surface.border,
									opacity: isActive('volcano') ? 1 : 0.65,
								}}
							>
								<div className="flex items-center gap-2.5 min-w-0">
									<div
										className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
										style={{
											background: isActive('volcano')
												? getDisasterColor('volcano')
												: ds.surface.overlaySubtle,
										}}
									>
										<Mountain
											size={14}
											strokeWidth={2.5}
											style={{ color: isActive('volcano') ? '#ffffff' : ds.text.secondary }}
											aria-hidden="true"
										/>
									</div>
									<span
										className="text-xs font-bold truncate"
										style={{ color: isActive('volcano') ? ds.text.primary : ds.text.secondary }}
									>
										Volcanoes
									</span>
								</div>
								<BdiLtr mono className="text-sm font-extrabold shrink-0">
									<span
										style={{
											color: isActive('volcano')
												? getDisasterColor('volcano')
												: ds.text.tertiary,
										}}
									>
										{displayCategoryCount(counts.volcanoes, 'volcano', sourceStatus, loadFailed)}
									</span>
								</BdiLtr>
							</button>

							{/* Earthquakes */}
							<button
								type="button"
								onClick={() => onFilterToggle('earthquake')}
								aria-pressed={isActive('earthquake')}
								aria-label={`Toggle earthquakes filter - ${counts.earthquakes} active`}
								className="w-full text-start rounded-lg px-3 py-2 border flex items-center justify-between gap-2.5 transition-opacity"
								style={{
									background: isActive('earthquake')
										? addOpacity(getDisasterColor('earthquake'), 15)
										: ds.surface.overlay,
									borderColor: isActive('earthquake')
										? addOpacity(getDisasterColor('earthquake'), 45)
										: ds.surface.border,
									opacity: isActive('earthquake') ? 1 : 0.65,
								}}
							>
								<div className="flex items-center gap-2.5 min-w-0">
									<div
										className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
										style={{
											background: isActive('earthquake')
												? getDisasterColor('earthquake')
												: ds.surface.overlaySubtle,
										}}
									>
										<Waves
											size={14}
											strokeWidth={2.5}
											style={{ color: isActive('earthquake') ? '#ffffff' : ds.text.secondary }}
											aria-hidden="true"
										/>
									</div>
									<span
										className="text-xs font-bold truncate"
										style={{
											color: isActive('earthquake') ? ds.text.primary : ds.text.secondary,
										}}
									>
										Earthquakes
									</span>
								</div>
								<BdiLtr mono className="text-sm font-extrabold shrink-0">
									<span
										style={{
											color: isActive('earthquake')
												? getDisasterColor('earthquake')
												: ds.text.tertiary,
										}}
									>
										{displayCategoryCount(
											counts.earthquakes,
											'earthquake',
											sourceStatus,
											loadFailed,
										)}
									</span>
								</BdiLtr>
							</button>
						</div>

						{/* Keyboard-Accessible Event List Disclosure */}
						{onSelectDisaster && browseItems.length > 0 && (
							<div className="pt-1 border-t" style={{ borderColor: ds.surface.borderSubtle }}>
								<button
									type="button"
									data-testid="legend-event-list-toggle"
									aria-expanded={showEventList}
									onClick={() => setShowEventList((v) => !v)}
									className="w-full min-h-[34px] px-2.5 py-1.5 rounded-lg border text-xs font-bold flex items-center justify-between gap-2"
									style={{
										background: ds.surface.overlaySubtle,
										borderColor: ds.surface.border,
										color: ds.text.primary,
									}}
								>
									<span className="inline-flex items-center gap-1.5">
										<List size={13} aria-hidden="true" />
										<span>{t.browseEventsListLabel}</span>
									</span>
									<BdiLtr mono className="text-[11px]" >
										{browseItems.length}
									</BdiLtr>
								</button>

								{showEventList && (
									<ul
										data-testid="legend-event-list"
										className="mt-1.5 max-h-40 overflow-y-auto custom-scrollbar space-y-1"
									>
										{browseItems.map((ev) => {
											const meta = getHazardMeta(ev.type);
											const metric = formatPrimaryMetric(ev);
											const isSel = selectedDisasterId === ev.id;
											return (
												<li key={ev.id}>
													<button
														type="button"
														data-testid={`legend-event-item-${ev.id}`}
														onClick={() => onSelectDisaster(ev)}
														aria-current={isSel ? 'true' : undefined}
														className="w-full text-start px-2.5 py-1.5 rounded-md border text-[11px] flex items-center justify-between gap-2"
														style={{
															background: isSel
																? 'rgba(37, 99, 235, 0.2)'
																: ds.surface.overlay,
															borderColor: isSel
																? 'rgba(96, 165, 250, 0.6)'
																: ds.surface.borderSubtle,
															color: ds.text.primary,
														}}
													>
														<span className="truncate font-semibold">
															<span aria-hidden="true">{meta.icon} </span>
															{ev.type === 'fire_detection'
																? 'Thermal Hotspot Cell'
																: ev.title}
														</span>
														{metric && (
															<BdiLtr mono className="text-[10px] shrink-0 opacity-80">
																{metric}
															</BdiLtr>
														)}
													</button>
												</li>
											);
										})}
									</ul>
								)}
							</div>
						)}

						<p
							data-testid="legend-scope"
							className="text-[10px] leading-relaxed"
							style={{ color: ds.text.tertiary }}
						>
							{DISASTER_SCOPE.fire} · {DISASTER_SCOPE.volcano} · {DISASTER_SCOPE.earthquake}
						</p>
					</div>

					{/* Footer */}
					<div
						className="shrink-0 flex items-center justify-between gap-2 px-3.5 py-2 border-t"
						style={{
							borderColor: addOpacity(ds.colors.accent.blue, 28),
							background: ds.surface.overlaySubtle,
						}}
					>
						<div className="flex items-center gap-1.5 text-[11px]">
							<span className="font-semibold" style={{ color: ds.text.secondary }}>
								Updated
							</span>
							<BdiLtr className="font-bold">
								<span style={{ color: ds.text.primary }}>
									{lastUpdated ? formatTime(lastUpdated) : 'Just now'}
								</span>
							</BdiLtr>
						</div>
						{onRefresh && (
							<button
								type="button"
								data-testid="refresh-disasters-btn"
								onClick={onRefresh}
								disabled={isRefreshing}
								className="min-h-[32px] min-w-[32px] rounded-lg flex items-center justify-center disabled:opacity-40"
								style={{
									background: addOpacity(ds.colors.accent.blue, 20),
									border: `1px solid ${addOpacity(ds.colors.accent.blue, 45)}`,
								}}
								title="Refresh data"
								aria-label="Refresh disaster data"
							>
								<RefreshCw
									size={13}
									className={isRefreshing ? 'animate-spin' : ''}
									style={{ color: ds.colors.accent.blueLight }}
									strokeWidth={2.5}
									aria-hidden="true"
								/>
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
