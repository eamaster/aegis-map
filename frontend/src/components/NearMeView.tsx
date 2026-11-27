import { useCallback, useEffect, useState } from 'react';
import {
	AlertTriangle,
	CheckCircle2,
	Clock,
	ExternalLink,
	Globe,
	Info,
	RefreshCw,
	ShieldOff,
	Trash2,
	WifiOff,
} from 'lucide-react';
import type { OfficialWarningItem, WarningsApiResponse, WarningCoverageStatus } from '../../../shared/contracts';
import { useLocale } from '../hooks/useLocale';
import { useDesignSystem } from '../hooks/useDesignSystem';
import {
	deleteSavedPlace,
	loadSavedPlaces,
	PRESENT_JURISDICTION_STORAGE_KEY,
	upsertSavedPlace,
	type SelectedPlace,
} from '../utils/places';
import { clearAllLocalResidentData, type OfflineWarningsState } from '../utils/offlineCache';
import { fetchOfficialWarnings } from '../utils/warningsClient';
import { BdiLtr } from './BdiLtr';
import LocationHelpPanel from './LocationHelpPanel';
import PlaceSelector from './PlaceSelector';
import SubscriptionOptIn from './SubscriptionOptIn';

interface NearMeViewProps {
	onOpenExploreEvents: () => void;
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

function formatDualTime(iso: string | null | undefined): string {
	if (!iso) return 'Not specified by issuer';
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return iso;
	const d = new Date(ms);
	const utc = d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
	try {
		const local = new Intl.DateTimeFormat(undefined, {
			year: 'numeric',
			month: 'short',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			timeZoneName: 'short',
		}).format(d);
		return `${utc} (${local})`;
	} catch {
		return utc;
	}
}

function coverageBadgeInfo(status: WarningCoverageStatus, t: ReturnType<typeof useLocale>['t']) {
	switch (status) {
		case 'active_warnings':
			return { label: t.coverageActive, tone: 'border-red-500/50 bg-red-500/15 text-red-200', icon: AlertTriangle };
		case 'checked_no_warnings':
			return { label: t.coverageEmpty, tone: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200', icon: CheckCircle2 };
		case 'partial_coverage':
			return { label: t.coveragePartial, tone: 'border-amber-500/50 bg-amber-500/15 text-amber-200', icon: AlertTriangle };
		case 'stale':
			return { label: t.coverageStale, tone: 'border-amber-500/50 bg-amber-500/15 text-amber-200', icon: Clock };
		case 'source_unavailable':
			return { label: t.coverageUnavailable, tone: 'border-red-500/50 bg-red-500/15 text-red-200', icon: ShieldOff };
		default:
			return { label: t.coverageUnsupported, tone: 'border-slate-500/50 bg-slate-500/15 text-slate-200', icon: Info };
	}
}

function WarningCard({
	warning,
	isOfflineExpired,
}: {
	warning: OfficialWarningItem;
	isOfflineExpired: boolean;
}) {
	const { t } = useLocale();
	const ds = useDesignSystem();
	const [langIdx, setLangIdx] = useState(0);
	const block = warning.translations[langIdx] ?? warning.translations[0];
	const bulletinHref = sanitizeExternalUrl(block?.web ?? warning.bulletinUrl ?? warning.issuerUrl);

	return (
		<article
			data-testid={`warning-card-${warning.id}`}
			className="rounded-xl p-4 border space-y-3"
			style={{
				background: ds.surface.overlay,
				borderColor:
					warning.severity === 'extreme' || warning.severity === 'severe'
						? 'rgba(239, 68, 68, 0.55)'
						: ds.surface.border,
			}}
		>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="space-y-1">
					<div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide">
						<span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40">
							{warning.severity}
						</span>
						<span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30">
							{warning.lifecycleState}
						</span>
						<span className="px-2 py-0.5 rounded bg-slate-500/20 text-slate-200 border border-slate-500/30">
							{t.bulletinLanguageTag}: <BdiLtr mono>{block?.language ?? warning.primaryLanguage}</BdiLtr>
						</span>
						{isOfflineExpired && (
							<span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/40">
								EXPIRED
							</span>
						)}
					</div>
					<h3 className="text-base font-bold" style={{ color: ds.text.primary }} lang={block?.language}>
						{block?.headline || block?.event || warning.category}
					</h3>
					<p className="text-xs" style={{ color: ds.text.tertiary }}>
						{warning.issuerName} · {warning.matchNote}
						{warning.matchUncertain ? ' (area match uncertain — verify area description below)' : ''}
					</p>
				</div>

				{warning.translations.length > 1 && (
					<div className="flex items-center gap-1" role="group" aria-label="Official bulletin language">
						{warning.translations.map((tr, idx) => (
							<button
								key={`${warning.id}-lang-${tr.language}-${idx}`}
								type="button"
								onClick={() => setLangIdx(idx)}
								className={`px-2 py-1 rounded text-xs font-semibold border ${
									idx === langIdx ? 'bg-blue-600 text-white border-blue-500' : 'border-slate-600 text-slate-300'
								}`}
							>
								{tr.language.toUpperCase()}
							</button>
						))}
					</div>
				)}
			</div>

			{block?.areaDesc && (
				<div className="text-xs">
					<span className="font-semibold" style={{ color: ds.text.secondary }}>
						{t.affectedAreaHeading}:{' '}
					</span>
					<span style={{ color: ds.text.primary }} lang={block.language}>
						{block.areaDesc}
					</span>
				</div>
			)}

			{block?.description && (
				<p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: ds.text.primary }} lang={block.language}>
					{block.description}
				</p>
			)}

			{block?.instruction && (
				<div
					className="rounded-lg p-3 border border-amber-500/40 bg-amber-500/10"
					lang={block.language}
				>
					<div className="text-xs font-bold uppercase tracking-wide text-amber-300 mb-1">
						{t.issuerInstructionsHeading}
					</div>
					<p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: ds.text.primary }}>
						{block.instruction}
					</p>
				</div>
			)}

			<dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs pt-2 border-t" style={{ borderColor: ds.surface.borderSubtle }}>
				<div>
					<dt className="font-semibold" style={{ color: ds.text.tertiary }}>{t.issuedLabel}</dt>
					<dd style={{ color: ds.text.secondary }}><BdiLtr>{formatDualTime(warning.sentAt)}</BdiLtr></dd>
				</div>
				<div>
					<dt className="font-semibold" style={{ color: ds.text.tertiary }}>{t.onsetLabel}</dt>
					<dd style={{ color: ds.text.secondary }}><BdiLtr>{formatDualTime(warning.onsetAt)}</BdiLtr></dd>
				</div>
				<div>
					<dt className="font-semibold" style={{ color: ds.text.tertiary }}>{t.expiresLabel}</dt>
					<dd style={{ color: ds.text.secondary }}>
						<BdiLtr>{warning.missingExpiry ? 'No expiry stated by issuer' : formatDualTime(warning.expiresAt)}</BdiLtr>
					</dd>
				</div>
			</dl>

			<div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1">
				<span style={{ color: ds.text.tertiary }}>{warning.attribution}</span>
				{bulletinHref && (
					<a
						href={bulletinHref}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1 text-blue-400 font-semibold hover:underline"
					>
						<span>{t.originalBulletinLink}</span>
						<ExternalLink size={12} aria-hidden="true" />
					</a>
				)}
			</div>
		</article>
	);
}

