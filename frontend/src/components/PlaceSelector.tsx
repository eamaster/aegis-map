import { useRef, useState } from 'react';
import {
	Bookmark,
	BookmarkCheck,
	ChevronDown,
	Compass,
	Globe2,
	MapPin,
	Navigation,
	RefreshCw,
	Search,
	Trash2,
	WifiOff,
} from 'lucide-react';
import { useLocale } from '../hooks/useLocale';
import { useDesignSystem } from '../hooks/useDesignSystem';
import {
	buildManualPlace,
	formatCoordinatesLtr,
	parseFlexibleCoordinates,
	searchPlaces,
	type SelectedPlace,
} from '../utils/places';
import { BdiLtr } from './BdiLtr';

interface PlaceSelectorProps {
	selectedPlace: SelectedPlace | null;
	savedPlaces: SelectedPlace[];
	countryOverride: string;
	onSelectPlace: (place: SelectedPlace) => void;
	onSavePlace: (place: SelectedPlace) => void;
	onDeleteSavedPlace: (id: string) => void;
	onCountryOverrideChange: (countryCode: string) => void;
}

const COUNTRY_OPTIONS: ReadonlyArray<{ code: string; label: string }> = [
	{ code: '', label: 'Auto' },
	{ code: 'MY', label: 'Malaysia (MY — MET Malaysia)' },
	{ code: 'NO', label: 'Norway (NO — MET Norway)' },
	{ code: 'SJ', label: 'Svalbard / Norway (SJ — MET Norway)' },
	{ code: 'IR', label: 'Iran (IR — IRIMO)' },
	{ code: 'IN', label: 'India (IN — NDMA SACHET)' },
	{ code: 'US', label: 'United States (US)' },
	{ code: 'GB', label: 'United Kingdom (GB)' },
	{ code: 'AU', label: 'Australia (AU)' },
	{ code: 'SG', label: 'Singapore (SG)' },
];

