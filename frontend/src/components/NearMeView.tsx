import { useCallback, useEffect, useState } from 'react';
import {
	AlertTriangle,
	CheckCircle2,
	Clock,
	Compass,
	ExternalLink,
	Info,
	RefreshCw,
	ShieldAlert,
	ShieldOff,
	Trash2,
	WifiOff,
} from 'lucide-react';
import type { OfficialWarningItem, WarningsApiResponse, WarningCoverageStatus } from '../../../shared/contracts';
import { selectPreferredWarningTranslationIndex } from '../i18n/translations';
import { useLocale } from '../hooks/useLocale';
import { useDesignSystem } from '../hooks/useDesignSystem';
import { formatEventDualTime } from '../utils/eventFormatters';
import {
	buildManualPlace,
	deleteSavedPlace,
	loadSavedPlaces,
	PRESENT_JURISDICTION_STORAGE_KEY,
	upsertSavedPlace,
	type SelectedPlace,
} from '../utils/places';
import { clearAllLocalResidentData, type OfflineWarningsState } from '../utils/offlineCache';
import { fetchOfficialWarnings } from '../utils/warningsClient';
import { BdiLtr } from './BdiLtr';
import LocationHelpPanel, { PrivateLocationCard } from './LocationHelpPanel';
import PlaceSelector from './PlaceSelector';
import SubscriptionOptIn from './SubscriptionOptIn';

export interface NotificationTarget {
	warningId?: string | null;
	lat?: number | null;
	lng?: number | null;
	countryCode?: string | null;
	placeName?: string | null;
	noticeStatus?: 'cancelled' | null;
	nonce?: number;
}

interface NearMeViewProps {
	onOpenExploreEvents: () => void;
	highlightedWarningId?: string | null;
	notificationTarget?: NotificationTarget | null;
}

function sanitizeExternalUrl(raw: string | null | undefined): string | null {
	if (!raw || typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const candidate = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
	try {
		const parsed = new URL(candidate);
		if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
			return parsed.href;
		}
		return null;
	} catch {
		return null;
	}
}

function formatDualTime(iso: string | null | undefined, locale?: string): string {
	if (!iso) return 'Not specified by issuer';
	const formatted = formatEventDualTime(iso, locale);
	return formatted.valid && formatted.local ? `${formatted.utc} (${formatted.local})` : formatted.utc;
}

function coverageBadgeInfo(status: WarningCoverageStatus, t: ReturnType<typeof useLocale>['t']) {
	switch (status) {
		case 'active_warnings':
			return {
				label: t.coverageActive,
				tone: 'border-red-500/55 bg-red-500/15',
				iconColor: 'text-red-400',
				icon: AlertTriangle,
			};
		case 'checked_no_warnings':
			return {
				label: t.coverageEmpty,
				tone: 'border-emerald-500/50 bg-emerald-500/12',
				iconColor: 'text-emerald-400',
				icon: CheckCircle2,
			};
		case 'partial_coverage':
			return {
				label: t.coveragePartial,
				tone: 'border-amber-500/50 bg-amber-500/12',
				iconColor: 'text-amber-400',
				icon: AlertTriangle,
			};
		case 'stale':
			return {
				label: t.coverageStale,
				tone: 'border-amber-500/50 bg-amber-500/12',
				iconColor: 'text-amber-400',
				icon: Clock,
			};
		case 'source_unavailable':
			return {
				label: t.coverageUnavailable,
				tone: 'border-red-500/50 bg-red-500/12',
				iconColor: 'text-red-400',
				icon: ShieldOff,
			};
		default:
			return {
				label: t.coverageUnsupported,
				tone: 'border-slate-500/50 bg-slate-500/12',
				iconColor: 'text-slate-400',
				icon: Info,
			};
	}
}

