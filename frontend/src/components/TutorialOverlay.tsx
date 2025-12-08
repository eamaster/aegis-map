/**
 * TutorialOverlay Component - Fixed version with proper contrast and spacing
 */

import { useEffect, useState } from 'react';
import { X, Flame, Satellite, MousePointer2, Activity, Sparkles } from 'lucide-react';

interface TutorialOverlayProps {
    onClose: () => void;
}

export default function TutorialOverlay({ onClose }: TutorialOverlayProps) {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        setTimeout(() => setIsVisible(true), 50);
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, []);

    const handleClose = () => {
        setIsVisible(false);
        setTimeout(onClose, 200);
    };

    return (
        <div
            className={`fixed inset-0 flex items-center justify-center p-4 transition-all duration-300`}
            style={{
                zIndex: 9999, // CRITICAL: Higher than legend (z-30)
                background: isVisible ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0)',
                backdropFilter: isVisible ? 'blur(8px)' : 'none',
            }}
            onClick={handleClose}
        >
            {/* Modal Container - DARK background for contrast */}
            <div
                className={`relative max-w-3xl w-full max-h-[90vh] overflow-hidden rounded-3xl transition-all duration-300 ${isVisible ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-4'
                    }`}
                style={{
                    background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.98), rgba(31, 41, 55, 0.98))',
                    backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    boxShadow: '0 25px 80px rgba(0, 0, 0, 0.7)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Gradient overlays */}
                <div
                    className="absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl"
                    style={{
                        background: 'radial-gradient(circle, rgba(59, 130, 246, 0.15), transparent 70%)',
                        pointerEvents: 'none',
                    }}
                />
                <div
                    className="absolute bottom-0 left-0 w-96 h-96 rounded-full blur-3xl"
                    style={{
                        background: 'radial-gradient(circle, rgba(147, 51, 234, 0.15), transparent 70%)',
                        pointerEvents: 'none',
                    }}
                />

                {/* Close Button */}
                <button
                    onClick={handleClose}
                    className="absolute top-4 right-4 z-10 p-2.5 rounded-xl transition-all duration-200 hover:scale-110 group"
                    style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                    }}
                    aria-label="Close tutorial"
                >
                    <X size={20} className="text-gray-300 group-hover:text-white transition-colors" />
                </button>

                {/* Header */}
                <div className="relative px-8 pt-8 pb-6">
                    <div className="flex items-start gap-4">
                        <div
                            className="flex-shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center relative overflow-hidden"
                            style={{
                                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.9), rgba(147, 51, 234, 0.9))',
                                boxShadow: '0 4px 20px rgba(59, 130, 246, 0.4)',
                            }}
                        >
                            <Sparkles size={26} className="text-white relative z-10" />
                            {/* Shine effect */}
                            <div
                                className="absolute inset-0"
                                style={{
                                    background: 'linear-gradient(135deg, transparent 40%, rgba(255, 255, 255, 0.3) 50%, transparent 60%)',
                                }}
                            />
                        </div>
                        <div className="flex-1">
                            <h2 className="text-3xl font-black text-white tracking-tight mb-1">
                                AegisMap
                            </h2>
                            <p className="text-gray-300 text-sm font-medium">
                                Professional Disaster Monitoring Platform
                            </p>
                        </div>
                    </div>
                </div>

                {/* Content - Scrollable */}
                <div className="relative px-8 pb-6 overflow-y-auto max-h-[calc(90vh-200px)]" style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(255, 255, 255, 0.3) transparent',
                }}>
                    <div className="space-y-5">
                        {/* Feature 1 - Disaster Types */}
                        <div
                            className="group p-5 rounded-2xl transition-all duration-200"
                            style={{
                                background: 'rgba(255, 255, 255, 0.03)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                            }}
                        >
                            <div className="flex items-start gap-4">
                                <div
                                    className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(251, 146, 60, 0.2))',
                                        border: '1px solid rgba(239, 68, 68, 0.3)',
                                    }}
                                >
                                    <Flame size={22} className="text-red-400" />
                                </div>
                                <div className="flex-1 min-w-0"> {/* CRITICAL: min-w-0 prevents text overflow */}
                                    <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2 flex-wrap">
                                        <span>Color-Coded Disasters</span>
                                        <span
                                            className="text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap"
                                            style={{
                                                background: 'rgba(59, 130, 246, 0.2)',
                                                color: '#93c5fd',
                                                border: '1px solid rgba(59, 130, 246, 0.3)',
                                            }}
                                        >
                                            Live
                                        </span>
                                    </h3>
                                    <div className="space-y-2.5 text-sm text-gray-300 leading-relaxed">
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="w-3 h-3 rounded-full flex-shrink-0"
                                                style={{
                                                    background: '#ef4444',
                                                    boxShadow: '0 0 12px rgba(239, 68, 68, 0.6)',
                                                }}
                                            />
                                            <span><strong className="text-red-400">Red circles</strong> → Wildfires</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="w-3 h-3 rounded-full flex-shrink-0"
                                                style={{
                                                    background: '#f97316',
                                                    boxShadow: '0 0 12px rgba(249, 115, 22, 0.6)',
                                                }}
                                            />
                                            <span><strong className="text-orange-400">Orange circles</strong> → Earthquakes</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="w-3 h-3 rounded-full flex-shrink-0"
                                                style={{
                                                    background: '#ea580c',
                                                    boxShadow: '0 0 12px rgba(234, 88, 12, 0.6)',
                                                }}
                                            />
                                            <span><strong className="text-orange-500">Orange-red circles</strong> → Volcanoes</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Feature 2 - Interactive */}
                        <div
                            className="group p-5 rounded-2xl transition-all duration-200"
                            style={{
                                background: 'rgba(255, 255, 255, 0.03)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                            }}
                        >
                            <div className="flex items-start gap-4">
                                <div
                                    className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(6, 182, 212, 0.2), rgba(6, 182, 212, 0.2))',
                                        border: '1px solid rgba(59, 130, 246, 0.3)',
                                    }}
                                >
                                    <MousePointer2 size={22} className="text-blue-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-white font-bold text-lg mb-2">Interactive Markers</h3>
                                    <p className="text-sm text-gray-300 leading-relaxed">
                                        <strong className="text-white">Hover</strong> to see disaster names with tooltips.
                                        <strong className="text-white"> Click</strong> markers to open detailed analysis panels with satellite imagery, AI insights, and real-time data.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Feature 3 - Satellite */}
                        <div
                            className="group p-5 rounded-2xl transition-all duration-200"
                            style={{
                                background: 'rgba(255, 255, 255, 0.03)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                            }}
                        >
                            <div className="flex items-start gap-4">
                                <div
                                    className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2))',
                                        border: '1px solid rgba(168, 85, 247, 0.3)',
                                    }}
                                >
                                    <Satellite size={22} className="text-purple-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-white font-bold text-lg mb-2 flex items-center gap-2 flex-wrap">
                                        <span>NASA Satellite Analysis</span>
                                        <span
                                            className="text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap"
                                            style={{
                                                background: 'rgba(168, 85, 247, 0.2)',
                                                color: '#c4b5fd',
                                                border: '1px solid rgba(168, 85, 247, 0.3)',
                                            }}
                                        >
                                            AI-Powered
                                        </span>
                                    </h3>
                                    <p className="text-sm text-gray-300 leading-relaxed">
                                        View <strong className="text-white">satellite pass times</strong> and get AI-powered imaging feasibility analysis.
                                        Includes cloud cover predictions, thermal imagery, and fire hotspot detection from NASA FIRMS.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Feature 4 - Live Monitoring */}
                        <div
                            className="group p-5 rounded-2xl transition-all duration-200"
                            style={{
                                background: 'rgba(255, 255, 255, 0.03)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                            }}
                        >
                            <div className="flex items-start gap-4">
                                <div
                                    className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(16, 185, 129, 0.2))',
                                        border: '1px solid rgba(34, 197, 94, 0.3)',
                                    }}
                                >
                                    <Activity size={22} className="text-green-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-white font-bold text-lg mb-2">Live Data Monitoring</h3>
                                    <p className="text-sm text-gray-300 leading-relaxed">
                                        Automatic refresh from <strong className="text-white">NASA EONET</strong> and <strong className="text-white">USGS</strong>.
                                        <span className="inline-flex items-center gap-1.5 mx-1">
                                            <span
                                                className="w-2 h-2 rounded-full animate-pulse"
                                                style={{
                                                    background: '#22c55e',
                                                    boxShadow: '0 0 10px rgba(34, 197, 94, 0.7)',
                                                }}
                                            />
                                            <strong className="text-green-400">Pulsing markers</strong>
                                        </span>
                                        indicate high-severity events requiring immediate attention.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Filter Tip */}
                        <div
                            className="p-4 rounded-2xl"
                            style={{
                                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(168, 85, 247, 0.1))',
                                border: '1px solid rgba(59, 130, 246, 0.25)',
                            }}
                        >
                            <p className="text-sm text-gray-200 leading-relaxed">
                                <strong className="text-blue-400">💡 Pro Tip:</strong> Use the <strong className="text-white">legend panel</strong> (top-left)
                                to filter disasters by type. Click disaster types to show/hide specific markers on the map.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div
                    className="relative px-8 py-5"
                    style={{
                        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                        background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.8), rgba(31, 41, 55, 0.8))',
                        backdropFilter: 'blur(12px)',
                    }}
                >
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        <p className="text-sm text-gray-400 font-medium flex items-center gap-2">
                            <kbd
                                className="px-3 py-1.5 rounded-lg text-white text-xs font-bold"
                                style={{
                                    background: 'rgba(75, 85, 99, 0.8)',
                                    border: '1px solid rgba(156, 163, 175, 0.5)',
                                }}
                            >
                                ?
                            </kbd>
                            <span>Press anytime for help</span>
                        </p>
                        <button
                            onClick={handleClose}
                            className="px-6 py-3 rounded-xl transition-all duration-200 hover:scale-105 font-bold flex items-center gap-2 text-white"
                            style={{
                                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                boxShadow: '0 4px 16px rgba(59, 130, 246, 0.4)',
                            }}
                        >
                            <span>Get Started</span>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
