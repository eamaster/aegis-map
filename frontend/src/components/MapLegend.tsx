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
                    className="bg-gray-900/40 backdrop-blur-xl border border-white/20 rounded-2xl px-5 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] hover:bg-gray-900/60 transition-all duration-300"
                >
                    <div className="flex items-center gap-3">
                        <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse shadow-[0_0_12px_rgba(74,222,128,0.8)]" />
                        <span className="text-white font-black text-xl tracking-tight">{counts.total}</span>
                        <ChevronDown size={18} className="text-gray-300" />
                    </div>
                </button>
            </div>
        );
    }

    return (
        <div className="absolute top-4 right-4 z-30">
            <div className="relative bg-gradient-to-br from-gray-900/50 via-gray-800/50 to-gray-900/50 backdrop-blur-2xl border border-white/20 rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden w-72">
                <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-transparent rounded-full blur-3xl" />
                <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-purple-500/10 via-blue-500/10 to-transparent rounded-full blur-3xl" />

                <div className="relative flex items-center justify-between px-5 py-4 bg-gradient-to-r from-gray-800/60 via-gray-900/60 to-gray-800/60 backdrop-blur-sm border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse shadow-[0_0_12px_rgba(74,222,128,0.9)]" />
                        <h3 className="text-white font-black text-base tracking-tight">Active Disasters</h3>
                    </div>
                    <button
                        onClick={() => setIsExpanded(false)}
                        className="text-gray-400 hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition-all duration-200"
                        aria-label="Collapse"
                    >
                        <ChevronUp size={18} />
                    </button>
                </div>

                <div className="relative p-5 space-y-4">
                    <div className="relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 via-purple-500/20 to-blue-500/20 rounded-2xl blur-xl" />
                        <div className="relative text-center py-6 bg-gradient-to-br from-blue-600/20 via-purple-600/20 to-blue-600/20 backdrop-blur-sm rounded-2xl border-2 border-blue-400/30 shadow-lg">
                            <div className="text-6xl font-black bg-gradient-to-br from-white via-blue-100 to-purple-100 bg-clip-text text-transparent drop-shadow-[0_2px_8px_rgba(255,255,255,0.3)]">
                                {counts.total.toLocaleString()}
                            </div>
                            <div className="text-xs text-gray-200 uppercase tracking-[0.2em] mt-2 font-bold">Total Events</div>
                        </div>
                    </div>

                    <div className="text-[10px] text-gray-300 text-center uppercase tracking-[0.15em] font-bold bg-white/5 backdrop-blur-sm rounded-xl py-2 border border-white/10">
                        ↓ Click to Filter Map ↓
                    </div>

                    <div className="space-y-3">
                        <button
                            onClick={() => onFilterToggle('fire')}
                            className={`group w-full flex items-center justify-between px-5 py-4 rounded-2xl transition-all duration-300 transform ${isActive('fire')
                                    ? 'bg-gradient-to-r from-red-600/30 via-red-500/30 to-red-600/30 backdrop-blur-md border-2 border-red-400/60 shadow-[0_0_20px_rgba(239,68,68,0.4)] scale-105'
                                    : 'bg-gray-800/30 backdrop-blur-sm border-2 border-white/10 opacity-60 hover:opacity-100 hover:border-white/20'
                                }`}
                            style={{ transform: isActive('fire') ? 'scale(1.05)' : 'scale(1)' }}
                        >
                            <div className="flex items-center gap-4">
                                <div className={`relative w-4 h-4 rounded-full transition-all duration-300 ${isActive('fire')
                                        ? 'bg-red-500 shadow-[0_0_16px_rgba(239,68,68,1)] scale-125'
                                        : 'bg-gray-600 group-hover:bg-gray-500'
                                    }`}>
                                    {isActive('fire') && (
                                        <div className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-75" />
                                    )}
                                </div>
                                <Flame size={18} className={isActive('fire') ? 'text-red-300' : 'text-gray-500 group-hover:text-gray-400'} />
                                <span className={`text-sm font-bold ${isActive('fire') ? 'text-white' : 'text-gray-500 group-hover:text-gray-400'}`}>
                                    Fires
                                </span>
                            </div>
                            <span className={`font-black text-2xl ${isActive('fire') ? 'text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]' : 'text-gray-600'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {counts.fires.toLocaleString()}
                            </span>
                        </button>

                        <button
                            onClick={() => onFilterToggle('earthquake')}
                            className={`group w-full flex items-center justify-between px-5 py-4 rounded-2xl transition-all duration-300 transform ${isActive('earthquake')
                                    ? 'bg-gradient-to-r from-orange-600/30 via-orange-500/30 to-orange-600/30 backdrop-blur-md border-2 border-orange-400/60 shadow-[0_0_20px_rgba(255,140,0,0.4)] scale-105'
                                    : 'bg-gray-800/30 backdrop-blur-sm border-2 border-white/10 opacity-60 hover:opacity-100 hover:border-white/20'
                                }`}
                            style={{ transform: isActive('earthquake') ? 'scale(1.05)' : 'scale(1)' }}
                        >
                            <div className="flex items-center gap-4">
                                <div className={`relative w-4 h-4 rounded-full transition-all duration-300 ${isActive('earthquake')
                                        ? 'bg-orange-500 shadow-[0_0_16px_rgba(255,140,0,1)] scale-125'
                                        : 'bg-gray-600 group-hover:bg-gray-500'
                                    }`}>
                                    {isActive('earthquake') && (
                                        <div className="absolute inset-0 rounded-full bg-orange-400 animate-ping opacity-75" />
                                    )}
                                </div>
                                <Waves size={18} className={isActive('earthquake') ? 'text-orange-300' : 'text-gray-500 group-hover:text-gray-400'} />
                                <span className={`text-sm font-bold ${isActive('earthquake') ? 'text-white' : 'text-gray-500 group-hover:text-gray-400'}`}>
                                    Earthquakes
                                </span>
                            </div>
                            <span className={`font-black text-2xl ${isActive('earthquake') ? 'text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]' : 'text-gray-600'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {counts.earthquakes.toLocaleString()}
                            </span>
                        </button>

                        <button
                            onClick={() => onFilterToggle('volcano')}
                            className={`group w-full flex items-center justify-between px-5 py-4 rounded-2xl transition-all duration-300 transform ${isActive('volcano')
                                    ? 'bg-gradient-to-r from-orange-600/30 via-red-600/30 to-orange-600/30 backdrop-blur-md border-2 border-orange-500/60 shadow-[0_0_20px_rgba(255,107,53,0.4)] scale-105'
                                    : 'bg-gray-800/30 backdrop-blur-sm border-2 border-white/10 opacity-60 hover:opacity-100 hover:border-white/20'
                                }`}
                            style={{ transform: isActive('volcano') ? 'scale(1.05)' : 'scale(1)' }}
                        >
                            <div className="flex items-center gap-4">
                                <div className={`relative w-4 h-4 rounded-full transition-all duration-300 ${isActive('volcano')
                                        ? 'bg-orange-600 shadow-[0_0_16px_rgba(255,107,53,1)] scale-125'
                                        : 'bg-gray-600 group-hover:bg-gray-500'
                                    }`}>
                                    {isActive('volcano') && (
                                        <div className="absolute inset-0 rounded-full bg-orange-500 animate-ping opacity-75" />
                                    )}
                                </div>
                                <Mountain size={18} className={isActive('volcano') ? 'text-orange-300' : 'text-gray-500 group-hover:text-gray-400'} />
                                <span className={`text-sm font-bold ${isActive('volcano') ? 'text-white' : 'text-gray-500 group-hover:text-gray-400'}`}>
                                    Volcanoes
                                </span>
                            </div>
                            <span className={`font-black text-2xl ${isActive('volcano') ? 'text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]' : 'text-gray-600'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {counts.volcanoes.toLocaleString()}
                            </span>
                        </button>
                    </div>

                    <div className="pt-4 border-t border-white/10 flex items-center justify-between bg-white/5 backdrop-blur-sm -mx-5 px-5 pb-4 rounded-b-3xl">
                        <div className="text-xs text-gray-300 font-semibold flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                            {lastUpdated ? formatTime(lastUpdated) : 'Loading...'}
                        </div>
                        {onRefresh && (
                            <button
                                onClick={onRefresh}
                                disabled={isRefreshing}
                                className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/20 p-2 rounded-xl transition-all duration-200 disabled:opacity-50 backdrop-blur-sm border border-white/10"
                                aria-label="Refresh"
                            >
                                <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
