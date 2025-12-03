/**
 * MapLegend Component - Shows disaster type indicators and counts
 */

import { useState } from 'react';
import { Flame, Mountain, Waves, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';

interface DisasterCounts {
    fires: number;
    volcanoes: number;
    earthquakes: number;
    total: number;
}

interface MapLegendProps {
    counts: DisasterCounts;
    lastUpdated?: Date;
    onRefresh?: () => void;
    isRefreshing?: boolean;
}

export default function MapLegend({ counts, lastUpdated, onRefresh, isRefreshing = false }: MapLegendProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    const formatTime = (date: Date) => {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="absolute top-4 right-4 z-30">
            {/* Main Legend Card */}
            <div className="bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden min-w-[260px]">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-gray-800/50 to-gray-900/50 border-b border-white/10">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-lg shadow-green-500/50" />
                        <h3 className="text-sm font-bold text-white tracking-wide">LIVE MONITORING</h3>
                    </div>
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-white/10 rounded"
                        aria-label={isExpanded ? 'Collapse legend' : 'Expand legend'}
                    >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                </div>

                {/* Expandable Content */}
                {isExpanded && (
                    <div className="p-4 space-y-4">
                        {/* Total Count - Prominent */}
                        <div className="bg-gradient-to-br from-blue-600/30 to-purple-600/30 border border-blue-500/40 rounded-xl px-4 py-4 shadow-lg">
                            <div className="flex items-center justify-between">
                                <span className="text-gray-200 text-sm font-semibold uppercase tracking-wide">Total Active</span>
                                <span className="text-3xl font-black text-white">{counts.total}</span>
                            </div>
                        </div>

                        {/* Disaster Type Breakdown */}
                        <div className="space-y-2">
                            {/* Fires */}
                            <div className="flex items-center justify-between bg-gray-800/40 hover:bg-gray-800/60 rounded-lg px-3 py-2.5 transition-all border border-white/5">
                                <div className="flex items-center gap-3">
                                    <div className="w-3 h-3 rounded-full bg-[#FF4444] shadow-lg shadow-red-500/50" />
                                    <Flame size={16} className="text-[#FF4444]" />
                                    <span className="text-gray-200 text-sm font-semibold">Fires</span>
                                </div>
                                <span className="text-white font-bold text-xl">{counts.fires}</span>
                            </div>

                            {/* Earthquakes */}
                            <div className="flex items-center justify-between bg-gray-800/40 hover:bg-gray-800/60 rounded-lg px-3 py-2.5 transition-all border border-white/5">
                                <div className="flex items-center gap-3">
                                    <div className="w-3 h-3 rounded-full bg-[#FF8C00] shadow-lg shadow-orange-500/50" />
                                    <Waves size={16} className="text-[#FF8C00]" />
                                    <span className="text-gray-200 text-sm font-semibold">Earthquakes</span>
                                </div>
                                <span className="text-white font-bold text-xl">{counts.earthquakes}</span>
                            </div>

                            {/* Volcanoes */}
                            <div className="flex items-center justify-between bg-gray-800/40 hover:bg-gray-800/60 rounded-lg px-3 py-2.5 transition-all border border-white/5">
                                <div className="flex items-center gap-3">
                                    <div className="w-3 h-3 rounded-full bg-[#FF6B35] shadow-lg shadow-orange-600/50" />
                                    <Mountain size={16} className="text-[#FF6B35]" />
                                    <span className="text-gray-200 text-sm font-semibold">Volcanoes</span>
                                </div>
                                <span className="text-white font-bold text-xl">{counts.volcanoes}</span>
                            </div>
                        </div>

                        {/* Last Updated & Refresh */}
                        <div className="pt-3 border-t border-white/10 flex items-center justify-between">
                            <div className="text-xs text-gray-400 font-medium">
                                {lastUpdated ? (
                                    <>
                                        <span className="text-gray-500">Updated:</span> <span className="text-gray-300">{formatTime(lastUpdated)}</span>
                                    </>
                                ) : (
                                    'Loading...'
                                )}
                            </div>
                            {onRefresh && (
                                <button
                                    onClick={onRefresh}
                                    disabled={isRefreshing}
                                    className="text-blue-400 hover:text-blue-300 transition-colors p-1.5 hover:bg-blue-500/10 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                    aria-label="Refresh data"
                                    title="Refresh disaster data"
                                >
                                    <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
                                </button>
                            )}
                        </div>

                        {/* Interaction Hint */}
                        <div className="text-xs text-gray-500 text-center pt-2 border-t border-white/5 font-medium">
                            💡 Click markers for satellite analysis
                        </div>
                    </div>
                )}
            </div>

            {/* Collapsed State */}
            {!isExpanded && (
                <div className="px-4 py-2">
                    <div className="text-white font-bold text-lg">{counts.total}</div>
                    <div className="text-xs text-gray-400">disasters</div>
                </div>
            )}
        </div>
    );
}

