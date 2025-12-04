/**
 * Sidebar Component - Coverage Analysis Panel
 * Shows satellite pass predictions, weather, and AI analysis
 */

import { useEffect, useState } from 'react';
import { X, Sparkles, Cloud, Wifi, Satellite } from 'lucide-react';
import type { Disaster, WeatherData, AIAnalysisResponse } from '../types';
import { getNextPass, predictPasses, type SatellitePass } from '../utils/orbitalEngine';

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
                console.log('🚀 Starting data fetch for disaster:', disaster.title);
                // DEBUG: Log TLE fetch
                (window as any).aegisDebug?.log(
                    'tles',
                    `Fetching TLEs from ${API_BASE}/api/tles`,
                    'info'
                );

                // Fetch TLEs
                console.log('📡 Fetching TLEs from:', `${API_BASE}/api/tles`);
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
                console.log('📥 Raw TLE response:', {
                    length: tles.length,
                    firstChars: tles.substring(0, 200),
                    lastChars: tles.substring(Math.max(0, tles.length - 200)),
                    hasNewlines: tles.includes('\n'),
                    lineCount: tles.split('\n').length
                });
                
                if (!tles || tles.trim().length === 0) {
                    throw new Error('TLE data is empty - no data received from API');
                }
                
                const tleLines = tles.trim().split('\n').filter(line => line.trim().length > 0);
                const satelliteCount = Math.floor(tleLines.length / 3);
                
                console.log('✅ TLEs parsed:', { 
                    rawLength: tles.length, 
                    lines: tleLines.length,
                    satelliteCount: satelliteCount,
                    firstSatellite: tleLines[0]?.substring(0, 80) || 'N/A',
                    firstLine1: tleLines[1]?.substring(0, 80) || 'N/A',
                    firstLine2: tleLines[2]?.substring(0, 80) || 'N/A'
                });
                
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

                console.log('🌐 Sidebar processing coordinates:', { 
                    lat, lng, latNum, lngNum, 
                    disasterKeys: Object.keys(disasterAny),
                    disaster: {
                        id: disasterAny.id,
                        title: disasterAny.title,
                        type: disasterAny.type,
                        lat: disasterAny.lat,
                        lng: disasterAny.lng,
                        Lat: disasterAny.Lat,
                        Lng: disasterAny.Lng
                    }
                });

                // Validate coordinates - allow 0 for equator/prime meridian, but not both
                if (isNaN(latNum) || isNaN(lngNum) || (latNum === 0 && lngNum === 0)) {
                    console.error('❌ Invalid coordinates in sidebar:', { lat, lng, latNum, lngNum, disaster: disasterAny });
                    setAiAnalysis("Invalid coordinates. Unable to calculate satellite passes.");
                    return;
                }

                // Calculate next pass
                console.log('🛰️ Calculating satellite passes for:', { latNum, lngNum, tleLength: tles.length });
                (window as any).aegisDebug?.log(
                    'orbital',
                    `Calculating satellite passes for disaster at (${latNum}, ${lngNum})`,
                    'info'
                );

                // Try with lower elevation threshold if no passes found
                let pass = getNextPass(tles, latNum, lngNum);
                
                // If no pass found with default 25°, try with lower threshold (15°)
                if (!pass) {
                    console.log('⚠️ No passes found with 25° threshold, trying 15°...');
                    const lowerPasses = predictPasses(tles, latNum, lngNum, 15);
                    console.log('📊 Lower threshold passes:', { count: lowerPasses.length, passes: lowerPasses });
                    if (lowerPasses.length > 0) {
                        pass = lowerPasses[0];
                        console.log('✅ Found pass with lower threshold:', pass);
                    }
                }
                
                // If still no pass, try even lower threshold (5°)
                if (!pass) {
                    console.log('⚠️ No passes found with 15° threshold, trying 5°...');
                    const evenLowerPasses = predictPasses(tles, latNum, lngNum, 5);
                    console.log('📊 Even lower threshold passes:', { count: evenLowerPasses.length, passes: evenLowerPasses });
                    if (evenLowerPasses.length > 0) {
                        pass = evenLowerPasses[0];
                        console.log('✅ Found pass with 5° threshold:', pass);
                    }
                }

                console.log('🛰️ Satellite pass result:', pass);

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
                    console.log('✅ Satellite pass found:', {
                        satellite: pass.satelliteName,
                        time: pass.time.toISOString(),
                        timeUntil: Math.round(timeUntil) + ' minutes',
                        elevation: pass.elevation.toFixed(1) + '°'
                    });
                    (window as any).aegisDebug?.log(
                        'orbital',
                        `Next pass: ${pass.satelliteName} at ${pass.time.toLocaleString()} (in ${Math.round(timeUntil)} min) - Elevation: ${pass.elevation.toFixed(1)}°`,
                        'success',
                        { satellite: pass.satelliteName, elevation: pass.elevation, azimuth: pass.azimuth, time: pass.time.toISOString() }
                    );
                }

                setNextPass(pass);

                // Fetch weather data
                console.log('🌤️ Fetching weather data for pass time:', pass.time.toISOString());
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

            console.log('🌤️ Fetching weather from:', url);
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
            console.log('🌤️ Weather data received:', { 
                hasHourly: !!data.hourly, 
                hasCloudCover: !!(data.hourly?.cloud_cover),
                timeCount: data.hourly?.time?.length || 0
            });

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
                (time) => new Date(time) >= passTime
            );

            if (closestIndex >= 0) {
                const cloudValue = data.hourly.cloud_cover[closestIndex];
                console.log('✅ Cloud cover found:', { 
                    cloudValue, 
                    time: data.hourly.time[closestIndex],
                    status: cloudValue < 20 ? 'Clear' : 'Cloudy'
                });
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
        console.log('🤖 AI Analysis trigger check:', {
            hasDisaster: !!disaster,
            hasNextPass: !!nextPass,
            cloudCover,
            hasAiAnalysis: !!aiAnalysis,
            loadingAnalysis
        });
        
        // Trigger AI analysis if we have all required data OR if we have disaster but no pass (fallback)
        if (disaster && !loadingAnalysis) {
            if (nextPass && cloudCover !== null && !aiAnalysis) {
                console.log('✅ Triggering AI analysis with satellite pass data...');
                analyzePass();
            } else if (!nextPass && cloudCover !== null && !aiAnalysis) {
                // Fallback: trigger AI analysis even without satellite pass
                console.log('✅ Triggering AI analysis without satellite pass (fallback)...');
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
        console.log('🤖 analyzePass called with:', { disaster: disaster.title, nextPass, cloudCover });

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

            console.log('🤖 Calling Gemini API:', { API_BASE, requestBody });
            const response = await fetch(`${API_BASE}/api/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            // Parse JSON first to check for fallback analysis (e.g., 503 with analysis field)
            const data: AIAnalysisResponse = await response.json();

            // If response is not OK, check if there's a fallback analysis before throwing
            if (!response.ok) {
                // Special handling for 503 Service Unavailable with fallback analysis
                if (response.status === 503 && data.analysis) {
                    console.warn('⚠️ Gemini API unavailable, using fallback analysis');
                    setAiAnalysis(data.analysis);
                    setLoadingAnalysis(false);
                    return;
                }
                // For other errors, throw as before
                throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${data.error || JSON.stringify(data)}`);
            }
            console.log('✅ Gemini API response received:', { 
                hasAnalysis: !!data.analysis, 
                analysisLength: data.analysis?.length || 0,
                analysisText: data.analysis?.substring(0, 100) || 'N/A',
                fullResponse: data
            });

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
            console.log('✅ Setting AI analysis:', { 
                length: trimmedAnalysis.length, 
                preview: trimmedAnalysis.substring(0, 200) 
            });
            
            // Check if analysis mentions the disaster
            const mentionsDisaster = trimmedAnalysis.toLowerCase().includes(disaster.title.toLowerCase().split(' ')[0]);
            (window as any).aegisDebug?.log(
                'gemini',
                `AI analysis received (${trimmedAnalysis.length} chars). Relevant: ${mentionsDisaster ? 'YES' : 'MAYBE'}`,
                'success',
                { analysis: trimmedAnalysis.slice(0, 100) + '...', length: trimmedAnalysis.length, mentionsDisaster }
            );
            
            setAiAnalysis(trimmedAnalysis);
            console.log('✅ AI analysis state updated:', { 
                trimmedAnalysis,
                length: trimmedAnalysis.length,
                firstChars: trimmedAnalysis.substring(0, 100)
            });
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
        console.log('📋 Sidebar rendered with disaster:', disaster);
    }, [disaster]);

    if (!disaster) {
        console.log('❌ Sidebar: No disaster provided, returning null');
        return null;
    }

    // Removed excessive logging on every render - only log on mount or disaster change

    return (
        <div 
            className="fixed right-0 top-[73px] bottom-0 z-[100] w-[420px] flex flex-col shadow-2xl overflow-hidden border-l border-white/10 backdrop-blur-xl"
            style={{ 
                display: 'flex', 
                height: 'calc(100vh - 73px)', 
                right: 0,
                left: 'auto',
                position: 'fixed',
                background: 'rgba(13, 18, 30, 0.85)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.5)'
            }}
        >
            {/* Header */}
            <div className="p-5 flex items-center justify-between border-b border-white/10 flex-shrink-0">
                <h2 className="text-xl font-bold text-white">Coverage Analysis</h2>
                <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-full"
                    aria-label="Close sidebar"
                >
                    <X size={20} />
                </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1">

                {/* AI Insight Card */}
                <div className="glass-card rounded-xl p-4 border-l-4 border-blue-500 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Sparkles size={60} />
                    </div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <Sparkles className="text-blue-400" size={18} />
                            <h3 className="font-bold text-white text-sm">AI Insight</h3>
                        </div>
                        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Google Gemini</span>
                    </div>
                    <p className="text-gray-300 text-sm leading-relaxed">
                        {loadingAnalysis ? (
                            <span className="animate-pulse text-blue-300 font-medium">Analyzing satellite telemetry...</span>
                        ) : aiAnalysis && aiAnalysis.trim().length > 0 ? (
                            <span>{aiAnalysis}</span>
                        ) : (
                            <span className="text-gray-500 italic">Waiting for analysis...</span>
                        )}
                    </p>
                </div>

                {/* Countdown Widget */}
                {nextPass && (
                    <div className="glass-card rounded-xl p-6 text-center relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />
                        <h3 className="text-gray-400 text-xs uppercase tracking-widest mb-2">
                            {nextPass.satelliteName} scan in
                        </h3>
                        <div className="text-5xl font-mono font-bold text-white tracking-tight tabular-nums">
                            {timeUntilPass || '00:00:00'}
                        </div>
                    </div>
                )}

                {/* Grid Widgets */}
                <div className="grid grid-cols-2 gap-4">
                    {/* Cloud-Clear Validator */}
                    <div className="glass-card rounded-xl p-4 flex flex-col justify-between min-h-[120px]">
                        <div className="flex justify-between items-start">
                            <Cloud className="text-sky-400" size={24} />
                            <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                        </div>
                        <div>
                            <h4 className="text-gray-400 text-xs font-bold uppercase mb-1">Cloud-Clear Validator</h4>
                            <p className="text-white text-sm leading-tight">
                                {cloudCover !== null ? `Current Cloud Cover: ${cloudCover}% (${cloudCover < 20 ? 'Clear' : 'Cloudy'})` : 'Loading...'}
                            </p>
                        </div>
                    </div>

                    {/* Connectivity Radar */}
                    <div className="glass-card rounded-xl p-4 flex flex-col justify-between min-h-[120px]">
                        <div className="flex justify-between items-start">
                            <Wifi className="text-purple-400" size={24} />
                            <Satellite className="text-gray-600" size={16} />
                        </div>
                        <div>
                            <h4 className="text-gray-400 text-xs font-bold uppercase mb-1">Connectivity Radar</h4>
                            <p className="text-white text-xs leading-tight">
                                Starlink-3452 overhead in 10 mins
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
