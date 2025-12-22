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
                    className="flex items-center gap-3 px-6 py-4 transition-all duration-300 hover:scale-105 active:scale-95"
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

    // Expanded state - Professional Dashboard Design
    return (
        <div className="absolute top-6 left-6 z-30">
            <div
                className="w-[320px] transition-all duration-300"
                style={{
                    borderRadius: '0',
                    background: 'linear-gradient(135deg, rgba(10, 15, 28, 0.95) 0%, rgba(17, 24, 39, 0.95) 100%)',
                    backdropFilter: 'blur(32px)',
                    WebkitBackdropFilter: 'blur(32px)',
                    border: '1px solid rgba(59, 130, 246, 0.2)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 1px rgba(59, 130, 246, 0.4)'
                }}
            >
                {/* Header - Prominent Live Indicator */}
                <div
                    className="px-6 pt-5 pb-4 flex items-center justify-between"
                    style={{
                        borderBottom: '1px solid rgba(59, 130, 246, 0.15)'
                    }}
                >
                    <div className="flex items-center gap-3">
                        <div
                            className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse"
                            style={{
                                boxShadow: '0 0 16px rgba(74, 222, 128, 0.9), 0 0 4px rgba(74, 222, 128, 0.5)'
                            }}
                        />
                        <span
                            className="text-sm font-black uppercase tracking-widest"
                            style={{
                                color: 'rgb(209, 213, 219)',
                                letterSpacing: '0.1em'
                            }}
                        >
                            Live Monitor
                        </span>
                    </div>
                    <button
                        onClick={() => setIsExpanded(false)}
                        className="text-gray-500 hover:text-white transition-colors p-1.5 hover:bg-white/5 rounded-lg"
                    >
                        <ChevronUp size={16} />
                    </button>
                </div>

                {/* Main Content - Professional Hierarchy */}
                <div className="px-6 pt-6 pb-6 space-y-6">
                    {/* Hero Number - Primary Focus */}
                    <div>
                        <span
                            className="block text-6xl font-black text-white tracking-tighter tabular-nums"
                            style={{
                                lineHeight: '1',
                                textShadow: '0 4px 24px rgba(59, 130, 246, 0.4)'
                            }}
                        >
                            {counts.total.toLocaleString()}
                        </span>
                        <div className="flex items-baseline gap-2 mt-2">
                            <span className="text-base font-bold text-gray-300">Active Events</span>
                            <div
                                className="h-1 flex-1 rounded-full"
                                style={{
                                    background: 'linear-gradient(90deg, rgba(59, 130, 246, 0.6), transparent)',
                                    boxShadow: '0 0 12px rgba(59, 130, 246, 0.4)'
                                }}
                            />
                        </div>
                    </div>

                    {/* Disaster Type Filters */}
                    <div className="space-y-2">
                        {/* Wildfires */}
                        <button
                            onClick={() => onFilterToggle('fire')}
                            className="w-full group transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <div
                                className={`flex items-center justify-between p-3 border-b transition-all duration-500 ease-in-out transform ${isActive('fire')
                                    ? 'bg-gradient-to-r from-red-500/15 to-transparent border-red-500/30'
                                    : 'border-white/[0.05] opacity-60 hover:opacity-80 hover:bg-white/[0.03]'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div
                                        className={`p-2 rounded-lg transition-all duration-500 ease-in-out transform ${isActive('fire')
                                            ? 'bg-red-500 shadow-[0_0_16px_rgba(239,68,68,0.5)] scale-110'
                                            : 'bg-transparent scale-100'
                                            }`}
                                    >
                                        <Flame
                                            size={16}
                                            className={`transition-all duration-500 ${isActive('fire') ? 'text-white' : 'text-gray-500'}`}
                                        />
                                    </div>
                                    <span className={`font-bold text-sm transition-all duration-500 ${isActive('fire') ? 'text-white' : 'text-gray-500'}`}>
                                        Wildfires
                                    </span>
                                </div>
                                <span
                                    className={`font-black text-xl tabular-nums transition-all duration-500 ease-in-out transform ${isActive('fire') ? 'text-red-400 scale-110' : 'text-gray-600 scale-100'
                                        }`}
                                >
                                    {counts.fires.toLocaleString()}
                                </span>
                            </div>
                        </button>

                        {/* Volcanoes */}
                        <button
                            onClick={() => onFilterToggle('volcano')}
                            className="w-full group transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <div
                                className={`flex items-center justify-between p-3 border-b transition-all duration-500 ease-in-out transform ${isActive('volcano')
                                    ? 'bg-gradient-to-r from-orange-500/15 to-transparent border-orange-500/30'
                                    : 'border-white/[0.05] opacity-60 hover:opacity-80 hover:bg-white/[0.03]'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div
                                        className={`p-2 rounded-lg transition-all duration-500 ease-in-out transform ${isActive('volcano')
                                            ? 'bg-orange-500 shadow-[0_0_16px_rgba(249,115,22,0.5)] scale-110'
                                            : 'bg-transparent scale-100'
                                            }`}
                                    >
                                        <Mountain
                                            size={16}
                                            className={`transition-all duration-500 ${isActive('volcano') ? 'text-white' : 'text-gray-500'}`}
                                        />
                                    </div>
                                    <span className={`font-bold text-sm transition-all duration-500 ${isActive('volcano') ? 'text-white' : 'text-gray-500'}`}>
                                        Volcanoes
                                    </span>
                                </div>
                                <span
                                    className={`font-black text-xl tabular-nums transition-all duration-500 ease-in-out transform ${isActive('volcano') ? 'text-orange-400 scale-110' : 'text-gray-600 scale-100'
                                        }`}
                                >
                                    {counts.volcanoes.toLocaleString()}
                                </span>
                            </div>
                        </button>

                        {/* Earthquakes */}
                        <button
                            onClick={() => onFilterToggle('earthquake')}
                            className="w-full group transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <div
                                className={`flex items-center justify-between p-3 border-b transition-all duration-500 ease-in-out transform ${isActive('earthquake')
                                    ? 'bg-gradient-to-r from-amber-500/15 to-transparent border-amber-500/30'
                                    : 'border-white/[0.05] opacity-60 hover:opacity-80 hover:bg-white/[0.03]'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div
                                        className={`p-2 rounded-lg transition-all duration-500 ease-in-out transform ${isActive('earthquake')
                                            ? 'bg-amber-500 shadow-[0_0_16px_rgba(245,158,11,0.5)] scale-110'
                                            : 'bg-transparent scale-100'
                                            }`}
                                    >
                                        <Waves
                                            size={16}
                                            className={`transition-all duration-500 ${isActive('earthquake') ? 'text-white' : 'text-gray-500'}`}
                                        />
                                    </div>
                                    <span className={`font-bold text-sm transition-all duration-500 ${isActive('earthquake') ? 'text-white' : 'text-gray-500'}`}>
                                        Earthquakes
                                    </span>
                                </div>
                                <span
                                    className={`font-black text-xl tabular-nums transition-all duration-500 ease-in-out transform ${isActive('earthquake') ? 'text-amber-400 scale-110' : 'text-gray-600 scale-100'
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
