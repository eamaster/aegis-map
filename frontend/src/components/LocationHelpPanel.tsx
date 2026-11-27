import { useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, MapPin, MessageSquare, Phone, Share2, ShieldAlert } from 'lucide-react';
import { EMERGENCY_CONTACTS_BY_COUNTRY, resolveEmergencyProfile } from '../../../shared/emergencyContacts';
import { useLocale } from '../hooks/useLocale';
import { useDesignSystem } from '../hooks/useDesignSystem';
import { formatCoordinatesLtr, parseFlexibleCoordinates, type SelectedPlace } from '../utils/places';
import { BdiLtr } from './BdiLtr';

interface LocationHelpPanelProps {
	monitoredPlace: SelectedPlace | null;
	presentJurisdiction: string;
	onPresentJurisdictionChange: (code: string) => void;
}

const PRESENT_JURISDICTION_CHOICES: ReadonlyArray<{ code: string; label: string }> = [
	{ code: '', label: 'Confirm country you are currently in…' },
	{ code: 'MY', label: 'Malaysia (MY — 999 / 112)' },
	{ code: 'NO', label: 'Norway (NO — 110 / 112 / 113)' },
	{ code: 'SJ', label: 'Svalbard, Norway (SJ — 112 / 110 / 113)' },
	{ code: 'IR', label: 'Iran (IR — 115 / 125 / 110 / 112)' },
	{ code: 'IN', label: 'India (IN — 112 / 1078)' },
	{ code: 'US', label: 'United States (US — 911)' },
	{ code: 'GB', label: 'United Kingdom (GB — 999 / 112)' },
	{ code: 'AU', label: 'Australia (AU — 000 / 112)' },
	{ code: 'SG', label: 'Singapore (SG — 999 / 995)' },
];

