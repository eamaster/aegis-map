import { useState } from 'react';
import { Bookmark, MapPin, Navigation, Search, Trash2, WifiOff } from 'lucide-react';
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
	{ code: 'MY', label: 'Malaysia (MY)' },
	{ code: 'NO', label: 'Norway (NO)' },
	{ code: 'SJ', label: 'Svalbard / Norway (SJ)' },
	{ code: 'IR', label: 'Iran (IR)' },
	{ code: 'IN', label: 'India (IN)' },
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

	const [query, setQuery] = useState('');
	const [coordInput, setCoordInput] = useState('');
	const [coordError, setCoordError] = useState<string | null>(null);
	const [candidates, setCandidates] = useState<SelectedPlace[]>([]);
	const [searching, setSearching] = useState(false);
	const [offlineSearchNote, setOfflineSearchNote] = useState(false);
	const [gpsStatus, setGpsStatus] = useState<string | null>(null);

	const handleSearch = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!query.trim()) return;
		setSearching(true);
		setCoordError(null);
		const res = await searchPlaces(query, { language: locale });
		setCandidates(res.candidates);
		setOfflineSearchNote(res.usedOfflineFallback);
		setSearching(false);
		if (res.candidates.length === 1) {
			onSelectPlace(res.candidates[0]);
		}
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
		onSelectPlace(place);
	};

	const handleUseGps = () => {
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			setGpsStatus(t.gpsStatusUnavailable);
			return;
		}
		setGpsStatus('Requesting GPS…');
		navigator.geolocation.getCurrentPosition(
			(pos) => {
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
				setGpsStatus(accuracy > 5000 ? t.gpsStatusLowAccuracy : null);
				onSelectPlace(gpsPlace);
			},
			(err) => {
				if (err.code === err.PERMISSION_DENIED) setGpsStatus(t.gpsStatusDenied);
				else if (err.code === err.TIMEOUT) setGpsStatus(t.gpsStatusTimeout);
				else setGpsStatus(t.gpsStatusUnavailable);
			},
			{ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
		);
	};

	return (
		<section
			aria-labelledby="place-selector-heading"
			data-testid="place-selector"
			className="rounded-xl p-4 sm:p-5 space-y-4"
			style={{
				background: ds.surface.elevated,
				border: `1px solid ${ds.surface.border}`,
			}}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 id="place-selector-heading" className="text-base font-bold flex items-center gap-2" style={{ color: ds.text.primary }}>
					<MapPin size={18} className="text-blue-400" aria-hidden="true" />
					<span>{t.searchPlaceLabel}</span>
				</h2>
				<button
					type="button"
					onClick={handleUseGps}
					data-testid="gps-request-btn"
					className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300"
				>
					<Navigation size={14} aria-hidden="true" />
					<span>{t.useGpsButton}</span>
				</button>
			</div>

			{gpsStatus && (
				<div
					role="status"
					data-testid="gps-status-banner"
					className="text-xs px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10"
					style={{ color: ds.text.primary }}
				>
					{gpsStatus}
				</div>
			)}

			<form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
				<label htmlFor="near-me-search-input" className="sr-only">
					{t.searchPlaceLabel}
				</label>
				<input
					id="near-me-search-input"
					data-testid="place-search-input"
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={t.searchPlacePlaceholder}
					className="flex-1 px-3 py-2 rounded-lg text-sm border focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
					style={{
						background: ds.surface.overlay,
						borderColor: ds.surface.border,
						color: ds.text.primary,
					}}
				/>
				<button
					type="submit"
					disabled={searching}
					data-testid="place-search-btn"
					className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300"
				>
					<Search size={15} aria-hidden="true" />
					<span>{searching ? '…' : t.searchButton}</span>
				</button>
			</form>

			{offlineSearchNote && (
				<div
					role="status"
					data-testid="offline-search-notice"
					className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10"
					style={{ color: ds.text.primary }}
				>
					<WifiOff size={14} className="shrink-0 text-amber-400" aria-hidden="true" />
					<span>{t.offlineSearchNotice}</span>
				</div>
			)}

			{candidates.length > 0 && (
				<div className="space-y-1.5" data-testid="place-candidates">
					<p className="text-xs font-semibold" style={{ color: ds.text.secondary }}>
						Select matching location ({candidates.length}):
					</p>
					<ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
						{candidates.map((cand) => (
							<li key={cand.id}>
								<button
									type="button"
									onClick={() => {
										onSelectPlace(cand);
										setCandidates([]);
									}}
									data-testid={`place-candidate-${cand.countryCode ?? 'XX'}`}
									className="w-full text-start px-3 py-2 rounded-lg border text-xs transition-colors hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
									style={{
										background: ds.surface.overlay,
										borderColor: ds.surface.border,
										color: ds.text.primary,
									}}
								>
									<div className="font-semibold">{cand.label}</div>
									<div className="text-[11px] mt-0.5" style={{ color: ds.text.tertiary }}>
										<BdiLtr mono>
											{cand.lat.toFixed(3)}, {cand.lng.toFixed(3)}
										</BdiLtr>
										{cand.countryCode ? ` · ${cand.countryCode}` : ''}
										{cand.timezone ? ` · ${cand.timezone}` : ''}
									</div>
								</button>
							</li>
						))}
					</ul>
				</div>
			)}

			<form onSubmit={handleApplyCoords} className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t" style={{ borderColor: ds.surface.borderSubtle }}>
				<div className="sm:col-span-2">
					<label htmlFor="manual-coords-input" className="block text-xs font-medium mb-1" style={{ color: ds.text.secondary }}>
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
						className="w-full px-3 py-2 rounded-lg text-sm font-mono border focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
						style={{
							background: ds.surface.overlay,
							borderColor: ds.surface.border,
							color: ds.text.primary,
						}}
					/>
				</div>
				<div className="flex flex-col justify-end">
					<button
						type="submit"
						data-testid="apply-coords-btn"
						className="px-3 py-2 rounded-lg text-sm font-semibold border hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
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
			{coordError && (
				<p role="alert" className="text-xs text-red-400">
					{coordError}
				</p>
			)}

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t" style={{ borderColor: ds.surface.borderSubtle }}>
				<div>
					<label htmlFor="monitored-jurisdiction-select" className="block text-xs font-medium mb-1" style={{ color: ds.text.secondary }}>
						{t.jurisdictionLabel}
					</label>
					<select
						id="monitored-jurisdiction-select"
						data-testid="monitored-jurisdiction-select"
						value={countryOverride}
						onChange={(e) => onCountryOverrideChange(e.target.value)}
						className="w-full px-3 py-2 rounded-lg text-xs border focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
						style={{
							background: ds.surface.overlay,
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

				<div className="flex items-end justify-between gap-2">
					{selectedPlace && (
						<button
							type="button"
							onClick={() => onSavePlace(selectedPlace)}
							data-testid="save-place-btn"
							className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
							style={{
								background: ds.surface.overlaySubtle,
								borderColor: ds.surface.border,
								color: ds.text.primary,
							}}
						>
							<Bookmark size={14} aria-hidden="true" />
							<span>{t.saveCurrentPlace}</span>
						</button>
					)}
				</div>
			</div>

			<div className="pt-2 border-t space-y-2" style={{ borderColor: ds.surface.borderSubtle }}>
				<h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: ds.text.tertiary }}>
					{t.savedPlacesHeading}
				</h3>
				{savedPlaces.length === 0 ? (
					<p className="text-xs" style={{ color: ds.text.tertiary }}>
						{t.noSavedPlaces}
					</p>
				) : (
					<ul className="flex flex-wrap gap-2" data-testid="saved-places-list">
						{savedPlaces.map((sp) => (
							<li
								key={sp.id}
								className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs"
								style={{
									background: ds.surface.overlay,
									borderColor: selectedPlace?.id === sp.id ? '#3b82f6' : ds.surface.border,
									color: ds.text.primary,
								}}
							>
								<button
									type="button"
									onClick={() => onSelectPlace(sp)}
									className="font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
								>
									{sp.label}
								</button>
								<button
									type="button"
									onClick={() => onDeleteSavedPlace(sp.id)}
									aria-label={`${t.removePlace} ${sp.label}`}
									data-testid={`delete-saved-${sp.id}`}
									className="p-1 text-red-400 hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"
								>
									<Trash2 size={12} aria-hidden="true" />
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}
