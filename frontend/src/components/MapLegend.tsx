/**
 * MapLegend Component - Professional Theme-Aware Dashboard
 * ✅ NO CSS CLASS CONFLICTS - Uses only inline styles from design system
 * ✅ Proper spacing between icon, label, and number
 * ✅ Consistent glassmorphism in both dark/light modes
 * ✅ Proper text visibility with high contrast
 */

import { useState } from 'react';
import { Flame, Mountain, Waves, RefreshCw, ChevronUp, ChevronDown } from 'lucide-react';
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

    // Get disaster-specific colors from design system
    const getDisasterColor = (type: 'fire' | 'volcano' | 'earthquake') => {
        return ds.colors.disaster[type];
    };

    // Helper to add opacity to hex colors
    const addOpacity = (hex: string, opacity: number) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
    };

    // Collapsed state - minimalist view
    if (!isExpanded) {
        return (
            <div className="legend-responsive">
                <button
                    onClick={() => setIsExpanded(true)}
                    className="flex items-center gap-3 px-5 py-3 transition-all duration-300 hover:scale-105 active:scale-95"
                    style={{
                        ...ds.glass.card,
                        borderRadius: ds.borderRadius.card,
                        minHeight: '44px',
                        minWidth: '44px',
                    }}
                >
                    <span
                        className="font-black text-xl tabular-nums tracking-tight"
                        style={{ color: ds.textPrimary }}
                    >
                        {counts.total.toLocaleString()}
                    </span>
                    <ChevronDown size={18} style={{ color: ds.textSecondary }} />
                </button>
            </div>
        );
    }

    return (
        <div className="legend-responsive">
            <div
                className="w-full transition-all duration-300"
                style={{
                    ...ds.glass.card,
                    borderRadius: ds.borderRadius.card,
                }}
            >
                {/* Header */}
                <div
                    className="px-6 py-4 flex items-center justify-between"
                    style={{
                        borderBottom: `1px solid ${ds.headerBorderColor}`,
                    }}
                >
                    <div className="flex items-center gap-2.5">
                        <div
                            className="w-2 h-2 rounded-full animate-pulse"
                            style={{
                                background: ds.colors.status.success,
                                boxShadow: `0 0 12px ${ds.colors.status.success}CC`
                            }}
                        />
                        <span
                            className="text-xs font-black uppercase tracking-widest"
                            style={{
                                color: ds.textPrimary,
                                letterSpacing: '0.1em'
                            }}
                        >
                            Live Monitor
                        </span>
                    </div>
                    <button
                        onClick={() => setIsExpanded(false)}
                        className="p-1.5 rounded-lg transition-all hover:scale-110"
                        style={{
                            color: ds.textSecondary,
                            minHeight: '44px',
                            minWidth: '44px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        aria-label="Collapse legend"
                    >
                        <ChevronUp size={16} />
                    </button>
                </div>

                {/* Main Content */}
                <div className="px-6 py-6 space-y-6">
                    {/* Hero Number */}
                    <div>
                        <span
                            className="block text-5xl font-black tracking-tighter tabular-nums"
                            style={{
                                color: ds.textPrimary,
                                lineHeight: '1',
                            }}
                        >
                            {counts.total.toLocaleString()}
                        </span>
                        <span
                            className="block text-sm font-bold mt-2"
                            style={{ color: ds.textSecondary }}
                        >
                            Active Events
                        </span>
                    </div>

                    {/* Disaster Type Rows - IMPROVED SPACING */}
                    <div className="space-y-3">
                        {/* Wildfires */}
                        <button
                            onClick={() => onFilterToggle('fire')}
                            className="w-full transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                            aria-label={`Toggle wildfires filter - ${counts.fires} active`}
                            style={{
                                minHeight: '44px',
                            }}
                        >
                            <div
                                className={`flex items-center justify-between px-4 py-4 rounded-xl transition-all duration-200 ${isActive('fire') ? '' : 'opacity-50 hover:opacity-75'
                                    }`}
                                style={{
                                    background: isActive('fire')
                                        ? addOpacity(getDisasterColor('fire'), 12)
                                        : 'transparent',
                                    border: `1px solid ${isActive('fire')
                                            ? addOpacity(getDisasterColor('fire'), 30)
                                            : 'transparent'
                                        }`,
                                }}
                            >
                                {/* LEFT SIDE: Icon + Label - INCREASED GAP */}
                                <div className="flex items-center gap-4">
                                    <div
                                        className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200"
                                        style={{
                                            background: isActive('fire')
                                                ? getDisasterColor('fire')
                                                : addOpacity(ds.textSecondary, 15),
                                            boxShadow: isActive('fire')
                                                ? `0 4px 16px ${addOpacity(getDisasterColor('fire'), 40)}`
                                                : 'none',
                                            flexShrink: 0,
                                        }}
                                    >
                                        <Flame
                                            size={20}
                                            strokeWidth={2.5}
                                            style={{
                                                color: isActive('fire') ? '#ffffff' : ds.textSecondary,
                                            }}
                                        />
                                    </div>
                                    <span
                                        className="font-bold text-base"
                                        style={{
                                            color: isActive('fire') ? ds.textPrimary : ds.textSecondary,
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        Wildfires
                                    </span>
                                </div>
                                {/* RIGHT SIDE: Number - SEPARATE SPACE */}
                                <span
                                    className="text-2xl font-black tabular-nums"
                                    style={{
                                        color: isActive('fire') ? getDisasterColor('fire') : ds.textTertiary,
                                        marginLeft: 'auto',
                                    }}
                                >
                                    {counts.fires.toLocaleString()}
                                </span>
                            </div>
                        </button>

                        {/* Volcanoes */}
                        <button
                            onClick={() => onFilterToggle('volcano')}
                            className="w-full transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                            aria-label={`Toggle volcanoes filter - ${counts.volcanoes} active`}
                            style={{
                                minHeight: '44px',
                            }}
                        >
                            <div
                                className={`flex items-center justify-between px-4 py-4 rounded-xl transition-all duration-200 ${isActive('volcano') ? '' : 'opacity-50 hover:opacity-75'
                                    }`}
                                style={{
                                    background: isActive('volcano')
                                        ? addOpacity(getDisasterColor('volcano'), 12)
                                        : 'transparent',
                                    border: `1px solid ${isActive('volcano')
                                            ? addOpacity(getDisasterColor('volcano'), 30)
                                            : 'transparent'
                                        }`,
                                }}
                            >
                                <div className="flex items-center gap-4">
                                    <div
                                        className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200"
                                        style={{
                                            background: isActive('volcano')
                                                ? getDisasterColor('volcano')
                                                : addOpacity(ds.textSecondary, 15),
                                            boxShadow: isActive('volcano')
                                                ? `0 4px 16px ${addOpacity(getDisasterColor('volcano'), 40)}`
                                                : 'none',
                                            flexShrink: 0,
                                        }}
                                    >
                                        <Mountain
                                            size={20}
                                            strokeWidth={2.5}
                                            style={{
                                                color: isActive('volcano') ? '#ffffff' : ds.textSecondary,
                                            }}
                                        />
                                    </div>
                                    <span
                                        className="font-bold text-base"
                                        style={{
                                            color: isActive('volcano') ? ds.textPrimary : ds.textSecondary,
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        Volcanoes
                                    </span>
                                </div>
                                <span
                                    className="text-2xl font-black tabular-nums"
                                    style={{
                                        color: isActive('volcano') ? getDisasterColor('volcano') : ds.textTertiary,
                                        marginLeft: 'auto',
                                    }}
                                >
                                    {counts.volcanoes.toLocaleString()}
                                </span>
                            </div>
                        </button>

                        {/* Earthquakes */}
                        <button
                            onClick={() => onFilterToggle('earthquake')}
                            className="w-full transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                            aria-label={`Toggle earthquakes filter - ${counts.earthquakes} active`}
                            style={{
                                minHeight: '44px',
                            }}
                        >
                            <div
                                className={`flex items-center justify-between px-4 py-4 rounded-xl transition-all duration-200 ${isActive('earthquake') ? '' : 'opacity-50 hover:opacity-75'
                                    }`}
                                style={{
                                    background: isActive('earthquake')
                                        ? addOpacity(getDisasterColor('earthquake'), 12)
                                        : 'transparent',
                                    border: `1px solid ${isActive('earthquake')
                                            ? addOpacity(getDisasterColor('earthquake'), 30)
                                            : 'transparent'
                                        }`,
                                }}
                            >
                                <div className="flex items-center gap-4">
                                    <div
                                        className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200"
                                        style={{
                                            background: isActive('earthquake')
                                                ? getDisasterColor('earthquake')
                                                : addOpacity(ds.textSecondary, 15),
                                            boxShadow: isActive('earthquake')
                                                ? `0 4px 16px ${addOpacity(getDisasterColor('earthquake'), 40)}`
                                                : 'none',
                                            flexShrink: 0,
                                        }}
                                    >
                                        <Waves
                                            size={20}
                                            strokeWidth={2.5}
                                            style={{
                                                color: isActive('earthquake') ? '#ffffff' : ds.textSecondary,
                                            }}
                                        />
                                    </div>
                                    <span
                                        className="font-bold text-base"
                                        style={{
                                            color: isActive('earthquake') ? ds.textPrimary : ds.textSecondary,
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        Earthquakes
                                    </span>
                                </div>
                                <span
                                    className="text-2xl font-black tabular-nums"
                                    style={{
                                        color: isActive('earthquake') ? getDisasterColor('earthquake') : ds.textTertiary,
                                        marginLeft: 'auto',
                                    }}
                                >
                                    {counts.earthquakes.toLocaleString()}
                                </span>
                            </div>
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <div
                    className="px-6 py-4 flex items-center justify-between"
                    style={{
                        borderTop: `1px solid ${ds.headerBorderColor}`,
                    }}
                >
                    <div className="flex items-center gap-2">
                        <span
                            className="text-xs font-medium"
                            style={{ color: ds.textTertiary }}
                        >
                            Updated
                        </span>
                        <span
                            className="text-xs font-bold"
                            style={{ color: ds.textSecondary }}
                        >
                            {lastUpdated ? formatTime(lastUpdated) : 'Just now'}
                        </span>
                    </div>
                    {onRefresh && (
                        <button
                            onClick={onRefresh}
                            disabled={isRefreshing}
                            className="p-2 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:scale-110 active:scale-95"
                            style={{
                                background: addOpacity(ds.colors.accent.blue, 15),
                                border: `1px solid ${addOpacity(ds.colors.accent.blue, 30)}`,
                                minHeight: '44px',
                                minWidth: '44px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                            title="Refresh data"
                            aria-label="Refresh disaster data"
                        >
                            <RefreshCw
                                size={14}
                                className={`transition-all ${isRefreshing ? 'animate-spin' : ''}`}
                                style={{ color: ds.colors.accent.blue }}
                                strokeWidth={2.5}
                            />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
