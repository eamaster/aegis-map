import { useState, useEffect, Suspense, lazy } from 'react';
import { Globe, HelpCircle, MapPin, Compass, History } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import DebugPanel from './components/DebugPanel';
import ThemeToggle from './components/ThemeToggle';
import type { Disaster, ObservationWindow, VolcanoMode } from './types';
import { DEFAULT_OBSERVATION_WINDOW, DEFAULT_VOLCANO_MODE } from './config/disasters';
import { useDesignSystem } from './hooks/useDesignSystem';
import { useLocale } from './hooks/useLocale';
import { SUPPORTED_LOCALES, type AppLocale } from './i18n/translations';

// Lazy load routes and heavy map/sidebar so text-first Near me loads without Mapbox GL
const MapBoard = lazy(() => import('./components/MapBoard'));
const Sidebar = lazy(() => import('./components/Sidebar'));
const NearMeView = lazy(() => import('./components/NearMeView'));
const TutorialOverlay = lazy(() => import('./components/TutorialOverlay'));
const TimelineAnalyticsDrawer = lazy(() => import('./components/TimelineAnalyticsDrawer'));

type ActiveView = 'explore' | 'near-me';

function resolveInitialView(): ActiveView {
  if (typeof window === 'undefined') return 'explore';
  const view = new URLSearchParams(window.location.search).get('view');
  return view === 'near-me' ? 'near-me' : 'explore';
}

