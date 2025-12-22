/**
 * Sidebar Component - Coverage Analysis Panel
 * Shows satellite pass predictions, weather, and AI analysis
 */

import { useEffect, useState } from 'react';
import { X, Sparkles, Cloud } from 'lucide-react';
import type { Disaster, WeatherData, AIAnalysisResponse } from '../types';
import { getNextPass, predictPasses, type SatellitePass } from '../utils/orbitalEngine';
import SatelliteImagery from './SatelliteImagery';

interface SidebarProps {
    disaster: Disaster | null;
    onClose: () => void;
}

export default function Sidebar({ disaster, onClose }: SidebarProps) {
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
            className="fixed right-0 top-[73px] bottom-0 z-[100] w-[440px] flex flex-col overflow-hidden"
            style={{
                height: 'calc(100vh - 73px)',
                right: 0,
                left: 'auto',
                position: 'fixed',
                background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.98) 0%, rgba(31, 41, 55, 0.98) 100%)',
                backdropFilter: 'blur(32px)',
                WebkitBackdropFilter: 'blur(32px)',
                borderLeft: '1px solid rgba(255, 255, 255, 0.12)',
                boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.6)'
            }}
        >
            {/* Header */}
            <div className="px-6 py-5 flex items-center justify-between border-b border-white/10 flex-shrink-0">
                <div>
                    <h2 className="text-2xl font-black text-white tracking-tight mb-0.5">
                        Coverage Analysis
                    </h2>
                    <p className="text-[11px] text-gray-500 font-medium">
                        Satellite intelligence & AI insights
                    </p>
                </div>
                <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-white transition-all p-2.5 hover:bg-white/10 rounded-xl group"
                    aria-label="Close"
                >
                    <X size={18} className="group-hover:rotate-90 transition-transform duration-300" />
                </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-5">

                {/* AI Insight Card */}
                <div
                    className="rounded-2xl p-5 border relative overflow-hidden group transition-all duration-300"
                    style={{
                        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(147, 51, 234, 0.08) 100%)',
                        borderLeft: '4px solid rgb(59, 130, 246)',
                        border: '1px solid rgba(59, 130, 246, 0.2)',
                        boxShadow: '0 8px 32px rgba(59, 130, 246, 0.1)'
                    }}
                >
                    {/* Decorative gradient */}
                    <div
                        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                        style={{
                            background: 'radial-gradient(circle at top right, rgba(59, 130, 246, 0.1), transparent 50%)'
                        }}
                    />
                    {/* Header */}
                    <div className="flex items-center justify-between mb-3 relative z-10">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-lg bg-blue-500/20">
                                <Sparkles className="text-blue-400" size={16} />
                            </div>
                            <h3 className="font-black text-white text-sm tracking-tight">
                                AI Insight
                            </h3>
                        </div>
                        <span className="text-[9px] uppercase tracking-widest text-gray-500 font-bold px-2 py-1 rounded-md bg-white/5">
                            Google Gemini
                        </span>
                    </div>

                    {/* Content */}
                    <p className="text-gray-300 text-[13px] leading-relaxed relative z-10">
                        {loadingAnalysis ? (
                            <span className="flex items-center gap-2">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                                <span className="text-blue-300 font-medium">Analyzing satellite telemetry...</span>
                            </span>
                        ) : aiAnalysis && aiAnalysis.trim().length > 0 ? (
                            aiAnalysis
                        ) : (
                            <span className="text-gray-600 italic">Waiting for analysis...</span>
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

                {/* Two-Column Grid: Countdown + Cloud Forecast */}
                <div className="grid grid-cols-2 gap-4">
                    {/* Countdown Timer */}
                    {nextPass && (
                        <div
                            className="rounded-2xl p-5 text-center relative overflow-hidden"
                            style={{
                                background: 'rgba(255, 255, 255, 0.03)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)'
                            }}
                        >
                            <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />

                            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-3">
                                {nextPass.satelliteName.replace(/[-_]/g, ' ')}
                            </p>

                            <div className="relative z-10">
                                <div className="text-3xl font-black font-mono text-white tracking-tight tabular-nums mb-1">
                                    {timeUntilPass || '00:00:00'}
                                </div>
                                <div className="h-0.5 w-10 mx-auto rounded-full bg-gradient-to-r from-transparent via-blue-500 to-transparent" />
                            </div>
                        </div>
                    )}

                    {/* Cloud Forecast */}
                    <div
                        className="rounded-2xl p-5 relative overflow-hidden"
                        style={{
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)'
                        }}
                    >
                        <div className="flex items-start justify-between mb-2">
                            <Cloud className="text-sky-400" size={18} />
                            <div className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]" />
                        </div>

                        <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">
                            Cloud Forecast
                        </p>

                        {cloudCover !== null ? (
                            <>
                                <div className="flex items-baseline gap-1 mb-1">
                                    <span className="text-2xl font-black text-white tabular-nums">
                                        {cloudCover}
                                    </span>
                                    <span className="text-gray-500 font-bold text-sm">%</span>
                                </div>
                                <p className="text-[11px] text-gray-400 font-medium">
                                    {cloudCover < 20 ? 'Clear ☀️' : cloudCover < 60 ? 'Partly Cloudy ⛅' : 'Overcast ☁️'}
                                </p>
                            </>
                        ) : (
                            <p className="text-gray-600 text-xs">Loading...</p>
                        )}

                        {nextPass && (
                            <p className="text-[9px] text-gray-600 font-medium mt-3 pt-2 border-t border-white/5">
                                {nextPass.time.toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    timeZone: 'UTC'
                                })} UTC
                                <span className="text-gray-700 ml-1">
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

