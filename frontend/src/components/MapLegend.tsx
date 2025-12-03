/**
 * MapLegend Component - Shows disaster type indicators and counts
 */

import { useState } from 'react';
import { Flame, Mountain, Waves, ChevronDown, ChevronUp, RefreshCw, MousePointer } from 'lucide-react';

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
        <div className="absolute top-4 right-4 z-30 select-none">
            {/* Main Legend Card */}
            <div className="bg-gradient-to-br from-gray-900/98 via-gray-900/95 to-gray-800/98 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-[0_20px_70px_-10px_rgba(0,0,0,0.8)] overflow-hidden min-w-[280px]">
                {/* Header with Gradient */}
                <div className="relative flex items-center justify-between px-5 py-4 bg-gradient-to-r from-blue-600/20 via-purple-600/20 to-blue-600/20 border-b border-white/20">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-blue-500/10 animate-pulse" />
                    <div className="flex items-center gap-3 relative z-10">
                        <div className="relative">
                            <div className="w-3 h-3 rounded-full bg-green-500 shadow-lg shadow-green-500/50 animate-pulse" />
                            <div className="absolute inset-0 w-3 h-3 rounded-full bg-green-400 animate-ping" />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-white tracking-wider uppercase">Live Monitoring</h3>
                            <p className="text-xs text-green-400 font-semibold">System Active</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="relative z-10 text-gray-300 hover:text-white transition-all p-1.5 hover:bg-white/10 rounded-lg hover:scale-110"
                        aria-label={isExpanded ? 'Collapse legend' : 'Expand legend'}
                    >
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                </div>

                {/* Expandable Content */}
                {isExpanded && (
                    <div className="p-5 space-y-4">
                        {/* Total Count - Eye-catching */}
                        <div className="relative overflow-hidden bg-gradient-to-br from-blue-600/40 via-purple-600/40 to-pink-600/40 border-2 border-blue-400/50 rounded-2xl px-5 py-5 shadow-xl">
                            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-purple-500/20 blur-xl" />
                            <div className="relative z-10 flex items-center justify-between">
                                <div>
                                    <span className="text-blue-200 text-xs font-bold uppercase tracking-widest block mb-1">Total Active Events</span>
                                    <span className="text-white text-4xl font-black drop-shadow-lg">{counts.total}</span>
                                </div>
                                <div className="flex flex-col items-center gap-1">
                                    <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                        <span className="text-3xl font-black text-white">{counts.total}</span>
                                    </div>
                                    <span className="text-xs text-blue-200 font-semibold">Disasters</span>
                                </div>
                            </div>
                        </div>

                        {/* Disaster Type Breakdown */}
                        <div className="space-y-3">
                            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Event Categories</div>
                            
                            {/* Fires */}
                            <div className="group relative overflow-hidden bg-gradient-to-r from-red-950/40 via-red-900/30 to-red-950/40 hover:from-red-900/50 hover:via-red-800/40 hover:to-red-900/50 rounded-xl px-4 py-3.5 transition-all duration-300 border border-red-500/30 hover:border-red-500/50 shadow-lg hover:shadow-xl hover:shadow-red-500/20 cursor-pointer">
                                <div className="absolute inset-0 bg-gradient-to-r from-red-500/0 via-red-500/10 to-red-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                <div className="relative z-10 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="relative">
                                            <div className="w-4 h-4 rounded-full bg-red-500 shadow-lg shadow-red-500/60 animate-pulse" />
                                            <div className="absolute inset-0 w-4 h-4 rounded-full bg-red-400 animate-ping opacity-75" />
                                        </div>
                                        <Flame size={18} className="text-red-400 drop-shadow-lg" />
                                        <span className="text-white text-sm font-bold tracking-wide">Wildfires</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-white font-black text-2xl drop-shadow-lg">{counts.fires}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Earthquakes */}
                            <div className="group relative overflow-hidden bg-gradient-to-r from-orange-950/40 via-orange-900/30 to-orange-950/40 hover:from-orange-900/50 hover:via-orange-800/40 hover:to-orange-900/50 rounded-xl px-4 py-3.5 transition-all duration-300 border border-orange-500/30 hover:border-orange-500/50 shadow-lg hover:shadow-xl hover:shadow-orange-500/20 cursor-pointer">
                                <div className="absolute inset-0 bg-gradient-to-r from-orange-500/0 via-orange-500/10 to-orange-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                <div className="relative z-10 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="relative">
                                            <div className="w-4 h-4 rounded-full bg-orange-500 shadow-lg shadow-orange-500/60 animate-pulse" />
                                            <div className="absolute inset-0 w-4 h-4 rounded-full bg-orange-400 animate-ping opacity-75" />
                                        </div>
                                        <Waves size={18} className="text-orange-400 drop-shadow-lg" />
                                        <span className="text-white text-sm font-bold tracking-wide">Earthquakes</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-white font-black text-2xl drop-shadow-lg">{counts.earthquakes}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Volcanoes */}
                            <div className="group relative overflow-hidden bg-gradient-to-r from-red-950/40 via-orange-900/30 to-red-950/40 hover:from-red-900/50 hover:via-orange-800/40 hover:to-red-900/50 rounded-xl px-4 py-3.5 transition-all duration-300 border border-red-600/30 hover:border-red-600/50 shadow-lg hover:shadow-xl hover:shadow-red-600/20 cursor-pointer">
                                <div className="absolute inset-0 bg-gradient-to-r from-red-600/0 via-orange-500/10 to-red-600/0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                <div className="relative z-10 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="relative">
                                            <div className="w-4 h-4 rounded-full bg-red-600 shadow-lg shadow-red-600/60 animate-pulse" />
                                            <div className="absolute inset-0 w-4 h-4 rounded-full bg-orange-500 animate-ping opacity-75" />
                                        </div>
                                        <Mountain size={18} className="text-orange-500 drop-shadow-lg" />
                                        <span className="text-white text-sm font-bold tracking-wide">Volcanoes</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-white font-black text-2xl drop-shadow-lg">{counts.volcanoes}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Last Updated & Refresh */}
                        <div className="pt-3 mt-2 border-t border-white/20 flex items-center justify-between bg-gray-800/30 -mx-5 px-5 py-3 rounded-b-2xl">
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                                <div className="text-xs font-semibold">
                                    {lastUpdated ? (
                                        <>
                                            <span className="text-gray-400">Updated:</span> <span className="text-blue-300">{formatTime(lastUpdated)}</span>
                                        </>
                                    ) : (
                                        <span className="text-gray-400">Initializing...</span>
                                    )}
                                </div>
                            </div>
                            {onRefresh && (
                                <button
                                    onClick={onRefresh}
                                    disabled={isRefreshing}
                                    className="group relative text-blue-400 hover:text-white transition-all p-2 hover:bg-blue-500/20 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed border border-blue-500/30 hover:border-blue-400/50 shadow-lg hover:shadow-blue-500/30 hover:scale-110 active:scale-95"
                                    aria-label="Refresh data"
                                    title="Refresh disaster data"
                                >
                                    <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'} />
                                </button>
                            )}
                        </div>

                        {/* Interaction Hint */}
                        <div className="text-xs text-center pt-3 -mx-5 px-5 pb-2 bg-gradient-to-t from-blue-950/30 to-transparent">
                            <div className="flex items-center justify-center gap-2 text-blue-300 font-semibold">
                                <MousePointer size={14} />
                                <span>Click markers for satellite analysis</span>
                            </div>
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

