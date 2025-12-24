/**
 * TutorialOverlay Component - Design System Aligned
 * Consistent styling with MapLegend and rest of dashboard
 */

import { useEffect, useState } from 'react';
import { X, Flame, Satellite, MousePointer2, Activity, Sparkles, Info } from 'lucide-react';
import { useDesignSystem } from '../hooks/useDesignSystem';

interface TutorialOverlayProps {
    onClose: () => void;
}

export default function TutorialOverlay({ onClose }: TutorialOverlayProps) {
    const ds = useDesignSystem();
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        setTimeout(() => setIsVisible(true), 50);
        document.body.style.overflow = 'hidden';

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleClose();
        };
        window.addEventListener('keydown', handleEscape);

        return () => {
            document.body.style.overflow = 'unset';
            window.removeEventListener('keydown', handleEscape);
        };
    }, []);

    const handleClose = () => {
        setIsVisible(false);
        setTimeout(onClose, 200);
    };

    // Helper to add opacity to hex colors
    const addOpacity = (hex: string, opacity: number) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
    };

    return (
        <div
            className="transition-all duration-300"
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px 24px',
                zIndex: 9998,
                background: isVisible ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0)',
                backdropFilter: isVisible ? 'blur(12px)' : 'none',
                WebkitBackdropFilter: isVisible ? 'blur(12px)' : 'none',
            }}
            onClick={handleClose}
        >
            {/* Modal Container - COMPACT */}
            <div
                className={`relative max-w-2xl w-full max-h-[85vh] overflow-hidden rounded-xl transition-all duration-300 ${isVisible ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-4'
                    }`}
                style={{
                    ...ds.glass.panel,
                    border: `2px solid ${addOpacity(ds.colors.accent.blue, 40)}`,
                    boxShadow: ds.isDark
                        ? '0 25px 80px rgba(0, 0, 0, 0.9), 0 0 1px ' + addOpacity(ds.colors.accent.blue, 50)
                        : '0 25px 80px rgba(0, 0, 0, 0.3)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close Button */}
                <button
                    onClick={handleClose}
                    className="absolute top-3 right-3 z-10 p-2 rounded-lg transition-all duration-200 hover:scale-110 hover:rotate-90"
                    style={{
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                    }}
                    aria-label="Close help modal"
                >
                    <X size={16} style={{ color: '#f87171' }} strokeWidth={2.5} />
                </button>

                {/* Header - COMPACT */}
                <div style={{ padding: '16px 20px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'start', gap: '12px' }}>
                        {/* Icon Badge */}
                        <div
                            style={{
                                width: '42px',
                                height: '42px',
                                borderRadius: '10px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                boxShadow: '0 4px 14px rgba(59, 130, 246, 0.4)',
                                flexShrink: 0,
                            }}
                        >
                            <Sparkles size={20} style={{ color: '#ffffff' }} strokeWidth={2} />
                        </div>

                        {/* Title */}
                        <div style={{ flex: 1 }}>
                            <h2
                                style={{
                                    fontSize: '1.5rem',
                                    fontWeight: '900',
                                    color: ds.text.primary,
                                    marginBottom: '4px',
                                    letterSpacing: '-0.02em',
                                }}
                            >
                                AegisMap
                            </h2>
                            <p
                                style={{
                                    fontSize: '0.75rem',
                                    fontWeight: '700',
                                    color: ds.text.secondary,
                                    marginBottom: '8px',
                                }}
                            >
                                Professional Disaster Monitoring Platform
                            </p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div
                                    style={{
                                        width: '5px',
                                        height: '5px',
                                        borderRadius: '50%',
                                        background: ds.colors.status.success,
                                        boxShadow: `0 0 6px ${ds.colors.status.success}CC`,
                                        animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                                    }}
                                />
                                <span
                                    style={{
                                        fontSize: '0.65rem',
                                        fontWeight: '700',
                                        color: ds.colors.status.success,
                                    }}
                                >
                                    NASA EONET • USGS • NASA FIRMS • Open-Meteo
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Divider */}
                <div
                    style={{
                        height: '1px',
                        background: `linear-gradient(90deg, transparent, ${addOpacity(ds.colors.accent.blue, 50)}, transparent)`,
                        margin: '0 20px',
                    }}
                />

                {/* Content - Scrollable - COMPACT */}
                <div
                    style={{
                        padding: '16px 20px',
                        overflowY: 'auto',
                        maxHeight: 'calc(85vh - 240px)',
                        scrollbarWidth: 'thin',
                        scrollbarColor: `${addOpacity(ds.colors.accent.blue, 50)} transparent`,
                    }}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {/* Feature 1 - Color-Coded Disasters */}
                        <FeatureCard
                            icon={<Flame size={18} strokeWidth={2.5} />}
                            iconBg={`linear-gradient(135deg, ${addOpacity('#ef4444', 20)}, ${addOpacity('#f97316', 20)})`}
                            iconBorder={addOpacity('#ef4444', 40)}
                            iconColor="#f87171"
                            title="Color-Coded Disasters"
                            badge="Live"
                            badgeColor={ds.colors.accent.blue}
                            ds={ds}
                        >
                            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <DisasterType color={ds.colors.disaster.fire} label="Red circles" text="Wildfires" ds={ds} />
                                <DisasterType color={ds.colors.disaster.earthquake} label="Orange circles" text="Earthquakes" ds={ds} />
                                <DisasterType color={ds.colors.disaster.volcano} label="Orange-red circles" text="Volcanoes" ds={ds} />
                            </div>
                        </FeatureCard>

                        {/* Feature 2 - Interactive Markers */}
                        <FeatureCard
                            icon={<MousePointer2 size={18} strokeWidth={2.5} />}
                            iconBg={`linear-gradient(135deg, ${addOpacity('#3b82f6', 20)}, ${addOpacity('#06b6d4', 20)})`}
                            iconBorder={addOpacity('#3b82f6', 40)}
                            iconColor="#60a5fa"
                            title="Interactive Markers"
                            ds={ds}
                        >
                            <p style={{ fontSize: '0.75rem', color: ds.text.secondary, lineHeight: '1.5', marginTop: '10px' }}>
                                <strong style={{ color: ds.text.primary }}>Hover</strong> to see names.{' '}
                                <strong style={{ color: ds.text.primary }}>Click</strong> for satellite imagery and AI insights.
                            </p>
                        </FeatureCard>

                        {/* Feature 3 - NASA Satellite */}
                        <FeatureCard
                            icon={<Satellite size={18} strokeWidth={2.5} />}
                            iconBg={`linear-gradient(135deg, ${addOpacity('#a855f7', 20)}, ${addOpacity('#ec4899', 20)})`}
                            iconBorder={addOpacity('#a855f7', 40)}
                            iconColor="#c084fc"
                            title="Satellite Analysis"
                            badge="AI-Powered"
                            badgeColor="#a855f7"
                            ds={ds}
                        >
                            <p style={{ fontSize: '0.75rem', color: ds.text.secondary, lineHeight: '1.5', marginTop: '10px' }}>
                                View <strong style={{ color: ds.text.primary }}>satellite pass times</strong> with AI imaging analysis. Includes cloud cover (Open-Meteo), thermal imagery, and fire hotspots (FIRMS).
                            </p>
                        </FeatureCard>

                        {/* Feature 4 - Live Monitoring */}
                        <FeatureCard
                            icon={<Activity size={18} strokeWidth={2.5} />}
                            iconBg={`linear-gradient(135deg, ${addOpacity('#22c55e', 20)}, ${addOpacity('#10b981', 20)})`}
                            iconBorder={addOpacity('#22c55e', 40)}
                            iconColor="#4ade80"
                            title="Multi-Source Data"
                            ds={ds}
                        >
                            <p style={{ fontSize: '0.75rem', color: ds.text.secondary, lineHeight: '1.5', marginTop: '10px' }}>
                                <strong style={{ color: ds.text.primary }}>NASA EONET</strong> (wildfires/volcanoes), {' '}
                                <strong style={{ color: ds.text.primary }}>USGS</strong> (earthquakes), {' '}
                                <strong style={{ color: ds.text.primary }}>NASA FIRMS</strong> (fire hotspots), {' '}
                                <strong style={{ color: ds.text.primary }}>Open-Meteo</strong> (weather).
                            </p>
                        </FeatureCard>
                    </div>

                    {/* Pro Tip Card */}
                    <div
                        style={{
                            marginTop: '14px',
                            padding: '14px',
                            borderRadius: '12px',
                            background: `linear-gradient(135deg, ${addOpacity(ds.colors.accent.blue, 12)}, ${addOpacity('#a855f7', 12)})`,
                            border: `2px solid ${addOpacity(ds.colors.accent.blue, 30)}`,
                            boxShadow: `0 4px 16px ${addOpacity(ds.colors.accent.blue, 20)}`,
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'start', gap: '10px' }}>
                            <Info size={16} style={{ color: ds.colors.accent.blue, flexShrink: 0, marginTop: '2px' }} strokeWidth={2.5} />
                            <p style={{ fontSize: '0.75rem', color: ds.text.secondary, lineHeight: '1.5' }}>
                                <span style={{ fontWeight: '900', color: ds.colors.accent.blue }}>💡 Pro Tip:</span> Use the{' '}
                                <strong style={{ color: ds.text.primary }}>Live Monitor panel</strong> to filter disasters by type. Click to show/hide specific markers on the map.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer - COMPACT */}
                <div
                    style={{
                        padding: '14px 20px',
                        borderTop: `1px solid ${addOpacity(ds.colors.accent.blue, 30)}`,
                        background: ds.surface.overlaySubtle,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>

                            <kbd
                                style={{
                                    padding: '6px 12px',
                                    borderRadius: '8px',
                                    fontSize: '0.8125rem',
                                    fontWeight: '900',
                                    color: '#ffffff',
                                    background: 'linear-gradient(135deg, #374151, #4b5563)',
                                    border: '1px solid rgba(156, 163, 175, 0.5)',
                                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                                }}
                            >
                                Esc
                            </kbd>
                            <span style={{ fontSize: '0.75rem', color: ds.text.tertiary, fontWeight: '600' }}>to show/hide help</span>
                        </div>
                        <button
                            onClick={handleClose}
                            className="transition-all duration-200 hover:scale-105 active:scale-95"
                            style={{
                                padding: '8px 20px',
                                borderRadius: '8px',
                                fontSize: '0.8125rem',
                                fontWeight: '900',
                                color: '#ffffff',
                                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                boxShadow: '0 4px 16px rgba(59, 130, 246, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
                                border: 'none',
                                cursor: 'pointer',
                            }}
                        >
                            Get Started →
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ===== HELPER COMPONENTS =====

interface FeatureCardProps {
    icon: React.ReactNode;
    iconBg: string;
    iconBorder: string;
    iconColor: string;
    title: string;
    badge?: string;
    badgeColor?: string;
    children: React.ReactNode;
    ds: ReturnType<typeof useDesignSystem>;
}

function FeatureCard({ icon, iconBg, iconBorder, iconColor, title, badge, badgeColor, children, ds }: FeatureCardProps) {
    return (
        <div
            className="group transition-all duration-200 hover:scale-[1.01]"
            style={{
                padding: '14px',
                borderRadius: '12px',
                background: ds.surface.overlay,
                border: `1px solid ${ds.surface.border}`,
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'start', gap: '10px' }}>
                {/* Icon */}
                <div
                    className="transition-transform group-hover:scale-110"
                    style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: iconBg,
                        border: `2px solid ${iconBorder}`,
                        boxShadow: `0 2px 8px ${iconBorder}`,
                        color: iconColor,
                        flexShrink: 0,
                    }}
                >
                    {icon}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '3px' }}>
                        <h3
                            style={{
                                fontSize: '0.875rem',
                                fontWeight: '900',
                                color: ds.text.primary,
                                letterSpacing: '-0.01em',
                            }}
                        >
                            {title}
                        </h3>
                        {badge && (
                            <span
                                style={{
                                    fontSize: '0.65rem',
                                    padding: '2px 8px',
                                    borderRadius: '10px',
                                    fontWeight: '700',
                                    background: `${badgeColor}33`,
                                    color: badgeColor,
                                    border: `1px solid ${badgeColor}66`,
                                    boxShadow: `0 0 10px ${badgeColor}33`,
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {badge}
                            </span>
                        )}
                    </div>
                    {children}
                </div>
            </div>
        </div>
    );
}

interface DisasterTypeProps {
    color: string;
    label: string;
    text: string;
    ds: ReturnType<typeof useDesignSystem>;
}

function DisasterType({ color, label, text, ds }: DisasterTypeProps) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
                style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: color,
                    boxShadow: `0 0 8px ${color}99, 0 0 2px ${color}`,
                    flexShrink: 0,
                }}
            />
            <span style={{ fontSize: '0.75rem', color: ds.text.secondary }}>
                <strong style={{ fontWeight: '700', color }}>{label}</strong>
                <span style={{ color: ds.text.tertiary, margin: '0 5px' }}>→</span>
                <span style={{ fontWeight: '600', color: ds.text.primary }}>{text}</span>
            </span>
        </div>
    );
}
