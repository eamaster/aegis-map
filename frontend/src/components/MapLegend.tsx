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
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    const isActive = (type: string) => activeFilters.has(type);

    if (!isExpanded) {
        return (
            <div className="absolute top-4 right-4 z-30">
                <button
                    onClick={() => setIsExpanded(true)}
                    className="flex items-center gap-3 bg-gray-900/90 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-3 shadow-lg hover:bg-gray-800 transition-all duration-300"
                >
                    <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.8)]" />
                    <span className="text-white font-bold text-lg tabular-nums tracking-tight">{counts.total.toLocaleString()}</span>
                    <ChevronDown size={16} className="text-gray-400" />
                </button>
            </div>
        );
    }

    return (
        <div className="absolute top-4 right-4 z-30">
            <div
                className="relative overflow-hidden rounded-3xl transition-all duration-300 ease-out"
                style={{
                    width: 'clamp(300px, 90vw, 380px)',
                    background: 'rgba(17, 24, 39, 0.95)', // High opacity dark background
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)'
                }}
            >
                {/* Simplified Header / Collapse */}
                <div className="flex items-center justify-between px-5 pt-4 pb-2">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-gray-400 text-xs font-bold uppercase tracking-wider">Live Monitor</span>
                    </div>
                    <button
                        onClick={() => setIsExpanded(false)}
                        className="text-gray-500 hover:text-white transition-colors p-1"
                        aria-label="Collapse"
                    >
                        <ChevronUp size={18} />
                    </button>
                </div>

                <div className="px-5 pb-5 space-y-5">
                    {/* Total Count - Clean & Big */}
                    <div className="flex items-baseline gap-2">
                        <span className="text-5xl font-black text-white tracking-tighter drop-shadow-lg tabular-nums">
                            {counts.total.toLocaleString()}
                        </span>
                        <span className="text-gray-400 font-medium text-sm">active events</span>
                    </div>

                    {/* Filter List - Compact */}
                    <div className="space-y-2">
                        {/* Fire */}
                        <button
                            onClick={() => onFilterToggle('fire')}
                            className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all duration-200 ${isActive('fire')
                                    ? 'bg-red-500/10 border-red-500/30'
                                    : 'bg-white/5 border-transparent hover:bg-white/10'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${isActive('fire') ? 'bg-red-500 text-white' : 'bg-gray-700 text-gray-400'}`}>
                                    <Flame size={16} />
                                </div>
                                <span className={`font-semibold ${isActive('fire') ? 'text-white' : 'text-gray-400'}`}>Wildfires</span>
                            </div>
                            <span className={`font-bold tabular-nums ${isActive('fire') ? 'text-red-400' : 'text-gray-500'}`}>
                                {counts.fires.toLocaleString()}
                            </span>
                        </button>

                        {/* Volcano */}
                        <button
                            onClick={() => onFilterToggle('volcano')}
                            className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all duration-200 ${isActive('volcano')
                                    ? 'bg-orange-500/10 border-orange-500/30'
                                    : 'bg-white/5 border-transparent hover:bg-white/10'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${isActive('volcano') ? 'bg-orange-500 text-white' : 'bg-gray-700 text-gray-400'}`}>
                                    <Mountain size={16} />
                                </div>
                                <span className={`font-semibold ${isActive('volcano') ? 'text-white' : 'text-gray-400'}`}>Volcanoes</span>
                            </div>
                            <span className={`font-bold tabular-nums ${isActive('volcano') ? 'text-orange-400' : 'text-gray-500'}`}>
                                {counts.volcanoes.toLocaleString()}
                            </span>
                        </button>

                        {/* Earthquake */}
                        <button
                            onClick={() => onFilterToggle('earthquake')}
                            className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all duration-200 ${isActive('earthquake')
                                    ? 'bg-amber-500/10 border-amber-500/30'
                                    : 'bg-white/5 border-transparent hover:bg-white/10'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${isActive('earthquake') ? 'bg-amber-500 text-white' : 'bg-gray-700 text-gray-400'}`}>
                                    <Waves size={16} />
                                </div>
                                <span className={`font-semibold ${isActive('earthquake') ? 'text-white' : 'text-gray-400'}`}>Earthquakes</span>
                            </div>
                            <span className={`font-bold tabular-nums ${isActive('earthquake') ? 'text-amber-400' : 'text-gray-500'}`}>
                                {counts.earthquakes.toLocaleString()}
                            </span>
                        </button>
                    </div>

                    {/* Footer / Refresh */}
                    <div className="pt-3 border-t border-white/5 flex items-center justify-between">
                        <span className="text-xs text-gray-500 font-medium">
                            Updated {lastUpdated ? formatTime(lastUpdated) : '...'}
                        </span>
                        {onRefresh && (
                            <button
                                onClick={onRefresh}
                                disabled={isRefreshing}
                                className="text-blue-400 hover:text-white transition-colors disabled:opacity-50"
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
