/**
 * Sidebar Component - Coverage Analysis Panel
 * Shows satellite pass predictions, weather, and AI analysis
 */

import { useEffect, useRef, useState } from 'react';
import { X, Sparkles, Cloud, Satellite } from 'lucide-react';
import type { Disaster, WeatherData, AIAnalysisResponse } from '../types';
import { getNextPass, predictPasses, type SatellitePass } from '../utils/orbitalEngine';
import SatelliteImagery from './SatelliteImagery';
import { useDesignSystem } from '../hooks/useDesignSystem';
import { apiUrl } from '../config/api';
import { debugLog } from '../utils/debug';
import {
    analysisRequestIdentity,
    isCurrentGeneration,
    nextGeneration,
} from '../utils/selectionGeneration';

interface SidebarProps {
    disaster: Disaster | null;
    onClose: () => void;
    isOpen: boolean;
}

const SATELLITE_ELEVATION_THRESHOLDS = {
    OPTIMAL: 25,
    ACCEPTABLE: 15,
    MINIMUM: 5
} as const;

type CloudState = number | null | undefined;
type PassState = 'loading' | 'pass' | 'no-pass' | 'unavailable';

/** Partial/retained TLE status reported by /api/tles response headers. */
function describeTleHeaders(headers: Headers): string | null {
    const status = headers.get('X-TLE-Status');
    const missing = headers.get('X-TLE-Missing');
    const retained = headers.get('X-TLE-Retained');
    const notes: string[] = [];
    if (status === 'partial' && missing) {
        notes.push(`Orbital elements unavailable for ${missing.split(',').length} of 6 monitored satellites`);
    }
    if (retained) {
        notes.push(`${retained.split(',').length} satellite(s) use cached elements pending refresh`);
    }
    return notes.length ? `${notes.join('; ')}.` : null;
}

