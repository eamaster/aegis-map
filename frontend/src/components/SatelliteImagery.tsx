import { useState, useEffect, useMemo } from 'react';
import { Satellite, Download, ExternalLink, Flame, AlertCircle, MapPin } from 'lucide-react';
import { canonicalizeFirmsSatellite } from '../../../shared/contracts';
import { useDesignSystem } from '../hooks/useDesignSystem';
import { apiUrl } from '../config/api';
import type { FireDetectionCell } from '../types';
import {
	createHotspotLoader,
	fireDisplayState,
	summarizeVisibleHotspots,
	type FireHotspotState,
} from '../utils/fireHotspots';
import { buildImagerySpec, hotspotImagePosition, type ImageryLayer } from '../utils/gibsImagery';
import { GIBS_WMS_THERMAL_LAYERS } from '../config/gibs';
import { BdiLtr } from './BdiLtr';

interface SatelliteImageryProps {
	disasterId?: string;
	lat: number;
	lng: number;
	disasterType: 'fire' | 'volcano' | 'earthquake';
	isHotspotCell?: boolean;
	detectionCell?: FireDetectionCell;
	date?: string;
	title: string;
}

const MAX_MARKERS = 30;

const fireHotspotsUrl = (lat: number, lng: number, sources?: readonly string[]) => {
	const base = `/api/fire-hotspots?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`;
	if (sources && sources.length > 0) {
		return apiUrl(`${base}&sources=${encodeURIComponent(sources.join(','))}`);
	}
	return apiUrl(base);
};

const getWorldviewLayers = (type: string): string => {
	switch (type) {
		case 'fire':
			return GIBS_WMS_THERMAL_LAYERS;
		case 'volcano':
			return 'ASTER_Volcanic_Sulfur_Dioxide_Index,MODIS_Terra_CorrectedReflectance_Bands721,MODIS_Aqua_CorrectedReflectance_Bands721,Coastlines_15m';
		case 'earthquake':
			return 'MODIS_Terra_CorrectedReflectance_Bands721,Landsat_WELD_CorrectedReflectance_Bands721_Global_Annual,Coastlines_15m';
		default:
			return 'Reference_Labels_15m,Coastlines_15m';
	}
};

const getConfidenceColor = (conf: string | null): string => {
	if (conf === 'h') return 'bg-red-500';
	if (conf === 'n') return 'bg-orange-500';
	return 'bg-yellow-500';
};

