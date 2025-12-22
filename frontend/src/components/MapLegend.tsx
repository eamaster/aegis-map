/**
 * MapLegend Component - Professional Dashboard Design
 * Features: Bold typography, modern glass-morphism, expandable panel, responsive mobile bottom sheet
 */

import { useState } from 'react';
import { Flame, Mountain, Waves, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { useDesignSystem } from '../hooks/useDesignSystem';

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
    const ds = useDesignSystem();
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
            <div className="legend-responsive">
                <button
                    onClick={() => setIsExpanded(true)}
                    className="flex items-center gap-3 px-5 md:px-6 py-3 md:py-4 transition-all duration-300 hover:scale-105 active:scale-95 touch-target"
                    style={{
                        ...ds.glass.panel,
                        borderRadius: ds.borderRadius.md,
                    }}
                >
                    <div
                        className="w-2.5 h-2.5 rounded-full animate-pulse"
                        style={{
                            background: ds.colors.status.success,
                            boxShadow: `0 0 12px ${ds.colors.status.success}CC`
                        }}
                    />
                    <span
                        className="font-black text-lg md:text-xl tabular-nums tracking-tight"
                        style={{ color: ds.isDark ? '#ffffff' : '#111827' }}
                    >
                        {counts.total.toLocaleString()}
                    </span>
                    <ChevronDown
                        size={18}
                        style={{ color: ds.isDark ? 'rgb(156, 163, 175)' : 'rgb(107, 114, 128)' }}
                    />
                </button>
            </div>
        );
    }

    // Expanded state - Professional Dashboard Design with responsive mobile bottom sheet
    return (
        <div className="legend-responsive">
            <div
                className="w-full md:w-[320px] transition-all duration-300"
                style={{
                    ...ds.glass.panel,
                    borderColor: ds.headerBorderColor,
                    boxShadow: `0 8px 32px rgba(0, 0, 0, ${ds.isDark ? '0.6' : '0.15'}), 0 0 1px ${ds.colors.accent.blue}66`,
                }}
            >
                {/* Header - Prominent Live Indicator */}
                <div
                    className="px-5 md:px-6 pt-4 md:pt-5 pb-3 md:pb-4 flex items-center justify-between"
                    style={{
                        borderBottom: `1px solid ${ds.headerBorderColor}`
                    }}
                >
                    <div className="flex items-center gap-3">
                        <div
                            className="w-2.5 h-2.5 rounded-full animate-pulse"
                            style={{
                                background: ds.colors.status.success,
                                boxShadow: `0 0 16px ${ds.colors.status.success}E6, 0 0 4px ${ds.colors.status.success}80`
                            }}
                        />
                        <span
                            className="text-xs md:text-sm font-black uppercase tracking-widest"
                            style={{
                                color: ds.isDark ? 'rgb(209, 213, 219)' : 'rgb(75, 85, 99)',
                                letterSpacing: '0.1em'
                            }}
                        >
                            Live Monitor
                        </span>
                    </div>
                    <button
                        onClick={() => setIsExpanded(false)}
                        className="p-1.5 rounded-lg transition-colors touch-target"
                        style={{
                            color: ds.isDark ? 'rgb(107, 114, 128)' : 'rgb(156, 163, 175)',
                        }}
                    >
                        <ChevronUp size={16} />
                    </button>
                </div>

                {/* Main Content - Professional Hierarchy */}
                <div className="px-5 md:px-6 pt-5 md:pt-6 pb-5 md:pb-6 space-y-5 md:space-y-6">
                    {/* Hero Number - Primary Focus */}
                    <div>
                        <span
                            className="block text-5xl md:text-6xl font-black tracking-tighter tabular-nums"
                            style={{
                                color: ds.isDark ? '#ffffff' : '#111827',
                                lineHeight: '1',
                                textShadow: ds.isDark ? `0 4px 24px ${ds.colors.accent.blue}66` : 'none'
                            }}
                        >
                            {counts.total.toLocaleString()}
                        </span>
                        <div className="flex items-baseline gap-2 mt-2">
                            <span
                                className="text-sm md:text-base font-bold"
                                style={{ color: ds.isDark ? 'rgb(209, 213, 219)' : 'rgb(75, 85, 99)' }}
                            >
                                Active Events
                            </span>
                            <div
                                className="h-1 flex-1 rounded-full"
                                style={{
                                    background: `linear-gradient(90deg, ${ds.colors.accent.blue}99, transparent)`,
                                    boxShadow: `0 0 12px ${ds.colors.accent.blue}66`
                                }}
                            />
                        </div>
                    </div>

                    {/* Disaster Type Filters */}
                    <div className="space-y-2">
                        {/* Wildfires */}
                        <button
                            onClick={() => onFilterToggle('fire')}
                            className="w-full group transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] touch-target"
                        >
                            <div
                                className={`flex items-center justify-between p-3 border-b transition-all duration-500 ease-in-out transform ${isActive('fire')
                                    ? 'bg-gradient-to-r from-red-500/15 to-transparent border-red-500/30'
                                    : 'opacity-60 hover:opacity-80'
                                    }`}
                                style={{
                                    borderColor: isActive('fire') ? undefined : (ds.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)')
                                }}
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
                                            className={`transition-all duration-500 ${isActive('fire') ? 'text-white' : ''}`}
                                            style={{ color: isActive('fire') ? undefined : (ds.isDark ? 'rgb(107, 114, 128)' : 'rgb(156, 163, 175)') }}
                                        />
                                    </div>
                                    <span
                                        className={`font-bold text-sm transition-all duration-500`}
                                        style={{ color: isActive('fire') ? (ds.isDark ? '#ffffff' : '#111827') : (ds.isDark ? 'rgb(107, 114, 128)' : 'rgb(156, 163, 175)') }}
                                    >
                                        Wildfires
                                    </span>
                                </div>
                                <span
                                    className={`font-black text-lg md:text-xl tabular-nums transition-all duration-500 ease-in-out transform ${isActive('fire') ? 'text-red-400 scale-110' : 'scale-100'
                                        }`}
                                    style={{ color: isActive('fire') ? undefined : (ds.isDark ? 'rgb(75, 85, 99)' : 'rgb(156, 163, 175)') }}
                                >
                                    {counts.fires.toLocaleString()}
                                </span>
                            </div>
                        </button>

                        {/* Volcanoes */}
                        <button
                            onClick={() => onFilterToggle('volcano')}
                            className="w-full group transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] touch-target"
                        >
                            <div
                                className={`flex items-center justify-between p-3 border-b transition-all duration-500 ease-in-out transform ${isActive('volcano')
                                    ? 'bg-gradient-to-r from-orange-500/15 to-transparent border-orange-500/30'
                                    : 'opacity-60 hover:opacity-80'
                                    }`}
                                style={{
                                    borderColor: isActive('volcano') ? undefined : (ds.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)')
                                }}
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
                                            className={`transition-all duration-500 ${isActive('volcano') ? 'text-white' : ''}`}
                                            style={{ color: isActive('volcano') ? undefined : (ds.isDark ? 'rgb(107, 114, 128)' : 'rgb(156, 163, 175)') }}
                                        />
                                    </div>
                                    <span
                                        className={`font-bold text-sm transition-all duration-500`}
                                        style={{ color: isActive('volcano') ? (ds.isDark ? '#ffffff' : '#111827') : (ds.isDark ? 'rgb(107, 114, 128)' : 'rgb(156, 163, 175)') }}
                                    >
                                        Volcanoes
                                    </span>
                                </div>
                                <span
                                    className={`font-black text-lg md:text-xl tabular-nums transition-all duration-500 ease-in-out transform ${isActive('volcano') ? 'text-orange-400 scale-110' : 'scale-100'
                                        }`}
                                    style={{ color: isActive('volcano') ? undefined : (ds.isDark ? 'rgb(75, 85, 99)' : 'rgb(156, 163, 175)') }}
                                >
                                    {counts.volcanoes.toLocaleString()}
                                </span>
                            </div>
                        </button>

                        {/* Earthquakes */}
                        <button
                            onClick={() => onFilterToggle('earthquake')}
                            className="w-full group transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] touch-target"
                        >
                            <div
                                className={`flex items-center justify-between p-3 border-b transition-all duration-500 ease-in-out transform ${isActive('earthquake')
                                    ? 'bg-gradient-to-r from-amber-500/15 to-transparent border-amber-500/30'
                                    : 'opacity-60 hover:opacity-80'
                                    }`}
                                style={{
                                    borderColor: isActive('earthquake') ? undefined : (ds.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)')
                                }}
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
                                            className={`transition-all duration-500 ${isActive('earthquake') ? 'text-white' : ''}`}
                                            style={{ color: isActive('earthquake') ? undefined : (ds.isDark ? 'rgb(107, 114, 128)' : 'rgb(156, 163, 175)') }}
                                        />
                                    </div>
                                    <span
                                        className={`font-bold text-sm transition-all duration-500`}
                                        style={{ color: isActive('earthquake') ? (ds.isDark ? '#ffffff' : '#111827') : (ds.isDark ? 'rgb(107, 114, 128)' : 'rgb(156, 163, 175)') }}
                                    >
                                        Earthquakes
                                    </span>
                                </div>
                                <span
                                    className={`font-black text-lg md:text-xl tabular-nums transition-all duration-500 ease-in-out transform ${isActive('earthquake') ? 'text-amber-400 scale-110' : 'scale-100'
                                        }`}
                                    style={{ color: isActive('earthquake') ? undefined : (ds.isDark ? 'rgb(75, 85, 99)' : 'rgb(156, 163, 175)') }}
                                >
                                    {counts.earthquakes.toLocaleString()}
                                </span>
                            </div>
                        </button>
                    </div>

                    {/* Footer - Last Updated */}
                    <div
                        className="pt-3 border-t flex items-center justify-between"
                        style={{ borderColor: ds.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}
                    >
                        <div className="flex items-center gap-1.5">
                            <span
                                className="text-[10px] font-medium"
                                style={{ color: ds.isDark ? 'rgb(107, 114, 128)' : 'rgb(156, 163, 175)' }}
                            >
                                Updated
                            </span>
                            <span
                                className="text-[10px] font-semibold"
                                style={{ color: ds.isDark ? 'rgb(156, 163, 175)' : 'rgb(107, 114, 128)' }}
                            >
                                {lastUpdated ? formatTime(lastUpdated) : 'Just now'}
                            </span>
                        </div>
                        {onRefresh && (
                            <button
                                onClick={onRefresh}
                                disabled={isRefreshing}
                                className="p-2 rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed group touch-target"
                                style={{
                                    background: ds.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                                    borderColor: ds.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                                }}
                                title="Refresh data"
                            >
                                <RefreshCw
                                    size={12}
                                    className={`transition-colors ${isRefreshing ? 'animate-spin' : ''}`}
                                    style={{ color: ds.colors.accent.blue }}
                                />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