export default function NearMeView({ onOpenExploreEvents }: NearMeViewProps) {
	const { locale, t } = useLocale();
	const ds = useDesignSystem();

	const [savedPlaces, setSavedPlaces] = useState<SelectedPlace[]>(() => loadSavedPlaces());
	const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(() => loadSavedPlaces()[0] ?? null);
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
	const [wipeNotice, setWipeNotice] = useState<string | null>(null);

	const effectiveCountry = (countryOverride || selectedPlace?.countryCode || '').toUpperCase() || null;

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

	const handleClearLocalData = async () => {
		await clearAllLocalResidentData();
		setSavedPlaces([]);
		setSelectedPlace(null);
		setPresentJurisdiction('');
		setWarningsData(null);
		setOfflineState(null);
		setWipeNotice(t.clearLocalDataConfirm);
	};

	const badge = warningsData ? coverageBadgeInfo(warningsData.coverageStatus, t) : null;
	const BadgeIcon = badge?.icon ?? Info;

	return (
		<div
			data-testid="near-me-view"
			className="h-full overflow-y-auto px-4 py-6 sm:px-6"
			style={{ color: ds.text.primary }}
		>
			<div className="max-w-4xl mx-auto space-y-6 pb-12">
				<header className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h1 className="text-2xl font-black tracking-tight">{t.nearMeTitle}</h1>
						<p className="text-sm mt-1" style={{ color: ds.text.secondary }}>
							{t.nearMeSubtitle}
						</p>
					</div>
					<div className="flex items-center gap-2 text-xs">
						<span className="px-2.5 py-1 rounded-md border" style={{ borderColor: ds.surface.border, color: ds.text.tertiary }}>
							{t.interfaceLanguageTag}: <BdiLtr mono>{locale.toUpperCase()}</BdiLtr>
						</span>
						<button
							type="button"
							onClick={handleClearLocalData}
							data-testid="clear-local-data-btn"
							className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10 text-xs font-semibold"
						>
							<Trash2 size={13} aria-hidden="true" />
							<span>{t.clearLocalData}</span>
						</button>
					</div>
				</header>

				{wipeNotice && (
					<div role="status" data-testid="wipe-status-notice" className="text-xs px-3 py-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
						{wipeNotice}
					</div>
				)}

				<PlaceSelector
					selectedPlace={selectedPlace}
					savedPlaces={savedPlaces}
					countryOverride={countryOverride}
					onSelectPlace={handleSelectPlace}
					onSavePlace={(p) => setSavedPlaces(upsertSavedPlace(p))}
					onDeleteSavedPlace={(id) => setSavedPlaces(deleteSavedPlace(id))}
					onCountryOverrideChange={setCountryOverride}
				/>

				{/* Section 1: Official Warnings */}
				<section
					aria-labelledby="official-warnings-heading"
					data-testid="official-warnings-section"
					className="rounded-xl p-4 sm:p-5 space-y-4"
					style={{
						background: ds.surface.elevated,
						border: `1px solid ${ds.surface.border}`,
					}}
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div>
							<h2 id="official-warnings-heading" className="text-base font-bold">
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
								className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold"
								style={{
									background: ds.surface.overlay,
									borderColor: ds.surface.border,
									color: ds.text.primary,
								}}
							>
								<RefreshCw size={13} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
								<span>{t.refreshWarnings}</span>
							</button>
						)}
					</div>

					{!selectedPlace ? (
						<p className="text-sm" style={{ color: ds.text.secondary }}>
							Select a saved place, search for a city, request GPS, or enter coordinates above to check official authority warnings.
						</p>
					) : (
						<>
							<div className="text-xs flex flex-wrap gap-3" style={{ color: ds.text.secondary }}>
								<span>
									Monitoring: <strong>{selectedPlace.label}</strong>
								</span>
								<span>
									<BdiLtr mono>
										{selectedPlace.lat.toFixed(4)}, {selectedPlace.lng.toFixed(4)}
									</BdiLtr>
								</span>
								{selectedPlace.accuracyMeters != null && (
									<span>
										{t.gpsAccuracyLabel}: <BdiLtr mono>±{selectedPlace.accuracyMeters} m</BdiLtr>
									</span>
								)}
							</div>

							{offlineState?.status === 'empty_offline' && networkError && (
								<div
									role="status"
									data-testid="offline-empty-notice"
									className="flex items-start gap-2 rounded-lg p-3 border border-amber-500/40 bg-amber-500/10 text-xs"
								>
									<WifiOff size={15} className="shrink-0 text-amber-400 mt-0.5" aria-hidden="true" />
									<div>
										<div className="font-bold">{t.offlineFirstVisit}</div>
										<div className="mt-0.5" style={{ color: ds.text.tertiary }}>
											({networkError})
										</div>
									</div>
								</div>
							)}

							{(offlineState?.status === 'cached_valid' || offlineState?.status === 'cached_expired') && (
								<div
									role="status"
									data-testid="offline-cached-banner"
									className="flex items-start gap-2 rounded-lg p-3 border border-amber-500/40 bg-amber-500/10 text-xs"
								>
									<WifiOff size={15} className="shrink-0 text-amber-400 mt-0.5" aria-hidden="true" />
									<div>
										<div className="font-bold">
											{offlineState.status === 'cached_expired' ? t.offlineExpiredNotice : t.offlineCachedNotice}
										</div>
										<div className="mt-0.5" style={{ color: ds.text.tertiary }}>
											Cached at <BdiLtr>{formatDualTime(offlineState.entry?.cachedAt)}</BdiLtr>
										</div>
									</div>
								</div>
							)}

							{badge && warningsData && (
								<div
									role="status"
									data-testid="warnings-coverage-banner"
									data-coverage-status={warningsData.coverageStatus}
									className={`rounded-lg p-3 border text-xs flex items-start gap-2.5 ${badge.tone}`}
								>
									<BadgeIcon size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
									<div className="space-y-1">
										<div className="font-bold text-sm">{badge.label}</div>
										<div>{warningsData.coverageExplanation}</div>
										<div className="text-[11px] opacity-85">
											{t.lastCheckedLabel}: <BdiLtr>{formatDualTime(warningsData.query.checkedAt)}</BdiLtr>
										</div>
									</div>
								</div>
							)}

							{warningsData && warningsData.warnings.length > 0 && (
								<div className="space-y-3" data-testid="warnings-list">
									{warningsData.warnings.map((w) => (
										<WarningCard
											key={w.id}
											warning={w}
											isOfflineExpired={offlineState?.expiredWarningIds.includes(w.id) ?? false}
										/>
									))}
								</div>
							)}

							{warningsData && warningsData.sources.length > 0 && (
								<div className="space-y-2 pt-2 border-t" style={{ borderColor: ds.surface.borderSubtle }}>
									<div className="text-xs font-semibold" style={{ color: ds.text.secondary }}>
										Authority Source Coverage & Attribution
									</div>
									<ul className="space-y-1.5 text-xs" data-testid="warning-sources-list">
										{warningsData.sources.map((src) => (
											<li
												key={src.sourceId}
												className="rounded-lg p-2.5 border"
												style={{ background: ds.surface.overlay, borderColor: ds.surface.borderSubtle }}
											>
												<div className="flex flex-wrap items-center justify-between gap-2">
													<span className="font-semibold">{src.authorityName}</span>
													<span className="uppercase font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-200">
														{src.status}
													</span>
												</div>
												<div className="text-[11px] mt-1" style={{ color: ds.text.tertiary }}>
													{src.attribution} · Last success:{' '}
													<BdiLtr>{formatDualTime(src.lastSuccessAt)}</BdiLtr>
												</div>
												{src.unsupportedHazards.length > 0 && (
													<div className="text-[11px] mt-0.5" style={{ color: ds.text.tertiary }}>
														Not covered by this feed: {src.unsupportedHazards.join(', ')}
													</div>
												)}
											</li>
										))}
									</ul>
								</div>
							)}
						</>
					)}
				</section>

				{/* Section 2: Emergency Contacts & Location Handoff */}
				<LocationHelpPanel
					monitoredPlace={selectedPlace}
					presentJurisdiction={presentJurisdiction}
					onPresentJurisdictionChange={handlePresentJurisdictionChange}
				/>

				{/* Section 2.5: Opt-In Official Warning Alerts */}
				<SubscriptionOptIn monitoredPlace={selectedPlace} />

				{/* Section 3: Explicit Separation of Scientific Research Observations */}
				<section
					aria-labelledby="research-separation-heading"
					className="rounded-xl p-4 border flex flex-wrap items-center justify-between gap-3"
					style={{
						background: ds.surface.overlay,
						borderColor: ds.surface.border,
					}}
				>
					<div className="space-y-1 max-w-xl">
						<h2 id="research-separation-heading" className="text-sm font-bold flex items-center gap-2">
							<Globe size={16} className="text-blue-400" aria-hidden="true" />
							<span>{t.researchNoticeTitle}</span>
						</h2>
						<p className="text-xs" style={{ color: ds.text.secondary }}>
							{t.researchNoticeBody}
						</p>
					</div>
					<button
						type="button"
						onClick={onOpenExploreEvents}
						data-testid="open-explore-events-btn"
						className="px-4 py-2 rounded-lg text-xs font-semibold border border-blue-500/40 bg-blue-500/15 text-blue-300 hover:bg-blue-500/25"
					>
						{t.openExploreEvents}
					</button>
				</section>
			</div>
		</div>
	);
}