export default function PlaceSelector({
	selectedPlace,
	savedPlaces,
	countryOverride,
	onSelectPlace,
	onSavePlace,
	onDeleteSavedPlace,
	onCountryOverrideChange,
}: PlaceSelectorProps) {
	const { locale, t } = useLocale();
	const ds = useDesignSystem();
	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const candidateRefs = useRef<Array<HTMLButtonElement | null>>([]);

	const [isEditingPlace, setIsEditingPlace] = useState<boolean>(() => !selectedPlace);
	const [query, setQuery] = useState('');
	const [coordInput, setCoordInput] = useState('');
	const [coordError, setCoordError] = useState<string | null>(null);
	const [candidates, setCandidates] = useState<SelectedPlace[]>([]);
	const [hasSearched, setHasSearched] = useState(false);
	const [searching, setSearching] = useState(false);
	const [offlineSearchNote, setOfflineSearchNote] = useState(false);
	const [gpsLoading, setGpsLoading] = useState(false);
	const [gpsStatus, setGpsStatus] = useState<{ message: string; isError: boolean } | null>(null);
	const [showManualCoords, setShowManualCoords] = useState(false);
	const [showAuthorityOverride, setShowAuthorityOverride] = useState(() => Boolean(countryOverride));

	const matchedSaved = selectedPlace
		? savedPlaces.find(
				(sp) =>
					sp.id === selectedPlace.id ||
					(Math.abs(sp.lat - selectedPlace.lat) < 0.001 && Math.abs(sp.lng - selectedPlace.lng) < 0.001),
			)
		: undefined;

	const commitSelection = (place: SelectedPlace) => {
		onSelectPlace(place);
		setCandidates([]);
		setHasSearched(false);
		setIsEditingPlace(false);
	};

	const runSearch = async () => {
		if (!query.trim()) {
			searchInputRef.current?.focus();
			return;
		}
		setSearching(true);
		setCoordError(null);
		setHasSearched(true);
		const res = await searchPlaces(query, { language: locale });
		setCandidates(res.candidates);
		setOfflineSearchNote(res.usedOfflineFallback);
		setSearching(false);
		if (res.candidates.length === 1) {
			commitSelection(res.candidates[0]);
		}
	};

	const handleSearchSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		await runSearch();
	};

	const handleApplyCoords = (e: React.FormEvent) => {
		e.preventDefault();
		const parsed = parseFlexibleCoordinates(coordInput);
		if (!parsed.ok) {
			setCoordError(parsed.reason);
			return;
		}
		setCoordError(null);
		const place = buildManualPlace(parsed.lat, parsed.lng, countryOverride || null);
		commitSelection(place);
	};

	const handleUseGps = () => {
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			setGpsStatus({ message: t.gpsStatusUnavailable, isError: true });
			setShowManualCoords(true);
			return;
		}
		setGpsLoading(true);
		setGpsStatus({ message: t.gpsRequesting, isError: false });
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				setGpsLoading(false);
				const { latitude, longitude, accuracy } = pos.coords;
				const base = buildManualPlace(latitude, longitude, countryOverride || null);
				const gpsPlace: SelectedPlace = {
					...base,
					id: `gps:${latitude.toFixed(4)}:${longitude.toFixed(4)}`,
					label: `${base.countryName ? `${base.countryName} · ` : ''}${formatCoordinatesLtr(latitude, longitude)}`,
					source: 'gps',
					accuracyMeters: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
					capturedAt: new Date(pos.timestamp || Date.now()).toISOString(),
				};
				setGpsStatus(
					accuracy > 5000 ? { message: t.gpsStatusLowAccuracy, isError: true } : null,
				);
				commitSelection(gpsPlace);
			},
			(err) => {
				setGpsLoading(false);
				setShowManualCoords(true);
				if (err.code === err.PERMISSION_DENIED) {
					setGpsStatus({ message: t.gpsStatusDenied, isError: true });
				} else if (err.code === err.TIMEOUT) {
					setGpsStatus({ message: t.gpsStatusTimeout, isError: true });
				} else {
					setGpsStatus({ message: t.gpsStatusUnavailable, isError: true });
				}
			},
			{ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
		);
	};

	const showPickerForm = !selectedPlace || isEditingPlace;

	return (
		<section
			aria-labelledby="place-selector-heading"
			data-testid="place-selector"
			className="rounded-2xl p-4 sm:p-5 space-y-4 border shadow-sm"
			style={{
				background: 'var(--color-surface-elevated)',
				borderColor: ds.surface.border,
			}}
		>
			{/* Selected Place Summary Banner */}
			{selectedPlace && (
				<div
					data-testid="selected-place-summary"
					className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b"
					style={{ borderColor: ds.surface.borderSubtle }}
				>
					<div className="min-w-0 space-y-1">
						<div className="flex flex-wrap items-center gap-2">
							<span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-400">
								<MapPin size={14} aria-hidden="true" />
								<span>{t.monitoredPlaceLabel}</span>
							</span>
							{selectedPlace.countryCode && (
								<span
									className="px-2 py-0.5 rounded-md text-[11px] font-bold border"
									style={{
										background: ds.surface.overlaySubtle,
										borderColor: ds.surface.border,
										color: ds.text.secondary,
									}}
								>
									{selectedPlace.countryName
										? `${selectedPlace.countryName} (${selectedPlace.countryCode})`
										: selectedPlace.countryCode}
								</span>
							)}
							{countryOverride && (
								<span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/40">
									Override: {countryOverride}
								</span>
							)}
						</div>
						<h2
							id="place-selector-heading"
							className="text-lg sm:text-xl font-black tracking-tight break-words"
							style={{ color: ds.text.primary }}
						>
							{selectedPlace.label}
						</h2>
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: ds.text.tertiary }}>
							<BdiLtr mono>
								{selectedPlace.lat.toFixed(4)}, {selectedPlace.lng.toFixed(4)}
							</BdiLtr>
							{selectedPlace.accuracyMeters != null && (
								<span>
									{t.gpsAccuracyLabel}: <BdiLtr mono>±{selectedPlace.accuracyMeters} m</BdiLtr>
								</span>
							)}
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2 shrink-0">
						<button
							type="button"
							data-testid="change-place-btn"
							onClick={() => {
								setIsEditingPlace((prev) => !prev);
								setTimeout(() => searchInputRef.current?.focus(), 20);
							}}
							aria-expanded={showPickerForm}
							className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors hover:border-blue-400"
							style={{
								background: ds.surface.overlaySubtle,
								borderColor: ds.surface.border,
								color: ds.text.primary,
							}}
						>
							<Search size={14} aria-hidden="true" />
							<span>{t.changePlaceButton}</span>
						</button>

						<button
							type="button"
							data-testid="save-place-btn"
							aria-pressed={Boolean(matchedSaved)}
							onClick={() => {
								if (matchedSaved) {
									onDeleteSavedPlace(matchedSaved.id);
								} else {
									onSavePlace(selectedPlace);
								}
							}}
							className={`min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors ${
								matchedSaved
									? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-red-500/15 hover:text-red-300 hover:border-red-500/40'
									: 'hover:border-blue-400'
							}`}
							style={
								matchedSaved
									? undefined
									: {
											background: ds.surface.overlaySubtle,
											borderColor: ds.surface.border,
											color: ds.text.primary,
										}
							}
						>
							{matchedSaved ? (
								<>
									<BookmarkCheck size={14} aria-hidden="true" />
									<span>{t.removeSavedPlaceButton}</span>
								</>
							) : (
								<>
									<Bookmark size={14} aria-hidden="true" />
									<span>{t.saveCurrentPlace}</span>
								</>
							)}
						</button>
					</div>
				</div>
			)}

			{/* Primary Place Search & Location Picker */}
			{showPickerForm && (
				<div className="space-y-3.5">
					<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
						{!selectedPlace ? (
							<h2
								id="place-selector-heading"
								className="text-base font-bold flex items-center gap-2"
								style={{ color: ds.text.primary }}
							>
								<MapPin size={18} className="text-blue-400 shrink-0" aria-hidden="true" />
								<span>{t.searchPlaceLabel}</span>
							</h2>
						) : (
							<span className="text-xs font-bold uppercase tracking-wide" style={{ color: ds.text.secondary }}>
								{t.searchPlaceLabel}
							</span>
						)}

						<div className="flex flex-wrap items-center gap-2">
							<button
								type="button"
								onClick={handleUseGps}
								disabled={gpsLoading}
								data-testid="gps-request-btn"
								className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors hover:border-blue-400 disabled:opacity-60"
								style={{
									background: ds.surface.overlaySubtle,
									borderColor: ds.surface.border,
									color: ds.text.primary,
								}}
							>
								<Navigation size={14} className="text-blue-400 shrink-0" aria-hidden="true" />
								<span>{t.useGpsButton}</span>
							</button>
						</div>
					</div>

					{/* GPS error/status presented directly beside its control while keeping search & typed input intact */}
					{gpsStatus && (
						<div
							role="status"
							aria-live="polite"
							data-testid="gps-status-banner"
							className={`flex flex-wrap items-center justify-between gap-2 text-xs px-3.5 py-2.5 rounded-xl border ${
								gpsStatus.isError
									? 'border-amber-500/45 bg-amber-500/10 text-amber-200'
									: 'border-blue-500/40 bg-blue-500/10 text-blue-200'
							}`}
							style={ds.isDark ? undefined : { color: ds.text.primary }}
						>
							<span>{gpsStatus.message}</span>
							{gpsStatus.isError && (
								<button
									type="button"
									onClick={handleUseGps}
									className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border border-current/30 hover:bg-white/10"
								>
									<RefreshCw size={12} aria-hidden="true" />
									<span>Retry</span>
								</button>
							)}
						</div>
					)}

					<form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2.5">
						<div className="flex-1 min-w-0">
							<label htmlFor="near-me-search-input" className="block text-xs font-semibold mb-1" style={{ color: ds.text.secondary }}>
								{t.searchPlaceLabel}
							</label>
							<input
								ref={searchInputRef}
								id="near-me-search-input"
								data-testid="place-search-input"
								type="search"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'ArrowDown' && candidates.length > 0) {
										e.preventDefault();
										candidateRefs.current[0]?.focus();
									}
								}}
								placeholder={t.searchPlacePlaceholder}
								className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-sm border"
								style={{
									background: 'var(--color-surface-card)',
									borderColor: ds.surface.border,
									color: ds.text.primary,
								}}
							/>
						</div>
						<div className="flex items-end">
							<button
								type="submit"
								disabled={searching}
								data-testid="place-search-btn"
								className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white shadow-sm"
							>
								<Search size={16} aria-hidden="true" />
								<span>{searching ? '…' : t.searchButton}</span>
							</button>
						</div>
					</form>

					{offlineSearchNote && (
						<div
							role="status"
							data-testid="offline-search-notice"
							className="flex items-center justify-between gap-2 text-xs px-3.5 py-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10"
							style={{ color: ds.text.primary }}
						>
							<div className="flex items-center gap-2">
								<WifiOff size={14} className="shrink-0 text-amber-400" aria-hidden="true" />
								<span>{t.offlineSearchNotice}</span>
							</div>
							<button
								type="button"
								onClick={() => void runSearch()}
								className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border"
								style={{ borderColor: ds.surface.border, color: ds.text.primary }}
							>
								<RefreshCw size={12} aria-hidden="true" />
								<span>Retry</span>
							</button>
						</div>
					)}

					{candidates.length > 0 && (
						<div className="space-y-2" data-testid="place-candidates">
							<p className="text-xs font-semibold" style={{ color: ds.text.secondary }}>
								Select matching place ({candidates.length}):
							</p>
							<ul className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="listbox" aria-label="Matching places">
								{candidates.map((cand, idx) => (
									<li key={cand.id}>
										<button
											ref={(el) => {
												candidateRefs.current[idx] = el;
											}}
											type="button"
											onClick={() => commitSelection(cand)}
											onKeyDown={(e) => {
												if (e.key === 'ArrowDown') {
													e.preventDefault();
													candidateRefs.current[Math.min(candidates.length - 1, idx + 1)]?.focus();
												} else if (e.key === 'ArrowUp') {
													e.preventDefault();
													if (idx === 0) searchInputRef.current?.focus();
													else candidateRefs.current[idx - 1]?.focus();
												}
											}}
											data-testid={`place-candidate-${cand.countryCode ?? 'XX'}`}
											className="w-full min-h-[48px] text-start px-3.5 py-2.5 rounded-xl border text-xs transition-colors hover:border-blue-400"
											style={{
												background: 'var(--color-surface-card)',
												borderColor: ds.surface.border,
												color: ds.text.primary,
											}}
										>
											<div className="font-bold text-sm break-words">{cand.label}</div>
											<div className="text-[11px] mt-0.5 flex flex-wrap gap-1.5" style={{ color: ds.text.tertiary }}>
												<BdiLtr mono>
													{cand.lat.toFixed(3)}, {cand.lng.toFixed(3)}
												</BdiLtr>
												{cand.countryCode && <span>· {cand.countryCode}</span>}
												{cand.timezone && <span>· {cand.timezone}</span>}
											</div>
										</button>
									</li>
								))}
							</ul>
						</div>
					)}

					{hasSearched && !searching && candidates.length === 0 && (
						<p role="status" className="text-xs px-3 py-2 rounded-lg border" style={{ borderColor: ds.surface.border, color: ds.text.secondary }}>
							{t.noSearchMatches}
						</p>
					)}

					{/* Disclosure 1 & 2: Manual Coordinates and Authority Override */}
					<div className="flex flex-wrap items-center gap-2 pt-1">
						<button
							type="button"
							data-testid="manual-coords-disclosure"
							aria-expanded={showManualCoords}
							onClick={() => setShowManualCoords((v) => !v)}
							className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors hover:border-blue-400"
							style={{
								background: ds.surface.overlaySubtle,
								borderColor: showManualCoords ? ds.colors.accent.blue : ds.surface.border,
								color: ds.text.secondary,
							}}
						>
							<Compass size={13} aria-hidden="true" />
							<span>{t.manualCoordsDisclosure}</span>
							<ChevronDown size={13} className={`transition-transform ${showManualCoords ? 'rotate-180' : ''}`} aria-hidden="true" />
						</button>

						<button
							type="button"
							data-testid="authority-override-disclosure"
							aria-expanded={showAuthorityOverride}
							onClick={() => setShowAuthorityOverride((v) => !v)}
							className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors hover:border-blue-400"
							style={{
								background: ds.surface.overlaySubtle,
								borderColor: showAuthorityOverride || countryOverride ? ds.colors.accent.blue : ds.surface.border,
								color: ds.text.secondary,
							}}
						>
							<Globe2 size={13} aria-hidden="true" />
							<span>{t.authorityOverrideDisclosure}</span>
							<ChevronDown size={13} className={`transition-transform ${showAuthorityOverride ? 'rotate-180' : ''}`} aria-hidden="true" />
						</button>
					</div>

					{showManualCoords && (
						<form
							onSubmit={handleApplyCoords}
							className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3.5 rounded-xl border"
							style={{ background: 'var(--color-surface-card)', borderColor: ds.surface.borderSubtle }}
						>
							<div className="sm:col-span-2">
								<label htmlFor="manual-coords-input" className="block text-xs font-semibold mb-1" style={{ color: ds.text.secondary }}>
									{t.manualCoordsLabel}
								</label>
								<input
									id="manual-coords-input"
									data-testid="manual-coords-input"
									type="text"
									dir="ltr"
									value={coordInput}
									onChange={(e) => setCoordInput(e.target.value)}
									placeholder={t.manualCoordsPlaceholder}
									className="w-full min-h-[42px] px-3 py-2 rounded-lg text-sm font-mono border"
									style={{
										background: 'var(--color-bg-secondary)',
										borderColor: ds.surface.border,
										color: ds.text.primary,
									}}
								/>
								{coordError && (
									<p role="alert" className="text-xs text-red-400 mt-1">
										{coordError}
									</p>
								)}
							</div>
							<div className="flex flex-col justify-end">
								<button
									type="submit"
									data-testid="apply-coords-btn"
									className="min-h-[42px] px-4 py-2 rounded-lg text-sm font-bold border hover:border-blue-400 transition-colors"
									style={{
										background: ds.surface.overlaySubtle,
										borderColor: ds.surface.border,
										color: ds.text.primary,
									}}
								>
									{t.applyCoordsButton}
								</button>
							</div>
						</form>
					)}

					{showAuthorityOverride && (
						<div
							className="p-3.5 rounded-xl border space-y-1.5"
							style={{ background: 'var(--color-surface-card)', borderColor: ds.surface.borderSubtle }}
						>
							<label htmlFor="monitored-jurisdiction-select" className="block text-xs font-semibold" style={{ color: ds.text.secondary }}>
								{t.jurisdictionLabel}
							</label>
							<select
								id="monitored-jurisdiction-select"
								data-testid="monitored-jurisdiction-select"
								value={countryOverride}
								onChange={(e) => onCountryOverrideChange(e.target.value)}
								className="w-full sm:max-w-sm min-h-[42px] px-3 py-2 rounded-lg text-xs font-semibold border"
								style={{
									background: 'var(--color-bg-secondary)',
									borderColor: ds.surface.border,
									color: ds.text.primary,
								}}
							>
								{COUNTRY_OPTIONS.map((opt) => (
									<option key={opt.code || 'auto'} value={opt.code} style={{ background: '#111827', color: '#fff' }}>
										{opt.code === '' ? t.jurisdictionAuto : opt.label}
									</option>
								))}
							</select>
						</div>
					)}
				</div>
			)}

			{/* Saved Places Bar (always quickly switchable when present) */}
			{savedPlaces.length > 0 && (
				<div className="pt-2 border-t space-y-2" style={{ borderColor: ds.surface.borderSubtle }}>
					<h3 className="text-[11px] font-bold uppercase tracking-wide" style={{ color: ds.text.tertiary }}>
						{t.savedPlacesHeading}
					</h3>
					<ul className="flex flex-wrap gap-2" data-testid="saved-places-list">
						{savedPlaces.map((sp) => {
							const active = selectedPlace?.id === sp.id;
							return (
								<li
									key={sp.id}
									className="inline-flex items-center rounded-xl border text-xs overflow-hidden"
									style={{
										background: active ? 'rgba(37, 99, 235, 0.16)' : 'var(--color-surface-card)',
										borderColor: active ? '#3b82f6' : ds.surface.border,
										color: ds.text.primary,
									}}
								>
									<button
										type="button"
										onClick={() => commitSelection(sp)}
										className="min-h-[38px] px-3 py-1.5 font-semibold hover:underline text-start"
									>
										{sp.label}
									</button>
									<button
										type="button"
										onClick={() => onDeleteSavedPlace(sp.id)}
										aria-label={`${t.removePlace} ${sp.label}`}
										data-testid={`delete-saved-${sp.id}`}
										className="min-h-[38px] min-w-[36px] inline-flex items-center justify-center px-2 border-s text-red-400 hover:bg-red-500/15"
										style={{ borderColor: ds.surface.borderSubtle }}
									>
										<Trash2 size={13} aria-hidden="true" />
									</button>
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</section>
	);
}
