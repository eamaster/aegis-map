/**
 * Sidebar Component - Coverage Analysis Panel
 * Shows satellite pass predictions, weather, and AI analysis
 */

import { useEffect, useState } from 'react';
import { X, Satellite, Cloud, Sparkles, Clock } from 'lucide-react';
import type { Disaster, WeatherData, AIAnalysisResponse } from '../types';
import { getNextPass, type SatellitePass } from '../utils/orbitalEngine';
import { formatDistanceToNow } from 'date-fns';

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
                // Fetch TLEs
                const tleResponse = await fetch(`${API_BASE}/api/tles`);
                const tles = await tleResponse.text();

                // Calculate next pass
                const pass = getNextPass(tles, disaster.lat, disaster.lng);
                setNextPass(pass);

                // Fetch weather data
                if (pass) {
                    fetchWeather(disaster.lat, disaster.lng, pass.time);
                }
            } catch (error) {
                console.error('Error fetching data:', error);
            }
        };

        fetchData();
    }, [disaster]);

    // Fetch weather data from Open-Meteo
    const fetchWeather = async (lat: number, lng: number, passTime: Date) => {
        try {
            const response = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=cloud_cover&forecast_days=2`
            );
            const data: WeatherData = await response.json();

            // Find cloud cover closest to pass time
            const closestIndex = data.hourly.time.findIndex(
                (time) => new Date(time) >= passTime
            );

            if (closestIndex >= 0) {
                setCloudCover(data.hourly.cloud_cover[closestIndex]);
            }
        } catch (error) {
            console.error('Error fetching weather:', error);
        }
    };

    // Update countdown timer
    useEffect(() => {
        if (!nextPass) return;

        const updateTimer = () => {
            const now = new Date();
            const diff = nextPass.time.getTime() - now.getTime();

            if (diff > 0) {
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((diff % (1000 * 60)) / 1000);
                setTimeUntilPass(`${hours}h ${minutes}m ${seconds}s`);
            } else {
                setTimeUntilPass('Passing now');
            }
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);

        return () => clearInterval(interval);
    }, [nextPass]);

    // Get AI analysis
    const analyzePass = async () => {
        if (!disaster || !nextPass || cloudCover === null) return;

        setLoadingAnalysis(true);
        try {
            const response = await fetch(`${API_BASE}/api/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    disasterTitle: disaster.title,
                    satelliteName: nextPass.satelliteName,
                    passTime: nextPass.time.toISOString(),
                    cloudCover,
                }),
            });

            const data: AIAnalysisResponse = await response.json();
            setAiAnalysis(data.analysis);
        } catch (error) {
            console.error('Error getting AI analysis:', error);
            setAiAnalysis('Analysis failed. Please try again.');
        } finally {
            setLoadingAnalysis(false);
        }
    };

    if (!disaster) return null;

    return (
        <div className="absolute top-0 right-0 h-full w-full md:w-96 bg-gray-900 bg-opacity-95 backdrop-blur-lg shadow-2xl z-20 overflow-y-auto">
            {/* Header */}
            <div className="p-6 border-b border-gray-700">
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-2xl font-bold text-white mb-1">{disaster.title}</h2>
                        <p className="text-gray-400 text-sm capitalize">
                            {disaster.type} • {disaster.severity} severity
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
                {/* Disaster Details */}
                <div>
                    <h3 className="text-lg font-semibold text-white mb-3">Details</h3>
                    <div className="space-y-2 text-sm">
                        <p className="text-gray-300">
                            <span className="text-gray-500">Location:</span> {disaster.lat.toFixed(4)}, {disaster.lng.toFixed(4)}
                        </p>
                        <p className="text-gray-300">
                            <span className="text-gray-500">Date:</span>{' '}
                            {formatDistanceToNow(new Date(disaster.date), { addSuffix: true })}
                        </p>
                        {disaster.magnitude && (
                            <p className="text-gray-300">
                                <span className="text-gray-500">Magnitude:</span> {disaster.magnitude}
                            </p>
                        )}
                    </div>
                </div>

                {/* Coverage Analysis Section */}
                <div>
                    <h3 className="text-lg font-semibold text-white mb-4">Coverage Analysis</h3>

                    {/* Next Satellite Pass */}
                    {nextPass && (
                        <div className="bg-gray-800 rounded-lg p-4 mb-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Satellite className="text-blue-400" size={20} />
                                <h4 className="font-semibold text-white">Next Satellite Pass</h4>
                            </div>
                            <p className="text-gray-300 text-sm mb-2">{nextPass.satelliteName}</p>
                            <div className="bg-gray-900 rounded p-3">
                                <div className="flex items-center gap-2 mb-1">
                                    <Clock size={16} className="text-gray-400" />
                                    <span className="text-2xl font-mono font-bold text-white">
                                        {timeUntilPass}
                                    </span>
                                </div>
                                <p className="text-gray-500 text-xs">
                                    {nextPass.time.toLocaleString()}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Cloud Coverage */}
                    {cloudCover !== null && (
                        <div className="bg-gray-800 rounded-lg p-4 mb-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Cloud className="text-sky-400" size={20} />
                                <h4 className="font-semibold text-white">Cloud Coverage</h4>
                            </div>
                            <p className="text-3xl font-bold text-white mb-1">{cloudCover}%</p>
                            <p className="text-gray-400 text-sm">
                                {cloudCover < 20 ? 'Clear skies' : cloudCover < 50 ? 'Partly cloudy' : 'Mostly cloudy'}
                            </p>
                        </div>
                    )}

                    {/* AI Analysis Button */}
                    {nextPass && cloudCover !== null && !aiAnalysis && (
                        <button
                            onClick={analyzePass}
                            disabled={loadingAnalysis}
                            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {loadingAnalysis ? (
                                <>
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                    <span>Thinking...</span>
                                </>
                            ) : (
                                <>
                                    <Sparkles size={20} />
                                    <span>Analyze Coverage</span>
                                </>
                            )}
                        </button>
                    )}

                    {/* AI Analysis Result */}
                    {aiAnalysis && (
                        <div className="bg-gradient-to-br from-purple-900/30 to-blue-900/30 border border-purple-500/30 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <Sparkles className="text-purple-400" size={20} />
                                <h4 className="font-semibold text-white">AI Insight</h4>
                            </div>
                            <p className="text-gray-200 text-sm leading-relaxed">{aiAnalysis}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
