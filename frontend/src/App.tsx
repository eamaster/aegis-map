import { useState, useEffect } from 'react';
import { Globe, HelpCircle } from 'lucide-react';

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

  // Theme context imported for ThemeToggle component

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
      {/* Professional Header - Enterprise Design */}
      <header
        className="relative flex items-center justify-between px-8 py-3.5 border-b z-50 transition-all duration-300"
        style={{
          height: '64px',
          background: 'linear-gradient(135deg, rgba(10, 15, 28, 0.98) 0%, rgba(17, 24, 39, 0.98) 100%)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          borderColor: 'rgba(59, 130, 246, 0.2)',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.5), 0 0 1px rgba(59, 130, 246, 0.3)'
        }}
      >
        {/* Logo - Professional Brand Identity */}
        <div className="relative flex items-center gap-3.5">
          {/* Globe Icon Badge */}
          <div
            className="w-11 h-11 flex items-center justify-center relative overflow-hidden group transition-all duration-300 hover:scale-105"
            style={{
              borderRadius: '16px',
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(37, 99, 235, 0.15))',
              border: '2px solid rgba(59, 130, 246, 0.4)',
              boxShadow: '0 4px 16px rgba(59, 130, 246, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
            }}
          >
            <Globe
              size={22}
              className="relative z-10 transition-transform group-hover:rotate-12 duration-500"
              style={{
                color: 'rgb(96, 165, 250)',
                strokeWidth: 2.5,
                filter: 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.5))'
              }}
            />
            <div
              className="absolute inset-0 rounded-[16px] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{
                background: 'radial-gradient(circle at center, rgba(59, 130, 246, 0.3), transparent 70%)'
              }}
            />
          </div>

          {/* Brand Text */}
          <div className="flex flex-col">
            <h1
              className="text-xl font-black tracking-tight leading-none"
              style={{
                color: '#ffffff',
                letterSpacing: '-0.03em',
                textShadow: '0 2px 8px rgba(59, 130, 246, 0.3)'
              }}
            >
              AegisMap
            </h1>
            <p
              className="text-xs font-semibold leading-none mt-1"
              style={{
                color: 'rgb(156, 163, 175)',
                letterSpacing: '0.05em',
                textTransform: 'uppercase'
              }}
            >
              Disaster Monitoring System
            </p>
          </div>
        </div>

        {/* Right Controls */}
        <div className="relative flex items-center gap-2.5">
          <ThemeToggle />

          {/* Help Button */}
          <button
            onClick={() => setShowTutorial(true)}
            className="p-2.5 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95"
            style={{
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              color: 'rgb(156, 163, 175)',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
              e.currentTarget.style.color = 'rgb(156, 163, 175)';
            }}
            title="Help (Press ?)"
            aria-label="Show help"
          >
            <HelpCircle size={18} strokeWidth={2.5} />
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
