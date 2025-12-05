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

                    {/* Filter Instructions */}
                    <div className="text-[10px] text-gray-500 text-center pb-1 uppercase tracking-wider">
                        Click to filter map
                    </div>

                    {/* Types (Clickable Filters) */}
                    <div className="space-y-2">
                        {/* Fires */}
                        <button
                            onClick={() => onFilterToggle('fire')}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all ${isActive('fire')
                                    ? 'bg-[#FF4444]/20 border-2 border-[#FF4444]/50 shadow-lg'
                                    : 'bg-gray-800/30 border border-transparent opacity-40 hover:opacity-70'
                                }`}
                        >
                            <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full transition-all ${isActive('fire') ? 'bg-[#FF4444] shadow-[0_0_10px_rgba(255,68,68,0.8)] scale-110' : 'bg-gray-600'}`} />
                                <Flame size={14} className={isActive('fire') ? 'text-[#FF4444]' : 'text-gray-500'} />
                                <span className={`text-sm font-medium ${isActive('fire') ? 'text-white' : 'text-gray-500'}`}>Fires</span>
                            </div>
                            <span className={`font-bold ${isActive('fire') ? 'text-white' : 'text-gray-600'}`}>{counts.fires}</span>
                        </button>

                        {/* Earthquakes */}
                        <button
                            onClick={() => onFilterToggle('earthquake')}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all ${isActive('earthquake')
                                    ? 'bg-[#FF8C00]/20 border-2 border-[#FF8C00]/50 shadow-lg'
                                    : 'bg-gray-800/30 border border-transparent opacity-40 hover:opacity-70'
                                }`}
                        >
                            <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full transition-all ${isActive('earthquake') ? 'bg-[#FF8C00] shadow-[0_0_10px_rgba(255,140,0,0.8)] scale-110' : 'bg-gray-600'}`} />
                                <Waves size={14} className={isActive('earthquake') ? 'text-[#FF8C00]' : 'text-gray-500'} />
                                <span className={`text-sm font-medium ${isActive('earthquake') ? 'text-white' : 'text-gray-500'}`}>Earthquakes</span>
                            </div>
                            <span className={`font-bold ${isActive('earthquake') ? 'text-white' : 'text-gray-600'}`}>{counts.earthquakes}</span>
                        </button>

                        {/* Volcanoes */}
                        <button
                            onClick={() => onFilterToggle('volcano')}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all ${isActive('volcano')
                                    ? 'bg-[#FF6B35]/20 border-2 border-[#FF6B35]/50 shadow-lg'
                                    : 'bg-gray-800/30 border border-transparent opacity-40 hover:opacity-70'
                                }`}
                        >
                            <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full transition-all ${isActive('volcano') ? 'bg-[#FF6B35] shadow-[0_0_10px_rgba(255,107,53,0.8)] scale-110' : 'bg-gray-600'}`} />
                                <Mountain size={14} className={isActive('volcano') ? 'text-[#FF6B35]' : 'text-gray-500'} />
                                <span className={`text-sm font-medium ${isActive('volcano') ? 'text-white' : 'text-gray-500'}`}>Volcanoes</span>
                            </div>
                            <span className={`font-bold ${isActive('volcano') ? 'text-white' : 'text-gray-600'}`}>{counts.volcanoes}</span>
                        </button>
                    </div>

                    {/* Footer */}
                    <div className="pt-3 border-t border-white/10 flex items-center justify-between">
                        <div className="text-xs text-gray-500">
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
