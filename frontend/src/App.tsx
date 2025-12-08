import { useState, useEffect } from 'react';
import { Globe, HelpCircle } from 'lucide-react';
import { useTheme } from './contexts/ThemeContext';
import { Toaster } from 'react-hot-toast';
import MapBoard from './components/MapBoard';
import Sidebar from './components/Sidebar';
import DebugPanel from './components/DebugPanel';
import TutorialOverlay from './components/TutorialOverlay';
import ThemeToggle from './components/ThemeToggle';
import type { Disaster } from './types';

function App() {
  const [selectedDisaster, setSelectedDisaster] = useState<Disaster | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);

  // Theme state
  const { theme } = useTheme();

  // Filter state - all disasters visible by default
  const [activeFilters, setActiveFilters] = useState<Set<string>>(
    new Set(['fire', 'earthquake', 'volcano'])
  );

  // Filter toggle handler
  const handleFilterToggle = (type: string) => {
    setActiveFilters(prev => {
      const newFilters = new Set(prev);
      if (newFilters.has(type)) {
        // Don't allow turning off all filters
        if (newFilters.size > 1) {
          newFilters.delete(type);
        }
      } else {
        newFilters.add(type);
      }
      return newFilters;
    });
  };

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
      {/* Header - Theme-Aware */}
      <header
        className="flex items-center justify-between px-6 py-3 backdrop-blur-xl border-b z-50 relative"
        style={{
          background: theme === 'dark' ? 'rgba(17, 24, 39, 0.9)' : 'rgba(255, 255, 255, 0.9)',
          borderColor: theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Globe size={20} className="text-white" />
          </div>
          <div>
            <h1
              className="text-lg font-bold"
              style={{ color: theme === 'dark' ? '#fff' : '#111827' }}
            >
              AegisMap
            </h1>
            <p
              className="text-xs"
              style={{ color: theme === 'dark' ? '#9ca3af' : '#6b7280' }}
            >
              Disaster Monitoring
            </p>
          </div>
        </div>

        {/* Right Buttons */}
        <div className="flex items-center gap-2">
          {/* Theme Toggle */}
          <ThemeToggle />

          {/* Help Button */}
          <button
            onClick={() => setShowTutorial(true)}
            className="p-2 rounded-lg transition-all"
            style={{ color: theme === 'dark' ? '#9ca3af' : '#6b7280' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme === 'dark'
                ? 'rgba(255,255,255,0.1)'
                : 'rgba(0,0,0,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title="Help (Press ?)"
            aria-label="Show help"
          >
            <HelpCircle size={18} />
          </button>
        </div>
      </header>


      {/* Main Content Area */}
      <main className="flex-1 relative">
        <MapBoard
          onDisasterSelect={setSelectedDisaster}
          activeFilters={activeFilters}
          onFilterToggle={handleFilterToggle}
        />
      </main>

      {/* Sidebar - outside main container for proper positioning */}
      {selectedDisaster && (
        <Sidebar
          disaster={selectedDisaster}
          onClose={() => {
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
