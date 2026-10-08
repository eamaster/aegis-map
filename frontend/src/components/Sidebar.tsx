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
import { API_BASE } from '../config/api';
import { debugLog } from '../utils/debug';

interface SidebarProps {
    disaster: Disaster | null;
    onClose: () => void;
    isOpen: boolean;
}

/**
 * Satellite Elevation Thresholds
 * - OPTIMAL: Best quality imagery (>25°)
 * - ACCEPTABLE: Degraded but usable (>15°)
 * - MINIMUM: Last resort, significant quality loss (>5°)
 */
const SATELLITE_ELEVATION_THRESHOLDS = {
    OPTIMAL: 25,
    ACCEPTABLE: 15,
    MINIMUM: 5
} as const;

type CloudState = number | null | undefined; // undefined = still loading; null = unavailable

function analysisRequestKey(
    disasterId: string,
    satelliteName: string,
    passIso: string,
    cloud: number | null,
): string {
    return `${disasterId}|${satelliteName}|${passIso}|${cloud === null ? 'unknown' : cloud}`;
}

export default function Sidebar({ disaster, onClose, isOpen = true }: SidebarProps) {
    const ds = useDesignSystem();
    const [nextPass, setNextPass] = useState<SatellitePass | null>(null);
    const [cloudCover, setCloudCover] = useState<CloudState>(undefined);
    const [aiAnalysis, setAiAnalysis] = useState<string>('');
    const [analysisUnavailable, setAnalysisUnavailable] = useState(false);
    const [loadingAnalysis, setLoadingAnalysis] = useState(false);
    const [timeUntilPass, setTimeUntilPass] = useState<string>('');
    const analysisSeqRef = useRef(0);
    const inFlightKeyRef = useRef<string | null>(null);

    // Fetch TLE data and calculate next pass
    useEffect(() => {
        if (!disaster) return;

        // Reset state when disaster changes
        analysisSeqRef.current += 1;
        inFlightKeyRef.current = null;
        setNextPass(null);
        setCloudCover(undefined);
        setAiAnalysis('');
        setAnalysisUnavailable(false);
        setLoadingAnalysis(false);
        setTimeUntilPass('');

        const fetchData = async () => {
            try {

                // DEBUG: Log TLE fetch
                debugLog(
                    'tles',
                    `Fetching TLEs from ${API_BASE}/api/tles`,
                    'info'
                );

                // Fetch TLEs

                const tleResponse = await fetch(`${API_BASE}/api/tles`);

                // Check content type to determine if it's JSON (error) or text (TLE data)
                const contentType = tleResponse.headers.get('content-type') || '';
                const isJson = contentType.includes('application/json');

                if (!tleResponse.ok) {
                    const errorText = isJson ? JSON.stringify(await tleResponse.json()) : await tleResponse.text();
                    throw new Error(`TLE API error: ${tleResponse.status} ${tleResponse.statusText} - ${errorText}`);
                }

                // Get response text (it could be TLE data or JSON error)
                const responseText = await tleResponse.text();

                // If response looks like JSON (starts with { or [), it's likely an error message
                if (isJson || (responseText.trim().startsWith('{') || responseText.trim().startsWith('['))) {
                    try {
                        const errorData = JSON.parse(responseText) as { error?: string };
                        console.error('❌ TLE API returned JSON (error):', errorData);
                        throw new Error(`TLE API error: ${errorData.error || JSON.stringify(errorData)}`);
                    } catch (err) {
                        if (err instanceof Error && err.message.startsWith('TLE API error')) {
                            throw err;
                        }
                        console.warn('⚠️ Response looked like JSON but parse failed, treating as text');
                    }
                }

                const tles = responseText;

                // Log raw response for debugging
                if (!tles || tles.trim().length === 0) {
                    throw new Error('TLE data is empty - no data received from API');
                }

                const tleLines = tles.trim().split('\n').filter(line => line.trim().length > 0);
                const satelliteCount = Math.floor(tleLines.length / 3);

                if (tleLines.length < 3) {
                    console.error('❌ Invalid TLE data details:', {
                        receivedLength: tles.length,
                        lineCount: tleLines.length,
                        first100Chars: tles.substring(0, 100),
                        isJson: tles.trim().startsWith('{'),
                        responseText: tles.substring(0, 500)
                    });
                    throw new Error(`Invalid TLE data: expected at least 3 lines, got ${tleLines.length}. Raw response: ${tles.substring(0, 200)}`);
                }

                // DEBUG: Validate TLE format
                if (tleLines.length % 3 !== 0) {
                    debugLog(
                        'tles',
                        `WARNING: TLE format incorrect. Expected multiple of 3 lines, got ${tleLines.length}`,
                        'warning'
                    );
                }

                debugLog(
                    'tles',
                    `Loaded TLEs for ${satelliteCount} satellites`,
                    ' success',
                    { satellites: satelliteCount, lines: tleLines.length }
                );

                const latNum = disaster.lat;
                const lngNum = disaster.lng;

                // Validate coordinates - allow (0,0) which is a valid location (Gulf of Guinea)
                if (isNaN(latNum) || isNaN(lngNum) ||
                    Math.abs(latNum) > 90 || Math.abs(lngNum) > 180) {
                    console.error('❌ Invalid coordinates in sidebar:', { latNum, lngNum, disaster });
                    setAiAnalysis("Invalid coordinates. Unable to calculate satellite passes.");
                    setAnalysisUnavailable(true);
                    return;
                }

                // Calculate next pass

                debugLog(
                    'orbital',
                    `Calculating satellite passes for disaster at (${latNum}, ${lngNum})`,
                    'info'
                );

                // Try with lower elevation threshold if no passes found
                let pass = getNextPass(tles, latNum, lngNum); // Uses OPTIMAL threshold (25°)

                // If no pass found with optimal threshold, try acceptable threshold
                if (!pass) {
                    const lowerPasses = predictPasses(tles, latNum, lngNum, SATELLITE_ELEVATION_THRESHOLDS.ACCEPTABLE);
                    if (lowerPasses.length > 0) {
                        pass = lowerPasses[0];
                    }
                }

                // If still no pass, try minimum threshold as last resort
                if (!pass) {
                    const evenLowerPasses = predictPasses(tles, latNum, lngNum, SATELLITE_ELEVATION_THRESHOLDS.MINIMUM);
                    if (evenLowerPasses.length > 0) {
                        pass = evenLowerPasses[0];
                    }
                }



                if (!pass) {
                    console.warn('⚠️ No satellite passes found in next 24 hours even with lower threshold');
                    debugLog(
                        'orbital',
                        'No satellite passes found in next 24 hours',
                        'warning'
                    );
                    setNextPass(null);
                    setAiAnalysis("No satellite passes detected in the next 24 hours. Coverage unavailable.");
                    setAnalysisUnavailable(true);
                    // Still fetch weather to show cloud cover for context
                    fetchWeather(latNum, lngNum, new Date(Date.now() + 2 * 60 * 60 * 1000));
                    return;
                } else {
                    const timeUntil = (pass.time.getTime() - new Date().getTime()) / 1000 / 60; // minutes
                    debugLog(
                        'orbital',
                        `Next pass: ${pass.satelliteName} at ${pass.time.toLocaleString()} (in ${Math.round(timeUntil)} min) - Elevation: ${pass.elevation.toFixed(1)}°`,
                        'success',
                        { satellite: pass.satelliteName, elevation: pass.elevation, azimuth: pass.azimuth, time: pass.time.toISOString() }
                    );
                }

                setNextPass(pass);

                // Fetch weather data
                fetchWeather(latNum, lngNum, pass.time);
            } catch (error) {
                console.error('❌ Error fetching data in sidebar:', error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error('Error details:', { error, errorMessage, stack: error instanceof Error ? error.stack : undefined });
                debugLog(
                    'tles',
                    `FAILED to fetch TLEs: ${errorMessage}`,
                    'error',
                    { error: errorMessage, fullError: error }
                );
                setAiAnalysis(`Unable to retrieve satellite data: ${errorMessage}`);
                setAnalysisUnavailable(true);
                setNextPass(null);
                setCloudCover(null);
            }
        };

        fetchData();
    }, [disaster]);

    // Fetch weather data from Open-Meteo
    const fetchWeather = async (lat: number, lng: number, passTime: Date) => {
        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=cloud_cover&forecast_days=2`;

            debugLog(
                'weather',
                `Fetching weather for (${lat.toFixed(2)}, ${lng.toFixed(2)})`,
                'info'
            );

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Weather API error: ${response.status} ${response.statusText}`);
            }
            const data: WeatherData = await response.json();
            if (!data.hourly || !data.hourly.cloud_cover) {
                debugLog(
                    'weather',
                    'WARNING: Invalid weather data format',
                    'warning',
                    data
                );
                setCloudCover(null);
                return;
            }

            // Find cloud cover closest to pass time
            const closestIndex = data.hourly.time.findIndex(
                (time) => {
                    // Open-Meteo returns time as "YYYY-MM-DDTHH:MM" (no offset) — treat as UTC
                    const weatherTime = new Date(time + 'Z');
                    return weatherTime >= passTime;
                }
            );

            if (closestIndex >= 0) {
                const cloudValue = data.hourly.cloud_cover[closestIndex];
                setCloudCover(cloudValue);
                debugLog(
                    'weather',
                    `Cloud coverage at pass time: ${cloudValue}% (${cloudValue < 20 ? 'Clear' : 'Cloudy'})`,
                    'success',
                    { cloudCover: cloudValue, time: data.hourly.time[closestIndex] }
                );
            } else {
                console.warn('⚠️ Could not find cloud data for pass time:', passTime.toISOString());
                debugLog(
                    'weather',
                    'WARNING: Could not find cloud data for pass time',
                    'warning'
                );
                setCloudCover(null);
            }
        } catch (error) {
            console.error('❌ Error fetching weather:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            debugLog(
                'weather',
                `FAILED to fetch weather: ${errorMessage}`,
                'error',
                { error: errorMessage, fullError: error }
            );
            // Unknown weather — never coerce to 0 (clear skies)
            setCloudCover(null);
        }
    };

    // Update countdown timer
    useEffect(() => {
        if (!nextPass) return;

        const updateTimer = () => {
            const now = new Date();
            const diff = nextPass.time.getTime() - now.getTime();

            if (diff > 0) {
                const hours = Math.floor(diff / (1000 * 60 * 60)).toString().padStart(2, '0');
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
                const seconds = Math.floor((diff % (1000 * 60)) / 1000).toString().padStart(2, '0');
                setTimeUntilPass(`${hours}:${minutes}:${seconds}`);
            } else {
                setTimeUntilPass('PASSING');
            }
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);

        return () => clearInterval(interval);
    }, [nextPass]);

    // Trigger AI analysis when pass + cloud state are ready (cloud may be null = unknown)
    useEffect(() => {
        if (!disaster || !nextPass || cloudCover === undefined || loadingAnalysis || aiAnalysis) {
            return;
        }

        const passIso = nextPass.time.toISOString();
        const reqKey = analysisRequestKey(disaster.id, nextPass.satelliteName, passIso, cloudCover);
        if (inFlightKeyRef.current === reqKey) {
            return;
        }

        const seq = ++analysisSeqRef.current;
        inFlightKeyRef.current = reqKey;
        setLoadingAnalysis(true);
        setAnalysisUnavailable(false);

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
                const response = await fetch(`${API_BASE}/api/analyze`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                });

                const responseText = await response.text();
                let data: AIAnalysisResponse = {};
                try {
                    data = JSON.parse(responseText) as AIAnalysisResponse;
                } catch {
                    // non-JSON error body
                }

                if (seq !== analysisSeqRef.current) {
                    return; // stale — newer selection/request owns the UI
                }

                if (!response.ok) {
                    const msg =
                        data.message ||
                        data.error ||
                        `Analysis unavailable (${response.status})`;
                    debugLog('ai', `Analysis unavailable: ${msg}`, 'error', {
                        status: response.status,
                        code: data.code,
                    });
                    setAnalysisUnavailable(true);
                    setAiAnalysis(msg);
                    return;
                }

                if (!data.analysis || data.analysis.trim().length === 0 || data.source !== 'workers-ai') {
                    setAnalysisUnavailable(true);
                    setAiAnalysis('Analysis unavailable: empty or unexpected response.');
                    debugLog('ai', 'Empty or unexpected analysis response', 'warning', data);
                    return;
                }

                const trimmed = data.analysis.trim();
                debugLog(
                    'ai',
                    `AI analysis received (${trimmed.length} chars)${data.cached ? ' [cache]' : ''}`,
                    'success',
                    { length: trimmed.length, cached: data.cached },
                );
                setAiAnalysis(trimmed);
                setAnalysisUnavailable(false);
            } catch (error) {
                if (seq !== analysisSeqRef.current) {
                    return;
                }
                const errorMessage = error instanceof Error ? error.message : String(error);
                debugLog('ai', `FAILED to get AI analysis: ${errorMessage}`, 'error', {
                    error: errorMessage,
                });
                setAnalysisUnavailable(true);
                setAiAnalysis('Analysis unavailable. Map and satellite tools remain usable.');
            } finally {
                if (seq === analysisSeqRef.current) {
                    setLoadingAnalysis(false);
                    inFlightKeyRef.current = null;
                }
            }
        })();
    }, [disaster, nextPass, cloudCover, aiAnalysis, loadingAnalysis]);

    if (!disaster) {

        return null;
    }

    // Removed excessive logging on every render - only log on mount or disaster change

    return (
        <div
            className={`sidebar-container flex flex-col overflow-hidden transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'
                }`}
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

                {/* Two-Column Grid: Countdown + Cloud Forecast - COMPACT */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
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


