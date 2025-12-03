/**
 * TutorialOverlay Component - First-time user guide
 */

import { useState, useEffect } from 'react';
import { X, MapPin, Satellite, MousePointer } from 'lucide-react';

interface TutorialOverlayProps {
    onClose: () => void;
}

export default function TutorialOverlay({ onClose }: TutorialOverlayProps) {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Fade in animation
        setTimeout(() => setIsVisible(true), 100);
    }, []);

    const handleClose = () => {
        setIsVisible(false);
        setTimeout(onClose, 300);
    };

    return (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-300 ${
                isVisible ? 'bg-black/70 backdrop-blur-sm' : 'bg-black/0'
            }`}
            onClick={handleClose}
        >
            <div
                className={`bg-gray-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl max-w-2xl mx-4 overflow-hidden transition-all duration-300 ${
                    isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
                }`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                            <MapPin size={24} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">Welcome to AegisMap</h2>
                            <p className="text-blue-100 text-sm">Real-time disaster monitoring</p>
                        </div>
                    </div>
                    <button
                        onClick={handleClose}
                        className="text-white/80 hover:text-white hover:bg-white/20 p-2 rounded-lg transition-colors"
                        aria-label="Close tutorial"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Feature 1 */}
                    <div className="flex gap-4">
                        <div className="flex-shrink-0">
                            <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                                <div className="w-3 h-3 rounded-full bg-red-500" />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-white font-semibold mb-1">Color-Coded Disasters</h3>
                            <p className="text-gray-300 text-sm leading-relaxed">
                                <span className="text-red-400 font-medium">Red circles</span> = Wildfires • 
                                <span className="text-orange-400 font-medium"> Orange circles</span> = Earthquakes • 
                                <span className="text-orange-500 font-medium"> Orange-red circles</span> = Volcanoes
                            </p>
                        </div>
                    </div>

                    {/* Feature 2 */}
                    <div className="flex gap-4">
                        <div className="flex-shrink-0">
                            <div className="w-12 h-12 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                                <MousePointer size={20} className="text-blue-400" />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-white font-semibold mb-1">Interactive Markers</h3>
                            <p className="text-gray-300 text-sm leading-relaxed">
                                <span className="font-medium">Hover</span> over any marker to see the disaster name. 
                                <span className="font-medium"> Click</span> a marker to view detailed information and satellite coverage analysis.
                            </p>
                        </div>
                    </div>

                    {/* Feature 3 */}
                    <div className="flex gap-4">
                        <div className="flex-shrink-0">
                            <div className="w-12 h-12 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                                <Satellite size={20} className="text-purple-400" />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-white font-semibold mb-1">Satellite Analysis</h3>
                            <p className="text-gray-300 text-sm leading-relaxed">
                                View when satellites will pass over disaster zones. Get AI-powered analysis of imaging feasibility based on cloud cover and sensor capabilities.
                            </p>
                        </div>
                    </div>

                    {/* Feature 4 */}
                    <div className="flex gap-4">
                        <div className="flex-shrink-0">
                            <div className="w-12 h-12 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
                                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-white font-semibold mb-1">Live Monitoring</h3>
                            <p className="text-gray-300 text-sm leading-relaxed">
                                Data refreshes automatically. Check the legend in the top-right corner for real-time disaster counts. 
                                <span className="font-medium"> Pulsing markers</span> indicate high-severity events.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="bg-gray-800/50 px-6 py-4 flex items-center justify-between border-t border-white/10">
                    <p className="text-gray-400 text-xs">
                        Press <kbd className="px-2 py-1 bg-gray-700 rounded text-white text-xs">?</kbd> anytime to see this guide again
                    </p>
                    <button
                        onClick={handleClose}
                        className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl"
                    >
                        Get Started
                    </button>
                </div>
            </div>
        </div>
    );
}