function App() {
  const ds = useDesignSystem();
  const { locale, t, setLocale } = useLocale();
  const [activeView, setActiveView] = useState<ActiveView>(resolveInitialView);
  const [selectedDisaster, setSelectedDisaster] = useState<Disaster | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showTimelineDrawer, setShowTimelineDrawer] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [observationWindow, setObservationWindow] = useState<ObservationWindow>(DEFAULT_OBSERVATION_WINDOW);
  const [volcanoMode, setVolcanoMode] = useState<VolcanoMode>(DEFAULT_VOLCANO_MODE);

  const [activeFilters, setActiveFilters] = useState<Set<string>>(
    new Set(['fire', 'fire_detection', 'earthquake', 'volcano'])
  );

  const switchView = (nextView: ActiveView) => {
    setActiveView(nextView);
    if (nextView === 'near-me') {
      setIsSidebarOpen(false);
    }
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (nextView === 'near-me') {
        url.searchParams.set('view', 'near-me');
      } else {
        url.searchParams.delete('view');
      }
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleFilterToggle = (type: string) => {
    setActiveFilters(prev => {
      const newFilters = new Set(prev);
      if (newFilters.has(type)) {
        if (newFilters.size > 1) {
          newFilters.delete(type);
        }
      } else {
        newFilters.add(type);
      }
      return newFilters;
    });
  };

  const handleDisasterSelect = (disaster: Disaster | null) => {
    setSelectedDisaster(disaster);
    if (disaster) {
      setIsSidebarOpen(true);
    }
  };

  const handleSidebarClose = () => {
    setSelectedDisaster(null);
    setIsSidebarOpen(false);
  };

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT';
      if (!isInput && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
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
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[250] focus:px-3 focus:py-2 focus:rounded-lg focus:bg-blue-600 focus:text-white focus:text-xs focus:font-bold"
      >
        {t.skipToMain}
      </a>

      {/* Header */}
      <header
        className="relative flex items-center justify-between py-2.5 border-b z-50 transition-all duration-300"
        style={{
          height: ds.dimensions.header.height.desktop,
          paddingLeft: '16px',
          paddingRight: '16px',
          background: ds.accentGradient,
          ...ds.glass.panel,
          borderColor: ds.headerBorderColor,
          boxShadow: `0 4px 24px rgba(0, 0, 0, ${ds.isDark ? '0.5' : '0.15'}), 0 0 1px ${ds.colors.accent.blue}33`
        }}
      >
        {/* Brand Identity */}
        <div className="relative flex items-center" style={{ gap: '12px' }}>
          <div
            className="flex items-center justify-center relative overflow-hidden group transition-all duration-300 hover:scale-105"
            style={{
              width: '40px',
              height: '40px',
              borderRadius: ds.borderRadius.lg,
              background: `linear-gradient(135deg, ${ds.colors.accent.blueDim}, rgba(37, 99, 235, 0.15))`,
              border: `2px solid ${ds.colors.accent.blue}66`,
              boxShadow: `0 4px 16px ${ds.colors.accent.blue}40, inset 0 1px 0 rgba(255, 255, 255, 0.1)`
            }}
          >
            <Globe
              size={22}
              className="relative z-10"
              style={{
                color: ds.colors.accent.blueLight,
                strokeWidth: 2.5,
              }}
            />
          </div>

          <div className="flex flex-col">
            <span
              className="font-black tracking-tight leading-none"
              style={{
                fontSize: '1.25rem',
                color: ds.isDark ? '#ffffff' : '#111827',
                letterSpacing: '-0.03em',
              }}
            >
              AegisMap
            </span>
            <p
              className="text-[10px] font-semibold leading-none mt-1 hidden md:block"
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

        {/* Route Navigation: Near me vs Explore events */}
        <nav aria-label="Primary views" className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="nav-near-me"
            onClick={() => switchView('near-me')}
            aria-current={activeView === 'near-me' ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${
              activeView === 'near-me' ? 'bg-blue-600 text-white' : ''
            }`}
            style={
              activeView === 'near-me'
                ? undefined
                : { background: ds.surface.overlaySubtle, color: ds.text.secondary, border: `1px solid ${ds.surface.border}` }
            }
          >
            <MapPin size={14} aria-hidden="true" />
            <span>{t.navNearMe}</span>
          </button>
          <button
            type="button"
            data-testid="nav-explore-events"
            onClick={() => switchView('explore')}
            aria-current={activeView === 'explore' ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${
              activeView === 'explore' ? 'bg-blue-600 text-white' : ''
            }`}
            style={
              activeView === 'explore'
                ? undefined
                : { background: ds.surface.overlaySubtle, color: ds.text.secondary, border: `1px solid ${ds.surface.border}` }
            }
          >
            <Compass size={14} aria-hidden="true" />
            <span>{t.navExploreEvents}</span>
          </button>
        </nav>

        {/* Right Controls */}
        <div className="relative flex items-center" style={{ gap: '8px' }}>
          {activeView === 'explore' && (
            <button
              type="button"
              data-testid="open-timeline-drawer-btn"
              onClick={() => setShowTimelineDrawer(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-bold border transition-colors hover:opacity-90"
              style={{
                background: ds.surface.overlaySubtle,
                borderColor: ds.surface.border,
                color: ds.text.primary,
              }}
              aria-label="Open Historical Archive and Source Health"
            >
              <History size={14} aria-hidden="true" />
              <span>Archive</span>
            </button>
          )}
          <label htmlFor="ui-locale-select" className="sr-only">
            {t.languageLabel}
          </label>
          <select
            id="ui-locale-select"
            data-testid="ui-locale-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as AppLocale)}
            className="px-2 py-2 rounded-lg text-xs font-bold border focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
            style={{
              background: ds.surface.overlaySubtle,
              borderColor: ds.surface.border,
              color: ds.text.primary,
            }}
            aria-label={t.languageLabel}
          >
            {SUPPORTED_LOCALES.map((loc) => (
              <option key={loc} value={loc} style={{ background: '#111827', color: '#fff' }}>
                {loc === 'en' ? 'EN' : loc === 'fa' ? 'FA (فارسی)' : 'MS'}
              </option>
            ))}
          </select>

          <ThemeToggle />

          <button
            onClick={() => setShowTutorial(true)}
            className="transition-all duration-200 hover:scale-105 active:scale-95"
            style={{
              padding: '10px',
              borderRadius: '10px',
              background: ds.surface.overlaySubtle,
              border: `1px solid ${ds.surface.border}`,
              color: ds.text.secondary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Help (?)"
            aria-label="Show help"
          >
            <HelpCircle size={18} strokeWidth={2.5} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main id="main-content" className="flex-1 relative overflow-hidden">
        {activeView === 'near-me' ? (
          <Suspense fallback={<div className="p-6 text-sm">Loading resident view…</div>}>
            <NearMeView onOpenExploreEvents={() => switchView('explore')} />
          </Suspense>
        ) : (
          <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-sm opacity-75">Loading map view…</div>}>
            <MapBoard
              selectedDisaster={selectedDisaster}
              onDisasterSelect={handleDisasterSelect}
              activeFilters={activeFilters}
              onFilterToggle={handleFilterToggle}
              observationWindow={observationWindow}
              onObservationWindowChange={setObservationWindow}
              volcanoMode={volcanoMode}
              onVolcanoModeChange={setVolcanoMode}
              onOpenNearMe={() => switchView('near-me')}
            />
          </Suspense>
        )}
      </main>

      {/* Sidebar */}
      {activeView === 'explore' && selectedDisaster && (
        <Suspense fallback={null}>
          <Sidebar
            disaster={selectedDisaster}
            onClose={handleSidebarClose}
            isOpen={isSidebarOpen}
          />
        </Suspense>
      )}

      <DebugPanel />

      <Suspense fallback={null}>
        {showTutorial && <TutorialOverlay onClose={() => setShowTutorial(false)} />}
        {showTimelineDrawer && (
          <TimelineAnalyticsDrawer
            isOpen={showTimelineDrawer}
            onClose={() => setShowTimelineDrawer(false)}
            onSelectEvent={(ev) => {
              setShowTimelineDrawer(false);
              handleDisasterSelect(ev);
            }}
          />
        )}
      </Suspense>

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
