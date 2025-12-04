/**
 * MapLegend Component - Clean, Minimal Design
 */

import { useState } from 'react';
import { Flame, Mountain, Waves, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

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

        if (diffMins < 1) return 'now';
        if (diffMins < 60) return `${diffMins}m`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h`;
        // For updates >= 24 hours old, show the actual time
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    if (!isExpanded) {
        return (
            <div className="absolute top-4 right-4 z-30">
                <button
                    onClick={() => setIsExpanded(true)}
                    className="bg-gray-900/95 backdrop-blur-xl border border-white/20 rounded-xl px-4 py-3 shadow-lg hover:bg-gray-900 transition-all"
                >
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-white font-bold text-lg">{counts.total}</span>
                        <ChevronDown size={16} className="text-gray-400" />
                    </div>
                </button>
            </div>
        );
    }

    return (
        <div className="absolute top-4 right-4 z-30">
            <div className="bg-gray-900/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl overflow-hidden w-64">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 bg-gray-800/50 border-b border-white/10">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <h3 className="text-white font-bold text-sm">Active Disasters</h3>
                    </div>
                    <button
                        onClick={() => setIsExpanded(false)}
                        className="text-gray-400 hover:text-white transition-colors"
                        aria-label="Collapse"
                    >
                        <ChevronUp size={16} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-3">
                    {/* Total */}
                    <div className="text-center py-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                        <div className="text-4xl font-black text-white">{counts.total}</div>
                        <div className="text-xs text-gray-400 uppercase tracking-wide mt-1">Total Events</div>
                    </div>

                    {/* Types */}
                    <div className="space-y-2">
                        {/* Fires */}
                        <div className="flex items-center justify-between px-3 py-2 bg-gray-800/30 rounded-lg hover:bg-gray-800/50 transition-colors">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-[#FF4444]" />
                                <Flame size={14} className="text-[#FF4444]" />
                                <span className="text-gray-300 text-sm">Fires</span>
                            </div>
                            <span className="text-white font-bold">{counts.fires}</span>
                        </div>

                        {/* Earthquakes */}
                        <div className="flex items-center justify-between px-3 py-2 bg-gray-800/30 rounded-lg hover:bg-gray-800/50 transition-colors">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-[#FF8C00]" />
                                <Waves size={14} className="text-[#FF8C00]" />
                                <span className="text-gray-300 text-sm">Earthquakes</span>
                            </div>
                            <span className="text-white font-bold">{counts.earthquakes}</span>
                        </div>

                        {/* Volcanoes */}
                        <div className="flex items-center justify-between px-3 py-2 bg-gray-800/30 rounded-lg hover:bg-gray-800/50 transition-colors">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-[#FF6B35]" />
                                <Mountain size={14} className="text-[#FF6B35]" />
                                <span className="text-gray-300 text-sm">Volcanoes</span>
                            </div>
                            <span className="text-white font-bold">{counts.volcanoes}</span>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="pt-3 border-t border-white/10 flex items-center justify-between">
                        <div className="text-xs text-gray-500">
                            {lastUpdated ? (() => {
                                const timeStr = formatTime(lastUpdated);
                                return timeStr === 'now' ? 'Just now' : `${timeStr} ago`;
                            })() : 'Loading...'}
                        </div>
                        {onRefresh && (
                            <button
                                onClick={onRefresh}
                                disabled={isRefreshing}
                                className="text-blue-400 hover:text-blue-300 p-1 hover:bg-blue-500/10 rounded transition-all disabled:opacity-50"
                                aria-label="Refresh"
                            >
                                <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
