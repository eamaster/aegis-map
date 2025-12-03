import { useState, useEffect } from 'react';
import { Globe, Menu, X, HelpCircle } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import MapBoard from './components/MapBoard';
import Sidebar from './components/Sidebar';
import DebugPanel from './components/DebugPanel';
import TutorialOverlay from './components/TutorialOverlay';
import type { Disaster } from './types';

function App() {
  const [selectedDisaster, setSelectedDisaster] = useState<Disaster | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  // Debug: Log state changes
  useEffect(() => {
    console.log('🔍 selectedDisaster state changed:', selectedDisaster);
  }, [selectedDisaster]);

  // Show tutorial on first visit
  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem('aegismap_tutorial_seen');
    if (!hasSeenTutorial) {
      setShowTutorial(true);
      localStorage.setItem('aegismap_tutorial_seen', 'true');
    }
  }, []);

  // Keyboard shortcut to show tutorial (? key)
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        setShowTutorial(true);
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-black flex flex-col">
      {/* Header - Premium Design */}
      <header className="relative flex items-center justify-between px-8 py-4 bg-gradient-to-r from-gray-900/95 via-gray-900/98 to-gray-900/95 backdrop-blur-2xl border-b border-white/20 z-50 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.8)]">
        {/* Background Gradient Animation */}
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/5 via-purple-600/5 to-blue-600/5 animate-pulse" />
        
        {/* Logo & Branding */}
        <div className="relative z-10 flex items-center gap-4">
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 via-purple-500 to-blue-600 rounded-xl blur-md opacity-75 group-hover:opacity-100 transition-opacity" />
            <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600 flex items-center justify-center shadow-2xl shadow-blue-500/50 group-hover:scale-110 transition-transform">
              <Globe size={24} className="text-white drop-shadow-lg" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight bg-gradient-to-r from-white via-blue-100 to-white bg-clip-text">AegisMap</h1>
            <p className="text-xs text-blue-400 font-bold uppercase tracking-wider">Global Disaster Monitoring</p>
          </div>
        </div>

        {/* Desktop Navigation - Premium */}
        <nav className="desktop-nav flex items-center gap-3 relative z-10">
          <button
            onClick={() => setShowTutorial(true)}
            className="group relative text-gray-300 hover:text-white hover:bg-white/10 transition-all px-5 py-2.5 rounded-xl flex items-center gap-2 text-sm font-semibold border border-white/10 hover:border-blue-400/50 shadow-lg hover:shadow-xl hover:shadow-blue-500/20 hover:scale-105 active:scale-95"
            aria-label="Show tutorial"
            title="Help (Press ?)"
          >
            <HelpCircle size={18} className="group-hover:rotate-12 transition-transform" />
            <span>Help</span>
          </button>
        </nav>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="mobile-menu-btn relative z-10 p-2.5 text-white hover:bg-white/10 rounded-lg transition-all border border-white/10 hover:border-white/20"
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      {/* Mobile Navigation Overlay */}
      {mobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Slide-in Menu */}
          <nav className="fixed top-0 right-0 h-full w-64 bg-gray-900/95 backdrop-blur-xl border-l border-white/10 z-50 md:hidden shadow-2xl animate-in slide-in-from-right duration-300">
            <div className="flex flex-col h-full">
              {/* Menu Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <h2 className="text-lg font-bold text-white">Menu</h2>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Menu Items */}
              <div className="flex-1 px-4 py-6 space-y-2">
                <button
                  onClick={() => {
                    setShowTutorial(true);
                    setMobileMenuOpen(false);
                  }}
                  className="w-full px-4 py-3 text-left text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-all flex items-center gap-2"
                >
                  <HelpCircle size={18} />
                  Help & Tutorial
                </button>
              </div>
            </div>
          </nav>
        </>
      )}

      {/* Main Content Area */}
      <main className="flex-1 relative">
        <MapBoard onDisasterSelect={setSelectedDisaster} />
      </main>

      {/* Sidebar - outside main container for proper positioning */}
      {selectedDisaster && (
        <Sidebar
          disaster={selectedDisaster}
          onClose={() => {
            console.log('🔒 Closing sidebar');
            setSelectedDisaster(null);
          }}
        />
      )}

      {/* Debug Panel */}
      <DebugPanel />

      {/* Tutorial Overlay */}
      {showTutorial && <TutorialOverlay onClose={() => setShowTutorial(false)} />}

      {/* Toast Notifications */}
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: 'rgba(17, 24, 39, 0.95)',
            backdropFilter: 'blur(16px)',
            color: '#fff',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '0.75rem',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
            padding: '16px',
            fontSize: '14px',
            fontWeight: '500',
          },
          success: {
            iconTheme: {
              primary: '#10B981',
              secondary: '#fff',
            },
            style: {
              border: '1px solid rgba(16, 185, 129, 0.3)',
            },
          },
          error: {
            iconTheme: {
              primary: '#EF4444',
              secondary: '#fff',
            },
            style: {
              border: '1px solid rgba(239, 68, 68, 0.3)',
            },
          },
        }}
      />
    </div>
  );
}

export default App;