function WarningCard({
	warning,
	isOfflineExpired,
	isHighlighted = false,
}: {
	warning: OfficialWarningItem;
	isOfflineExpired: boolean;
	isHighlighted?: boolean;
}) {
	const { locale, t } = useLocale();
	const ds = useDesignSystem();
	const [manualLangChoice, setManualLangChoice] = useState<{
		warningId: string;
		locale: string;
		idx: number;
	} | null>(null);
	const langIdx =
		manualLangChoice && manualLangChoice.warningId === warning.id && manualLangChoice.locale === locale
			? manualLangChoice.idx
			: selectPreferredWarningTranslationIndex(warning.translations, locale);
	const block = warning.translations[langIdx] ?? warning.translations[0];
	const bulletinHref = sanitizeExternalUrl(block?.web ?? warning.bulletinUrl ?? warning.issuerUrl);
	const isHighSeverity = warning.severity === 'extreme' || warning.severity === 'severe';

	return (
		<article
			id={`warning-card-${warning.id}`}
			data-testid={`warning-card-${warning.id}`}
			className={`rounded-2xl p-4 sm:p-5 border space-y-3.5 shadow-sm ${
				isHighlighted ? 'ring-2 ring-blue-500' : ''
			}`}
			style={{
				background: 'var(--color-surface-card)',
				borderColor: isHighSeverity ? 'rgba(239, 68, 68, 0.55)' : ds.surface.border,
			}}
		>
			<div className="flex flex-wrap items-start justify-between gap-2.5">
				<div className="space-y-1.5 min-w-0">
					<div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide">
						<span
							className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md border ${
								isHighSeverity
									? 'bg-red-500/20 text-red-300 border-red-500/45'
									: 'bg-amber-500/20 text-amber-300 border-amber-500/45'
							}`}
						>
							<AlertTriangle size={12} aria-hidden="true" />
							<span>{warning.severity}</span>
						</span>
						<span className="px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 border border-blue-500/35">
							{warning.lifecycleState}
						</span>
						<span
							className="px-2 py-0.5 rounded-md border"
							style={{ borderColor: ds.surface.border, color: ds.text.secondary }}
						>
							{t.bulletinLanguageTag}: <BdiLtr mono>{block?.language ?? warning.primaryLanguage}</BdiLtr>
						</span>
						{isOfflineExpired && (
							<span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/45">
								EXPIRED
							</span>
						)}
					</div>
					<h3 className="text-base sm:text-lg font-extrabold break-words" style={{ color: ds.text.primary }} lang={block?.language}>
						{block?.headline || block?.event || warning.category}
					</h3>
					<p className="text-xs leading-relaxed" style={{ color: ds.text.secondary }}>
						<strong>{warning.issuerName}</strong> · {warning.matchNote}
						{warning.matchUncertain ? ' (area match approximate — verify affected area below)' : ''}
					</p>
				</div>

				{warning.translations.length > 1 && (
					<div className="flex items-center gap-1" role="group" aria-label="Official bulletin language">
						{warning.translations.map((tr, idx) => (
							<button
								key={`${warning.id}-lang-${tr.language}-${idx}`}
								type="button"
								onClick={() => setManualLangChoice({ warningId: warning.id, locale, idx })}
								className={`min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-bold border ${
									idx === langIdx ? 'bg-blue-600 text-white border-blue-500' : ''
								}`}
								style={
									idx === langIdx
										? undefined
										: { borderColor: ds.surface.border, color: ds.text.secondary }
								}
							>
								{tr.language.toUpperCase()}
							</button>
						))}
					</div>
				)}
			</div>

			{block?.areaDesc && (
				<div className="text-xs leading-relaxed">
					<span className="font-bold" style={{ color: ds.text.secondary }}>
						{t.affectedAreaHeading}:{' '}
					</span>
					<span style={{ color: ds.text.primary }} lang={block.language}>
						{block.areaDesc}
					</span>
				</div>
			)}

			{block?.instruction && (
				<div
					className="rounded-xl p-3.5 border border-amber-500/45 bg-amber-500/12 space-y-1"
					lang={block.language}
				>
					<div className="text-xs font-extrabold uppercase tracking-wide flex items-center gap-1.5 text-amber-400">
						<ShieldAlert size={14} aria-hidden="true" />
						<span>{t.issuerInstructionsHeading}</span>
					</div>
					<p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: ds.text.primary }}>
						{block.instruction}
					</p>
				</div>
			)}

			{block?.description && (
				<p className="text-sm leading-relaxed whitespace-pre-line break-words" style={{ color: ds.text.primary }} lang={block.language}>
					{block.description}
				</p>
			)}

			<dl
				className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs pt-3 border-t"
				style={{ borderColor: ds.surface.borderSubtle }}
			>
				<div>
					<dt className="font-bold" style={{ color: ds.text.tertiary }}>
						{t.issuedLabel}
					</dt>
					<dd className="mt-0.5" style={{ color: ds.text.secondary }}>
						<BdiLtr>{formatDualTime(warning.sentAt)}</BdiLtr>
					</dd>
				</div>
				<div>
					<dt className="font-bold" style={{ color: ds.text.tertiary }}>
						{t.onsetLabel}
					</dt>
					<dd className="mt-0.5" style={{ color: ds.text.secondary }}>
						<BdiLtr>{formatDualTime(warning.onsetAt)}</BdiLtr>
					</dd>
				</div>
				<div>
					<dt className="font-bold" style={{ color: ds.text.tertiary }}>
						{t.expiresLabel}
					</dt>
					<dd className="mt-0.5" style={{ color: ds.text.secondary }}>
						<BdiLtr>{warning.missingExpiry ? 'No expiry stated by issuer' : formatDualTime(warning.expiresAt)}</BdiLtr>
					</dd>
				</div>
			</dl>

			<div
				className="flex flex-wrap items-center justify-between gap-2 text-xs pt-2 border-t"
				style={{ borderColor: ds.surface.borderSubtle }}
			>
				<span style={{ color: ds.text.tertiary }}>{warning.attribution}</span>
				{bulletinHref && (
					<a
						href={bulletinHref}
						target="_blank"
						rel="noopener noreferrer"
						className="min-h-[36px] inline-flex items-center gap-1.5 text-blue-400 font-bold underline underline-offset-2 hover:text-blue-300"
					>
						<span>{t.originalBulletinLink}</span>
						<ExternalLink size={13} aria-hidden="true" />
					</a>
				)}
			</div>
		</article>
	);
}

export default function NearMeView({
	onOpenExploreEvents,
	highlightedWarningId = null,
	notificationTarget = null,
}: NearMeViewProps) {
	const { locale, t } = useLocale();
	const ds = useDesignSystem();

	const [savedPlaces, setSavedPlaces] = useState<SelectedPlace[]>(() => loadSavedPlaces());
	const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(() => {
		const saved = loadSavedPlaces()[0] ?? null;
		if (typeof window !== 'undefined') {
			const sp = new URLSearchParams(window.location.search);
			const qLat = Number(sp.get('lat'));
			const qLng = Number(sp.get('lng'));
			const qCountry = sp.get('country');
			const qPlace = sp.get('place');
			if (Number.isFinite(qLat) && Number.isFinite(qLng) && sp.has('lat') && sp.has('lng')) {
				const built = buildManualPlace(qLat, qLng, qCountry);
				return qPlace && qPlace.trim() ? { ...built, label: qPlace.trim().slice(0, 120) } : built;
			}
		}
		return saved;
	});
	const [countryOverride, setCountryOverride] = useState<string>('');
	const [presentJurisdiction, setPresentJurisdiction] = useState<string>(() => {
		try {
			return window.localStorage.getItem(PRESENT_JURISDICTION_STORAGE_KEY) ?? '';
		} catch {
			return '';
		}
	});

	const [loading, setLoading] = useState(false);
	const [warningsData, setWarningsData] = useState<WarningsApiResponse | null>(null);
	const [offlineState, setOfflineState] = useState<OfflineWarningsState | null>(null);
	const [networkError, setNetworkError] = useState<string | null>(null);
	const [confirmingWipe, setConfirmingWipe] = useState(false);
	const [wipeNotice, setWipeNotice] = useState<string | null>(null);

	const [appliedNotificationNonce, setAppliedNotificationNonce] = useState<number>(
		() => notificationTarget?.nonce ?? 0,
	);

	// React to notification click or popstate targeting a new place/warning in an existing window
	if (
		notificationTarget &&
		typeof notificationTarget.nonce === 'number' &&
		notificationTarget.nonce > 0 &&
		notificationTarget.nonce !== appliedNotificationNonce
	) {
		setAppliedNotificationNonce(notificationTarget.nonce);
		const { lat, lng, countryCode, placeName } = notificationTarget;
		if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
			const built = buildManualPlace(lat, lng, countryCode ?? null);
			const nextPlace =
				placeName && placeName.trim() ? { ...built, label: placeName.trim().slice(0, 120) } : built;
			setSelectedPlace(nextPlace);
			setCountryOverride('');
		}
	}

	const effectiveCountry = (countryOverride || selectedPlace?.countryCode || '').toUpperCase() || null;
	const activeTargetWarningId = notificationTarget?.warningId ?? highlightedWarningId ?? null;
	const activeNoticeStatus = notificationTarget?.noticeStatus ?? null;
	const targetWarningPresent = Boolean(
		activeTargetWarningId &&
			warningsData?.warnings.some(
				(w) => w.identifier === activeTargetWarningId || w.id === activeTargetWarningId,
			),
	);

	const loadWarningsForPlace = useCallback(
		async (place: SelectedPlace | null, country: string | null, signal?: AbortSignal) => {
			if (!place) {
				setWarningsData(null);
				setOfflineState(null);
				return;
			}
			setLoading(true);
			const res = await fetchOfficialWarnings({
				lat: place.lat,
				lng: place.lng,
				countryCode: country,
				signal,
			});
			if (signal?.aborted) return;
			setWarningsData(res.data);
			setOfflineState(res.offlineState);
			setNetworkError(res.networkError);
			setLoading(false);
		},
		[],
	);

	useEffect(() => {
		if (!selectedPlace) return;
		const controller = new AbortController();
		const timer = setTimeout(() => {
			void loadWarningsForPlace(selectedPlace, effectiveCountry, controller.signal);
		}, 0);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [selectedPlace, effectiveCountry, loadWarningsForPlace]);

	const handleSelectPlace = (place: SelectedPlace) => {
		setSelectedPlace(place);
		// Only physical GPS capture may initialize presentJurisdiction when unconfirmed;
		// remote/manual monitored place selection NEVER silently alters emergency contact country.
		if (place.source === 'gps' && place.countryCode && !presentJurisdiction) {
			setPresentJurisdiction(place.countryCode);
			try {
				window.localStorage.setItem(PRESENT_JURISDICTION_STORAGE_KEY, place.countryCode);
			} catch {
				// ignore
			}
		}
	};

	const handlePresentJurisdictionChange = (code: string) => {
		setPresentJurisdiction(code);
		try {
			window.localStorage.setItem(PRESENT_JURISDICTION_STORAGE_KEY, code);
		} catch {
			// ignore
		}
	};

	const handleExecuteLocalWipe = async () => {
		await clearAllLocalResidentData();
		setSavedPlaces([]);
		setSelectedPlace(null);
		setCountryOverride('');
		setPresentJurisdiction('');
		setWarningsData(null);
		setOfflineState(null);
		setConfirmingWipe(false);
		setWipeNotice(t.clearLocalDataConfirm);
	};

	const badge = warningsData ? coverageBadgeInfo(warningsData.coverageStatus, t) : null;
	const BadgeIcon = badge?.icon ?? Info;

	return (
		<div
			data-testid="near-me-view"
			className="w-full px-4 py-5 sm:px-6 sm:py-7"
			style={{ color: ds.text.primary }}
		>
			<div className="max-w-6xl mx-auto space-y-6 pb-12">
				{/* Page Heading */}
				<header className="space-y-1">
					<h1 className="text-2xl sm:text-3xl font-black tracking-tight">{t.nearMeTitle}</h1>
					<p className="text-sm leading-relaxed max-w-3xl" style={{ color: ds.text.secondary }}>
						{t.nearMeSubtitle}
					</p>
				</header>

				{wipeNotice && (
					<div
						role="status"
						data-testid="wipe-status-notice"
						className="text-xs font-semibold px-4 py-3 rounded-xl border border-emerald-500/45 bg-emerald-500/12 text-emerald-400"
					>
						{wipeNotice}
					</div>
				)}

				{/* Step 1: Choose / View Monitored Place */}
				<PlaceSelector
					selectedPlace={selectedPlace}
					savedPlaces={savedPlaces}
					countryOverride={countryOverride}
					onSelectPlace={handleSelectPlace}
					onSavePlace={(p) => setSavedPlaces(upsertSavedPlace(p))}
					onDeleteSavedPlace={(id) => setSavedPlaces(deleteSavedPlace(id))}
					onCountryOverrideChange={setCountryOverride}
				/>

					{/* Step 2: Balanced Task-Based Grid — Row 1: Official Warnings + Emergency Contacts; Row 2: Private Location Card + Subscriptions & Map */}
				<div className="space-y-5">
					<div
						data-testid="near-me-primary-row"
						className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start"
					>
						<div className="lg:col-span-7 min-w-0">
							<section
								aria-labelledby="official-warnings-heading"
								data-testid="official-warnings-section"
								className="w-full flex flex-col gap-4 rounded-2xl p-4 sm:p-5 border shadow-sm"
								style={{
									background: 'var(--color-surface-elevated)',
									borderColor: ds.surface.border,
								}}
							>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div>
										<h2 id="official-warnings-heading" className="text-lg font-extrabold tracking-tight">
											{t.warningsSectionTitle}
										</h2>
										<p className="text-xs mt-0.5" style={{ color: ds.text.tertiary }}>
											{t.bulletinLanguageNote}
										</p>
									</div>
									{selectedPlace && (
										<button
											type="button"
											disabled={loading}
											onClick={() => void loadWarningsForPlace(selectedPlace, effectiveCountry)}
											data-testid="refresh-warnings-btn"
											className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-bold transition-colors hover:border-blue-400 disabled:opacity-60"
											style={{
												background: ds.surface.overlaySubtle,
												borderColor: ds.surface.border,
												color: ds.text.primary,
											}}
										>
											<RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
											<span>{t.refreshWarnings}</span>
										</button>
									)}
								</div>

								{!selectedPlace ? (
									<div
										className="rounded-xl p-5 border text-sm leading-relaxed"
										style={{
											background: 'var(--color-surface-card)',
											borderColor: ds.surface.borderSubtle,
											color: ds.text.secondary,
										}}
									>
										Search for a city, use your location, or enter coordinates above to check official authority warnings and coverage freshness.
									</div>
								) : (
									<>
										{offlineState && offlineState.status !== 'live' && (
											<div
												role="status"
												data-testid="offline-cached-banner"
												className="rounded-xl p-3.5 border border-amber-500/50 bg-amber-500/12 text-xs space-y-1"
												style={{ color: ds.text.primary }}
											>
												<div className="flex items-center gap-2 font-bold text-amber-400">
													<WifiOff size={15} className="shrink-0" aria-hidden="true" />
													<span>
														{offlineState.status === 'empty_offline' ? t.offlineFirstVisit : t.offlineCachedNotice}
													</span>
												</div>
												{offlineState.entry && (
													<div style={{ color: ds.text.secondary }}>
														Cached snapshot time: <BdiLtr mono>{formatDualTime(offlineState.entry.cachedAt, locale)}</BdiLtr>
													</div>
												)}
												{offlineState.status === 'cached_expired' && (
													<div className="font-semibold text-amber-400">{t.offlineExpiredNotice}</div>
												)}
												{networkError && <div style={{ color: ds.text.tertiary }}>Connection status: {networkError}</div>}
											</div>
										)}

										{loading && !warningsData ? (
											<p className="text-sm py-3" style={{ color: ds.text.secondary }}>
												Checking official alerting authorities…
											</p>
										) : warningsData && badge ? (
											<div className="flex flex-col gap-4">
												{activeTargetWarningId && !targetWarningPresent && (
													<div
														role="status"
														data-testid="notification-warning-status"
														data-notice-status={activeNoticeStatus === 'cancelled' ? 'cancelled' : 'inactive'}
														className="rounded-xl p-3.5 border border-blue-500/45 bg-blue-500/12 text-xs leading-relaxed flex items-start gap-2.5"
														style={{ color: ds.text.primary }}
													>
														<Info size={16} className="shrink-0 mt-0.5 text-blue-400" aria-hidden="true" />
														<span>
															{(activeNoticeStatus === 'cancelled'
																? t.notifCancelledNotice
																: t.notifExpiredOrInactiveNotice
															).replace('{id}', activeTargetWarningId)}
														</span>
													</div>
												)}

												<div
													role="status"
													data-testid="warnings-coverage-banner"
													className={`rounded-xl p-4 border ${badge.tone} flex items-start gap-3`}
													style={{ color: ds.text.primary }}
												>
													<BadgeIcon size={20} className={`shrink-0 mt-0.5 ${badge.iconColor}`} aria-hidden="true" />
													<div className="space-y-1 text-xs min-w-0">
														<div className="font-extrabold text-sm">{badge.label}</div>
														<div className="leading-relaxed" style={{ color: ds.text.secondary }}>
															{warningsData.coverageExplanation}
														</div>
														<div style={{ color: ds.text.tertiary }}>
															{t.lastCheckedLabel}: <BdiLtr mono>{formatDualTime(warningsData.query.checkedAt, locale)}</BdiLtr>
														</div>
													</div>
												</div>

												{warningsData.warnings.length > 0 && (
													<div className="space-y-3.5" data-testid="warnings-list">
														{warningsData.warnings.map((w) => (
															<WarningCard
																key={w.id}
																warning={w}
																isOfflineExpired={offlineState?.expiredWarningIds.includes(w.id) ?? false}
																isHighlighted={activeTargetWarningId === w.identifier || activeTargetWarningId === w.id}
															/>
														))}
													</div>
												)}

												{warningsData.sources.length > 0 && (
													<div className="space-y-2 pt-3 border-t" style={{ borderColor: ds.surface.borderSubtle }}>
														<h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: ds.text.tertiary }}>
															{t.authoritySourceCoverageHeading}
														</h3>
														<div className="grid grid-cols-1 gap-2">
															{warningsData.sources.map((src) => (
																<div
																	key={src.sourceId}
																	className="rounded-xl p-3 border text-xs space-y-1"
																	style={{
																		background: 'var(--color-surface-card)',
																		borderColor: ds.surface.borderSubtle,
																	}}
																>
																	<div className="flex flex-wrap items-center justify-between gap-2">
																		<span className="font-bold" style={{ color: ds.text.primary }}>
																			{src.authorityName}
																		</span>
																		<span
																			className={`uppercase text-[10px] font-bold px-2 py-0.5 rounded-md border ${
																				src.status === 'ok' || src.status === 'not_modified'
																					? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/35'
																					: 'bg-amber-500/15 text-amber-400 border-amber-500/35'
																			}`}
																		>
																			{src.status}
																		</span>
																	</div>
																	<div className="text-[11px] leading-relaxed" style={{ color: ds.text.tertiary }}>
																		{src.attribution}
																		{src.lastSuccessAt ? (
																			<>
																				{' '}
																				· {t.lastVerifiedLabel}: <BdiLtr mono>{formatDualTime(src.lastSuccessAt, locale)}</BdiLtr>
																			</>
																		) : null}
																	</div>
																	{src.unsupportedHazards.length > 0 && (
																		<div className="text-[11px]" style={{ color: ds.text.tertiary }}>
																			Not covered by this feed: {src.unsupportedHazards.join(', ')}
																		</div>
																	)}
																	{src.errorReason && (
																		<div className="text-[11px] text-amber-400">Source note: {src.errorReason}</div>
																	)}
																</div>
															))}
														</div>
													</div>
												)}
											</div>
										) : null}
									</>
								)}
							</section>
						</div>

						<div className="lg:col-span-5 min-w-0">
							<LocationHelpPanel
								sectionMode="contacts"
								monitoredPlace={selectedPlace}
								presentJurisdiction={presentJurisdiction}
								onPresentJurisdictionChange={handlePresentJurisdictionChange}
							/>
						</div>
					</div>

					<div
						data-testid="near-me-secondary-row"
						className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start"
					>
						<div className="lg:col-span-7 min-w-0">
							<PrivateLocationCard monitoredPlace={selectedPlace} />
						</div>

						<div className="lg:col-span-5 space-y-5 min-w-0">
							<SubscriptionOptIn monitoredPlace={selectedPlace} effectiveCountry={effectiveCountry} />

							<section
								aria-labelledby="research-callout-heading"
								className="rounded-2xl p-4 sm:p-5 border flex flex-col gap-3 shadow-sm"
								style={{
									background: 'var(--color-surface-elevated)',
									borderColor: ds.surface.border,
								}}
							>
								<div className="space-y-1">
									<h2
										id="research-callout-heading"
										className="text-sm font-bold flex items-center gap-2"
										style={{ color: ds.text.primary }}
									>
										<Compass size={16} className="text-blue-400 shrink-0" aria-hidden="true" />
										<span>{t.researchNoticeTitle}</span>
									</h2>
									<p className="text-xs leading-relaxed" style={{ color: ds.text.secondary }}>
										{t.researchNoticeBody}
									</p>
								</div>
								<div>
									<button
										type="button"
										onClick={onOpenExploreEvents}
										data-testid="near-me-open-explore-btn"
										className="min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border hover:border-blue-400 transition-colors"
										style={{
											background: ds.surface.overlaySubtle,
											borderColor: ds.surface.border,
											color: ds.text.primary,
										}}
									>
										<Compass size={14} aria-hidden="true" />
										<span>{t.openExploreEvents}</span>
									</button>
								</div>
							</section>
						</div>
					</div>
				</div>

				{/* Footer Local Data & Privacy Settings (separated from ordinary place selection, with confirmation) */}
				<section
					aria-labelledby="local-data-settings-heading"
					data-testid="local-data-settings"
					className="rounded-2xl p-4 sm:p-5 border flex flex-col sm:flex-row sm:items-center justify-between gap-4"
					style={{
						background: 'var(--color-surface-card)',
						borderColor: ds.surface.borderSubtle,
					}}
				>
					<div className="space-y-1 max-w-2xl">
						<h2 id="local-data-settings-heading" className="text-xs font-bold uppercase tracking-wide" style={{ color: ds.text.secondary }}>
							{t.localDataSettingsHeading}
						</h2>
						<p className="text-xs leading-relaxed" style={{ color: ds.text.tertiary }}>
							{t.localDataSettingsBody}
						</p>
					</div>

					{!confirmingWipe ? (
						<button
							type="button"
							onClick={() => setConfirmingWipe(true)}
							data-testid="clear-local-data-btn"
							className="min-h-[42px] shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs font-bold"
						>
							<Trash2 size={14} aria-hidden="true" />
							<span>{t.clearLocalData}</span>
						</button>
					) : (
						<div className="flex flex-col sm:items-end gap-2 shrink-0" role="group" aria-label={t.confirmClearLocalDataPrompt}>
							<p className="text-xs font-semibold text-red-400">{t.confirmClearLocalDataPrompt}</p>
							<div className="flex flex-wrap items-center gap-2">
								<button
									type="button"
									onClick={() => void handleExecuteLocalWipe()}
									data-testid="confirm-clear-local-data-btn"
									className="min-h-[40px] px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold"
								>
									{t.confirmClearLocalDataAction}
								</button>
								<button
									type="button"
									onClick={() => setConfirmingWipe(false)}
									data-testid="cancel-clear-local-data-btn"
									className="min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-semibold"
									style={{ borderColor: ds.surface.border, color: ds.text.primary }}
								>
									{t.cancelAction}
								</button>
							</div>
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
