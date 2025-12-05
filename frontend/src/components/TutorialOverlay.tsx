/**
 * TutorialOverlay Component - Modern Glassmorphism Design
 * Professional disaster monitoring tutorial
 */

import { useEffect, useState } from 'react';
import { X, Flame, Satellite, MousePointer2, Activity, Sparkles } from 'lucide-react';

interface TutorialOverlayProps {
    onClose: () => void;
}

export default function TutorialOverlay({ onClose }: TutorialOverlayProps) {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Smooth fade-in animation
        setTimeout(() => setIsVisible(true), 50);

        // Prevent body scroll
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
            className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-all duration-300 ${isVisible ? 'bg-black/60 backdrop-blur-md' : 'bg-black/0'
                }`}
            onClick={handleClose}
        >
            {/* Modal Container - Professional Glassmorphism */}
            <div
                className={`relative bg-gradient-to-br from-gray-900/95 via-gray-800/95 to-gray-900/95 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] max-w-3xl w-full max-h-[90vh] overflow-hidden transition-all duration-300 ${isVisible ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-4'
                    }`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Decorative gradient overlays */}
                <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-transparent rounded-full blur-3xl" />
                <div className="absolute bottom-0 left-0 w-96 h-96 bg-gradient-to-tr from-purple-500/10 via-blue-500/10 to-transparent rounded-full blur-3xl" />

                {/* Close Button - Floating */}
                <button
                    onClick={handleClose}
                    className="absolute top-4 right-4 z-10 p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all duration-200 hover:scale-110 group"
                    aria-label="Close tutorial"
                >
                    <X size={20} className="text-gray-400 group-hover:text-white transition-colors" />
                </button>

                {/* Header - Gradient */}
                <div className="relative px-8 pt-8 pb-6">
                    <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <Sparkles size={26} className="text-white" />
                        </div>
                        <div className="flex-1">
                            <h2 className="text-3xl font-black text-white tracking-tight mb-1 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                                AegisMap
                            </h2>
                            <p className="text-gray-400 text-sm font-medium">
                                Professional Disaster Monitoring Platform
                            </p>
                        </div>
                    </div>
                </div>

                {/* Content - Scrollable with custom scrollbar */}
                <div className="relative px-8 pb-6 overflow-y-auto max-h-[60vh] custom-scrollbar">
                    <div className="space-y-5">
                        {/* Feature 1 - Disaster Types */}
                        <div className="group hover:bg-white/5 p-4 rounded-2xl transition-all duration-200 border border-transparent hover:border-white/10">
                            <div className="flex items-start gap-4">
                                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-red-500/20 to-orange-500/20 border border-red-500/20 flex items-center justify-center shadow-lg shadow-red-500/10">
                                    <Flame size={22} className="text-red-400" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-white font-bold text-lg mb-2 flex items-center gap-2">
                                        Color-Coded Disasters
                                        <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded-full font-medium">Live</span>
                                    </h3>
                                    <div className="space-y-2 text-sm text-gray-300 leading-relaxed">
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full bg-red-500 shadow-lg shadow-red-500/50" />
                                            <span><strong className="text-red-400">Red circles</strong> → Wildfires</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full bg-orange-500 shadow-lg shadow-orange-500/50" />
                                            <span><strong className="text-orange-400">Orange circles</strong> → Earthquakes</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full bg-orange-600 shadow-lg shadow-orange-600/50" />
                                            <span><strong className="text-orange-500">Orange-red circles</strong> → Volcanoes</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Feature 2 - Interactive */}
                        <div className="group hover:bg-white/5 p-4 rounded-2xl transition-all duration-200 border border-transparent hover:border-white/10">
                            <div className="flex items-start gap-4">
                                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/20 flex items-center justify-center shadow-lg shadow-blue-500/10">
                                    <MousePointer2 size={22} className="text-blue-400" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-white font-bold text-lg mb-2">Interactive Markers</h3>
                                    <p className="text-sm text-gray-300 leading-relaxed">
                                        <strong className="text-white">Hover</strong> to see disaster names with tooltips.
                                        <strong className="text-white"> Click</strong> markers to open detailed analysis panels with satellite imagery, AI insights, and real-time data.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Feature 3 - Satellite */}
                        <div className="group hover:bg-white/5 p-4 rounded-2xl transition-all duration-200 border border-transparent hover:border-white/10">
                            <div className="flex items-start gap-4">
                                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/20 flex items-center justify-center shadow-lg shadow-purple-500/10">
                                    <Satellite size={22} className="text-purple-400" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-white font-bold text-lg mb-2 flex items-center gap-2">
                                        NASA Satellite Analysis
                                        <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded-full font-medium">AI-Powered</span>
                                    </h3>
                                    <p className="text-sm text-gray-300 leading-relaxed">
                                        View <strong className="text-white">satellite pass times</strong> and get AI-powered imaging feasibility analysis.
                                        Includes cloud cover predictions, thermal imagery, and fire hotspot detection from NASA FIRMS.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Feature 4 - Live Monitoring */}
                        <div className="group hover:bg-white/5 p-4 rounded-2xl transition-all duration-200 border border-transparent hover:border-white/10">
                            <div className="flex items-start gap-4">
                                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 border border-green-500/20 flex items-center justify-center shadow-lg shadow-green-500/10">
                                    <Activity size={22} className="text-green-400" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-white font-bold text-lg mb-2">Live Data Monitoring</h3>
                                    <p className="text-sm text-gray-300 leading-relaxed">
                                        Automatic refresh from <strong className="text-white">NASA EONET</strong> and <strong className="text-white">USGS</strong>.
                                        <span className="inline-flex items-center gap-1 mx-1">
                                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-lg shadow-green-500/50" />
                                            <strong className="text-green-400">Pulsing markers</strong>
                                        </span>
                                        indicate high-severity events requiring immediate attention.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Filter Tip */}
                        <div className="bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-blue-500/10 border border-blue-500/20 rounded-2xl p-4">
                            <p className="text-sm text-gray-300 leading-relaxed">
                                <strong className="text-blue-400">💡 Pro Tip:</strong> Use the <strong className="text-white">legend panel</strong> (top-right)
                                to filter disasters by type. Click disaster types to show/hide specific markers on the map.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer - Action Bar */}
                <div className="relative px-8 py-5 border-t border-white/10 bg-gradient-to-r from-gray-900/50 via-gray-800/50 to-gray-900/50 backdrop-blur-sm">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-400 font-medium flex items-center gap-2">
                            <kbd className="px-2.5 py-1.5 bg-gray-700/80 border border-gray-600/50 rounded-lg text-white text-xs font-bold shadow-md">
                                ?
                            </kbd>
                            <span>Press anytime for help</span>
                        </p>
                        <button
                            onClick={handleClose}
                            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold rounded-xl transition-all duration-200 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-105 flex items-center gap-2"
                        >
                            <span>Get Started</span>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            {/* Custom Scrollbar Styles */}
            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.3);
                }
            `}</style>
        </div>
    );
}