export default function LocationHelpPanel({
	monitoredPlace,
	presentJurisdiction,
	onPresentJurisdictionChange,
}: LocationHelpPanelProps) {
	const { t } = useLocale();
	const ds = useDesignSystem();
	const [editableCoord, setEditableCoord] = useState('');
	const [note, setNote] = useState('');
	const [handoffNotice, setHandoffNotice] = useState<string | null>(null);

	const effectiveCoord = (() => {
		if (editableCoord.trim()) {
			const p = parseFlexibleCoordinates(editableCoord);
			if (p.ok) return { lat: p.lat, lng: p.lng, valid: true };
		}
		if (monitoredPlace) return { lat: monitoredPlace.lat, lng: monitoredPlace.lng, valid: true };
		return { lat: 0, lng: 0, valid: false };
	})();

	const profile = resolveEmergencyProfile(presentJurisdiction);
	const monitoredCountrySupported =
		monitoredPlace?.countryCode && EMERGENCY_CONTACTS_BY_COUNTRY[monitoredPlace.countryCode]
			? EMERGENCY_CONTACTS_BY_COUNTRY[monitoredPlace.countryCode]
			: null;

	const shareCardText = effectiveCoord.valid
		? [
				`AegisMap Location Card`,
				`Place: ${monitoredPlace?.label ?? 'Manual coordinates'}`,
				`Coordinates: ${effectiveCoord.lat.toFixed(5)}, ${effectiveCoord.lng.toFixed(5)} (${formatCoordinatesLtr(effectiveCoord.lat, effectiveCoord.lng)})`,
				monitoredPlace?.accuracyMeters != null ? `GPS accuracy: ±${monitoredPlace.accuracyMeters} m` : 'Coordinates entered/selected manually',
				monitoredPlace?.capturedAt ? `Timestamp (UTC): ${monitoredPlace.capturedAt}` : `Timestamp (UTC): ${new Date().toISOString()}`,
				note.trim() ? `Note: ${note.trim()}` : null,
			]
				.filter(Boolean)
				.join('\n')
		: '';

	const handleCopy = async () => {
		if (!shareCardText) return;
		try {
			await navigator.clipboard.writeText(shareCardText);
			setHandoffNotice('Location card copied to clipboard. Your device did not transmit it automatically.');
		} catch {
			setHandoffNotice('Clipboard unavailable — select and copy the location card text manually.');
		}
	};

	const handleShare = async () => {
		if (!shareCardText) return;
		if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
			try {
				await navigator.share({ title: 'My Location (AegisMap)', text: shareCardText });
				setHandoffNotice('Device share sheet opened. Verify recipient delivery in your chosen app.');
			} catch {
				setHandoffNotice('Share cancelled or unavailable.');
			}
		} else {
			await handleCopy();
		}
	};

	return (
		<section
			aria-labelledby="help-panel-heading"
			data-testid="location-help-panel"
			className="rounded-2xl p-4 sm:p-5 space-y-4 border shadow-sm"
			style={{
				background: 'var(--color-surface-elevated)',
				borderColor: ds.surface.border,
			}}
		>
			<div>
				<h2 id="help-panel-heading" className="text-base font-bold flex items-center gap-2" style={{ color: ds.text.primary }}>
					<Phone size={18} className="text-emerald-400 shrink-0" aria-hidden="true" />
					<span>{t.helpSectionTitle}</span>
				</h2>
				<p className="text-xs mt-1 leading-relaxed" style={{ color: ds.text.secondary }}>
					{t.presentJurisdictionHint}
				</p>
			</div>

			{/* Explicit Separation: Monitored Place vs Present Country */}
			<div className="grid grid-cols-1 gap-2.5">
				<div
					data-testid="monitored-place-readout"
					className="rounded-xl p-3 border text-xs"
					style={{ background: 'var(--color-surface-card)', borderColor: ds.surface.borderSubtle }}
				>
					<div className="font-semibold flex items-center gap-1.5" style={{ color: ds.text.tertiary }}>
						<MapPin size={12} className="text-blue-400 shrink-0" aria-hidden="true" />
						<span>{t.monitoredPlaceLabel}</span>
					</div>
					<div className="font-bold mt-1 break-words" style={{ color: ds.text.primary }}>
						{monitoredPlace ? monitoredPlace.label : '—'}
					</div>
				</div>

				<div
					className="rounded-xl p-3 border space-y-2"
					style={{ background: 'var(--color-surface-card)', borderColor: ds.surface.border }}
				>
					<label htmlFor="present-jurisdiction-select" className="block text-xs font-bold" style={{ color: ds.text.primary }}>
						{t.presentCountryLabel}
					</label>
					<select
						id="present-jurisdiction-select"
						data-testid="present-jurisdiction-select"
						value={presentJurisdiction}
						onChange={(e) => onPresentJurisdictionChange(e.target.value)}
						className="w-full min-h-[42px] px-3 py-2 rounded-lg text-xs font-semibold border"
						style={{
							background: 'var(--color-bg-secondary)',
							borderColor: ds.surface.border,
							color: ds.text.primary,
						}}
					>
						{PRESENT_JURISDICTION_CHOICES.map((opt) => (
							<option key={opt.code || 'unset'} value={opt.code} style={{ background: '#111827', color: '#fff' }}>
								{opt.label}
							</option>
						))}
					</select>

					{!presentJurisdiction && monitoredCountrySupported && (
						<button
							type="button"
							data-testid="confirm-monitored-as-present-btn"
							onClick={() => onPresentJurisdictionChange(monitoredCountrySupported.countryCode)}
							className="w-full min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition-colors"
						>
							<CheckCircle2 size={14} aria-hidden="true" />
							<span>
								{t.useMonitoredCountryAsPresent} {monitoredCountrySupported.countryName}
							</span>
						</button>
					)}
				</div>
			</div>

			{/* Before confirmation: show confirmation callout and NEVER style generic numbers as verified local contacts */}
			{!profile.verified ? (
				<div
					role="status"
					data-testid="unverified-contacts-notice"
					className="rounded-xl p-3.5 border border-amber-500/45 bg-amber-500/10 space-y-2 text-xs"
					style={{ color: ds.text.primary }}
				>
					<div className="flex items-start gap-2">
						<ShieldAlert size={16} className="shrink-0 text-amber-400 mt-0.5" aria-hidden="true" />
						<div className="space-y-1">
							<div className="font-bold">{t.confirmPresentCountryAction}</div>
							<p className="leading-relaxed" style={{ color: ds.text.secondary }}>
								{profile.guidanceNote}
							</p>
						</div>
					</div>
					<div
						data-testid="emergency-numbers-list"
						className="pt-2 border-t text-[11px]"
						style={{ borderColor: ds.surface.borderSubtle, color: ds.text.tertiary }}
					>
						Unverified international GSM standards (confirm locally before relying on them):{' '}
						<BdiLtr mono>112</BdiLtr> / <BdiLtr mono>911</BdiLtr>
					</div>
				</div>
			) : (
				<div className="space-y-2">
					<div className="flex items-center justify-between gap-2 text-xs">
						<span className="inline-flex items-center gap-1.5 font-bold text-emerald-400">
							<CheckCircle2 size={14} aria-hidden="true" />
							<span>Verified Emergency Contacts — {profile.countryName}</span>
						</span>
					</div>
					<div className="grid grid-cols-1 gap-2" data-testid="emergency-numbers-list">
						{profile.numbers.map((svc) => (
							<div
								key={`${svc.label}-${svc.number}`}
								className="rounded-xl p-3 border flex items-center justify-between gap-3"
								style={{
									background: 'var(--color-surface-card)',
									borderColor: ds.surface.border,
								}}
							>
								<div className="min-w-0">
									<div className="text-xs font-bold break-words" style={{ color: ds.text.primary }}>
										{svc.label}
									</div>
									<div className="text-[11px] mt-0.5 leading-snug" style={{ color: ds.text.tertiary }}>
										{svc.notes}
									</div>
								</div>
								<a
									href={`tel:${svc.number}`}
									onClick={() =>
										setHandoffNotice(`Handed off ${svc.number} to your device dialer. AegisMap cannot confirm call connection.`)
									}
									data-testid={`dial-${svc.number}`}
									className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shrink-0 shadow-sm"
								>
									<Phone size={14} aria-hidden="true" />
									<BdiLtr mono>{svc.number}</BdiLtr>
								</a>
							</div>
						))}
					</div>
					<div className="text-[11px]" style={{ color: ds.text.tertiary }}>
						Source: {profile.verificationSource}
					</div>
				</div>
			)}

			{/* Readable, Editable Private Location Card */}
			<div
				className="rounded-xl p-3.5 border space-y-3"
				style={{
					background: 'var(--color-surface-card)',
					borderColor: ds.surface.border,
				}}
			>
				<div className="text-xs font-bold" style={{ color: ds.text.primary }}>
					Private Location Card (Shared Only When You Choose)
				</div>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
					<div>
						<label htmlFor="help-coord-edit" className="block text-[11px] font-semibold mb-1" style={{ color: ds.text.secondary }}>
							Edit coordinates if needed
						</label>
						<input
							id="help-coord-edit"
							data-testid="help-coord-edit"
							type="text"
							dir="ltr"
							value={editableCoord}
							onChange={(e) => setEditableCoord(e.target.value)}
							placeholder={
								monitoredPlace
									? `${monitoredPlace.lat.toFixed(5)}, ${monitoredPlace.lng.toFixed(5)}`
									: 'e.g. 5.9804, 116.0735'
							}
							className="w-full min-h-[40px] px-2.5 py-1.5 rounded-lg border text-xs font-mono"
							style={{
								background: 'var(--color-bg-secondary)',
								borderColor: ds.surface.border,
								color: ds.text.primary,
							}}
						/>
					</div>
					<div>
						<label htmlFor="help-note-input" className="block text-[11px] font-semibold mb-1" style={{ color: ds.text.secondary }}>
							Optional short note
						</label>
						<input
							id="help-note-input"
							type="text"
							maxLength={140}
							value={note}
							onChange={(e) => setNote(e.target.value)}
							placeholder="e.g., Landmarks or floor…"
							className="w-full min-h-[40px] px-2.5 py-1.5 rounded-lg border text-xs"
							style={{
								background: 'var(--color-bg-secondary)',
								borderColor: ds.surface.border,
								color: ds.text.primary,
							}}
						/>
					</div>
				</div>

				{effectiveCoord.valid ? (
					<pre
						data-testid="location-card-preview"
						dir="ltr"
						className="text-xs font-mono p-2.5 rounded-lg border whitespace-pre-wrap break-words overflow-x-auto"
						style={{
							background: 'var(--color-bg-secondary)',
							borderColor: ds.surface.borderSubtle,
							color: ds.text.secondary,
						}}
					>
						{shareCardText}
					</pre>
				) : (
					<p className="text-xs" style={{ color: ds.text.tertiary }}>
						Select a place or enter coordinates above to prepare a shareable location card.
					</p>
				)}

				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						disabled={!effectiveCoord.valid}
						onClick={handleCopy}
						data-testid="copy-location-btn"
						className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border disabled:opacity-50"
						style={{
							background: ds.surface.overlaySubtle,
							borderColor: ds.surface.border,
							color: ds.text.primary,
						}}
					>
						<Copy size={13} aria-hidden="true" />
						<span>{t.copyLocationButton}</span>
					</button>
					<button
						type="button"
						disabled={!effectiveCoord.valid}
						onClick={handleShare}
						data-testid="share-location-btn"
						className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
					>
						<Share2 size={13} aria-hidden="true" />
						<span>{t.shareLocationButton}</span>
					</button>
					{effectiveCoord.valid && (
						<a
							href={`sms:?&body=${encodeURIComponent(shareCardText)}`}
							onClick={() =>
								setHandoffNotice('Opened SMS composer on your device. Verify message delivery in your messaging app.')
							}
							className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border"
							style={{
								background: ds.surface.overlaySubtle,
								borderColor: ds.surface.border,
								color: ds.text.primary,
							}}
						>
							<MessageSquare size={13} aria-hidden="true" />
							<span>SMS</span>
						</a>
					)}
				</div>

				<p className="text-[11px] leading-relaxed" style={{ color: ds.text.tertiary }}>
					{t.handoffDisclaimer}
				</p>
				{handoffNotice && (
					<p role="status" data-testid="handoff-status-note" className="text-xs font-semibold text-emerald-400">
						{handoffNotice}
					</p>
				)}
			</div>

			{profile.authorityLinks.length > 0 && (
				<div className="space-y-1.5">
					<div className="text-xs font-bold" style={{ color: ds.text.secondary }}>
						Official Emergency Guidance Links
					</div>
					<ul className="flex flex-col gap-1.5">
						{profile.authorityLinks.map((lnk) => (
							<li key={lnk.url}>
								<a
									href={lnk.url}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-400 underline underline-offset-2 hover:text-blue-300"
								>
									<span>{lnk.label}</span>
									<ExternalLink size={12} className="shrink-0" aria-hidden="true" />
								</a>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}
