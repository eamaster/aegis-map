/**
 * Sidebar Component — Event Inspector (Desktop Side Panel & Mobile Bottom Sheet)
 * Groups research sections into Overview, Imagery, and Passes tabs while keeping
 * orbital propagation, weather, STAC/GIBS imagery, and AI analysis mounted so
 * switching tabs or resizing never repeats upstream fetches.
 */

import { useEffect, useRef, useState } from 'react';
import { X, Sparkles, Cloud, ChevronUp, ChevronDown, Layers, Radar, Compass } from 'lucide-react';
import type { Disaster, WeatherData, AIAnalysisResponse } from '../types';
import {
	createPassPredictionSession,
	type EnrichedSatellitePass,
	type SatellitePass,
} from '../utils/orbitalEngine';
import SatelliteImagery from './SatelliteImagery';
import PassComparisonPanel from './PassComparisonPanel';
import SarScenesPanel from './SarScenesPanel';
import { BdiLtr } from './BdiLtr';
import { useDesignSystem } from '../hooks/useDesignSystem';
import { useLocale } from '../hooks/useLocale';
import { apiUrl } from '../config/api';
import { debugLog } from '../utils/debug';
import { tleClient } from '../utils/tleClient';
import { analysisViewState, blockedAnalysisMessage, describeAnalysisError } from '../utils/analysisState';
import {
	analysisRequestIdentity,
	isCurrentGeneration,
	nextGeneration,
} from '../utils/selectionGeneration';
import {
	formatCoordPair,
	formatEventDualTime,
	formatPrimaryMetric,
	getEventProvenanceLabel,
	getHazardMeta,
} from '../utils/eventFormatters';

interface SidebarProps {
	disaster: Disaster | null;
	onClose: () => void;
	isOpen: boolean;
}

const SATELLITE_ELEVATION_THRESHOLDS = {
	OPTIMAL: 25,
	ACCEPTABLE: 15,
	MINIMUM: 5,
} as const;

type CloudState = number | null | undefined;
type PassState = 'loading' | 'pass' | 'no-pass' | 'unavailable';
type InspectorTab = 'overview' | 'imagery' | 'passes';

function describeTleHeaders(headers: Headers): string | null {
	const status = headers.get('X-TLE-Status');
	const missing = headers.get('X-TLE-Missing');
	const retained = headers.get('X-TLE-Retained');
	const notes: string[] = [];
	if (status === 'partial' && missing) {
		notes.push(
			`Orbital elements unavailable for ${missing.split(',').length} of 6 monitored satellites`,
		);
	}
	if (retained) {
		notes.push(`${retained.split(',').length} satellite(s) use cached elements pending refresh`);
	}
	return notes.length ? `${notes.join('; ')}.` : null;
}

