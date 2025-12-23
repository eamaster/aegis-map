/**
 * MapLegend Component - Professional Glassmorphism Design
 * Matches reference UI with blue header, clean cards, readable typography
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

    // Collapsed state
    if (!isExpanded) {
        return (
            <div className="legend-responsive">
                <button
                    onClick={() => setIsExpanded(true)}
                    className="flex items-center gap-3 px-5 py-3 rounded-2xl transition-all duration-300 hover:scale-105 active:scale-95"
                    style={{
                        background: 'rgba(17, 24, 39, 0.85)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
                    }}
                >
                    <span className="font-black text-xl text-white tabular-nums">
                        {counts.total.toLocaleString()}
                    </span>
                    <ChevronDown size={20} className="text-gray-400" />
                </button>
            </div>
        );
    }

    // Expanded state
    return (
        <div className="legend-responsive">
            <div
                className="w-full md:w-[420px] rounded-2xl overflow-hidden transition-all duration-300"
                style={{
                    background: 'rgba(15, 23, 42, 0.92)',
                    backdropFilter: 'blur(32px)',
                    WebkitBackdropFilter: 'blur(32px)',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                    boxShadow: '0 12px 50px rgba(0, 0, 0, 0.7), 0 0 1px rgba(59, 130, 246, 0.4)',
                }}
            >
                {/* Header - Blue Gradient with LIVE MONITOR */}
                <div
                    className="px-6 py-4 flex items-center justify-between"
                    style={{
                        background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.95), rgba(29, 78, 216, 0.85))',
                        borderBottom: '1px solid rgba(59, 130, 246, 0.3)',
                    }}
                >
                    <h2 className="text-base font-bold uppercase tracking-[0.2em] text-white">
                        Live Monitor
                    </h2>
                    <button
                        onClick={() => setIsExpanded(false)}
                        className="p-1.5 rounded-lg transition-all hover:bg-white/10 active:scale-95"
                    >
                        <ChevronUp size={20} className="text-white/80" />
                    </button>
                </div>

                {/* Total Count Section */}
                <div className="px-6 pt-6 pb-5">
                    <div
                        className="text-6xl font-black tabular-nums text-white tracking-tight"
                        style={{
                            lineHeight: '1',
                            textShadow: '0 2px 20px rgba(0, 0, 0, 0.3)',
                        }}
                    >
                        {counts.total.toLocaleString()}
                    </div>
                    <div className="text-lg font-medium text-gray-400 mt-2">
                        Active Events
                    </div>
                </div>

                {/* Disaster Cards */}
                <div className="px-4 pb-4 space-y-2.5">
                    {/* Wildfires Card */}
                    <DisasterCard
                        label="Wildfires"
                        count={counts.fires}
                        icon={<Flame size={28} strokeWidth={2.5} />}
                        iconBg="rgba(127, 29, 29, 0.7)"
                        iconColor="#ef4444"
                        isActive={isActive('fire')}
                        onToggle={() => onFilterToggle('fire')}
                    />

                    {/* Volcanoes Card */}
                    <DisasterCard
                        label="Volcanoes"
                        count={counts.volcanoes}
                        icon={<Mountain size={28} strokeWidth={2.5} />}
                        iconBg="rgba(124, 45, 18, 0.7)"
                        iconColor="#f97316"
                        isActive={isActive('volcano')}
                        onToggle={() => onFilterToggle('volcano')}
                    />

                    {/* Earthquakes Card */}
                    <DisasterCard
                        label="Earthquakes"
                        count={counts.earthquakes}
                        icon={<Waves size={28} strokeWidth={2.5} />}
                        iconBg="rgba(30, 64, 175, 0.7)"
                        iconColor="#3b82f6"
                        isActive={isActive('earthquake')}
                        onToggle={() => onFilterToggle('earthquake')}
                    />
                </div>

                {/* Footer - Updated Time */}
                <div className="px-6 py-4 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-500">
                        Updated
                        <span className="text-gray-400 ml-1">
                            {lastUpdated ? formatTime(lastUpdated) : 'Just now'}
                        </span>
                    </span>
                    {onRefresh && (
                        <button
                            onClick={onRefresh}
                            disabled={isRefreshing}
                            className="p-2.5 rounded-lg transition-all hover:bg-blue-500/20 active:scale-95 disabled:opacity-50"
                        >
                            <RefreshCw
                                size={18}
                                className={`text-blue-400 ${isRefreshing ? 'animate-spin' : ''}`}
                            />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ===== DISASTER CARD COMPONENT =====
interface DisasterCardProps {
    label: string;
    count: number;
    icon: React.ReactNode;
    iconBg: string;
    iconColor: string;
    isActive: boolean;
    onToggle: () => void;
}

function DisasterCard({ label, count, icon, iconBg, iconColor, isActive, onToggle }: DisasterCardProps) {
    return (
        <button
            onClick={onToggle}
            className="w-full flex items-center gap-5 px-5 py-5 rounded-2xl transition-all duration-300 hover:scale-[1.01] active:scale-[0.99]"
            style={{
                background: 'linear-gradient(135deg, rgba(51, 65, 85, 0.6), rgba(30, 41, 59, 0.6))',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: '1px solid rgba(71, 85, 105, 0.5)',
                boxShadow: isActive
                    ? '0 4px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)'
                    : '0 2px 12px rgba(0, 0, 0, 0.3)',
            }}
        >
            {/* Icon with colored background */}
            <div
                className="flex-shrink-0 w-16 h-16 rounded-xl flex items-center justify-center"
                style={{
                    background: iconBg,
                    color: iconColor,
                    boxShadow: `0 4px 16px ${iconColor}40`,
                }}
            >
                {icon}
            </div>

            {/* Label - centered, always white */}
            <span className="flex-1 text-left text-xl font-medium text-white">
                {label}
            </span>

            {/* Count - large and prominent, always white */}
            <span
                className="text-4xl font-black tabular-nums text-white"
                style={{
                    textShadow: '0 2px 16px rgba(0, 0, 0, 0.5)',
                }}
            >
                {count.toLocaleString()}
            </span>
        </button>
    );
}
