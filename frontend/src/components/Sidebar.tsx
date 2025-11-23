/**
 * Sidebar Component - Coverage Analysis Panel
 * Shows satellite pass predictions, weather, and AI analysis
 */

import { useEffect, useState } from 'react';
import { X, Sparkles, Cloud, Wifi, Satellite } from 'lucide-react';
import type { Disaster, WeatherData, AIAnalysisResponse } from '../types';
import { getNextPass, type SatellitePass } from '../utils/orbitalEngine';

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
                const tles = await tleResponse.text();

                // DEBUG: Validate TLE format
                const tleLines = tles.trim().split('\n');
                const satelliteCount = Math.floor(tleLines.length / 3);

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

                // Calculate next pass
                (window as any).aegisDebug?.log(
                    'orbital',
                    `Calculating satellite passes for disaster at (${disaster.lat}, ${disaster.lng})`,
                    'info'
                );

                const pass = getNextPass(tles, disaster.lat, disaster.lng);

                if (!pass) {
                    (window as any).aegisDebug?.log(
                        'orbital',
                        'No satellite passes found in next 24 hours',
                        'warning'
                    );
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

                if (!pass) {
                    setAiAnalysis("No satellite passes detected in the next 24 hours. Coverage unavailable.");
                    return;
                }

                // Fetch weather data
                fetchWeather(disaster.lat, disaster.lng, pass.time);
            } catch (error) {
                console.error('Error fetching data:', error);
                (window as any).aegisDebug?.log(
                    'tles',
                    `FAILED to fetch TLEs: ${error}`,
                    'error',
                    { error: String(error) }
                );
                setAiAnalysis("Unable to retrieve satellite data.");
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
                (time) => new Date(time) >= passTime
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
                (window as any).aegisDebug?.log(
                    'weather',
                    'WARNING: Could not find cloud data for pass time',
                    'warning'
                );
            }
        } catch (error) {
            console.error('Error fetching weather:', error);
            (window as any).aegisDebug?.log(
                'weather',
                `FAILED to fetch weather: ${error}`,
                'error',
                { error: String(error) }
            );
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
        if (disaster && nextPass && cloudCover !== null && !aiAnalysis && !loadingAnalysis) {
            analyzePass();
        }
    }, [disaster, nextPass, cloudCover]);

    // Get AI analysis
    const analyzePass = async () => {
        if (!disaster || !nextPass || cloudCover === null) return;

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

            const data: AIAnalysisResponse = await response.json();

            // DEBUG: Validate Gemini response
            if (!data.analysis || data.analysis.length < 10) {
                (window as any).aegisDebug?.log(
                    'gemini',
                    'WARNING: AI analysis response is too short or empty',
                    'warning',
                    data
                );
            } else {
                // Check if analysis mentions the disaster
                const mentionsDisaster = data.analysis.toLowerCase().includes(disaster.title.toLowerCase().split(' ')[0]);
                (window as any).aegisDebug?.log(
                    'gemini',
                    `AI analysis received (${data.analysis.length} chars). Relevant: ${mentionsDisaster ? 'YES' : 'MAYBE'}`,
                    'success',
                    { analysis: data.analysis.slice(0, 100) + '...', length: data.analysis.length, mentionsDisaster }
                );
            }

            setAiAnalysis(data.analysis);
        } catch (error) {
            console.error('Error getting AI analysis:', error);
            (window as any).aegisDebug?.log(
                'gemini',
                `FAILED to get AI analysis: ${error}`,
                'error',
                { error: String(error) }
            );
            setAiAnalysis('Analysis unavailable.');
        } finally {
            setLoadingAnalysis(false);
        }
    };

    if (!disaster) return null;

    return (
        <div className="fixed bottom-4 left-4 right-4 z-[100] flex flex-col max-h-[60vh] rounded-2xl shadow-2xl overflow-hidden md:fixed md:top-24 md:right-6 md:w-[400px] md:bottom-auto md:left-auto md:max-h-[calc(100vh-160px)] glass-panel border border-white/10 backdrop-blur-xl bg-gray-900/85">
            {/* Header */}
            <div className="p-5 flex items-center justify-between border-b border-white/10">
                <h2 className="text-xl font-bold text-white">Coverage Analysis</h2>
                <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-full"
                >
                    <X size={20} />
                </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar">

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
                        ) : (
                            aiAnalysis || "Waiting for data..."
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
                            {timeUntilPass}
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
