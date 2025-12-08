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
    <div
      className="w-screen h-screen relative overflow-hidden flex flex-col"
      style={{
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
      }}
    >
      {/* Header - Professional Glassmorphism Design */}
      <header
        className="relative flex items-center justify-between px-6 py-3.5 border-b z-50"
        style={{
          background: theme === 'dark'
            ? 'linear-gradient(135deg, rgba(17, 24, 39, 0.95) 0%, rgba(31, 41, 55, 0.95) 100%)'
            : 'linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(241, 245, 249, 0.95) 100%)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderColor: theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)'
        }}
      >
        {/* Subtle gradient overlay */}
        <div
          className="absolute inset-0 opacity-50"
          style={{
            background: 'radial-gradient(circle at top right, rgba(59, 130, 246, 0.1), transparent 50%), radial-gradient(circle at bottom left, rgba(168, 85, 247, 0.1), transparent 50%)',
            pointerEvents: 'none'
          }}
        />

        {/* Logo - Enhanced with glassmorphism badge */}
        <div className="relative flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.8), rgba(147, 51, 234, 0.8))',
              boxShadow: '0 4px 16px rgba(59, 130, 246, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
            }}
          >
            <Globe size={20} className="text-white relative z-10" />
            {/* Shine effect */}
            <div
              className="absolute inset-0 opacity-40"
              style={{
                background: 'linear-gradient(135deg, transparent 40%, rgba(255, 255, 255, 0.4) 50%, transparent 60%)',
              }}
            />
          </div>
          <div>
            <h1
              className="text-lg font-black tracking-tight"
              style={{
                color: theme === 'dark' ? '#fff' : '#111827',
                textShadow: theme === 'dark' ? '0 1px 3px rgba(0,0,0,0.5)' : 'none'
              }}
            >
              AegisMap
            </h1>
            <p
              className="text-xs font-semibold"
              style={{
                color: theme === 'dark' ? '#9ca3af' : '#6b7280',
                letterSpacing: '0.025em'
              }}
            >
              Disaster Monitoring
            </p>
          </div>
        </div>

        {/* Right Buttons - Enhanced with glassmorphism */}
        <div className="relative flex items-center gap-2">
          {/* Theme Toggle */}
          <ThemeToggle />

          {/* Help Button - Glassmorphism style */}
          <button
            onClick={() => setShowTutorial(true)}
            className="relative p-2.5 rounded-xl transition-all duration-200 hover:scale-105"
            style={{
              background: theme === 'dark'
                ? 'rgba(255, 255, 255, 0.05)'
                : 'rgba(0, 0, 0, 0.05)',
              border: theme === 'dark'
                ? '1px solid rgba(255, 255, 255, 0.1)'
                : '1px solid rgba(0, 0, 0, 0.1)',
              backdropFilter: 'blur(12px)',
              color: theme === 'dark' ? '#9ca3af' : '#6b7280',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme === 'dark'
                ? 'rgba(255, 255, 255, 0.1)'
                : 'rgba(0, 0, 0, 0.1)';
              e.currentTarget.style.color = theme === 'dark' ? '#fff' : '#111827';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = theme === 'dark'
                ? 'rgba(255, 255, 255, 0.05)'
                : 'rgba(0, 0, 0, 0.05)';
              e.currentTarget.style.color = theme === 'dark' ? '#9ca3af' : '#6b7280';
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
