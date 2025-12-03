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
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-3 bg-gray-900/90 backdrop-blur-xl border-b border-white/10 z-50 relative shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600 flex items-center justify-center shadow-lg">
            <Globe size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">AegisMap</h1>
            <p className="text-xs text-gray-400">Disaster Monitoring</p>
          </div>
        </div>

        {/* Desktop Navigation - clean and minimal */}
        <nav className="desktop-nav flex items-center gap-2">
          <button
            onClick={() => setShowTutorial(true)}
            className="text-gray-300 hover:text-white hover:bg-white/10 transition-all px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium"
            aria-label="Show tutorial"
            title="Help (Press ?)"
          >
            <HelpCircle size={18} />
            <span>Help</span>
          </button>
        </nav>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="mobile-menu-btn p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
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