export default function Sidebar({ disaster, onClose, isOpen = true }: SidebarProps) {
    const ds = useDesignSystem();
    const [nextPass, setNextPass] = useState<SatellitePass | null>(null);
    const [passState, setPassState] = useState<PassState>('loading');
    const [tleNotice, setTleNotice] = useState<string | null>(null);
    const [cloudCover, setCloudCover] = useState<CloudState>(undefined);
    const [aiAnalysis, setAiAnalysis] = useState<string>('');
    const [analysisUnavailable, setAnalysisUnavailable] = useState(false);
    const [loadingAnalysis, setLoadingAnalysis] = useState(false);
    const [timeUntilPass, setTimeUntilPass] = useState<string>('');
    const [retryToken, setRetryToken] = useState(0);
    const selectionGenRef = useRef(0);
    const inFlightKeyRef = useRef<string | null>(null);
    const analyzeAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!disaster) return;

        const generation = nextGeneration(selectionGenRef.current);
        selectionGenRef.current = generation;
        inFlightKeyRef.current = null;
        analyzeAbortRef.current?.abort();
        analyzeAbortRef.current = null;

        setNextPass(null);
        setPassState('loading');
        setTleNotice(null);
        setCloudCover(undefined);
        setAiAnalysis('');
        setAnalysisUnavailable(false);
        setLoadingAnalysis(false);
        setTimeUntilPass('');
        setRetryToken(0);

        const tleAbort = new AbortController();

        const fetchWeather = async (lat: number, lng: number, passTime: Date) => {
            try {
                // Request explicit UTC hourly forecasts to avoid local solar time ambiguity
                const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=cloud_cover&forecast_days=2&timezone=UTC`;
                debugLog('weather', `Fetching weather for (${lat.toFixed(2)}, ${lng.toFixed(2)})`, 'info');
                const response = await fetch(url, { signal: tleAbort.signal });
                if (!response.ok) throw new Error(`Weather API error: ${response.status}`);
                const data: WeatherData = await response.json();
                if (!isCurrentGeneration(generation, selectionGenRef.current)) return;
                if (!data.hourly || !Array.isArray(data.hourly.cloud_cover) || !Array.isArray(data.hourly.time) || data.hourly.time.length === 0) {
                    setCloudCover(null);
                    return;
                }

                // Match nearest hour to predicted pass time (within 2-hour window)
                let nearestIdx = -1;
                let minDiffMs = Infinity;
                const passTimeMs = passTime.getTime();

                for (let i = 0; i < data.hourly.time.length; i++) {
                    const tStr = data.hourly.time[i];
                    // Open-Meteo returns ISO strings (e.g. 2026-10-10T12:00); with timezone=UTC, treat strictly as UTC
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

                const MAX_WEATHER_DIFF_MS = 2 * 60 * 60 * 1000; // 2 hours
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
                debugLog('tles', `Fetching TLEs from ${apiUrl('/api/tles')}`, 'info');
                const tleResponse = await fetch(apiUrl('/api/tles'), { signal: tleAbort.signal });
                const contentType = tleResponse.headers.get('content-type') || '';
                const isJson = contentType.includes('application/json');
                if (!tleResponse.ok) {
                    const errorText = isJson ? JSON.stringify(await tleResponse.json()) : await tleResponse.text();
                    throw new Error(`TLE API error: ${tleResponse.status} - ${errorText}`);
                }
                const responseText = await tleResponse.text();
                if (!isCurrentGeneration(generation, selectionGenRef.current)) return;
                setTleNotice(describeTleHeaders(tleResponse.headers));
                if (isJson || responseText.trim().startsWith('{') || responseText.trim().startsWith('[')) {
                    try {
                        const errorData = JSON.parse(responseText) as { error?: string };
                        throw new Error(`TLE API error: ${errorData.error || JSON.stringify(errorData)}`);
                    } catch (err) {
                        if (err instanceof Error && err.message.startsWith('TLE API error')) throw err;
                    }
                }
                if (!responseText.trim()) throw new Error('TLE data is empty');
                const tleLines = responseText.trim().split('\n').filter((line) => line.trim().length > 0);
                if (tleLines.length < 3) throw new Error(`Invalid TLE data: expected at least 3 lines, got ${tleLines.length}`);

                const latNum = disaster.lat;
                const lngNum = disaster.lng;
                if (!Number.isFinite(latNum) || !Number.isFinite(lngNum) || Math.abs(latNum) > 90 || Math.abs(lngNum) > 180) {
                    setAiAnalysis('Invalid coordinates. Unable to calculate satellite passes.');
                    setAnalysisUnavailable(true);
                    setPassState('unavailable');
                    setCloudCover(null);
                    return;
                }

                let pass = getNextPass(responseText, latNum, lngNum);
                if (!pass) {
                    const lower = predictPasses(responseText, latNum, lngNum, SATELLITE_ELEVATION_THRESHOLDS.ACCEPTABLE);
                    if (lower.length > 0) pass = lower[0];
                }
                if (!pass) {
                    const min = predictPasses(responseText, latNum, lngNum, SATELLITE_ELEVATION_THRESHOLDS.MINIMUM);
                    if (min.length > 0) pass = min[0];
                }
                if (!isCurrentGeneration(generation, selectionGenRef.current)) return;

                if (!pass) {
                    setNextPass(null);
                    setPassState('no-pass');
                    setAiAnalysis('No satellite passes detected in the next 24 hours. Coverage unavailable.');
                    setAnalysisUnavailable(true);
                    await fetchWeather(latNum, lngNum, new Date(Date.now() + 2 * 60 * 60 * 1000));
                    return;
                }
                setNextPass(pass);
                setPassState('pass');
                await fetchWeather(latNum, lngNum, pass.time);
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') return;
                if (!isCurrentGeneration(generation, selectionGenRef.current)) return;
                debugLog('tles', 'FAILED to fetch TLEs', 'error');
                setAiAnalysis('Unable to retrieve satellite data.');
                setAnalysisUnavailable(true);
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
    }, [disaster]);

    useEffect(() => {
        if (!nextPass) return;
        const updateTimer = () => {
            const diff = nextPass.time.getTime() - Date.now();
            if (diff > 0) {
                const hours = Math.floor(diff / (1000 * 60 * 60)).toString().padStart(2, '0');
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
                const seconds = Math.floor((diff % (1000 * 60)) / 1000).toString().padStart(2, '0');
                setTimeUntilPass(`${hours}:${minutes}:${seconds}`);
            } else setTimeUntilPass('PASSING');
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
            disasterType: disaster.type,
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
                // Aborting the client fetch does not cancel remote Workers AI inference once accepted.

                const responseText = await response.text();
                let data: AIAnalysisResponse = {};
                try { data = JSON.parse(responseText) as AIAnalysisResponse; } catch { /* ignore */ }
                if (!isCurrentGeneration(generation, selectionGenRef.current)) return;

                if (!response.ok) {
                    setAnalysisUnavailable(true);
                    setAiAnalysis(data.message || data.error || `Analysis unavailable (${response.status})`);
                    return;
                }
                if (!data.analysis || data.analysis.trim().length === 0 || data.source !== 'workers-ai') {
                    setAnalysisUnavailable(true);
                    setAiAnalysis('Analysis unavailable: empty or unexpected response.');
                    return;
                }
                setAiAnalysis(data.analysis.trim());
                setAnalysisUnavailable(false);
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') return;
                if (!isCurrentGeneration(generation, selectionGenRef.current)) return;
                setAnalysisUnavailable(true);
                setAiAnalysis('Analysis unavailable. Map and satellite tools remain usable.');
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
        setRetryToken((t) => t + 1);
    };

    if (!disaster) {

        return null;
    }

    // Removed excessive logging on every render - only log on mount or disaster change

    return (
        <div
            className={`sidebar-container flex flex-col overflow-hidden transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'
                }`}
            data-testid="sidebar"
            data-disaster-id={disaster.id}
            data-pass-state={passState}
            data-pass-satellite={nextPass?.satelliteName ?? ''}
            data-pass-time={nextPass ? nextPass.time.toISOString() : ''}
            data-weather-state={cloudCover === undefined ? 'loading' : cloudCover === null ? 'unavailable' : 'known'}
            data-cloud-cover={typeof cloudCover === 'number' ? String(cloudCover) : ''}
            style={{
                ...ds.glass.panel,
                borderLeft: `1px solid ${ds.headerBorderColor}`,
            }}
        >
            {/* Header - COMPACT */}
            <div
                className="flex items-center justify-between flex-shrink-0"
                style={{
                    padding: '16px 20px 14px',
                    borderBottom: `1px solid ${ds.surface.border}`,
                }}
            >
                <div className="flex items-center" style={{ gap: '12px' }}>
                    {/* Icon Badge */}
                    <div
                        className="flex items-center justify-center"
                        style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: ds.borderRadius.lg,
                            background: `linear-gradient(135deg, ${ds.colors.accent.blueDim}, rgba(37, 99, 235, 0.15))`,
                            border: `2px solid ${ds.colors.accent.blue}66`,
                            boxShadow: `0 3px 12px ${ds.colors.accent.blue}40`,
                        }}
                    >
                        <Satellite
                            size={20}
                            style={{
                                color: ds.colors.accent.blueLight,
                                strokeWidth: 2.5,
                            }}
                        />
                    </div>

                    {/* Title */}
                    <div>
                        <h2
                            className="font-black tracking-tight leading-none"
                            style={{
                                fontSize: '1.25rem',
                                color: ds.text.primary,
                                marginBottom: '3px',
                            }}
                        >
                            Coverage Analysis
                        </h2>
                        <p
                            className="text-xs font-semibold leading-none"
                            style={{
                                color: ds.text.tertiary,
                                fontSize: '0.6875rem',
                            }}
                        >
                            Satellite intelligence & AI insights
                        </p>
                    </div>
                </div>

                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="transition-all duration-200 hover:scale-110 hover:rotate-90"
                    style={{
                        width: '32px',
                        height: '32px',
                        padding: '6px',
                        borderRadius: '10px',
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        color: '#f87171',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                    aria-label="Close"
                >
                    <X size={16} strokeWidth={2.5} />
                </button>
            </div>

            {/* Scrollable Content - COMPACT */}
            <div
                className="flex-1 overflow-y-auto custom-scrollbar"
                style={{
                    padding: '16px 20px',
                }}
            >

                {/* AI Insight Card - REDESIGNED */}
                <div
                    className="relative overflow-hidden transition-all duration-200"
                    style={{
                        padding: '14px',
                        borderRadius: ds.borderRadius.lg,
                        background: ds.surface.overlay,
                        border: `1px solid ${ds.surface.border}`,
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                        marginBottom: '12px',
                    }}
                >
                    {/* Header */}
                    <div
                        className="flex items-center justify-between relative z-10"
                        style={{ marginBottom: '10px' }}
                    >
                        <div className="flex items-center" style={{ gap: '10px' }}>
                            <div
                                style={{
                                    width: '30px',
                                    height: '30px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: '8px',
                                    background: 'rgba(59, 130, 246, 0.15)',
                                    border: `1px solid rgba(59, 130, 246, 0.3)`,
                                }}
                            >
                                <Sparkles size={14} style={{ color: ds.colors.accent.blueLight }} />
                            </div>
                            <h3
                                className="font-black tracking-tight"
                                style={{
                                    fontSize: '0.875rem',
                                    color: ds.text.primary,
                                }}
                            >
                                AI Insight
                            </h3>
                        </div>
                        <span
                            className="text-xs font-bold px-2 py-1 rounded-md"
                            style={{
                                fontSize: '0.625rem',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                color: ds.text.tertiary,
                                background: ds.surface.overlaySubtle,
                            }}
                        >
                            {analysisUnavailable ? 'Unavailable' : 'Workers AI'}
                        </span>
                    </div>

                    {/* Content */}
                    <p
                        className="leading-relaxed relative z-10"
                        style={{
                            fontSize: '0.75rem',
                            color: analysisUnavailable ? ds.colors.status.warning : ds.text.secondary,
                        }}
                    >
                        {loadingAnalysis ? (
                            <span className="flex items-center gap-2">
                                <span
                                    className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                                    style={{ background: ds.colors.accent.blueLight }}
                                />
                                <span
                                    className="font-medium"
                                    style={{ color: ds.colors.accent.blueLight }}
                                >
                                    Analyzing satellite pass metadata...
                                </span>
                            </span>
                        ) : aiAnalysis && aiAnalysis.trim().length > 0 ? (
                            aiAnalysis
                        ) : (
                            <span
                                className="italic"
                                style={{ color: ds.text.tertiary }}
                            >
                                Waiting for analysis...
                            </span>
                        )}
                    </p>
                    <p
                        className="relative z-10"
                        style={{
                            fontSize: '0.625rem',
                            color: ds.text.tertiary,
                            marginTop: '8px',
                            lineHeight: 1.4,
                        }}
                    >
                        AI-assisted metadata guidance from predicted pass, weather, and known sensors —
                        not confirmed imagery or authoritative emergency instruction.
                    </p>
                    {analysisUnavailable && !loadingAnalysis && nextPass && cloudCover !== undefined && (
                        <button
                            type="button"
                            onClick={handleRetryAnalysis}
                            className="relative z-10 mt-2 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
                            style={{
                                color: ds.colors.accent.blueLight,
                                background: ds.surface.overlaySubtle,
                                border: `1px solid ${ds.surface.border}`,
                            }}
                        >
                            Retry analysis
                        </button>
                    )}
                </div>

                {/* Satellite Imagery */}
                {disaster && (
                    <SatelliteImagery
                        lat={disaster.lat}
                        lng={disaster.lng}
                        disasterType={disaster.type}
                        date={disaster.date}
                        title={disaster.title}
                    />
                )}

                {tleNotice && (
                    <p
                        data-testid="tle-notice"
                        style={{ fontSize: '0.6875rem', color: ds.colors.status.warning, marginBottom: '8px' }}
                    >
                        {tleNotice}
                    </p>
                )}

                {/* Two-Column Grid: Countdown + Cloud Forecast - COMPACT */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                    {!nextPass && (
                        <div
                            data-testid="pass-status"
                            className="text-center"
                            style={{
                                padding: '14px',
                                borderRadius: ds.borderRadius.lg,
                                background: ds.surface.overlay,
                                border: `1px solid ${ds.surface.border}`,
                                fontSize: '0.75rem',
                                color: passState === 'unavailable' ? ds.colors.status.warning : ds.text.secondary,
                            }}
                        >
                            {passState === 'loading'
                                ? 'Calculating satellite passes...'
                                : passState === 'no-pass'
                                    ? `No monitored satellite pass above ${SATELLITE_ELEVATION_THRESHOLDS.MINIMUM}° elevation in the next 24 hours.`
                                    : 'Pass prediction unavailable (orbital data could not be loaded).'}
                        </div>
                    )}
                    {/* Countdown Timer */}
                    {nextPass && (
                        <div
                            className="text-center relative overflow-hidden"
                            style={{
                                padding: '14px',
                                borderRadius: ds.borderRadius.lg,
                                background: ds.surface.overlay,
                                border: `1px solid ${ds.surface.border}`,
                                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                            }}
                        >
                            <p
                                className="uppercase font-bold"
                                style={{
                                    fontSize: '0.625rem',
                                    letterSpacing: '0.05em',
                                    color: ds.text.tertiary,
                                    marginBottom: '10px',
                                }}
                            >
                                {nextPass.satelliteName.replace(/[-_]/g, ' ')}
                            </p>

                            <div className="relative z-10">
                                <div
                                    className="font-black font-mono tracking-tight tabular-nums"
                                    style={{
                                        fontSize: '1.875rem',
                                        color: ds.text.primary,
                                        marginBottom: '4px',
                                    }}
                                >
                                    {timeUntilPass || '00:00:00'}
                                </div>
                                <div
                                    style={{
                                        height: '2px',
                                        width: '40px',
                                        margin: '0 auto',
                                        borderRadius: '2px',
                                        background: `linear-gradient(90deg, transparent, ${ds.colors.accent.blue}, transparent)`,
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Cloud Forecast */}
                    <div
                        className="relative overflow-hidden"
                        style={{
                            padding: '14px',
                            borderRadius: ds.borderRadius.lg,
                            background: ds.surface.overlay,
                            border: `1px solid ${ds.surface.border}`,
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                        }}
                    >
                        <div
                            className="flex items-start justify-between"
                            style={{ marginBottom: '8px' }}
                        >
                            <Cloud size={16} style={{ color: '#38bdf8' }} />
                            <div
                                className="w-1.5 h-1.5 rounded-full"
                                style={{
                                    background: '#4ade80',
                                    boxShadow: '0 0 8px rgba(74, 222, 128, 0.8)',
                                }}
                            />
                        </div>

                        <p
                            className="uppercase font-bold"
                            style={{
                                fontSize: '0.625rem',
                                letterSpacing: '0.05em',
                                color: ds.text.tertiary,
                                marginBottom: '8px',
                            }}
                        >
                            Cloud Forecast
                        </p>

                        {cloudCover === undefined ? (
                            <p
                                className="text-xs"
                                style={{ color: ds.text.tertiary }}
                            >
                                Loading...
                            </p>
                        ) : cloudCover === null ? (
                            <>
                                <div
                                    className="font-black"
                                    style={{ fontSize: '1.25rem', color: ds.text.primary, marginBottom: '4px' }}
                                >
                                    Unknown
                                </div>
                                <p
                                    className="font-medium"
                                    style={{ fontSize: '0.6875rem', color: ds.text.secondary }}
                                >
                                    Weather data unavailable
                                </p>
                            </>
                        ) : (
                            <>
                                <div className="flex items-baseline gap-1" style={{ marginBottom: '4px' }}>
                                    <span
                                        className="font-black tabular-nums"
                                        style={{
                                            fontSize: '1.5rem',
                                            color: ds.text.primary,
                                        }}
                                    >
                                        {cloudCover}
                                    </span>
                                    <span
                                        className="font-bold"
                                        style={{
                                            fontSize: '0.875rem',
                                            color: ds.text.tertiary,
                                        }}
                                    >
                                        %
                                    </span>
                                </div>
                                <p
                                    className="font-medium"
                                    style={{
                                        fontSize: '0.6875rem',
                                        color: ds.text.secondary,
                                    }}
                                >
                                    {cloudCover < 20 ? 'Clear' : cloudCover < 60 ? 'Partly Cloudy' : 'Overcast'}
                                </p>
                            </>
                        )}

                        {passState === 'no-pass' && typeof cloudCover === 'number' && (
                            <p style={{ fontSize: '0.5625rem', color: ds.text.tertiary, marginTop: '8px' }}>
                                Forecast for ~2 h from now (no pass predicted)
                            </p>
                        )}
                        {nextPass && (
                            <p
                                className="font-medium"
                                style={{
                                    fontSize: '0.5625rem',
                                    color: ds.text.tertiary,
                                    marginTop: '10px',
                                    paddingTop: '8px',
                                    borderTop: `1px solid ${ds.surface.border}`,
                                }}
                            >
                                {nextPass.time.toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    timeZone: 'UTC'
                                })} UTC
                                <span style={{ color: ds.text.tertiary, marginLeft: '4px' }}>
                                    ({nextPass.time.toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    })} local)
                                </span>
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}


