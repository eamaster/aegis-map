import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { Download, HelpCircle, MapPin, Compass, History } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import { AegisBrandMark } from './components/AegisBrandMark';
import DebugPanel from './components/DebugPanel';
import { InstallAppModal } from './components/InstallAppModal';
import ThemeToggle from './components/ThemeToggle';
import type { NotificationTarget } from './components/NearMeView';
import type { Disaster, ObservationWindow, VolcanoMode } from './types';
import { DEFAULT_OBSERVATION_WINDOW, DEFAULT_VOLCANO_MODE } from './config/disasters';
import { useDesignSystem } from './hooks/useDesignSystem';
import { useLocale } from './hooks/useLocale';
import { usePwaInstall } from './hooks/usePwaInstall';
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

function resolveNotificationTargetFromSearch(search: string, nonce = 0): NotificationTarget | null {
	const sp = new URLSearchParams(search);
	const warningId = sp.get('warningId')?.trim() || null;
	const latRaw = sp.get('lat');
	const lngRaw = sp.get('lng');
	const lat = latRaw !== null && latRaw !== '' && Number.isFinite(Number(latRaw)) ? Number(latRaw) : null;
	const lng = lngRaw !== null && lngRaw !== '' && Number.isFinite(Number(lngRaw)) ? Number(lngRaw) : null;
	const countryCode = sp.get('country')?.trim().toUpperCase() || null;
	const placeName = sp.get('place')?.trim() || null;
	const noticeStatus = sp.get('noticeStatus') === 'cancelled' ? 'cancelled' : null;
	if (!warningId && lat === null && lng === null && !noticeStatus) return null;
	return { warningId, lat, lng, countryCode, placeName, noticeStatus, nonce };
}

function resolveInitialNotificationTarget(): NotificationTarget | null {
	if (typeof window === 'undefined') return null;
	return resolveNotificationTargetFromSearch(window.location.search, 0);
}

function App() {
	const ds = useDesignSystem();
	const { locale, t, setLocale } = useLocale();
	const { canPromptInstall, isInstalledStandalone, platform, promptInstall } = usePwaInstall();
	const [activeView, setActiveView] = useState<ActiveView>(resolveInitialView);
	const [notificationTarget, setNotificationTarget] = useState<NotificationTarget | null>(
		resolveInitialNotificationTarget,
	);
	const highlightedWarningId = notificationTarget?.warningId ?? null;
	const [showInstallModal, setShowInstallModal] = useState(false);
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
			setNotificationTarget(resolveNotificationTargetFromSearch(window.location.search, Date.now()));
			if (resolved === 'near-me') {
				setIsSidebarOpen(false);
			}
		};
		window.addEventListener('popstate', onPopState);
		return () => window.removeEventListener('popstate', onPopState);
	}, []);

	useEffect(() => {
		if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
		const onSwMessage = (event: MessageEvent) => {
			const data = event.data as {
				type?: string;
				url?: string;
				warningId?: string;
				route?: {
					lat?: number;
					lng?: number;
					countryCode?: string;
					warningId?: string;
					placeName?: string;
					msgType?: string;
				} | null;
			} | null;
			if (!data || data.type !== 'AEGIS_WARNING_CLICK') return;
			let parsedSearch = '';
			if (typeof data.url === 'string' && typeof window !== 'undefined') {
				try {
					const parsed = new URL(data.url, window.location.href);
					if (parsed.origin === window.location.origin) {
						parsedSearch = parsed.search;
						window.history.pushState({ view: 'near-me' }, '', parsed.toString());
					}
				} catch {
					// ignore invalid URL
				}
			}
			const fromUrl = parsedSearch ? resolveNotificationTargetFromSearch(parsedSearch, Date.now()) : null;
			const nextTarget: NotificationTarget | null = data.route
				? {
						warningId: data.route.warningId ?? data.warningId ?? fromUrl?.warningId ?? null,
						lat: typeof data.route.lat === 'number' ? data.route.lat : fromUrl?.lat ?? null,
						lng: typeof data.route.lng === 'number' ? data.route.lng : fromUrl?.lng ?? null,
						countryCode: data.route.countryCode ?? fromUrl?.countryCode ?? null,
						placeName: data.route.placeName ?? fromUrl?.placeName ?? null,
						noticeStatus: data.route.msgType === 'Cancel' ? 'cancelled' : fromUrl?.noticeStatus ?? null,
						nonce: Date.now(),
					}
				: fromUrl ?? (data.warningId ? { warningId: data.warningId, nonce: Date.now() } : null);
			setActiveView('near-me');
			setIsSidebarOpen(false);
			if (nextTarget) {
				setNotificationTarget(nextTarget);
			}
		};
		navigator.serviceWorker.addEventListener('message', onSwMessage);
		return () => navigator.serviceWorker.removeEventListener('message', onSwMessage);
	}, []);

	const handleInstallClick = async () => {
		if (canPromptInstall) {
			const outcome = await promptInstall();
			if (outcome === 'accepted') return;
		}
		setShowInstallModal(true);
	};

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
					<AegisBrandMark size={32} className="shrink-0" />

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
							{t.appSubtitle}
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

					{!isInstalledStandalone && (
						<button
							type="button"
							data-testid="pwa-install-btn"
							onClick={() => void handleInstallClick()}
							className="min-h-[38px] sm:min-h-[40px] inline-flex items-center justify-center gap-1.5 px-2 sm:px-3 rounded-lg text-xs font-bold border transition-colors hover:border-blue-400 cursor-pointer"
							style={{
								background: ds.surface.overlaySubtle,
								borderColor: ds.surface.border,
								color: ds.text.primary,
							}}
							title={t.installAppButton}
						>
							<Download size={14} className="text-blue-400 shrink-0" aria-hidden="true" />
							<span className="hidden md:inline">{t.installAppButton}</span>
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
								{loc === 'en' ? 'EN' : loc === 'zh-Hans' ? '简体中文' : loc === 'fa' ? 'فارسی' : 'BM'}
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
						<NearMeView
							onOpenExploreEvents={() => switchView('explore')}
							highlightedWarningId={highlightedWarningId}
							notificationTarget={notificationTarget}
						/>
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

			<InstallAppModal
				open={showInstallModal}
				platform={platform}
				canPromptInstall={canPromptInstall}
				isDark={ds.isDark}
				onTriggerNativePrompt={() => {
					void promptInstall().then((outcome) => {
						if (outcome === 'accepted') setShowInstallModal(false);
					});
				}}
				onClose={() => setShowInstallModal(false)}
				labels={{
					title: t.installModalTitle,
					subtitle: t.installModalSubtitle,
					iosStep1: t.installIosStep1,
					iosStep2: t.installIosStep2,
					androidStep: t.installAndroidStep,
					desktopStep: t.installDesktopStep,
					notificationsNote: t.installNotificationsNote,
					shortcutNote: t.installShortcutNote,
					nativePromptBtn: t.installNativePromptBtn,
					closeBtn: t.closeButton,
				}}
			/>

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
