import { useState, useEffect, Suspense, lazy } from 'react';
import { Globe, HelpCircle } from 'lucide-react';

import { Toaster } from 'react-hot-toast';
import MapBoard from './components/MapBoard';
import Sidebar from './components/Sidebar';
import DebugPanel from './components/DebugPanel';
import ThemeToggle from './components/ThemeToggle';
import type { Disaster } from './types';
import { useDesignSystem } from './hooks/useDesignSystem';

// Lazy load rarely-used components
const TutorialOverlay = lazy(() => import('./components/TutorialOverlay'));

function App() {
  const ds = useDesignSystem();
  const [selectedDisaster, setSelectedDisaster] = useState<Disaster | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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

  // Handle disaster selection with mobile sidebar toggle
  const handleDisasterSelect = (disaster: Disaster | null) => {
    setSelectedDisaster(disaster);
    if (disaster && typeof window !== 'undefined' && window.innerWidth < 768) {
      setIsSidebarOpen(true);
    }
  };

  // Handle sidebar close
  const handleSidebarClose = () => {
    setSelectedDisaster(null);
    setIsSidebarOpen(false);
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
        backgroundColor: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
      }}
    >
      {/* Professional Header - Enterprise Design */}
      <header
        className="relative flex items-center justify-between px-4 md:px-8 py-3.5 border-b z-50 transition-all duration-300"
        style={{
          height: ds.dimensions.header.height.desktop,
          background: ds.accentGradient,
          ...ds.glass.panel,
          borderColor: ds.headerBorderColor,
          boxShadow: `0 4px 24px rgba(0, 0, 0, ${ds.isDark ? '0.5' : '0.15'}), 0 0 1px ${ds.colors.accent.blue}33`
        }}
      >
        {/* Logo - Professional Brand Identity */}
        <div className="relative flex items-center gap-3.5">
          {/* Globe Icon Badge */}
          <div
            className="w-11 h-11 flex items-center justify-center relative overflow-hidden group transition-all duration-300 hover:scale-105"
            style={{
              borderRadius: ds.borderRadius.lg,
              background: `linear-gradient(135deg, ${ds.colors.accent.blueDim}, rgba(37, 99, 235, 0.15))`,
              border: `2px solid ${ds.colors.accent.blue}66`,
              boxShadow: `0 4px 16px ${ds.colors.accent.blue}40, inset 0 1px 0 rgba(255, 255, 255, 0.1)`
            }}
          >
            <Globe
              size={22}
              className="relative z-10 transition-transform group-hover:rotate-12 duration-500"
              style={{
                color: ds.colors.accent.blueLight,
                strokeWidth: 2.5,
                filter: `drop-shadow(0 0 8px ${ds.colors.accent.blue}80)`
              }}
            />
            <div
              className="absolute inset-0 rounded-[16px] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{
                background: `radial-gradient(circle at center, ${ds.colors.accent.blue}4D, transparent 70%)`
              }}
            />
          </div>

          {/* Brand Text */}
          <div className="flex flex-col">
            <h1
              className="text-lg md:text-xl font-black tracking-tight leading-none"
              style={{
                color: ds.isDark ? '#ffffff' : '#111827',
                letterSpacing: '-0.03em',
                textShadow: ds.isDark ? `0 2px 8px ${ds.colors.accent.blue}4D` : 'none'
              }}
            >
              AegisMap
            </h1>
            <p
              className="text-[10px] md:text-xs font-semibold leading-none mt-1 hidden sm:block"
              style={{
                color: ds.isDark ? 'rgb(156, 163, 175)' : 'rgb(107, 114, 128)',
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
            className="p-2.5 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95 touch-target"
            style={{
              ...ds.glass.accent,
              color: ds.isDark ? 'rgb(156, 163, 175)' : 'rgb(107, 114, 128)',
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
          onDisasterSelect={handleDisasterSelect}
          activeFilters={activeFilters}
          onFilterToggle={handleFilterToggle}
        />
      </main>

      {/* Sidebar - outside main container for proper positioning */}
      {selectedDisaster && (
        <Sidebar
          disaster={selectedDisaster}
          onClose={handleSidebarClose}
          isOpen={isSidebarOpen}
        />
      )}

      {/* Debug Panel */}
      <DebugPanel />

      {/* Tutorial Overlay - Lazy Loaded */}
      <Suspense fallback={null}>
        {showTutorial && <TutorialOverlay onClose={() => setShowTutorial(false)} />}
      </Suspense>

      {/* Toast Notifications */}
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 3000,
          style: {
            ...ds.glass.panel,
            color: ds.isDark ? '#fff' : '#111827',
            borderRadius: ds.borderRadius.md,
            padding: '16px',
            fontSize: '14px',
            fontWeight: '500',
          },
          success: {
            iconTheme: {
              primary: ds.colors.status.success,
              secondary: '#fff',
            },
            style: {
              border: `1px solid ${ds.colors.status.success}4D`,
            },
          },
          error: {
            iconTheme: {
              primary: ds.colors.status.error,
              secondary: '#fff',
            },
            style: {
              border: `1px solid ${ds.colors.status.error}4D`,
            },
          },
        }}
      />
    </div>
  );
}

export default App;
