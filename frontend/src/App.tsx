import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
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
		new Set(['fire', 'fire_detection', 'earthquake', 'volcano']),
	);

	const switchView = useCallback(
		(nextView: ActiveView) => {
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
				if (url.toString() !== window.location.href) {
					window.history.pushState({ view: nextView }, '', url.toString());
				}
			}
		},
		[],
	);

	useEffect(() => {
		const onPopState = () => {
			const resolved = resolveInitialView();
			setActiveView(resolved);
			if (resolved === 'near-me') {
				setIsSidebarOpen(false);
			}
		};
		window.addEventListener('popstate', onPopState);
		return () => window.removeEventListener('popstate', onPopState);
	}, []);

	const handleFilterToggle = (type: string) => {
		setActiveFilters((prev) => {
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

	const handleDisasterSelect = useCallback((disaster: Disaster | null) => {
		setSelectedDisaster(disaster);
		setIsSidebarOpen(Boolean(disaster));
	}, []);

	const handleSidebarClose = useCallback(() => {
		setSelectedDisaster(null);
		setIsSidebarOpen(false);
	}, []);

	const closeTutorialAndRestoreFocus = useCallback(() => {
		setShowTutorial(false);
		requestAnimationFrame(() => {
			(document.querySelector('[data-testid="open-help-btn"]') as HTMLElement | null)?.focus();
		});
	}, []);

	const closeArchiveAndRestoreFocus = useCallback(() => {
		setShowTimelineDrawer(false);
		requestAnimationFrame(() => {
			(document.querySelector('[data-testid="open-timeline-drawer-btn"]') as HTMLElement | null)?.focus();
		});
	}, []);

	// Coordinated topmost keyboard handler (? opens Help; Escape closes topmost surface only)
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				if (showTutorial) {
					e.preventDefault();
					closeTutorialAndRestoreFocus();
					return;
				}
				if (showTimelineDrawer) {
					e.preventDefault();
					closeArchiveAndRestoreFocus();
					return;
				}
				if (activeView === 'explore' && selectedDisaster) {
					e.preventDefault();
					handleSidebarClose();
				}
				return;
			}

			const target = e.target as HTMLElement | null;
			const isInput =
				target?.tagName === 'INPUT' ||
				target?.tagName === 'TEXTAREA' ||
				target?.tagName === 'SELECT' ||
				target?.isContentEditable;
			if (!isInput && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
				setShowTutorial(true);
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [
		showTutorial,
		showTimelineDrawer,
		activeView,
		selectedDisaster,
		closeTutorialAndRestoreFocus,
		closeArchiveAndRestoreFocus,
		handleSidebarClose,
	]);

	return (
		<div
			className={
				activeView === 'explore'
					? 'app-shell-explore relative flex flex-col'
					: 'app-shell-resident relative flex flex-col'
			}
			style={{
				backgroundColor: 'var(--color-bg-primary)',
				color: 'var(--color-text-primary)',
			}}
		>
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-[250] focus:px-3 focus:py-2 focus:rounded-lg focus:bg-blue-600 focus:text-white focus:text-xs focus:font-bold"
			>
				{t.skipToMain}
			</a>

			{/* Responsive Header — zero horizontal overflow from 320px to wide desktop */}
			<header
				className="relative z-50 shrink-0 border-b px-2.5 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-2"
				style={{
					background: ds.accentGradient,
					...ds.glass.panel,
					borderColor: ds.headerBorderColor,
					boxShadow: `0 4px 20px rgba(0, 0, 0, ${ds.isDark ? '0.45' : '0.1'})`,
				}}
			>
				{/* Brand Identity */}
				<div className="order-1 flex items-center gap-2 sm:gap-3 min-w-0">
					<div
						className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 flex items-center justify-center rounded-lg"
						style={{
							background: `linear-gradient(135deg, ${ds.colors.accent.blueDim}, rgba(37, 99, 235, 0.15))`,
							border: `1.5px solid ${ds.colors.accent.blue}66`,
						}}
					>
						<Globe
							size={18}
							style={{
								color: ds.colors.accent.blueLight,
								strokeWidth: 2.5,
							}}
							aria-hidden="true"
						/>
					</div>

					<div className="flex flex-col min-w-0">
						<span
							className="font-black tracking-tight leading-none text-sm sm:text-lg truncate"
							style={{
								color: ds.isDark ? '#ffffff' : '#0f172a',
								letterSpacing: '-0.025em',
							}}
						>
							{t.appTitle}
						</span>
						<span
							className="text-[10px] font-semibold leading-none mt-1 hidden lg:block uppercase tracking-wider"
							style={{
								color: ds.text.tertiary,
							}}
						>
							Disaster Monitoring System
						</span>
					</div>
				</div>

				{/* Primary Route Switcher: full-width 2-col bar on <640px, inline pill bar on sm+ */}
				<nav
					aria-label="Primary views"
					className="order-3 sm:order-2 w-full sm:w-auto grid grid-cols-2 sm:flex items-center gap-1.5"
				>
					<button
						type="button"
						data-testid="nav-near-me"
						onClick={() => switchView('near-me')}
						aria-current={activeView === 'near-me' ? 'page' : undefined}
						className={`min-h-[38px] sm:min-h-[40px] inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
							activeView === 'near-me' ? 'bg-blue-600 text-white shadow-sm' : ''
						}`}
						style={
							activeView === 'near-me'
								? undefined
								: {
										background: ds.surface.overlaySubtle,
										color: ds.text.secondary,
										border: `1px solid ${ds.surface.border}`,
								  }
						}
					>
						<MapPin size={14} className="shrink-0" aria-hidden="true" />
						<span className="truncate">{t.navNearMe}</span>
					</button>
					<button
						type="button"
						data-testid="nav-explore-events"
						onClick={() => switchView('explore')}
						aria-current={activeView === 'explore' ? 'page' : undefined}
						className={`min-h-[38px] sm:min-h-[40px] inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
							activeView === 'explore' ? 'bg-blue-600 text-white shadow-sm' : ''
						}`}
						style={
							activeView === 'explore'
								? undefined
								: {
										background: ds.surface.overlaySubtle,
										color: ds.text.secondary,
										border: `1px solid ${ds.surface.border}`,
								  }
						}
					>
						<Compass size={14} className="shrink-0" aria-hidden="true" />
						<span className="truncate">{t.navExploreEvents}</span>
					</button>
				</nav>

				{/* Utility Controls */}
				<div className="order-2 sm:order-3 flex items-center gap-1 sm:gap-2 shrink-0">
					{activeView === 'explore' && (
						<button
							type="button"
							data-testid="open-timeline-drawer-btn"
							onClick={() => setShowTimelineDrawer(true)}
							className="min-h-[38px] sm:min-h-[40px] inline-flex items-center justify-center gap-1.5 px-2 sm:px-3 rounded-lg text-xs font-bold border transition-colors hover:opacity-90"
							style={{
								background: ds.surface.overlaySubtle,
								borderColor: ds.surface.border,
								color: ds.text.primary,
							}}
							aria-label={t.archiveButtonLabel}
							title={t.archiveButtonLabel}
						>
							<History size={15} className="shrink-0" aria-hidden="true" />
							<span className="hidden min-[380px]:inline">{t.archiveButtonLabel}</span>
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
						className="min-h-[38px] sm:min-h-[40px] px-1.5 sm:px-2.5 rounded-lg text-xs font-bold border"
						style={{
							background: ds.surface.overlaySubtle,
							borderColor: ds.surface.border,
							color: ds.text.primary,
						}}
						aria-label={t.languageLabel}
					>
						{SUPPORTED_LOCALES.map((loc) => (
							<option key={loc} value={loc} style={{ background: '#111827', color: '#fff' }}>
								{loc === 'en' ? 'EN' : loc === 'fa' ? 'FA' : 'MS'}
							</option>
						))}
					</select>

					<ThemeToggle />

					<button
						type="button"
						data-testid="open-help-btn"
						onClick={() => setShowTutorial(true)}
						className="min-h-[38px] min-w-[38px] sm:min-h-[40px] sm:min-w-[40px] rounded-lg border flex items-center justify-center transition-colors hover:opacity-90"
						style={{
							background: ds.surface.overlaySubtle,
							borderColor: ds.surface.border,
							color: ds.text.secondary,
						}}
						title={`${t.helpButtonLabel} (?)`}
						aria-label={t.helpButtonLabel}
					>
						<HelpCircle size={17} strokeWidth={2.5} aria-hidden="true" />
					</button>
				</div>
			</header>

			{/* Main Content Surface */}
			{activeView === 'near-me' ? (
				<main id="main-content" className="flex-1 w-full">
					<Suspense fallback={<div className="p-6 text-sm">Loading resident view…</div>}>
						<NearMeView onOpenExploreEvents={() => switchView('explore')} />
					</Suspense>
				</main>
			) : (
				<main
					id="main-content"
					className="flex-1 flex flex-col md:flex-row min-h-0 relative overflow-hidden"
				>
					<div className="flex-1 min-w-0 h-full relative">
						<Suspense
							fallback={
								<div className="w-full h-full flex items-center justify-center text-sm opacity-75">
									Loading map view…
								</div>
							}
						>
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
					</div>

					{selectedDisaster && (
						<Suspense fallback={null}>
							<Sidebar
								disaster={selectedDisaster}
								onClose={handleSidebarClose}
								isOpen={isSidebarOpen}
							/>
						</Suspense>
					)}
				</main>
			)}

			<DebugPanel />

			<Suspense fallback={null}>
				{showTutorial && <TutorialOverlay onClose={closeTutorialAndRestoreFocus} />}
				{showTimelineDrawer && (
					<TimelineAnalyticsDrawer
						isOpen={showTimelineDrawer}
						onClose={closeArchiveAndRestoreFocus}
						onSelectEvent={(ev) => {
							setShowTimelineDrawer(false);
							handleDisasterSelect(ev);
						}}
					/>
				)}
			</Suspense>

			<Toaster
				position="bottom-center"
				toastOptions={{
					duration: 3000,
					style: {
						...ds.glass.panel,
						color: ds.isDark ? '#fff' : '#0f172a',
						borderRadius: ds.borderRadius.md,
						padding: '12px 16px',
						fontSize: '13px',
						fontWeight: '600',
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