export default function SatelliteImagery({
	disasterId,
	lat,
	lng,
	disasterType,
	isHotspotCell = false,
	detectionCell,
	date,
	title,
}: SatelliteImageryProps) {
	const ds = useDesignSystem();
	const [selectedLayer, setSelectedLayer] = useState<ImageryLayer>(() => (isHotspotCell ? 'fire' : 'visual'));
	const [fireState, setFireState] = useState<FireHotspotState>({ state: 'idle' });
	const [loader] = useState(() =>
		createHotspotLoader(fireHotspotsUrl, (input, init) => fetch(input, init), setFireState),
	);
	const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const [overlayFailedUrl, setOverlayFailedUrl] = useState<string | null>(null);
	const [overlayLoadedUrl, setOverlayLoadedUrl] = useState<string | null>(null);
	const [mountedAt] = useState(() => Date.now());

	useEffect(() => {
		if (disasterType !== 'fire') {
			loader.cancel();
			return;
		}
		loader.load(lat, lng);
		return () => loader.cancel();
	}, [lat, lng, disasterType, loader]);

	const spec = useMemo(
		() => buildImagerySpec(selectedLayer, lat, lng, new Date(), import.meta.env.VITE_MAPBOX_TOKEN ?? ''),
		[selectedLayer, lat, lng],
	);

	const worldviewUrl = useMemo(() => {
		const day = buildImagerySpec('falsecolor', lat, lng, new Date(), '').date;
		return `https://worldview.earthdata.nasa.gov/?v=${lng - 1.5},${lat - 1.5},${lng + 1.5},${lat + 1.5}&t=${day}&l=${getWorldviewLayers(disasterType)}`;
	}, [lat, lng, disasterType]);

	const imageStatus: 'loading' | 'loaded' | 'error' =
		failedUrl === spec.url ? 'error' : loadedUrl === spec.url ? 'loaded' : 'loading';
	const overlayUrl = spec.overlay?.url ?? null;
	const overlayStatus: 'none' | 'not-rendered' | 'loading' | 'loaded' | 'error' = !overlayUrl
		? 'none'
		: overlayFailedUrl === overlayUrl
			? 'error'
			: overlayLoadedUrl === overlayUrl
				? 'loaded'
				: imageStatus === 'error'
					? 'not-rendered'
					: 'loading';

	const effectiveFire: FireHotspotState = disasterType === 'fire' ? fireState : { state: 'idle' };
	const fireDisplay = fireDisplayState(effectiveFire);
	const loadedFire = effectiveFire.state === 'loaded' ? effectiveFire : null;
	const coverage =
		loadedFire?.data.coverage ??
		(effectiveFire.state === 'unavailable' ? effectiveFire.coverage ?? null : null);
	const visibleHotspots = useMemo(() => loadedFire?.visible ?? [], [loadedFire]);
	const fireSummary = useMemo(() => summarizeVisibleHotspots(visibleHotspots), [visibleHotspots]);

	const { markers, offImage } = useMemo(() => {
		if (selectedLayer !== 'fire' || spec.halfSizeDeg === null) return { markers: [], offImage: 0 };
		const half = spec.halfSizeDeg;
		const placed = visibleHotspots
			.map((h) => ({ h, pos: hotspotImagePosition(h, lat, lng, half) }))
			.filter(
				(
					m,
				): m is {
					h: (typeof visibleHotspots)[number];
					pos: { leftPct: number; topPct: number };
				} => m.pos !== null,
			);
		return { markers: placed.slice(0, MAX_MARKERS), offImage: visibleHotspots.length - placed.length };
	}, [visibleHotspots, selectedLayer, spec.halfSizeDeg, lat, lng]);

	const cellFootprintRect = useMemo(() => {
		if (!detectionCell?.bounds || selectedLayer !== 'fire' || spec.halfSizeDeg === null) return null;
		const [west, south, east, north] = detectionCell.bounds;
		const half = spec.halfSizeDeg;
		const left = Math.max(0, Math.min(100, 50 + ((west - lng) / (2 * half)) * 100));
		const right = Math.max(0, Math.min(100, 50 + ((east - lng) / (2 * half)) * 100));
		const top = Math.max(0, Math.min(100, 50 - ((north - lat) / (2 * half)) * 100));
		const bottom = Math.max(0, Math.min(100, 50 - ((south - lat) / (2 * half)) * 100));
		const width = Math.max(0, right - left);
		const height = Math.max(0, bottom - top);
		if (width <= 0 || height <= 0) return null;
		return { leftPct: left, topPct: top, widthPct: width, heightPct: height };
	}, [detectionCell, selectedLayer, spec.halfSizeDeg, lat, lng]);

	const satelliteBreakdown = useMemo(() => {
		const counts = new Map<string, number>();
		if (visibleHotspots.length > 0) {
			for (const h of visibleHotspots) {
				const sat = canonicalizeFirmsSatellite(h.satellite);
				counts.set(sat, (counts.get(sat) ?? 0) + 1);
			}
		} else if (detectionCell?.satelliteCounts && !loadedFire) {
			for (const [rawSat, cnt] of Object.entries(detectionCell.satelliteCounts)) {
				if (cnt > 0) {
					const sat = canonicalizeFirmsSatellite(rawSat);
					counts.set(sat, (counts.get(sat) ?? 0) + cnt);
				}
			}
		}
		return Array.from(counts.entries());
	}, [visibleHotspots, detectionCell, loadedFire]);

	const failedSensorLabels = useMemo(() => {
		const raw = loadedFire?.data.failedSources ?? [];
		return raw.map((s) => canonicalizeFirmsSatellite(s));
	}, [loadedFire]);

	const windowLabel = coverage ? `${coverage.requestedStart} – ${coverage.requestedEnd} UTC` : '';
	const eventDateMs = date ? Date.parse(date) : NaN;
	const reportedEventDay = Number.isFinite(eventDateMs)
		? new Date(eventDateMs).toISOString().slice(0, 10)
		: null;
	const daysSinceDetection = Number.isFinite(eventDateMs)
		? Math.floor((mountedAt - eventDateMs) / (1000 * 60 * 60 * 24))
		: null;

	const markImageLoaded =
		(url: string, setter: (url: string) => void = setLoadedUrl) =>
		(el: HTMLImageElement | null) => {
			if (el && el.complete && el.naturalHeight !== 0) setter(url);
		};

	return (
		<div
			className="relative overflow-hidden rounded-xl p-3.5 border space-y-3"
			data-testid="satellite-imagery"
			data-disaster-id={disasterId ?? ''}
			data-firms-state={disasterType === 'fire' ? fireDisplay : 'not-applicable'}
			data-firms-coverage={coverage?.status ?? ''}
			data-firms-window={coverage ? `${coverage.requestedStart}/${coverage.requestedEnd}` : ''}
			data-firms-total={loadedFire ? String(loadedFire.data.totalCount) : ''}
			data-firms-visible={loadedFire ? String(loadedFire.visible.length) : ''}
			data-firms-sensor={
				loadedFire?.data.source ??
				(effectiveFire.state === 'unavailable' ? effectiveFire.source ?? '' : '')
			}
			data-imagery-layer={spec.layer}
			data-imagery-product={spec.product}
			data-imagery-date={spec.date ?? ''}
			data-imagery-overlay-product={spec.overlay?.product ?? ''}
			data-imagery-overlay-date={spec.overlay?.date ?? ''}
			data-imagery-overlay-status={overlayStatus}
			data-imagery-status={imageStatus}
			data-imagery-limitation={spec.limitation ?? ''}
			data-imagery-markers={String(markers.length)}
			style={{
				background: ds.surface.overlay,
				borderColor: ds.surface.border,
			}}
		>
			{/* Header */}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Satellite size={15} style={{ color: ds.colors.accent.blueLight }} aria-hidden="true" />
					<h3 className="text-xs sm:text-sm font-bold" style={{ color: ds.text.primary }}>
						{disasterType === 'fire' ? 'Fire Intelligence & Imagery' : 'Satellite Imagery'}
					</h3>
				</div>
				<span
					className="uppercase font-semibold text-[10px] tracking-wider"
					style={{ color: ds.text.tertiary }}
				>
					{spec.provider} ·{' '}
					{spec.layer === 'falsecolor'
						? 'MODIS 7-2-1'
						: spec.layer === 'fire'
							? 'MODIS + VIIRS'
							: 'Undated basemap'}
				</span>
			</div>

			{/* Explicit Temporal Provenance Strip: Requested Imagery Date vs Reported Event Date */}
			<div
				className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] px-2.5 py-1.5 rounded-lg border"
				style={{
					background: ds.surface.overlaySubtle,
					borderColor: ds.surface.borderSubtle,
					color: ds.text.secondary,
				}}
			>
				<span>
					Imagery date:{' '}
					<strong style={{ color: ds.text.primary }}>
						{spec.date ? <BdiLtr mono>{spec.date} UTC</BdiLtr> : 'Undated basemap'}
					</strong>
				</span>
				{reportedEventDay && (
					<span>
						Reported event: <BdiLtr mono>{reportedEventDay} UTC</BdiLtr>
					</span>
				)}
			</div>

			{/* Fire detections (wildfires only) */}
			{disasterType === 'fire' && (
				<div className="space-y-2">
					{coverage?.status === 'partial' && (
						<div
							data-testid="firms-partial"
							className="text-xs p-2.5 rounded-lg border space-y-1"
							style={{
								background: 'rgba(234, 179, 8, 0.15)',
								borderColor: 'rgba(234, 179, 8, 0.4)',
								color: ds.text.primary,
							}}
						>
							<div>
								Partial FIRMS coverage: incomplete data
								{failedSensorLabels.length > 0 ? ` from ${failedSensorLabels.join(', ')}` : ''}
								{coverage.missingDates.length > 0 ? ` for ${coverage.missingDates.join(', ')} (UTC)` : ''}.
								Counts below cover only the portions that succeeded.
							</div>
							{coverage.missingBboxes && coverage.missingBboxes.length > 0 && (
								<div className="text-[11px]" style={{ color: ds.text.secondary }}>
									Missing box extent(s): <BdiLtr mono>{coverage.missingBboxes.join(' · ')}</BdiLtr>
								</div>
							)}
						</div>
					)}

					{fireDisplay === 'loading' || fireDisplay === 'idle' ? (
						<div
							className="p-4 rounded-xl border flex flex-col items-center justify-center gap-2 text-center"
							style={{
								background: ds.surface.overlaySubtle,
								borderColor: ds.surface.border,
							}}
						>
							<p className="text-xs font-medium" style={{ color: '#fb923c' }}>
								Querying NASA FIRMS detections…
							</p>
						</div>
					) : effectiveFire.state === 'unavailable' ? (
						<div
							className="p-3.5 rounded-xl border flex flex-col items-center text-center"
							style={{
								background: 'rgba(239, 68, 68, 0.08)',
								borderColor: 'rgba(239, 68, 68, 0.28)',
							}}
						>
							<AlertCircle size={20} className="mb-1.5" style={{ color: '#ef4444' }} aria-hidden="true" />
							<p className="text-xs font-bold" style={{ color: '#ef4444' }}>
								Fire Detections Unavailable
							</p>
							<p className="text-xs mt-1" style={{ color: ds.text.secondary }}>
								{effectiveFire.reason}. This is a data outage, not an absence of fires.
							</p>
							{effectiveFire.coverage && (
								<p className="text-[11px] mt-1" style={{ color: ds.text.tertiary }}>
									Requested: {effectiveFire.source ?? 'NASA FIRMS'},{' '}
									<BdiLtr mono>{windowLabel}</BdiLtr>.
								</p>
							)}
						</div>
					) : loadedFire && fireDisplay === 'detections' ? (
						<div
							className="p-3 rounded-xl border space-y-2"
							style={{
								background:
									'linear-gradient(135deg, rgba(220, 38, 38, 0.14), rgba(249, 115, 22, 0.09))',
								borderColor: 'rgba(220, 38, 38, 0.3)',
							}}
						>
							<div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
								<Flame
									size={14}
									style={{ color: ds.isDark ? '#f87171' : '#dc2626' }}
									aria-hidden="true"
								/>
								<span style={{ color: ds.text.primary }}>
									FIRMS Detections (<BdiLtr mono>{windowLabel}</BdiLtr>)
								</span>
							</div>

							<div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
								<div className="p-2.5 rounded-lg" style={{ background: ds.surface.overlaySubtle }}>
									<BdiLtr mono className="text-2xl font-bold block">
										{fireSummary.total}
									</BdiLtr>
									<div className="text-[11px]" style={{ color: ds.text.secondary }}>
										Shown Detections
									</div>
									<div className="mt-1 flex flex-col gap-0.5 text-[10px] font-medium">
										<span style={{ color: ds.isDark ? '#f87171' : '#dc2626' }}>
											{fireSummary.high} High Confidence
										</span>
										<span style={{ color: ds.isDark ? '#fdba74' : '#ea580c' }}>
											{fireSummary.nominal} Nominal
										</span>
										{fireSummary.unknown > 0 && (
											<span style={{ color: ds.text.tertiary }}>
												{fireSummary.unknown} Confidence not reported
											</span>
										)}
										{loadedFire.hiddenLowConfidence > 0 && (
											<span style={{ color: ds.text.tertiary }}>
												{loadedFire.hiddenLowConfidence} low-confidence hidden
											</span>
										)}
									</div>
								</div>

								<div className="p-2.5 rounded-lg" style={{ background: ds.surface.overlaySubtle }}>
									{fireSummary.maxBrightness !== null ? (
										<>
											<BdiLtr mono className="text-xl font-bold block">
												{fireSummary.maxBrightness.toFixed(1)} K
											</BdiLtr>
											<div className="text-[11px]" style={{ color: ds.text.secondary }}>
												Max I-4 brightness temperature
											</div>
										</>
									) : (
										<div className="text-xs" style={{ color: ds.text.secondary }}>
											Brightness temperature not reported
										</div>
									)}
									{fireSummary.latestDetection && (
										<div className="mt-1 text-[10px]" style={{ color: ds.text.tertiary }}>
											Latest detection <BdiLtr mono>{fireSummary.latestDetection}</BdiLtr>
										</div>
									)}
								</div>
							</div>

							<p className="text-[10px]" style={{ color: ds.text.tertiary }}>
								Brightness temperature is the sensor&apos;s pixel radiometric value, not air or flame
								temperature, and not a severity rating.
							</p>

							<div className="flex items-center gap-2 text-xs">
								<AlertCircle size={13} style={{ color: '#fb923c' }} aria-hidden="true" />
								<span style={{ color: ds.text.secondary }}>
									Max Fire Radiative Power:{' '}
									<span className="font-semibold" style={{ color: '#fb923c' }}>
										{fireSummary.maxPower !== null ? (
											<BdiLtr mono>{fireSummary.maxPower.toFixed(1)} MW</BdiLtr>
										) : (
											'not reported'
										)}
									</span>
								</span>
							</div>

							{satelliteBreakdown.length > 0 && (
								<div className="flex flex-wrap items-center gap-1.5 text-[10px]" data-testid="firms-satellite-breakdown">
									<span style={{ color: ds.text.tertiary }}>
										{loadedFire.data.truncated ? 'Sensors (displayed subset):' : 'Sensors:'}
									</span>
									{satelliteBreakdown.map(([sat, count]) => (
										<span
											key={sat}
											className="px-1.5 py-0.5 rounded border font-mono"
											style={{
												background: ds.surface.overlaySubtle,
												borderColor: ds.surface.borderSubtle,
												color: ds.text.secondary,
											}}
										>
											{sat}: {count}
										</span>
									))}
								</div>
							)}

							{loadedFire.data.truncated && loadedFire.data.rawMatchedCount && (
								<p data-testid="firms-truncated-note" className="text-[10px]" style={{ color: ds.text.tertiary }}>
									Showing newest {loadedFire.data.totalCount} of {loadedFire.data.rawMatchedCount} unique
									matched detections in this ±0.5° area; counts, peaks, and sensor breakdown reflect the
									displayed subset
									{loadedFire.data.matchedSatelliteCounts
										? ` (all matched: ${Object.entries(loadedFire.data.matchedSatelliteCounts)
												.map(([s, c]) => `${s} ${c}`)
												.join(', ')})`
										: ''}
									.
								</p>
							)}
						</div>
					) : (
						<div
							className="p-3.5 rounded-xl border text-center"
							style={{
								background: ds.surface.overlaySubtle,
								borderColor: ds.surface.border,
							}}
						>
							{fireDisplay === 'filtered' && loadedFire ? (
								<>
									<p className="text-xs font-bold" style={{ color: ds.text.secondary }}>
										Only Low-Confidence Detections (<BdiLtr mono>{windowLabel}</BdiLtr>)
									</p>
									<p className="text-[11px] mt-1" style={{ color: ds.text.tertiary }}>
										NASA FIRMS {loadedFire.data.sensor} reported {loadedFire.hiddenLowConfidence}{' '}
										low-confidence detection
										{loadedFire.hiddenLowConfidence === 1 ? '' : 's'} in this ±0.5° area; they are
										hidden from the map view.
									</p>
								</>
							) : coverage?.status === 'partial' ? (
								<>
									<p data-testid="firms-partial-empty" className="text-xs font-bold" style={{ color: ds.text.secondary }}>
										No Detections in Available Portion (<BdiLtr mono>{windowLabel}</BdiLtr>)
									</p>
									<p className="text-[11px] mt-1" style={{ color: ds.text.tertiary }}>
										Coverage is incomplete, so absence of thermal anomalies cannot be confirmed across all
										requested sensors, dates, and boxes.
									</p>
								</>
							) : (
								<>
									<p className="text-xs font-bold" style={{ color: ds.text.secondary }}>
										No Detections (<BdiLtr mono>{windowLabel}</BdiLtr>)
									</p>
									<p className="text-[11px] mt-1" style={{ color: ds.text.tertiary }}>
										NASA FIRMS {loadedFire?.data.sensor ?? 'VIIRS'} returned no thermal anomalies in
										this ±0.5° area for the queried dates.
									</p>
								</>
							)}
						</div>
					)}
				</div>
			)}

			{/* Historical event notice */}
			{daysSinceDetection !== null && daysSinceDetection > 7 && (
				<div
					className="flex items-start gap-2 p-2.5 rounded-lg border text-xs"
					style={{
						background: ds.isDark ? 'rgba(234, 179, 8, 0.14)' : 'rgba(234, 179, 8, 0.2)',
						borderColor: 'rgba(234, 179, 8, 0.45)',
					}}
				>
					<AlertCircle
						className="shrink-0 mt-0.5"
						size={14}
						style={{ color: ds.isDark ? '#fbbf24' : '#b45309' }}
						aria-hidden="true"
					/>
					<div>
						<p className="font-medium" style={{ color: ds.text.primary }}>
							<strong>
								{disasterType === 'volcano' ? 'Open volcanic event:' : 'Historical Event:'}
							</strong>{' '}
							{disasterType === 'volcano'
								? 'NASA EONET reported it'
								: 'Latest reported observation'}{' '}
							{daysSinceDetection >= 365
								? `${Math.floor(daysSinceDetection / 365)} year(s) ago`
								: daysSinceDetection >= 30
									? `${Math.floor(daysSinceDetection / 30)} month(s) ago`
									: `${daysSinceDetection} day(s) ago`}
							{disasterType === 'volcano'
								? ' and has not closed it; that date is not the latest activity.'
								: '.'}
						</p>
						<p className="mt-1 text-[11px]" style={{ color: ds.text.secondary }}>
							Imagery and detections below are recent, not from the event date.
						</p>
					</div>
				</div>
			)}

			{/* Layer selector (wraps cleanly at 320px) */}
			<div className="flex flex-wrap gap-1.5">
				{disasterType === 'fire' && (
					<button
						type="button"
						onClick={() => setSelectedLayer('fire')}
						data-testid="imagery-tab-fire"
						className="flex-1 min-w-[92px] min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors"
						style={{
							background:
								selectedLayer === 'fire' ? 'rgba(239, 68, 68, 0.2)' : ds.surface.overlaySubtle,
							color:
								selectedLayer === 'fire'
									? ds.isDark
										? '#fca5a5'
										: '#dc2626'
									: ds.text.secondary,
							border:
								selectedLayer === 'fire'
									? '1.5px solid rgba(239, 68, 68, 0.5)'
									: `1px solid ${ds.surface.border}`,
						}}
					>
						<Flame size={13} aria-hidden="true" />
						<span>Fire Hotspots</span>
					</button>
				)}
				<button
					type="button"
					onClick={() => setSelectedLayer('falsecolor')}
					data-testid="imagery-tab-falsecolor"
					className="flex-1 min-w-[104px] min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors"
					style={{
						background:
							selectedLayer === 'falsecolor'
								? 'rgba(249, 115, 22, 0.2)'
								: ds.surface.overlaySubtle,
						color:
							selectedLayer === 'falsecolor'
								? ds.isDark
									? '#fdba74'
									: '#ea580c'
								: ds.text.secondary,
						border:
							selectedLayer === 'falsecolor'
								? '1.5px solid rgba(249, 115, 22, 0.5)'
								: `1px solid ${ds.surface.border}`,
					}}
				>
					7-2-1 False Color
				</button>
				<button
					type="button"
					onClick={() => setSelectedLayer('visual')}
					data-testid="imagery-tab-visual"
					className="flex-1 min-w-[80px] min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors"
					style={{
						background:
							selectedLayer === 'visual'
								? 'rgba(59, 130, 246, 0.2)'
								: ds.surface.overlaySubtle,
						color:
							selectedLayer === 'visual'
								? ds.isDark
									? '#93c5fd'
									: '#1d4ed8'
								: ds.text.secondary,
						border:
							selectedLayer === 'visual'
								? '1.5px solid rgba(59, 130, 246, 0.5)'
								: `1px solid ${ds.surface.border}`,
					}}
				>
					Visual
				</button>
			</div>

			{/* Image display */}
			<div
				className="relative overflow-hidden rounded-xl border"
				style={{
					background: ds.surface.overlaySubtle,
					borderColor: ds.surface.border,
				}}
			>
				{imageStatus === 'error' ? (
					<div className="w-full aspect-[4/3] flex flex-col items-center justify-center gap-2 p-5 text-center">
						<AlertCircle size={36} style={{ color: ds.colors.status.warning }} aria-hidden="true" />
						<p className="text-xs font-bold" style={{ color: ds.text.primary }}>
							{spec.provider} Imagery Unavailable
						</p>
						<p className="text-xs" style={{ color: ds.text.secondary }}>
							{spec.label}
							{spec.date ? ` for ${spec.date}` : ''} could not be loaded.
						</p>
					</div>
				) : (
					<div
						data-testid="imagery-frame"
						className="relative w-full aspect-[4/3]"
						style={{ backgroundColor: '#111827' }}
					>
						{imageStatus === 'loading' && (
							<div
								className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-30"
								style={{ backgroundColor: 'rgba(17, 24, 39, 0.92)' }}
							>
								<p className="text-xs text-slate-300 font-medium">Loading {spec.label}…</p>
							</div>
						)}

						<img
							key={spec.url}
							ref={markImageLoaded(spec.url)}
							src={spec.url}
							alt={`${spec.label}${spec.date ? ` ${spec.date}` : ''}`}
							data-testid="imagery-base"
							className="absolute inset-0 w-full h-full object-fill"
							onError={(e) => {
								const img = e.target as HTMLImageElement;
								if (spec.layer === 'visual' && !img.dataset.fallback) {
									img.dataset.fallback = '1';
									img.src = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},8,0/800x600?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`;
									return;
								}
								setFailedUrl(spec.url);
							}}
							onLoad={() => setLoadedUrl(spec.url)}
						/>

						<div className="absolute inset-0 pointer-events-none">
							{spec.overlay && overlayFailedUrl !== spec.overlay.url && (
								<img
									key={spec.overlay.url}
									ref={markImageLoaded(spec.overlay.url, setOverlayLoadedUrl)}
									src={spec.overlay.url}
									alt=""
									data-testid="imagery-overlay"
									className="absolute inset-0 w-full h-full object-fill pointer-events-none"
									style={{ mixBlendMode: 'screen' }}
									onError={() => setOverlayFailedUrl(spec.overlay?.url ?? null)}
									onLoad={() => setOverlayLoadedUrl(spec.overlay?.url ?? null)}
								/>
							)}

							{cellFootprintRect && (
								<div
									data-testid="imagery-cell-footprint"
									className="absolute border border-dashed border-amber-300/75 bg-amber-400/5 pointer-events-none"
									style={{
										left: `${cellFootprintRect.leftPct}%`,
										top: `${cellFootprintRect.topPct}%`,
										width: `${cellFootprintRect.widthPct}%`,
										height: `${cellFootprintRect.heightPct}%`,
										zIndex: 8,
									}}
									title="0.5° FIRMS detection grid cell footprint"
								/>
							)}

							{markers.map(({ h, pos }) => (
								<div
									key={`${h.latitude}|${h.longitude}|${h.acq_date}|${h.acq_time}|${h.satellite}`}
									data-testid="imagery-hotspot-marker"
									data-lat={String(h.latitude)}
									data-lng={String(h.longitude)}
									data-satellite={h.satellite}
									className={`absolute rounded-full ${getConfidenceColor(h.confidence)} shadow-lg pointer-events-auto`}
									style={{
										width: '10px',
										height: '10px',
										left: `${pos.leftPct}%`,
										top: `${pos.topPct}%`,
										transform: 'translate(-50%, -50%)',
										border: '2px solid white',
										zIndex: 10,
									}}
									title={`${h.satellite} · ${h.acq_date} ${h.acq_time} UTC · ${h.bright_ti4 ?? '?'}K · ${h.frp ?? '?'}MW`}
								/>
							))}

							<div className="absolute top-2 left-2 z-20 bg-black/85 px-2 py-1 rounded text-[11px] text-white font-semibold">
								{spec.layer === 'fire'
									? 'Fire Data'
									: spec.layer === 'falsecolor'
										? '7-2-1 False Color'
										: 'Visual Basemap'}
							</div>

							<div className="absolute bottom-2 left-2 z-15 bg-black/85 px-2 py-0.5 rounded text-[10px] text-white font-mono">
								<MapPin size={10} className="inline mr-1" aria-hidden="true" />
								<BdiLtr mono>
									{lat.toFixed(3)}°, {lng.toFixed(3)}°
								</BdiLtr>
							</div>
						</div>
					</div>
				)}
			</div>

			<p
				data-testid="imagery-caption"
				className="text-[10px] leading-relaxed"
				style={{ color: ds.text.tertiary }}
			>
				Image: {spec.label}
				{spec.date ? `, requested UTC day ${spec.date}; swath and cloud coverage not confirmed` : ''}.
				{spec.overlay &&
					(overlayStatus === 'loading' || overlayStatus === 'loaded') &&
					` Overlay: ${spec.overlay.label}${spec.overlay.date ? `, requested ${spec.overlay.date}` : ''}; an empty overlay may mean no detections or no coverage.`}
				{spec.overlay &&
					overlayStatus === 'error' &&
					` Overlay${spec.overlay.date ? ` for ${spec.overlay.date}` : ' (undated NRT thermal layer)'} failed to load; thermal anomalies are not shown on the image.`}
				{spec.layer === 'fire' &&
					loadedFire &&
					` Markers: FIRMS detections ${windowLabel} (multi-day; not the same period as the overlay).`}
				{spec.layer === 'fire' &&
					offImage > 0 &&
					` ${offImage} detection(s) fall outside the drawable image and are not marked.`}
				{spec.layer === 'fire' &&
					effectiveFire.state === 'unavailable' &&
					' No FIRMS markers: detection data unavailable.'}
			</p>

			{spec.limitation && (
				<p
					data-testid="imagery-limitation"
					className="flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-400"
				>
					<AlertCircle size={12} className="shrink-0 mt-0.5" aria-hidden="true" />
					<span>{spec.limitation}</span>
				</p>
			)}

			{/* Action buttons */}
			<div className="flex flex-wrap gap-2">
				<a
					href={worldviewUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="flex-1 min-w-[140px] min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-blue-500/40 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors"
				>
					<ExternalLink size={13} aria-hidden="true" />
					<span>NASA Worldview</span>
				</a>
				<a
					href={spec.url}
					download={`${disasterType}_${title.replace(/\s+/g, '_')}_${spec.date ?? 'basemap'}.jpg`}
					aria-label="Download current satellite image"
					className="min-h-[38px] min-w-[42px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border"
					style={{
						background: ds.surface.overlaySubtle,
						borderColor: ds.surface.border,
						color: ds.text.primary,
					}}
				>
					<Download size={14} aria-hidden="true" />
				</a>
			</div>

			{/* Layer explanation */}
			<div
				className="text-xs leading-relaxed p-2.5 rounded-lg border"
				style={{
					color: ds.text.secondary,
					background: ds.surface.overlaySubtle,
					borderColor: ds.surface.border,
				}}
			>
				{disasterType === 'fire' && selectedLayer === 'fire' && (
					<p>
						<strong style={{ color: ds.text.primary }}>Fire Hotspots:</strong> markers are NASA FIRMS
						VIIRS (S-NPP, NOAA-20, NOAA-21) detections{loadedFire ? ` for ${windowLabel}` : ''}; the red
						overlay is an undated GIBS NRT VIIRS thermal anomaly composite; the base is MODIS Aqua true color (±0.5° view).
					</p>
				)}
				{selectedLayer === 'falsecolor' && (
					<p>
						<strong style={{ color: ds.text.primary }}>MODIS Terra bands 7-2-1</strong> false-color
						reflectance. Burn scars appear brown-red and vegetation green; active fires can appear
						bright orange. Reflectance, not temperature.
					</p>
				)}
				{selectedLayer === 'visual' && (
					<p>
						<strong style={{ color: ds.text.primary }}>Mapbox satellite basemap</strong> for
						geographic context. Acquisition date is not provided and may be months or years old.
					</p>
				)}
			</div>
		</div>
	);
}
