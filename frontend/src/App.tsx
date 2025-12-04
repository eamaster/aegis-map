import { useState, useEffect } from 'react';
import { Globe, HelpCircle } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import MapBoard from './components/MapBoard';
import Sidebar from './components/Sidebar';
import DebugPanel from './components/DebugPanel';
import TutorialOverlay from './components/TutorialOverlay';
import type { Disaster } from './types';

function App() {
  const [selectedDisaster, setSelectedDisaster] = useState<Disaster | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);

  // Debug: Log state changes
  useEffect(() => {
    console.log('🔍 selectedDisaster state changed:', selectedDisaster);
  }, [selectedDisaster]);

  // Don't auto-show tutorial - let users discover it via Help button
  useEffect(() => {
    // Tutorial only shows when user clicks Help button
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
      {/* Header - Clean & Simple */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900/90 backdrop-blur-xl border-b border-white/10 z-50 relative">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Globe size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">AegisMap</h1>
            <p className="text-xs text-gray-400">Disaster Monitoring</p>
          </div>
        </div>

        {/* Help Button */}
        <button
          onClick={() => setShowTutorial(true)}
          className="text-gray-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/10 transition-all text-sm"
          title="Help (Press ?)"
        >
          <HelpCircle size={18} />
        </button>
      </header>


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
