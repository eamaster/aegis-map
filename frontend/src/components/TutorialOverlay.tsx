/**
 * TutorialOverlay Component - Professional Redesign
 * Consistent, accessible, and user-friendly help modal
 */

import { useEffect, useState } from 'react';
import { X, Flame, Satellite, MousePointer2, Activity, Sparkles, Info } from 'lucide-react';

interface TutorialOverlayProps {
    onClose: () => void;
}

export default function TutorialOverlay({ onClose }: TutorialOverlayProps) {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        setTimeout(() => setIsVisible(true), 50);
        document.body.style.overflow = 'hidden';

        // Close on Escape key
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

    return (
        <div
            className={`fixed inset-0 flex items-center justify-center p-4 md:p-6 transition-all duration-300 z-[200]`}
            style={{
                background: isVisible ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0)',
                backdropFilter: isVisible ? 'blur(12px)' : 'none',
                WebkitBackdropFilter: isVisible ? 'blur(12px)' : 'none',
            }}
            onClick={handleClose}
        >
            {/* Modal Container */}
            <div
                className={`relative max-w-4xl w-full max-h-[90vh] overflow-hidden rounded-3xl transition-all duration-300 ${isVisible ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-4'
                    }`}
                style={{
                    background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.98), rgba(31, 41, 55, 0.98))',
                    backdropFilter: 'blur(32px)',
                    WebkitBackdropFilter: 'blur(32px)',
                    border: '2px solid rgba(59, 130, 246, 0.3)',
                    boxShadow: '0 25px 80px rgba(0, 0, 0, 0.8), 0 0 1px rgba(59, 130, 246, 0.5)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Animated gradient overlays */}
                <div
                    className="absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl opacity-30"
                    style={{
                        background: 'radial-gradient(circle, rgba(59, 130, 246, 0.4), transparent 70%)',
                        pointerEvents: 'none',
                        animation: 'pulse 4s ease-in-out infinite',
                    }}
                />
                <div
                    className="absolute bottom-0 left-0 w-96 h-96 rounded-full blur-3xl opacity-30"
                    style={{
                        background: 'radial-gradient(circle, rgba(147, 51, 234, 0.4), transparent 70%)',
                        pointerEvents: 'none',
                        animation: 'pulse 4s ease-in-out infinite 2s',
                    }}
                />

                {/* Close Button - Prominent */}
                <button
                    onClick={handleClose}
                    className="absolute top-6 right-6 z-10 p-3 rounded-xl transition-all duration-200 hover:scale-110 hover:rotate-90 group"
                    style={{
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                    }}
                    aria-label="Close help modal"
                >
                    <X size={22} className="text-red-400 group-hover:text-red-300 transition-colors" strokeWidth={2.5} />
                </button>

                {/* Header - Professional Brand Identity */}
                <div className="relative px-8 md:px-10 pt-10 pb-8">
                    <div className="flex items-start gap-5">
                        {/* Icon Badge */}
                        <div
                            className="flex-shrink-0 w-16 h-16 rounded-2xl flex items-center justify-center relative overflow-hidden"
                            style={{
                                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                boxShadow: '0 8px 24px rgba(59, 130, 246, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
                            }}
                        >
                            <Sparkles size={30} className="text-white relative z-10" strokeWidth={2} />
                            {/* Shine effect */}
                            <div
                                className="absolute inset-0 animate-pulse"
                                style={{
                                    background: 'linear-gradient(135deg, transparent 40%, rgba(255, 255, 255, 0.3) 50%, transparent 60%)',
                                }}
                            />
                        </div>

                        {/* Title */}
                        <div className="flex-1 min-w-0">
                            <h2 className="text-4xl font-black text-white tracking-tight mb-2">
                                AegisMap
                            </h2>
                            <p className="text-gray-300 text-base font-semibold mb-1">
                                Professional Disaster Monitoring Platform
                            </p>
                            <div className="flex items-center gap-2 mt-3">
                                <div className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)] animate-pulse" />
                                <span className="text-sm text-green-400 font-bold">Live Data from NASA EONET</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Divider */}
                <div className="mx-8 md:mx-10" style={{ height: '1px', background: 'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.5), transparent)' }} />

                {/* Content - Scrollable */}
                <div
                    className="relative px-8 md:px-10 py-8 overflow-y-auto max-h-[calc(90vh-300px)]"
                    style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'rgba(59, 130, 246, 0.5) transparent',
                    }}
                >
                    <div className="grid md:grid-cols-2 gap-5">
                        {/* Feature 1 - Color-Coded Disasters */}
                        <FeatureCard
                            icon={<Flame size={24} strokeWidth={2.5} />}
                            iconBg="linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(251, 146, 60, 0.2))"
                            iconBorder="rgba(239, 68, 68, 0.4)"
                            iconColor="text-red-400"
                            title="Color-Coded Disasters"
                            badge="Live"
                            badgeColor="#3b82f6"
                        >
                            <div className="space-y-3 mt-3">
                                <DisasterType color="#ef4444" label="Red circles" text="Wildfires" />
                                <DisasterType color="#f97316" label="Orange circles" text="Earthquakes" />
                                <DisasterType color="#f59e0b" label="Orange-red circles" text="Volcanoes" />
                            </div>
                        </FeatureCard>

                        {/* Feature 2 - Interactive Markers */}
                        <FeatureCard
                            icon={<MousePointer2 size={24} strokeWidth={2.5} />}
                            iconBg="linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(6, 182, 212, 0.2))"
                            iconBorder="rgba(59, 130, 246, 0.4)"
                            iconColor="text-blue-400"
                            title="Interactive Markers"
                        >
                            <p className="text-sm text-gray-300 leading-relaxed mt-3">
                                <span className="font-bold text-white">Hover</span> to see disaster names with tooltips.{' '}
                                <span className="font-bold text-white">Click</span> markers to open detailed analysis panels with satellite imagery, AI insights, and real-time data.
                            </p>
                        </FeatureCard>

                        {/* Feature 3 - NASA Satellite */}
                        <FeatureCard
                            icon={<Satellite size={24} strokeWidth={2.5} />}
                            iconBg="linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2))"
                            iconBorder="rgba(168, 85, 247, 0.4)"
                            iconColor="text-purple-400"
                            title="NASA Satellite Analysis"
                            badge="AI-Powered"
                            badgeColor="#a855f7"
                        >
                            <p className="text-sm text-gray-300 leading-relaxed mt-3">
                                View <span className="font-bold text-white">satellite pass times</span> and get AI-powered imaging feasibility analysis. Includes cloud cover predictions, thermal imagery, and fire hotspot detection from NASA FIRMS.
                            </p>
                        </FeatureCard>

                        {/* Feature 4 - Live Monitoring */}
                        <FeatureCard
                            icon={<Activity size={24} strokeWidth={2.5} />}
                            iconBg="linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(16, 185, 129, 0.2))"
                            iconBorder="rgba(34, 197, 94, 0.4)"
                            iconColor="text-green-400"
                            title="Live Data Monitoring"
                        >
                            <p className="text-sm text-gray-300 leading-relaxed mt-3">
                                Automatic refresh from <span className="font-bold text-white">NASA EONET</span> and <span className="font-bold text-white">USGS</span>.
                                <span className="inline-flex items-center gap-2 mx-1.5 px-2 py-0.5 rounded-full" style={{ background: 'rgba(34, 197, 94, 0.15)' }}>
                                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
                                    <span className="font-bold text-green-400 text-xs">High-severity</span>
                                </span>
                                markers require immediate attention.
                            </p>
                        </FeatureCard>
                    </div>

                    {/* Pro Tip Card */}
                    <div
                        className="mt-6 p-5 rounded-2xl"
                        style={{
                            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(168, 85, 247, 0.12))',
                            border: '2px solid rgba(59, 130, 246, 0.3)',
                            boxShadow: '0 4px 16px rgba(59, 130, 246, 0.2)',
                        }}
                    >
                        <div className="flex items-start gap-3">
                            <Info size={20} className="text-blue-400 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                            <p className="text-sm text-gray-200 leading-relaxed">
                                <span className="font-black text-blue-400">💡 Pro Tip:</span> Use the{' '}
                                <span className="font-bold text-white">Live Monitor panel</span> (top-left) to filter disasters by type. Click disaster types to show/hide specific markers on the map.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer - Professional CTA */}
                <div
                    className="relative px-8 md:px-10 py-6"
                    style={{
                        borderTop: '1px solid rgba(59, 130, 246, 0.3)',
                        background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.95), rgba(31, 41, 55, 0.95))',
                        backdropFilter: 'blur(16px)',
                    }}
                >
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3">
                            <kbd
                                className="px-3 py-2 rounded-lg text-white text-sm font-black shadow-md"
                                style={{
                                    background: 'linear-gradient(135deg, #374151, #4b5563)',
                                    border: '1px solid rgba(156, 163, 175, 0.5)',
                                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                                }}
                            >
                                ?
                            </kbd>
                            <span className="text-sm text-gray-300 font-medium">or</span>
                            <kbd
                                className="px-3 py-2 rounded-lg text-white text-sm font-black shadow-md"
                                style={{
                                    background: 'linear-gradient(135deg, #374151, #4b5563)',
                                    border: '1px solid rgba(156, 163, 175, 0.5)',
                                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                                }}
                            >
                                Esc
                            </kbd>
                            <span className="text-sm text-gray-400 font-medium">to show/hide help</span>
                        </div>
                        <button
                            onClick={handleClose}
                            className="px-8 py-3.5 rounded-xl transition-all duration-200 hover:scale-105 hover:shadow-2xl active:scale-95 font-black text-white text-base"
                            style={{
                                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                boxShadow: '0 4px 20px rgba(59, 130, 246, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
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
}

function FeatureCard({ icon, iconBg, iconBorder, iconColor, title, badge, badgeColor, children }: FeatureCardProps) {
    return (
        <div
            className="group p-6 rounded-2xl transition-all duration-200 hover:scale-[1.02]"
            style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
            }}
        >
            <div className="flex items-start gap-4">
                {/* Icon */}
                <div
                    className={`flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center ${iconColor} transition-transform group-hover:scale-110`}
                    style={{
                        background: iconBg,
                        border: `2px solid ${iconBorder}`,
                        boxShadow: `0 4px 12px ${iconBorder}`,
                    }}
                >
                    {icon}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap mb-1">
                        <h3 className="text-white font-black text-lg tracking-tight">{title}</h3>
                        {badge && (
                            <span
                                className="text-xs px-3 py-1 rounded-full font-bold whitespace-nowrap"
                                style={{
                                    background: `${badgeColor}33`,
                                    color: badgeColor,
                                    border: `1px solid ${badgeColor}66`,
                                    boxShadow: `0 0 12px ${badgeColor}33`,
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
}

function DisasterType({ color, label, text }: DisasterTypeProps) {
    return (
        <div className="flex items-center gap-3">
            <div
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{
                    background: color,
                    boxShadow: `0 0 12px ${color}99, 0 0 4px ${color}`,
                }}
            />
            <span className="text-sm text-gray-300">
                <strong className="font-bold" style={{ color }}>{label}</strong>
                <span className="text-gray-400 mx-1.5">→</span>
                <span className="text-white">{text}</span>
            </span>
        </div>
    );
}
