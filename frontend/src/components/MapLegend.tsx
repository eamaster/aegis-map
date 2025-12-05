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

        if (diffMins < 1) return 'now';
        if (diffMins < 60) return `${diffMins}m`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h`;
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    const isActive = (type: string) => activeFilters.has(type);

    if (!isExpanded) {
        return (
            <div className="absolute top-4 right-4 z-30">
                <button
                    onClick={() => setIsExpanded(true)}
                    className="bg-gray-900/95 backdrop-blur-xl border border-white/20 rounded-xl px-4 py-3 shadow-2xl hover:bg-gray-900 transition-all"
                >
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
                        <span className="text-white font-bold text-lg">{counts.total}</span>
                        <ChevronDown size={16} className="text-gray-300" />
                    </div>
                </button>
            </div>
        );
    }

    return (
        <div className="absolute top-4 right-4 z-30">
            <div className="bg-gray-900/98 backdrop-blur-xl border border-white/30 rounded-xl shadow-2xl overflow-hidden w-64">
                {/* Header - Better contrast */}
                <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-gray-800 to-gray-900 border-b border-white/20">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
                        <h3 className="text-white font-bold text-sm tracking-wide">Active Disasters</h3>
                    </div>
                    <button
                        onClick={() => setIsExpanded(false)}
                        className="text-gray-300 hover:text-white transition-colors"
                        aria-label="Collapse"
                    >
                        <ChevronUp size={16} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-3">
                    {/* Total - High contrast */}
                    <div className="text-center py-3 bg-gradient-to-br from-blue-600/20 to-blue-500/20 rounded-lg border-2 border-blue-500/40 shadow-lg">
                        <div className="text-5xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                            {counts.total}
                        </div>
                        <div className="text-xs text-gray-100 uppercase tracking-wider mt-1 font-semibold">Total Events</div>
                    </div>

                    {/* Filter Instructions - Better visibility */}
                    <div className="text-[11px] text-gray-200 text-center pb-1 uppercase tracking-widest font-semibold bg-gray-800/40 rounded py-2">
                        Click to filter map
                    </div>

                    {/* Types (Clickable Filters) - High contrast */}
                    <div className="space-y-2.5">
                        {/* Fires - Red theme with high visibility */}
                        <button
                            onClick={() => onFilterToggle('fire')}
                            className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-all transform ${isActive('fire')
                                    ? 'bg-gradient-to-r from-red-600/30 to-red-500/30 border-2 border-red-500/70 shadow-[0_0_15px_rgba(239,68,68,0.4)] scale-105'
                                    : 'bg-gray-800/50 border-2 border-gray-700/50 opacity-50 hover:opacity-80 hover:border-gray-600/70'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-3.5 h-3.5 rounded-full transition-all ${isActive('fire')
                                        ? 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.9)] scale-125'
                                        : 'bg-gray-600'
                                    }`} />
                                <Flame size={16} className={isActive('fire') ? 'text-red-400' : 'text-gray-500'} />
                                <span className={`text-sm font-bold ${isActive('fire') ? 'text-white' : 'text-gray-500'}`}>
                                    Fires
                                </span>
                            </div>
                            <span className={`font-black text-lg ${isActive('fire') ? 'text-white' : 'text-gray-600'}`}>
                                {counts.fires}
                            </span>
                        </button>

                        {/* Earthquakes - Orange theme with high visibility */}
                        <button
                            onClick={() => onFilterToggle('earthquake')}
                            className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-all transform ${isActive('earthquake')
                                    ? 'bg-gradient-to-r from-orange-600/30 to-orange-500/30 border-2 border-orange-500/70 shadow-[0_0_15px_rgba(255,140,0,0.4)] scale-105'
                                    : 'bg-gray-800/50 border-2 border-gray-700/50 opacity-50 hover:opacity-80 hover:border-gray-600/70'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-3.5 h-3.5 rounded-full transition-all ${isActive('earthquake')
                                        ? 'bg-orange-500 shadow-[0_0_12px_rgba(255,140,0,0.9)] scale-125'
                                        : 'bg-gray-600'
                                    }`} />
                                <Waves size={16} className={isActive('earthquake') ? 'text-orange-400' : 'text-gray-500'} />
                                <span className={`text-sm font-bold ${isActive('earthquake') ? 'text-white' : 'text-gray-500'}`}>
                                    Earthquakes
                                </span>
                            </div>
                            <span className={`font-black text-lg ${isActive('earthquake') ? 'text-white' : 'text-gray-600'}`}>
                                {counts.earthquakes}
                            </span>
                        </button>

                        {/* Volcanoes - Orange-red theme with high visibility */}
                        <button
                            onClick={() => onFilterToggle('volcano')}
                            className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-all transform ${isActive('volcano')
                                    ? 'bg-gradient-to-r from-orange-600/30 to-red-600/30 border-2 border-orange-500/70 shadow-[0_0_15px_rgba(255,107,53,0.4)] scale-105'
                                    : 'bg-gray-800/50 border-2 border-gray-700/50 opacity-50 hover:opacity-80 hover:border-gray-600/70'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-3.5 h-3.5 rounded-full transition-all ${isActive('volcano')
                                        ? 'bg-orange-600 shadow-[0_0_12px_rgba(255,107,53,0.9)] scale-125'
                                        : 'bg-gray-600'
                                    }`} />
                                <Mountain size={16} className={isActive('volcano') ? 'text-orange-400' : 'text-gray-500'} />
                                <span className={`text-sm font-bold ${isActive('volcano') ? 'text-white' : 'text-gray-500'}`}>
                                    Volcanoes
                                </span>
                            </div>
                            <span className={`font-black text-lg ${isActive('volcano') ? 'text-white' : 'text-gray-600'}`}>
                                {counts.volcanoes}
                            </span>
                        </button>
                    </div>

                    {/* Footer - Better contrast */}
                    <div className="pt-3 border-t border-white/20 flex items-center justify-between bg-gray-800/30 -mx-4 px-4 pb-3 mt-3">
                        <div className="text-xs text-gray-200 font-medium">
                            {lastUpdated ? (() => {
                                const timeStr = formatTime(lastUpdated);
                                if (timeStr === 'now') return 'Just now';
                                if (timeStr.includes(':')) return timeStr;
                                return `${timeStr} ago`;
                            })() : 'Loading...'}
                        </div>
                        {onRefresh && (
                            <button
                                onClick={onRefresh}
                                disabled={isRefreshing}
                                className="text-blue-400 hover:text-blue-300 p-1.5 hover:bg-blue-500/20 rounded transition-all disabled:opacity-50"
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