export default function Sidebar({ disaster, onClose, isOpen = true }: SidebarProps) {
	const ds = useDesignSystem();
	const { t } = useLocale();
	const [activeTab, setActiveTab] = useState<InspectorTab>('overview');
	const [sheetExpanded, setSheetExpanded] = useState(false);

	const [nextPass, setNextPass] = useState<SatellitePass | null>(null);
	const [allFleetPasses, setAllFleetPasses] = useState<EnrichedSatellitePass[]>([]);
	const [hourlyWeather, setHourlyWeather] = useState<WeatherData['hourly'] | null>(null);
	const [passState, setPassState] = useState<PassState>('loading');
	const [tleNotice, setTleNotice] = useState<string | null>(null);
	const [tleOldestEpoch, setTleOldestEpoch] = useState<string | null>(null);
	const [passThreshold, setPassThreshold] = useState<number | null>(null);
	const [cloudCover, setCloudCover] = useState<CloudState>(undefined);
	const [aiAnalysis, setAiAnalysis] = useState<string>('');
	const [analysisUnavailable, setAnalysisUnavailable] = useState(false);
	const [loadingAnalysis, setLoadingAnalysis] = useState(false);
	const [timeUntilPass, setTimeUntilPass] = useState<string>('');
	const [retryToken, setRetryToken] = useState(0);
	const [analysisErrorCode, setAnalysisErrorCode] = useState<string | null>(null);
	const [orbitFailure, setOrbitFailure] = useState<{
		code: string;
		retryAfterSeconds: number | null;
	} | null>(null);
	const [orbitReload, setOrbitReload] = useState(0);
	const forceOrbitReloadRef = useRef(false);
	const selectionGenRef = useRef(0);
	const inFlightKeyRef = useRef<string | null>(null);
	const analyzeAbortRef = useRef<AbortController | null>(null);

	// Reset mobile bottom sheet to peek height when a new event ID is selected so map + pinned bubble stay visible
	const selectedId = disaster?.id ?? null;
	useEffect(() => {
		setSheetExpanded(false);
	}, [selectedId]);

	// Depend on stable primitive event identity + coordinates rather than object reference
	const disasterLat = disaster?.lat ?? NaN;
	const disasterLng = disaster?.lng ?? NaN;

	useEffect(() => {
		if (!selectedId || !Number.isFinite(disasterLat) || !Number.isFinite(disasterLng)) return;

		const generation = nextGeneration(selectionGenRef.current);
		selectionGenRef.current = generation;
		inFlightKeyRef.current = null;
		analyzeAbortRef.current?.abort();
		analyzeAbortRef.current = null;

		setNextPass(null);
		setAllFleetPasses([]);
		setHourlyWeather(null);
		setPassState('loading');
		setTleNotice(null);
		setTleOldestEpoch(null);
		setPassThreshold(null);
		setCloudCover(undefined);
		setAiAnalysis('');
		setAnalysisUnavailable(false);
		setAnalysisErrorCode(null);
		setOrbitFailure(null);
		setLoadingAnalysis(false);
		setTimeUntilPass('');
		setRetryToken(0);

		const tleAbort = new AbortController();

		const fetchWeather = async (lat: number, lng: number, passTime: Date) => {
			try {
				const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=cloud_cover&forecast_days=2&timezone=UTC`;
				debugLog('weather', `Fetching weather for (${lat.toFixed(2)}, ${lng.toFixed(2)})`, 'info');
				const response = await fetch(url, { signal: tleAbort.signal });
				if (!response.ok) throw new Error(`Weather API error: ${response.status}`);
				const data: WeatherData = await response.json();
				if (!isCurrentGeneration(generation, selectionGenRef.current)) return;
				if (
					!data.hourly ||
					!Array.isArray(data.hourly.cloud_cover) ||
					!Array.isArray(data.hourly.time) ||
					data.hourly.time.length === 0
				) {
					setHourlyWeather(null);
					setCloudCover(null);
					return;
				}
				setHourlyWeather(data.hourly);

				let nearestIdx = -1;
				let minDiffMs = Infinity;
				const passTimeMs = passTime.getTime();

				for (let i = 0; i < data.hourly.time.length; i++) {
					const tStr = data.hourly.time[i];
					const tIso = tStr.endsWith('Z') ? tStr : `${tStr}:00Z`.replace(/:00:00Z$/, ':00Z');
					const tMs = new Date(tIso).getTime();
					if (!Number.isNaN(tMs)) {
						const diff = Math.abs(tMs - passTimeMs);
						if (diff < minDiffMs) {
							minDiffMs = diff;
							nearestIdx = i;
						}
					}
				}

				const MAX_WEATHER_DIFF_MS = 2 * 60 * 60 * 1000;
				if (nearestIdx >= 0 && minDiffMs <= MAX_WEATHER_DIFF_MS) {
					const val = data.hourly.cloud_cover[nearestIdx];
					if (typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 100) {
						setCloudCover(val);
					} else {
						setCloudCover(null);
					}
				} else {
					setCloudCover(null);
				}
			} catch (error) {
				if (error instanceof DOMException && error.name === 'AbortError') return;
				if (!isCurrentGeneration(generation, selectionGenRef.current)) return;
				debugLog('weather', 'FAILED to fetch weather', 'error');
				setCloudCover(null);
			}
		};

		const fetchData = async () => {
			try {
				const force = forceOrbitReloadRef.current;
				forceOrbitReloadRef.current = false;
				debugLog('tles', `Loading TLEs from ${apiUrl('/api/tles')}${force ? ' (retry)' : ''}`, 'info');
				const tles = await tleClient.load({ force });
				if (!isCurrentGeneration(generation, selectionGenRef.current)) return;
				if (!tles.ok) {
					debugLog('tles', `TLEs unavailable: ${tles.code}`, 'error');
					setOrbitFailure({ code: tles.code, retryAfterSeconds: tles.retryAfterSeconds });
					setNextPass(null);
					setPassState('unavailable');
					setCloudCover(null);
					return;
				}
				const responseText = tles.text;
				setTleNotice(describeTleHeaders(tles.headers));
				const oldestEpoch = Date.parse(tles.headers.get('X-TLE-Oldest-Epoch') ?? '');
				setTleOldestEpoch(
					Number.isFinite(oldestEpoch)
						? new Date(oldestEpoch).toISOString().slice(0, 16).replace('T', ' ')
						: null,
				);
				const tleLines = responseText
					.trim()
					.split('\n')
					.filter((line) => line.trim().length > 0);
				if (tleLines.length < 3 || tleLines.length % 3 !== 0) {
					throw new Error(`Invalid TLE data: ${tleLines.length} lines`);
				}

				if (Math.abs(disasterLat) > 90 || Math.abs(disasterLng) > 180) {
					setOrbitFailure({ code: 'invalid_coordinates', retryAfterSeconds: null });
					setPassState('unavailable');
					setCloudCover(null);
					return;
				}

				const session = createPassPredictionSession(responseText, disasterLat, disasterLng);
				const resolved = session.resolveNextBestPass([
					SATELLITE_ELEVATION_THRESHOLDS.OPTIMAL,
					SATELLITE_ELEVATION_THRESHOLDS.ACCEPTABLE,
					SATELLITE_ELEVATION_THRESHOLDS.MINIMUM,
				]);
				const pass = resolved.pass;
				const threshold = resolved.threshold ?? SATELLITE_ELEVATION_THRESHOLDS.OPTIMAL;
				if (!isCurrentGeneration(generation, selectionGenRef.current)) return;

				setAllFleetPasses(resolved.allFleetPasses);
				if (!pass) {
					setNextPass(null);
					setPassState('no-pass');
					await fetchWeather(disasterLat, disasterLng, new Date(Date.now() + 2 * 60 * 60 * 1000));
					return;
				}
				setNextPass(pass);
				setPassThreshold(threshold);
				setPassState('pass');
				await fetchWeather(disasterLat, disasterLng, pass.time);
			} catch (error) {
				if (error instanceof DOMException && error.name === 'AbortError') return;
				if (!isCurrentGeneration(generation, selectionGenRef.current)) return;
				debugLog('tles', 'FAILED to use TLEs', 'error');
				setOrbitFailure({ code: 'invalid_response', retryAfterSeconds: null });
				setNextPass(null);
				setPassState('unavailable');
				setCloudCover(null);
			}
		};

		void fetchData();
		return () => {
			tleAbort.abort();
			selectionGenRef.current = nextGeneration(selectionGenRef.current);
			analyzeAbortRef.current?.abort();
		};
	}, [selectedId, disasterLat, disasterLng, orbitReload]);

	const handleRetryOrbitalData = () => {
		forceOrbitReloadRef.current = true;
		setOrbitReload((n) => n + 1);
	};

	useEffect(() => {
		if (!nextPass) return;
		const updateTimer = () => {
			const diff = nextPass.time.getTime() - Date.now();
			if (diff > 0) {
				const hours = Math.floor(diff / (1000 * 60 * 60))
					.toString()
					.padStart(2, '0');
				const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
					.toString()
					.padStart(2, '0');
				const seconds = Math.floor((diff % (1000 * 60)) / 1000)
					.toString()
					.padStart(2, '0');
				setTimeUntilPass(`${hours}:${minutes}:${seconds}`);
			} else {
				setTimeUntilPass('PASSING');
			}
		};
		updateTimer();
		const interval = setInterval(updateTimer, 1000);
		return () => clearInterval(interval);
	}, [nextPass]);

	useEffect(() => {
		if (!disaster || !nextPass || cloudCover === undefined || loadingAnalysis || aiAnalysis) return;

		const generation = selectionGenRef.current;
		const passIso = nextPass.time.toISOString();
		const reqKey = analysisRequestIdentity({
			disasterId: disaster.id,
			satelliteName: nextPass.satelliteName,
			passIso,
			cloudCover,
			retryToken,
		});
		if (inFlightKeyRef.current === reqKey) return;

		inFlightKeyRef.current = reqKey;
		setLoadingAnalysis(true);
		setAnalysisUnavailable(false);
		analyzeAbortRef.current?.abort();
		const abort = new AbortController();
		analyzeAbortRef.current = abort;

		const requestBody = {
			disasterTitle: disaster.title,
			satelliteName: nextPass.satelliteName,
			passTime: passIso,
			cloudCover,
			disasterType: disaster.type === 'fire_detection' ? 'fire' : disaster.type,
			lat: disaster.lat,
			lng: disaster.lng,
			maxElevationDeg: nextPass.maxElevationDeg ?? nextPass.elevation,
		};
		debugLog('ai', `Requesting AI analysis for ${disaster.title}`, 'info', requestBody);

		(async () => {
			try {
				const response = await fetch(apiUrl('/api/analyze'), {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(requestBody),
					signal: abort.signal,
				});

				const responseText = await response.text();
				let data: AIAnalysisResponse = {};
				try {
					data = JSON.parse(responseText) as AIAnalysisResponse;
				} catch {
					/* ignore */
				}
				if (!isCurrentGeneration(generation, selectionGenRef.current)) return;

				if (!response.ok) {
					setAnalysisUnavailable(true);
					setAnalysisErrorCode(data.code ?? `http_${response.status}`);
					setAiAnalysis(
						describeAnalysisError(data.code, data.message || data.error || `HTTP ${response.status}`),
					);
					return;
				}
				if (!data.analysis || data.analysis.trim().length === 0 || data.source !== 'workers-ai') {
					setAnalysisUnavailable(true);
					setAnalysisErrorCode('unexpected_response');
					setAiAnalysis('Analysis unavailable: empty or unexpected response.');
					return;
				}
				setAiAnalysis(data.analysis.trim());
				setAnalysisUnavailable(false);
				setAnalysisErrorCode(null);
			} catch (error) {
				if (error instanceof DOMException && error.name === 'AbortError') return;
				if (!isCurrentGeneration(generation, selectionGenRef.current)) return;
				setAnalysisUnavailable(true);
				setAnalysisErrorCode('network');
				setAiAnalysis('Analysis request did not reach the API. Map and satellite tools remain usable.');
			} finally {
				if (isCurrentGeneration(generation, selectionGenRef.current)) {
					setLoadingAnalysis(false);
					if (inFlightKeyRef.current === reqKey) inFlightKeyRef.current = null;
				}
			}
		})();
	}, [disaster, nextPass, cloudCover, aiAnalysis, loadingAnalysis, retryToken]);

	const handleRetryAnalysis = () => {
		if (!disaster || !nextPass || cloudCover === undefined || loadingAnalysis) return;
		inFlightKeyRef.current = null;
		setAiAnalysis('');
		setAnalysisUnavailable(false);
		setAnalysisErrorCode(null);
		setRetryToken((tok) => tok + 1);
	};

	const analysisState = analysisViewState({
		passState,
		loading: loadingAnalysis,
		hasAnalysis: !analysisUnavailable && aiAnalysis.trim().length > 0,
		errorCode: analysisUnavailable ? analysisErrorCode : null,
	});

	if (!disaster || !isOpen) {
		return null;
	}

	const meta = getHazardMeta(disaster.type);
	const metric = formatPrimaryMetric(disaster);
	const provenance = getEventProvenanceLabel(disaster);
	const dualTime = formatEventDualTime(disaster.date);
	const displayTitle =
		disaster.type === 'fire_detection' ? 'Satellite Thermal Hotspots Cell' : disaster.title;

	return (
		<aside
			aria-label={displayTitle}
			className={`flex flex-col overflow-hidden md:relative md:w-[390px] lg:w-[420px] md:h-full md:shrink-0 md:z-20 md:border-s max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-[90] max-md:rounded-t-2xl max-md:border-t max-md:shadow-2xl transition-[max-height] duration-200 ${
				sheetExpanded ? 'max-md:max-h-[82dvh]' : 'max-md:max-h-[34dvh]'
			}`}
			data-testid="sidebar"
			data-sheet-state={sheetExpanded ? 'expanded' : 'peek'}
			data-active-tab={activeTab}
			data-disaster-id={disaster.id}
			data-pass-state={passState}
			data-pass-satellite={nextPass?.satelliteName ?? ''}
			data-pass-time={nextPass ? nextPass.time.toISOString() : ''}
			data-pass-threshold={passThreshold ?? ''}
			data-analysis-state={analysisState}
			data-orbit-failure={orbitFailure?.code ?? ''}
			data-weather-state={
				cloudCover === undefined ? 'loading' : cloudCover === null ? 'unavailable' : 'known'
			}
			data-cloud-cover={typeof cloudCover === 'number' ? String(cloudCover) : ''}
			style={{
				...ds.glass.panel,
				borderColor: ds.headerBorderColor,
				paddingBottom: 'env(safe-area-inset-bottom, 0px)',
			}}
		>
			{/* Mobile Bottom-Sheet Handle + Accessible Expand/Collapse Bar */}
			<div
				className="md:hidden shrink-0 flex items-center justify-between px-3 pt-2 pb-1 border-b"
				style={{ borderColor: ds.surface.borderSubtle }}
			>
				<button
					type="button"
					data-testid="sheet-expand-toggle"
					aria-expanded={sheetExpanded}
					onClick={() => setSheetExpanded((v) => !v)}
					className="flex-1 min-h-[36px] inline-flex items-center justify-center gap-1.5 text-xs font-bold rounded-lg px-2"
					style={{ color: ds.text.secondary }}
				>
					<span
						className="w-8 h-1 rounded-full bg-slate-400/50 me-1"
						aria-hidden="true"
					/>
					<span>{sheetExpanded ? t.collapseSheetLabel : t.expandSheetLabel}</span>
					{sheetExpanded ? (
						<ChevronDown size={15} aria-hidden="true" />
					) : (
						<ChevronUp size={15} aria-hidden="true" />
					)}
				</button>
			</div>

			{/* Event Header — Selected Event Title + Hazard Type + Source + Timestamp */}
			<div
				className="shrink-0 px-4 py-3 border-b space-y-1.5"
				style={{ borderColor: ds.surface.border }}
			>
				<div className="flex items-start justify-between gap-2.5">
					<div className="min-w-0 flex-1 space-y-1">
						<div className="flex flex-wrap items-center gap-1.5">
							<span
								className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider"
								style={{
									background: `${meta.accentHex}24`,
									border: `1px solid ${meta.accentHex}66`,
									color: ds.text.primary,
								}}
							>
								<span aria-hidden="true">{meta.icon}</span>
								<span>{meta.typeLabel}</span>
							</span>
							{metric && (
								<span
									className="px-2 py-0.5 rounded text-[10px] font-bold"
									style={{
										background: ds.surface.overlaySubtle,
										border: `1px solid ${ds.surface.border}`,
										color: ds.text.primary,
									}}
								>
									<BdiLtr>{metric}</BdiLtr>
								</span>
							)}
							{provenance && (
								<span
									data-testid="sidebar-provenance-badge"
									className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/40"
								>
									{provenance}
								</span>
							)}
						</div>

						<h2
							data-testid="inspector-event-title"
							className="text-sm sm:text-base font-extrabold leading-snug break-words"
							style={{ color: ds.text.primary }}
						>
							{displayTitle}
						</h2>
					</div>

					<button
						type="button"
						data-testid="sidebar-close-btn"
						onClick={onClose}
						aria-label={t.deselectEventLabel}
						className="min-w-[38px] min-h-[38px] shrink-0 rounded-lg flex items-center justify-center transition-colors"
						style={{
							background: 'rgba(239, 68, 68, 0.14)',
							border: '1px solid rgba(239, 68, 68, 0.4)',
							color: ds.isDark ? '#f87171' : '#dc2626',
						}}
					>
						<X size={16} strokeWidth={2.5} aria-hidden="true" />
					</button>
				</div>

				<div
					className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
					style={{ color: ds.text.tertiary }}
				>
					<span>Source: {disaster.archiveAttribution || meta.defaultSource}</span>
					{dualTime.valid && <BdiLtr mono>{dualTime.utc}</BdiLtr>}
					<BdiLtr mono>{formatCoordPair(disaster.lat, disaster.lng, 3)}</BdiLtr>
				</div>
			</div>

			{/* Inspector Section Tabs (Overview | Imagery | Passes) */}
			<div
				role="tablist"
				aria-label="Event inspection sections"
				className="shrink-0 grid grid-cols-3 gap-1 px-3 py-2 border-b"
				style={{
					borderColor: ds.surface.borderSubtle,
					background: ds.surface.overlaySubtle,
				}}
			>
				{(
					[
						{ id: 'overview', label: t.tabOverview, icon: Layers },
						{ id: 'imagery', label: t.tabImagery, icon: Radar },
						{ id: 'passes', label: t.tabPasses, icon: Compass },
					] as const
				).map(({ id, label, icon: Icon }) => {
					const selected = activeTab === id;
					return (
						<button
							key={id}
							type="button"
							role="tab"
							id={`inspector-tab-${id}`}
							data-testid={`inspector-tab-${id}`}
							aria-selected={selected}
							aria-controls={`inspector-panel-${id}`}
							onClick={() => {
								setActiveTab(id);
								setSheetExpanded(true);
							}}
							className={`min-h-[36px] px-2 py-1.5 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
								selected ? 'bg-blue-600 text-white shadow-sm' : ''
							}`}
							style={
								selected
									? undefined
									: {
											color: ds.text.secondary,
											background: 'transparent',
									  }
							}
						>
							<Icon size={13} className="shrink-0" aria-hidden="true" />
							<span className="truncate">{label}</span>
						</button>
					);
				})}
			</div>

			{/* Scrollable Tab Panels (all kept mounted so tab switches never re-fetch) */}
			<div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
				{/* TAB 1: OVERVIEW */}
				<div
					role="tabpanel"
					id="inspector-panel-overview"
					aria-labelledby="inspector-tab-overview"
					className={activeTab === 'overview' ? 'space-y-3' : 'hidden'}
				>
					{/* Thermal Hotspot Intelligence Card */}
					{disaster.type === 'fire_detection' && disaster.detectionCell && (
						<div
							className="rounded-xl p-3.5 border space-y-2.5"
							style={{
								background: ds.surface.overlay,
								borderColor: 'rgba(249, 115, 22, 0.4)',
							}}
						>
							<div className="flex items-center justify-between gap-2">
								<span
									className="text-[11px] font-extrabold uppercase tracking-wider"
									style={{ color: ds.colors.disaster.fire_detection }}
								>
									Satellite Thermal Detection
								</span>
								<span
									className="text-[10px] font-bold px-2 py-0.5 rounded"
									style={{
										background: 'rgba(249, 115, 22, 0.15)',
										color: ds.colors.disaster.fire_detection,
									}}
								>
									VIIRS 375m
								</span>
							</div>

							<div
								className="p-2.5 rounded-lg text-[11px] leading-relaxed"
								style={{
									background: 'rgba(245, 158, 11, 0.1)',
									border: '1px solid rgba(245, 158, 11, 0.28)',
									color: ds.colors.status.warning,
								}}
							>
								<strong>Satellite Hotspot Notice:</strong> Thermal signature detected by satellite
								sensors. Represents radiative heat anomaly, not a verified ground perimeter or
								confirmed wildfire incident.
							</div>

							<div className="grid grid-cols-2 gap-2 text-xs">
								<div className="p-2 rounded-lg" style={{ background: ds.surface.overlaySubtle }}>
									<span className="block text-[10px]" style={{ color: ds.text.tertiary }}>
										Sensor Detections
									</span>
									<BdiLtr mono className="font-extrabold">
										{disaster.detectionCell.detectionCount.toLocaleString()}
									</BdiLtr>
								</div>
								<div className="p-2 rounded-lg" style={{ background: ds.surface.overlaySubtle }}>
									<span className="block text-[10px]" style={{ color: ds.text.tertiary }}>
										Peak Radiative Power
									</span>
									<BdiLtr mono className="font-extrabold">
										<span style={{ color: ds.colors.disaster.fire_detection }}>
											{disaster.detectionCell.maxFrp !== null
												? `${disaster.detectionCell.maxFrp} MW`
												: '—'}
										</span>
									</BdiLtr>
								</div>
								<div className="p-2 rounded-lg" style={{ background: ds.surface.overlaySubtle }}>
									<span className="block text-[10px]" style={{ color: ds.text.tertiary }}>
										Avg Radiative Power
									</span>
									<BdiLtr mono className="font-extrabold">
										{disaster.detectionCell.avgFrp !== null
											? `${disaster.detectionCell.avgFrp} MW`
											: '—'}
									</BdiLtr>
								</div>
								<div className="p-2 rounded-lg" style={{ background: ds.surface.overlaySubtle }}>
									<span className="block text-[10px]" style={{ color: ds.text.tertiary }}>
										Max Channel I-4 Temp
									</span>
									<BdiLtr mono className="font-extrabold">
										{disaster.detectionCell.maxBrightTi4 !== null
											? `${disaster.detectionCell.maxBrightTi4} K`
											: '—'}
									</BdiLtr>
								</div>
							</div>

							<div className="text-[11px] space-y-0.5" style={{ color: ds.text.tertiary }}>
								<div>
									Sensors:{' '}
									{Object.entries(disaster.detectionCell.satelliteCounts)
										.map(([s, c]) => `${s} (${c})`)
										.join(', ')}
								</div>
								<div>
									Overpasses: {disaster.detectionCell.dayNightCounts.day} Day /{' '}
									{disaster.detectionCell.dayNightCounts.night} Night
								</div>
							</div>
						</div>
					)}

					{/* Historical Volcano / Archive Context Notice */}
					{disaster.isArchived && (
						<div
							className="p-2.5 rounded-lg text-[11px] leading-relaxed border border-blue-400/35 bg-blue-500/10"
							style={{ color: ds.text.secondary }}
						>
							<strong style={{ color: ds.text.primary }}>Archived Observation:</strong> Loaded from
							the D1 historical archive (
							{disaster.archiveProvenance === 'reconstructed_backfill'
								? 'reconstructed backfill'
								: 'live captured'}
							). Verify active feeds before treating as ongoing.
						</div>
					)}

					{disaster.type === 'volcano' && disaster.isHistoricalContext && (
						<div
							className="p-2.5 rounded-lg text-[11px] leading-relaxed"
							style={{
								background: 'rgba(147, 51, 234, 0.1)',
								border: '1px solid rgba(147, 51, 234, 0.3)',
								color: ds.text.secondary,
							}}
						>
							<strong>Active Volcanic Context:</strong> Open volcanic event monitored for ongoing
							context. Initial activity report may precede current observation window.
						</div>
					)}

					{/* Derived AI Insight Card */}
					<div
						className="rounded-xl p-3.5 border space-y-2"
						style={{
							background: ds.surface.overlay,
							borderColor: ds.surface.border,
						}}
					>
						<div className="flex items-center justify-between gap-2">
							<div className="flex items-center gap-2">
								<div
									className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
									style={{
										background: 'rgba(59, 130, 246, 0.15)',
										border: '1px solid rgba(59, 130, 246, 0.3)',
									}}
								>
									<Sparkles size={14} style={{ color: ds.colors.accent.blueLight }} aria-hidden="true" />
								</div>
								<h3 className="text-xs sm:text-sm font-black" style={{ color: ds.text.primary }}>
									Derived AI Insight
								</h3>
							</div>
							<span
								className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider"
								style={{
									color: ds.text.tertiary,
									background: ds.surface.overlaySubtle,
								}}
							>
								{analysisState === 'ready' || analysisState === 'loading'
									? 'Workers AI'
									: analysisState.startsWith('error')
										? 'Unavailable'
										: analysisState === 'waiting-orbit' || analysisState === 'waiting'
											? 'Waiting'
											: 'Not requested'}
							</span>
						</div>

						<p
							data-testid="analysis-text"
							className="text-xs leading-relaxed"
							style={{
								color: analysisState.startsWith('error')
									? ds.colors.status.warning
									: ds.text.secondary,
							}}
						>
							{blockedAnalysisMessage(analysisState) ? (
								<span style={{ color: ds.text.tertiary }}>
									{blockedAnalysisMessage(analysisState)}
								</span>
							) : loadingAnalysis ? (
								<span className="inline-flex items-center gap-2">
									<span
										className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
										style={{ background: ds.colors.accent.blueLight }}
									/>
									<span className="font-medium" style={{ color: ds.colors.accent.blueLight }}>
										Analyzing satellite pass metadata...
									</span>
								</span>
							) : aiAnalysis && aiAnalysis.trim().length > 0 ? (
								aiAnalysis
							) : (
								<span className="italic" style={{ color: ds.text.tertiary }}>
									Waiting for analysis...
								</span>
							)}
						</p>
						<p className="text-[10px] leading-relaxed" style={{ color: ds.text.tertiary }}>
							AI-assisted metadata guidance from predicted pass, weather, and known sensors — not
							confirmed imagery or authoritative emergency instruction.
						</p>
						{analysisUnavailable && !loadingAnalysis && nextPass && cloudCover !== undefined && (
							<button
								type="button"
								onClick={handleRetryAnalysis}
								className="min-h-[36px] text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors"
								style={{
									color: ds.colors.accent.blueLight,
									background: ds.surface.overlaySubtle,
									borderColor: ds.surface.border,
								}}
							>
								Retry analysis
							</button>
						)}
					</div>

					{tleNotice && (
						<p
							data-testid="tle-notice"
							className="text-[11px]"
							style={{ color: ds.colors.status.warning }}
						>
							{tleNotice}
						</p>
					)}

					{/* Next Pass Countdown + Cloud Forecast Grid */}
					<div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2.5">
						{!nextPass && (
							<div
								data-testid="pass-status"
								className="rounded-xl p-3.5 border text-center text-xs"
								style={{
									background: ds.surface.overlay,
									borderColor: ds.surface.border,
									color:
										passState === 'unavailable'
											? ds.colors.status.warning
											: ds.text.secondary,
								}}
							>
								{passState === 'loading'
									? 'Calculating satellite passes...'
									: passState === 'no-pass'
										? `No monitored satellite pass above ${SATELLITE_ELEVATION_THRESHOLDS.MINIMUM}° elevation in the next 24 hours.`
										: orbitFailure?.code === 'invalid_coordinates'
											? 'Pass prediction unavailable: event coordinates are invalid.'
											: 'Pass prediction unavailable: orbital data could not be loaded.'}
								{passState === 'unavailable' &&
									orbitFailure &&
									orbitFailure.code !== 'invalid_coordinates' && (
										<>
											{orbitFailure.retryAfterSeconds !== null && (
												<span
													className="block mt-1 text-[10px]"
													style={{ color: ds.text.tertiary }}
												>
													The server will try the orbital-data provider again in about{' '}
													{Math.max(1, Math.ceil(orbitFailure.retryAfterSeconds / 60))} min.
												</span>
											)}
											<button
												type="button"
												data-testid="retry-orbital-data"
												onClick={handleRetryOrbitalData}
												className="mt-2 min-h-[36px] text-xs font-semibold px-3 py-1.5 rounded-lg border"
												style={{
													color: ds.colors.accent.blueLight,
													background: ds.surface.overlaySubtle,
													borderColor: ds.surface.border,
												}}
											>
												Retry orbital data
											</button>
										</>
									)}
							</div>
						)}

						{nextPass && (
							<div
								className="rounded-xl p-3.5 border text-center"
								style={{
									background: ds.surface.overlay,
									borderColor: ds.surface.border,
								}}
							>
								<p
									className="uppercase font-bold text-[10px] tracking-wider mb-2"
									style={{ color: ds.text.tertiary }}
								>
									{nextPass.satelliteName.replace(/[-_]/g, ' ')}
								</p>
								<BdiLtr
									mono
									className="block text-2xl font-black tracking-tight mb-1"
								>
									{timeUntilPass || '00:00:00'}
								</BdiLtr>
								<p
									data-testid="pass-note"
									className="text-[10px] leading-relaxed mt-2"
									style={{ color: ds.text.tertiary }}
								>
									First 5-minute sample at or above{' '}
									{passThreshold ?? SATELLITE_ELEVATION_THRESHOLDS.OPTIMAL}° elevation (
									{nextPass.elevation.toFixed(0)}° at that sample; not the exact rise or peak),
									propagated from orbital elements
									{tleOldestEpoch ? ` with epochs from ${tleOldestEpoch} UTC or later` : ''}. A
									predicted pass does not guarantee the sensor images this location.
								</p>
							</div>
						)}

						{/* Cloud Forecast */}
						<div
							className="rounded-xl p-3.5 border"
							style={{
								background: ds.surface.overlay,
								borderColor: ds.surface.border,
							}}
						>
							<div className="flex items-start justify-between mb-2">
								<Cloud size={16} style={{ color: '#38bdf8' }} aria-hidden="true" />
								<span
									className="w-1.5 h-1.5 rounded-full"
									style={{ background: '#4ade80' }}
									aria-hidden="true"
								/>
							</div>

							<p
								className="uppercase font-bold text-[10px] tracking-wider mb-1.5"
								style={{ color: ds.text.tertiary }}
							>
								Cloud Forecast
							</p>

							{cloudCover === undefined ? (
								<p className="text-xs" style={{ color: ds.text.tertiary }}>
									Loading...
								</p>
							) : cloudCover === null ? (
								<>
									<div className="text-lg font-black mb-0.5" style={{ color: ds.text.primary }}>
										Unknown
									</div>
									<p className="text-[11px]" style={{ color: ds.text.secondary }}>
										Weather data unavailable
									</p>
								</>
							) : (
								<>
									<div className="flex items-baseline gap-1 mb-0.5">
										<BdiLtr mono className="text-2xl font-black">
											{cloudCover}%
										</BdiLtr>
									</div>
									<p className="text-[11px] font-medium" style={{ color: ds.text.secondary }}>
										{cloudCover < 20 ? 'Clear' : cloudCover < 60 ? 'Partly Cloudy' : 'Overcast'}
									</p>
								</>
							)}

							{passState === 'no-pass' && typeof cloudCover === 'number' && (
								<p className="text-[10px] mt-2" style={{ color: ds.text.tertiary }}>
									Forecast for ~2 h from now (no pass predicted)
								</p>
							)}
							{nextPass && (
								<p
									className="text-[10px] font-medium mt-2.5 pt-2 border-t"
									style={{
										color: ds.text.tertiary,
										borderColor: ds.surface.borderSubtle,
									}}
								>
									<BdiLtr mono>
										{nextPass.time.toLocaleTimeString([], {
											hour: '2-digit',
											minute: '2-digit',
											timeZone: 'UTC',
										})}{' '}
										UTC
									</BdiLtr>{' '}
									<span>
										(
										<BdiLtr>
											{nextPass.time.toLocaleTimeString([], {
												hour: '2-digit',
												minute: '2-digit',
												timeZoneName: 'short',
											})}
										</BdiLtr>
										)
									</span>
								</p>
							)}
						</div>
					</div>
				</div>

				{/* TAB 2: IMAGERY (Optical/Thermal GIBS + Copernicus Sentinel-1 SAR) */}
				<div
					role="tabpanel"
					id="inspector-panel-imagery"
					aria-labelledby="inspector-tab-imagery"
					className={activeTab === 'imagery' ? 'space-y-3' : 'hidden'}
				>
					<SatelliteImagery
						lat={disaster.lat}
						lng={disaster.lng}
						disasterType={disaster.type === 'fire_detection' ? 'fire' : disaster.type}
						date={disaster.date}
						title={disaster.title}
					/>
					<SarScenesPanel
						lat={disaster.lat}
						lng={disaster.lng}
						eventDateIso={disaster.date}
					/>
				</div>

				{/* TAB 3: PASSES (Multi-Satellite Fleet Comparison & .ics Export) */}
				<div
					role="tabpanel"
					id="inspector-panel-passes"
					aria-labelledby="inspector-tab-passes"
					className={activeTab === 'passes' ? 'space-y-3' : 'hidden'}
				>
					{allFleetPasses.length > 0 ? (
						<PassComparisonPanel
							eventTitle={disaster.title}
							lat={disaster.lat}
							lng={disaster.lng}
							passes={allFleetPasses}
							hourlyWeather={hourlyWeather}
							tleOldestEpoch={tleOldestEpoch}
						/>
					) : (
						<div
							data-testid="passes-empty-state"
							className="rounded-xl p-4 border text-xs space-y-2"
							style={{
								background: ds.surface.overlay,
								borderColor: ds.surface.border,
								color: ds.text.secondary,
							}}
						>
							<p className="font-bold" style={{ color: ds.text.primary }}>
								{passState === 'loading'
									? 'Propagating satellite fleet orbits…'
									: passState === 'unavailable'
										? 'Predicted pass schedule unavailable'
										: 'No upcoming monitored fleet passes in the next 24 hours'}
							</p>
							<p style={{ color: ds.text.tertiary }}>
								{passState === 'unavailable'
									? 'Orbital TLE elements could not be loaded. Use Overview to retry orbital data.'
									: 'Predicted overpasses depend on orbital geometry and do not confirm sensor imaging.'}
							</p>
						</div>
					)}
				</div>
			</div>
		</aside>
	);
}
