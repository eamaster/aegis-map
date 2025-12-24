/**
 * Sidebar Component - Coverage Analysis Panel
 * Shows satellite pass predictions, weather, and AI analysis
 */

import { useEffect, useState } from 'react';
import { X, Sparkles, Cloud, Satellite } from 'lucide-react';
import type { Disaster, WeatherData, AIAnalysisResponse } from '../types';
import { getNextPass, predictPasses, type SatellitePass } from '../utils/orbitalEngine';
import SatelliteImagery from './SatelliteImagery';
import { useDesignSystem } from '../hooks/useDesignSystem';

interface SidebarProps {
    disaster: Disaster | null;
    onClose: () => void;
    isOpen?: boolean;
}

export default function Sidebar({ disaster, onClose, isOpen = true }: SidebarProps) {
    const ds = useDesignSystem();
    const [nextPass, setNextPass] = useState<SatellitePass | null>(null);
    const [cloudCover, setCloudCover] = useState<number | null>(null);
    const [aiAnalysis, setAiAnalysis] = useState<string>('');
    const [loadingAnalysis, setLoadingAnalysis] = useState(false);
    const [timeUntilPass, setTimeUntilPass] = useState<string>('');

    const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

    // Fetch TLE data and calculate next pass
    useEffect(() => {
        if (!disaster) return;

        // Reset state when disaster changes
        setNextPass(null);
        setCloudCover(null);
        setAiAnalysis(''); // Reset analysis when disaster changes
        setLoadingAnalysis(false);
        setTimeUntilPass('');

        const fetchData = async () => {
            try {

                // DEBUG: Log TLE fetch
                (window as any).aegisDebug?.log(
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
                        const errorData = JSON.parse(responseText);
                        console.error('❌ TLE API returned JSON (error):', errorData);
                        throw new Error(`TLE API error: ${errorData.error || JSON.stringify(errorData)}`);
                    } catch (parseError) {
                        // If it's not valid JSON, treat it as text and continue
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
                    (window as any).aegisDebug?.log(
                        'tles',
                        `WARNING: TLE format incorrect. Expected multiple of 3 lines, got ${tleLines.length}`,
                        'warning'
                    );
                }

                (window as any).aegisDebug?.log(
                    'tles',
                    `Loaded TLEs for ${satelliteCount} satellites`,
                    ' success',
                    { satellites: satelliteCount, lines: tleLines.length }
                );

                // Handle both uppercase and lowercase coordinates - normalize to lowercase
                const disasterAny = disaster as any;
                // Try all possible coordinate property names
                const lat = disaster.lat ?? disasterAny.lat ?? disasterAny.Lat ?? disasterAny.latitude ?? disasterAny.Latitude;
                const lng = disaster.lng ?? disasterAny.lng ?? disasterAny.Lng ?? disasterAny.longitude ?? disasterAny.Longitude;
                const latNum = typeof lat === 'number' ? lat : parseFloat(String(lat || '0'));
                const lngNum = typeof lng === 'number' ? lng : parseFloat(String(lng || '0'));

                // Validate coordinates - allow 0 for equator/prime meridian, but not both
                if (isNaN(latNum) || isNaN(lngNum) || (latNum === 0 && lngNum === 0)) {
                    console.error('❌ Invalid coordinates in sidebar:', { lat, lng, latNum, lngNum, disaster: disasterAny });
                    setAiAnalysis("Invalid coordinates. Unable to calculate satellite passes.");
                    return;
                }

                // Calculate next pass

                (window as any).aegisDebug?.log(
                    'orbital',
                    `Calculating satellite passes for disaster at (${latNum}, ${lngNum})`,
                    'info'
                );

                // Try with lower elevation threshold if no passes found
                let pass = getNextPass(tles, latNum, lngNum);

                // If no pass found with default 25°, try with lower threshold (15°)
                if (!pass) {

                    const lowerPasses = predictPasses(tles, latNum, lngNum, 15);

                    if (lowerPasses.length > 0) {
                        pass = lowerPasses[0];

                    }
                }

                // If still no pass, try even lower threshold (5°)
                if (!pass) {

                    const evenLowerPasses = predictPasses(tles, latNum, lngNum, 5);

                    if (evenLowerPasses.length > 0) {
                        pass = evenLowerPasses[0];

                    }
                }



                if (!pass) {
                    console.warn('⚠️ No satellite passes found in next 24 hours even with lower threshold');
                    (window as any).aegisDebug?.log(
                        'orbital',
                        'No satellite passes found in next 24 hours',
                        'warning'
                    );
                    // Set a default cloud cover so AI analysis can still run
                    setCloudCover(0);
                    setNextPass(null);
                    setAiAnalysis("No satellite passes detected in the next 24 hours. Coverage unavailable.");
                    // Still fetch weather to show cloud cover
                    fetchWeather(latNum, lngNum, new Date(Date.now() + 2 * 60 * 60 * 1000)); // 2 hours from now
                    return;
                } else {
                    const timeUntil = (pass.time.getTime() - new Date().getTime()) / 1000 / 60; // minutes
                    (window as any).aegisDebug?.log(
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
                (window as any).aegisDebug?.log(
                    'tles',
                    `FAILED to fetch TLEs: ${errorMessage}`,
                    'error',
                    { error: errorMessage, fullError: error }
                );
                setAiAnalysis(`Unable to retrieve satellite data: ${errorMessage}`);
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


            // DEBUG: Log weather API call
            (window as any).aegisDebug?.log(
                'weather',
                `Fetching weather for (${lat.toFixed(2)}, ${lng.toFixed(2)})`,
                'info'
            );

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Weather API error: ${response.status} ${response.statusText}`);
            }
            const data: WeatherData = await response.json();
            // DEBUG: Validate weather response
            if (!data.hourly || !data.hourly.cloud_cover) {
                (window as any).aegisDebug?.log(
                    'weather',
                    'WARNING: Invalid weather data format',
                    'warning',
                    data
                );
                return;
            }

            // Find cloud cover closest to pass time
            const closestIndex = data.hourly.time.findIndex(
                (time) => {
                    // Open-Meteo returns time as "YYYY-MM-DDTHH:MM" (ISO 8601 without offset)
                    // We must treat it as UTC to match satellite pass times (which are in UTC)
                    const weatherTime = new Date(time + 'Z');
                    return weatherTime >= passTime;
                }
            );

            if (closestIndex >= 0) {
                const cloudValue = data.hourly.cloud_cover[closestIndex];
                setCloudCover(cloudValue);

                // DEBUG: Log weather result
                (window as any).aegisDebug?.log(
                    'weather',
                    `Cloud coverage at pass time: ${cloudValue}% (${cloudValue < 20 ? 'Clear' : 'Cloudy'})`,
                    'success',
                    { cloudCover: cloudValue, time: data.hourly.time[closestIndex] }
                );
            } else {
                console.warn('⚠️ Could not find cloud data for pass time:', passTime.toISOString());
                (window as any).aegisDebug?.log(
                    'weather',
                    'WARNING: Could not find cloud data for pass time',
                    'warning'
                );
            }
        } catch (error) {
            console.error('❌ Error fetching weather:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Weather error details:', { error, errorMessage });
            (window as any).aegisDebug?.log(
                'weather',
                `FAILED to fetch weather: ${errorMessage}`,
                'error',
                { error: errorMessage, fullError: error }
            );
            setCloudCover(0); // Default to 0 if weather fetch fails so AI analysis can still run
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

    // Trigger AI analysis automatically when data is ready
    useEffect(() => {
        // Trigger AI analysis if we have all required data OR if we have disaster but no pass (fallback)
        if (disaster && !loadingAnalysis) {
            if (nextPass && cloudCover !== null && !aiAnalysis) {

                analyzePass();
            } else if (!nextPass && cloudCover !== null && !aiAnalysis) {
                // Fallback: trigger AI analysis even without satellite pass
                // Create a fallback pass for AI analysis
                const fallbackPass = {
                    satelliteName: 'Landsat-9',
                    time: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours from now
                    elevation: 0,
                    azimuth: 0
                };
                // Call analyzePass with fallback data
                const analyzeWithFallback = async () => {
                    if (!disaster || cloudCover === null) return;
                    setLoadingAnalysis(true);
                    try {
                        const requestBody = {
                            disasterTitle: disaster.title,
                            satelliteName: 'Landsat-9',
                            passTime: fallbackPass.time.toISOString(),
                            cloudCover,
                        };
                        const response = await fetch(`${API_BASE}/api/analyze`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(requestBody),
                        });
                        if (!response.ok) {
                            throw new Error(`Gemini API error: ${response.status}`);
                        }
                        const data: AIAnalysisResponse = await response.json();
                        setAiAnalysis(data.analysis || 'Analysis unavailable.');
                    } catch (error) {
                        console.error('Error in fallback AI analysis:', error);
                        setAiAnalysis('Analysis unavailable.');
                    } finally {
                        setLoadingAnalysis(false);
                    }
                };
                analyzeWithFallback();
            }
        }
    }, [disaster, nextPass, cloudCover, aiAnalysis, loadingAnalysis]);

    // Get AI analysis
    const analyzePass = async () => {
        if (!disaster) {
            console.warn('⚠️ analyzePass called without disaster');
            return;
        }
        if (!nextPass) {
            console.warn('⚠️ analyzePass called without nextPass');
            return;
        }
        if (cloudCover === null) {
            console.warn('⚠️ analyzePass called without cloudCover');
            return;
        }


        setLoadingAnalysis(true);
        try {
            const requestBody = {
                disasterTitle: disaster.title,
                satelliteName: nextPass.satelliteName,
                passTime: nextPass.time.toISOString(),
                cloudCover,
            };

            // DEBUG: Log Gemini API request
            (window as any).aegisDebug?.log(
                'gemini',
                `Requesting AI analysis for ${disaster.title}`,
                'info',
                requestBody
            );


            const response = await fetch(`${API_BASE}/api/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            // Check status first, then parse JSON with error handling
            if (!response.ok) {
                // Read response body as text first (can only be read once)
                const responseText = await response.text();

                // Special handling for 503 Service Unavailable with fallback analysis
                if (response.status === 503) {
                    try {
                        const data: AIAnalysisResponse = JSON.parse(responseText);
                        if (data.analysis) {
                            console.warn('⚠️ Gemini API unavailable, using fallback analysis');
                            setAiAnalysis(data.analysis);
                            setLoadingAnalysis(false);
                            return;
                        }
                    } catch (jsonError) {
                        // If JSON parsing fails, fall through to error handling
                        console.error('Failed to parse 503 response JSON:', jsonError);
                    }
                }

                // For other errors or if 503 doesn't have fallback, try to parse error details
                try {
                    const errorData: AIAnalysisResponse = JSON.parse(responseText);
                    // JSON parsing succeeded, throw structured error with API details
                    throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorData.error || JSON.stringify(errorData)}`);
                } catch (parseError) {
                    // Only catch JSON parsing errors (SyntaxError), re-throw our intentional errors
                    if (parseError instanceof SyntaxError) {
                        // JSON parsing failed, use text response
                        throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${responseText}`);
                    }
                    // Re-throw our intentionally thrown error (preserves structured error details)
                    throw parseError;
                }
            }

            // Response is OK, parse JSON normally
            const data: AIAnalysisResponse = await response.json();
            // DEBUG: Validate Gemini response
            if (!data.analysis || data.analysis.trim().length === 0) {
                console.error('❌ AI analysis is empty or whitespace only:', data);
                (window as any).aegisDebug?.log(
                    'gemini',
                    'WARNING: AI analysis response is empty or whitespace only',
                    'warning',
                    data
                );
                setAiAnalysis('Analysis unavailable: Empty response from AI service.');
                return;
            }

            if (data.analysis.trim().length < 10) {
                console.warn('⚠️ AI analysis is very short:', data.analysis);
                (window as any).aegisDebug?.log(
                    'gemini',
                    'WARNING: AI analysis response is too short',
                    'warning',
                    { analysis: data.analysis, length: data.analysis.length }
                );
            }

            // Trim and set the analysis
            const trimmedAnalysis = data.analysis.trim();
            // Check if analysis mentions the disaster
            const mentionsDisaster = trimmedAnalysis.toLowerCase().includes(disaster.title.toLowerCase().split(' ')[0]);
            (window as any).aegisDebug?.log(
                'gemini',
                `AI analysis received (${trimmedAnalysis.length} chars). Relevant: ${mentionsDisaster ? 'YES' : 'MAYBE'}`,
                'success',
                { analysis: trimmedAnalysis.slice(0, 100) + '...', length: trimmedAnalysis.length, mentionsDisaster }
            );

            setAiAnalysis(trimmedAnalysis);
        } catch (error) {
            console.error('❌ Error getting AI analysis:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('AI analysis error details:', { error, errorMessage, stack: error instanceof Error ? error.stack : undefined });
            (window as any).aegisDebug?.log(
                'gemini',
                `FAILED to get AI analysis: ${errorMessage}`,
                'error',
                { error: errorMessage, fullError: error }
            );
            setAiAnalysis(`Analysis unavailable: ${errorMessage}`);
        } finally {
            setLoadingAnalysis(false);
        }
    };

    useEffect(() => {

    }, [disaster]);

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
                <div className="flex items-center gap-3">
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
                        <div className="flex items-center gap-2.5">
                            <div
                                style={{
                                    padding: '6px',
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
                            Google Gemini
                        </span>
                    </div>

                    {/* Content */}
                    <p
                        className="leading-relaxed relative z-10"
                        style={{
                            fontSize: '0.75rem',
                            color: ds.text.secondary,
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
                                    Analyzing satellite telemetry...
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

                        {cloudCover !== null ? (
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
                                    {cloudCover < 20 ? 'Clear ☀️' : cloudCover < 60 ? 'Partly Cloudy ⛅' : 'Overcast ☁️'}
                                </p>
                            </>
                        ) : (
                            <p
                                className="text-xs"
                                style={{ color: ds.text.tertiary }}
                            >
                                Loading...
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

