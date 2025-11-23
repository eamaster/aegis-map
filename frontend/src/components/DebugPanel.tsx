/**
 * Debug Panel Component
 * Shows real-time validation status of all features
 * Toggle with Ctrl+D or click "Debug" in header
 */

import { useEffect, useState } from 'react';
import { Activity, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface DebugInfo {
    timestamp: string;
    category: string;
    message: string;
    status: 'success' | 'error' | 'warning' | 'info';
    data?: any;
}

interface DebugStats {
    backendOnline: boolean;
    disastersLoaded: number;
    tlesLoaded: boolean;
    satellitesCount: number;
    geminiCalls: number;
    geminiErrors: number;
    weatherCalls: number;
    cacheHits: number;
    cacheMisses: number;
}

export default function DebugPanel() {
    const [isOpen, setIsOpen] = useState(false);
    const [logs, setLogs] = useState<DebugInfo[]>([]);
    const [stats, setStats] = useState<DebugStats>({
        backendOnline: false,
        disastersLoaded: 0,
        tlesLoaded: false,
        satellitesCount: 0,
        geminiCalls: 0,
        geminiErrors: 0,
        weatherCalls: 0,
        cacheHits: 0,
        cacheMisses: 0,
    });

    // Listen for debug events from window
    useEffect(() => {
        const handleDebugEvent = (e: CustomEvent) => {
            const { category, message, status, data } = e.detail;
            const newLog: DebugInfo = {
                timestamp: new Date().toLocaleTimeString(),
                category,
                message,
                status,
                data,
            };
            setLogs((prev) => [newLog, ...prev].slice(0, 100)); // Keep last 100

            // Update stats
            if (category === 'backend' && status === 'success') {
                setStats((prev) => ({ ...prev, backendOnline: true }));
            }
            if (category === 'disasters' && data?.count) {
                setStats((prev) => ({ ...prev, disastersLoaded: data.count }));
            }
            if (category === 'tles' && data?.satellites) {
                setStats((prev) => ({
                    ...prev,
                    tlesLoaded: true,
                    satellitesCount: data.satellites,
                }));
            }
            if (category === 'gemini') {
                setStats((prev) => ({
                    ...prev,
                    geminiCalls: prev.geminiCalls + 1,
                    geminiErrors: status === 'error' ? prev.geminiErrors + 1 : prev.geminiErrors,
                }));
            }
            if (category === 'weather') {
                setStats((prev) => ({ ...prev, weatherCalls: prev.weatherCalls + 1 }));
            }
        };

        window.addEventListener('aegis-debug' as any, handleDebugEvent);

        // Keyboard shortcut: Ctrl+D
        const handleKeyPress = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'd') {
                e.preventDefault();
                setIsOpen((prev) => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyPress);

        // Expose debug functions globally
        (window as any).aegisDebug = {
            log: (category: string, message: string, status: string, data?: any) => {
                window.dispatchEvent(
                    new CustomEvent('aegis-debug', {
                        detail: { category, message, status, data },
                    })
                );
            },
            getStats: () => stats,
            getLogs: () => logs,
            clear: () => setLogs([]),
        };

        return () => {
            window.removeEventListener('aegis-debug' as any, handleDebugEvent);
            window.removeEventListener('keydown', handleKeyPress);
        };
    }, [stats, logs]);

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-4 right-4 z-[9999] bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium transition-all"
                title="Open Debug Panel (Ctrl+D)"
            >
                <Activity size={16} />
                Debug
            </button>
        );
    }

    const StatusIcon = ({ status }: { status: 'success' | 'error' | 'warning' | 'info' }) => {
        switch (status) {
            case 'success':
                return <CheckCircle size={16} className="text-green-400" />;
            case 'error':
                return <XCircle size={16} className="text-red-400" />;
            case 'warning':
                return <AlertCircle size={16} className="text-yellow-400" />;
            default:
                return <Activity size={16} className="text-blue-400" />;
        }
    };

    return (
        <div className="fixed bottom-0 right-0 w-full md:w-[600px] h-[400px] bg-gray-900/95 backdrop-blur-xl border-l border-t border-white/10 z-[9999] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                    <Activity size={20} className="text-blue-400" />
                    <h3 className="font-bold text-white">Debug Panel</h3>
                    <span className="text-xs text-gray-400">(Ctrl+D to toggle)</span>
                </div>
                <button
                    onClick={() => setIsOpen(false)}
                    className="text-gray-400 hover:text-white transition-colors"
                >
                    ✕
                </button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-white/10 bg-gray-800/50">
                <div className="text-center">
                    <div className="text-xs text-gray-400 mb-1">Backend</div>
                    <div className={`text-sm font-bold ${stats.backendOnline ? 'text-green-400' : 'text-red-400'}`}>
                        {stats.backendOnline ? '✓ Online' : '✗ Offline'}
                    </div>
                </div>
                <div className="text-center">
                    <div className="text-xs text-gray-400 mb-1">Disasters</div>
                    <div className="text-sm font-bold text-white">{stats.disastersLoaded}</div>
                </div>
                <div className="text-center">
                    <div className="text-xs text-gray-400 mb-1">Satellites</div>
                    <div className="text-sm font-bold text-white">{stats.satellitesCount}/6</div>
                </div>
                <div className="text-center">
                    <div className="text-xs text-gray-400 mb-1">Gemini</div>
                    <div className="text-sm font-bold text-white">
                        {stats.geminiCalls} ({stats.geminiErrors} ✗)
                    </div>
                </div>
            </div>

            {/* Logs */}
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1 custom-scrollbar">
                {logs.length === 0 && (
                    <div className="text-center text-gray-500 py-8">No debug logs yet...</div>
                )}
                {logs.map((log, idx) => (
                    <div
                        key={idx}
                        className="flex items-start gap-2 text-xs py-1 px-2 rounded hover:bg-white/5"
                    >
                        <StatusIcon status={log.status} />
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <span className="text-gray-500">{log.timestamp}</span>
                                <span className="text-blue-400 font-medium">[{log.category}]</span>
                                <span className="text-white">{log.message}</span>
                            </div>
                            {log.data && (
                                <pre className="text-gray-400 mt-1 text-[10px] overflow-x-auto">
                                    {JSON.stringify(log.data, null, 2).slice(0, 200)}
                                    {JSON.stringify(log.data).length > 200 && '...'}
                                </pre>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-white/10 flex justify-between items-center bg-gray-800/50">
                <span className="text-xs text-gray-400">{logs.length} logs</span>
                <button
                    onClick={() => setLogs([])}
                    className="text-xs text-blue-400 hover:text-blue-300"
                >
                    Clear Logs
                </button>
            </div>
        </div>
    );
}
