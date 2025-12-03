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
            <div className="bg-gray-900/90 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl overflow-hidden min-w-[240px]">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <h3 className="text-sm font-semibold text-white">Live Monitoring</h3>
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
                    <div className="p-4 space-y-3">
                        {/* Total Count - Prominent */}
                        <div className="bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 rounded-lg px-4 py-3">
                            <div className="flex items-center justify-between">
                                <span className="text-gray-300 text-sm font-medium">Active Disasters</span>
                                <span className="text-2xl font-bold text-white">{counts.total}</span>
                            </div>
                        </div>

                        {/* Disaster Type Breakdown */}
                        <div className="space-y-2">
                            {/* Fires */}
                            <div className="flex items-center justify-between group hover:bg-white/5 rounded-lg px-2 py-2 transition-all">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-[#FF4444] ring-2 ring-white/30" />
                                    <Flame size={14} className="text-[#FF4444]" />
                                    <span className="text-gray-300 text-sm font-medium">Fires</span>
                                </div>
                                <span className="text-white font-bold text-lg">{counts.fires}</span>
                            </div>

                            {/* Earthquakes */}
                            <div className="flex items-center justify-between group hover:bg-white/5 rounded-lg px-2 py-2 transition-all">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-[#FF8C00] ring-2 ring-white/30" />
                                    <Waves size={14} className="text-[#FF8C00]" />
                                    <span className="text-gray-300 text-sm font-medium">Earthquakes</span>
                                </div>
                                <span className="text-white font-bold text-lg">{counts.earthquakes}</span>
                            </div>

                            {/* Volcanoes */}
                            <div className="flex items-center justify-between group hover:bg-white/5 rounded-lg px-2 py-2 transition-all">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-[#FF6B35] ring-2 ring-white/30" />
                                    <Mountain size={14} className="text-[#FF6B35]" />
                                    <span className="text-gray-300 text-sm font-medium">Volcanoes</span>
                                </div>
                                <span className="text-white font-bold text-lg">{counts.volcanoes}</span>
                            </div>
                        </div>

                        {/* Last Updated & Refresh */}
                        <div className="pt-3 border-t border-white/10 flex items-center justify-between">
                            <div className="text-xs text-gray-400">
                                {lastUpdated ? (
                                    <>
                                        Updated: <span className="text-gray-300">{formatTime(lastUpdated)}</span>
                                    </>
                                ) : (
                                    'Loading...'
                                )}
                            </div>
                            {onRefresh && (
                                <button
                                    onClick={onRefresh}
                                    disabled={isRefreshing}
                                    className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-white/10 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                                    aria-label="Refresh data"
                                >
                                    <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                                </button>
                            )}
                        </div>

                        {/* Interaction Hint */}
                        <div className="text-xs text-gray-500 italic text-center pt-2 border-t border-white/5">
                            Click markers for details
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

