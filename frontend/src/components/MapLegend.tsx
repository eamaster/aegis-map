/**
 * MapLegend Component - Professional Dashboard Design
 * Features: Bold typography, modern glass-morphism, expandable panel
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
    activeFilters: Set<string>;
    onFilterToggle: (type: string) => void;
}

export default function MapLegend({
    counts,
    lastUpdated,
    onRefresh,
    isRefreshing = false,
    activeFilters,
    onFilterToggle
}: MapLegendProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    const formatTime = (date: Date) => {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const isActive = (type: string) => activeFilters.has(type);

    // Collapsed state - minimalist pill
    if (!isExpanded) {
        return (
            <div className="absolute top-6 left-6 z-30">
                <button
                    onClick={() => setIsExpanded(true)}
                    className="flex items-center gap-3 px-6 py-4 rounded-2xl transition-all duration-300 hover:scale-105 active:scale-95"
                    style={{
                        background: 'var(--glass-bg)',
                        backdropFilter: 'blur(24px)',
                        WebkitBackdropFilter: 'blur(24px)',
                        border: '1px solid var(--color-border)',
                        boxShadow: 'var(--shadow-lg)'
                    }}
                >
                    <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse shadow-[0_0_12px_rgba(74,222,128,0.8)]" />
                    <span className="text-white font-black text-xl tabular-nums tracking-tight">
                        {counts.total.toLocaleString()}
                    </span>
                    <ChevronDown size={18} className="text-gray-400" />
                </button>
            </div>
        );
    }

    // Expanded state - full panel
    return (
        <div className="absolute top-6 left-6 z-30">
            <div
                className="w-[280px] rounded-3xl overflow-hidden transition-all duration-300"
                style={{
                    background: 'var(--glass-bg)',
                    backdropFilter: 'blur(32px)',
                    WebkitBackdropFilter: 'blur(32px)',
                    border: '1px solid var(--color-border)',
                    boxShadow: 'var(--shadow-xl)'
                }}
            >
                {/* Header */}
                <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-white/10">
                    <div className="flex items-center gap-2.5">
                        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shadow-[0_0_12px_rgba(74,222,128,0.8)]" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                            Live Monitor
                        </span>
                    </div>
                    <button
                        onClick={() => setIsExpanded(false)}
                        className="text-gray-500 hover:text-white transition-colors p-1.5 hover:bg-white/5 rounded-lg"
                        aria-label="Collapse"
                    >
                        <ChevronUp size={14} />
                    </button>
                </div>

                {/* Main Content */}
                <div className="px-5 pt-5 pb-5 space-y-5">
                    {/* Total Count - Hero Number */}
                    <div>
                        <div className="flex items-baseline gap-2 mb-1">
                            <span
                                className="text-5xl font-black text-white tracking-tighter tabular-nums"
                                style={{
                                    textShadow: '0 2px 16px rgba(59, 130, 246, 0.3)'
                                }}
                            >
                                {counts.total.toLocaleString()}
                            </span>
                            <div className="flex flex-col">
                                <span className="text-gray-400 font-semibold text-xs">active</span>
                                <span className="text-gray-500 font-medium text-[10px]">events</span>
                            </div>
                        </div>
                        <div className="h-0.5 w-16 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 shadow-[0_0_12px_rgba(59,130,246,0.5)]" />
                    </div>

                    {/* Disaster Type Filters */}
                    <div className="space-y-2">
                        {/* Wildfires */}
                        <button
                            onClick={() => onFilterToggle('fire')}
                            className="w-full group transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <div
                                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${isActive('fire')
                                    ? 'bg-gradient-to-r from-red-500/15 to-transparent border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.15)]'
                                    : 'bg-white/[0.03] border-white/[0.05] hover:bg-white/[0.06]'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div
                                        className={`p-2 rounded-lg transition-all ${isActive('fire')
                                            ? 'bg-red-500 shadow-[0_0_16px_rgba(239,68,68,0.5)]'
                                            : 'bg-gray-800/50'
                                            }`}
                                    >
                                        <Flame
                                            size={16}
                                            className={isActive('fire') ? 'text-white' : 'text-gray-500'}
                                        />
                                    </div>
                                    <span className={`font-bold text-sm ${isActive('fire') ? 'text-white' : 'text-gray-500'}`}>
                                        Wildfires
                                    </span>
                                </div>
                                <span
                                    className={`font-black text-xl tabular-nums ${isActive('fire') ? 'text-red-400' : 'text-gray-600'
                                        }`}
                                >
                                    {counts.fires.toLocaleString()}
                                </span>
                            </div>
                        </button>

                        {/* Volcanoes */}
                        <button
                            onClick={() => onFilterToggle('volcano')}
                            className="w-full group transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <div
                                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${isActive('volcano')
                                    ? 'bg-gradient-to-r from-orange-500/15 to-transparent border-orange-500/30 shadow-[0_0_20px_rgba(249,115,22,0.15)]'
                                    : 'bg-white/[0.03] border-white/[0.05] hover:bg-white/[0.06]'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div
                                        className={`p-2 rounded-lg transition-all ${isActive('volcano')
                                            ? 'bg-orange-500 shadow-[0_0_16px_rgba(249,115,22,0.5)]'
                                            : 'bg-gray-800/50'
                                            }`}
                                    >
                                        <Mountain
                                            size={16}
                                            className={isActive('volcano') ? 'text-white' : 'text-gray-500'}
                                        />
                                    </div>
                                    <span className={`font-bold text-sm ${isActive('volcano') ? 'text-white' : 'text-gray-500'}`}>
                                        Volcanoes
                                    </span>
                                </div>
                                <span
                                    className={`font-black text-xl tabular-nums ${isActive('volcano') ? 'text-orange-400' : 'text-gray-600'
                                        }`}
                                >
                                    {counts.volcanoes.toLocaleString()}
                                </span>
                            </div>
                        </button>

                        {/* Earthquakes */}
                        <button
                            onClick={() => onFilterToggle('earthquake')}
                            className="w-full group transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <div
                                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${isActive('earthquake')
                                    ? 'bg-gradient-to-r from-amber-500/15 to-transparent border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.15)]'
                                    : 'bg-white/[0.03] border-white/[0.05] hover:bg-white/[0.06]'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div
                                        className={`p-2 rounded-lg transition-all ${isActive('earthquake')
                                            ? 'bg-amber-500 shadow-[0_0_16px_rgba(245,158,11,0.5)]'
                                            : 'bg-gray-800/50'
                                            }`}
                                    >
                                        <Waves
                                            size={16}
                                            className={isActive('earthquake') ? 'text-white' : 'text-gray-500'}
                                        />
                                    </div>
                                    <span className={`font-bold text-sm ${isActive('earthquake') ? 'text-white' : 'text-gray-500'}`}>
                                        Earthquakes
                                    </span>
                                </div>
                                <span
                                    className={`font-black text-xl tabular-nums ${isActive('earthquake') ? 'text-amber-400' : 'text-gray-600'
                                        }`}
                                >
                                    {counts.earthquakes.toLocaleString()}
                                </span>
                            </div>
                        </button>
                    </div>

                    {/* Footer - Last Updated */}
                    <div className="pt-3 border-t border-white/5 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-gray-500 font-medium">
                                Updated
                            </span>
                            <span className="text-[10px] text-gray-400 font-semibold">
                                {lastUpdated ? formatTime(lastUpdated) : 'Just now'}
                            </span>
                        </div>
                        {onRefresh && (
                            <button
                                onClick={onRefresh}
                                disabled={isRefreshing}
                                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed group"
                                title="Refresh data"
                            >
                                <RefreshCw
                                    size={12}
                                    className={`text-blue-400 group-hover:text-white transition-colors ${isRefreshing ? 'animate-spin' : ''
                                        }`}
                                />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
