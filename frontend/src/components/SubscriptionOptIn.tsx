import { useEffect, useState, type FormEvent } from 'react';
import { Bell, BellOff, CheckCircle2, Mail, MessageSquareOff, Trash2 } from 'lucide-react';
import type { SubscriptionServiceStatus } from '../../../shared/contracts';
import {
	getAuthoritiesForCountry,
	WARNING_AUTHORITY_REGISTRY,
	type WarningAuthoritySpec,
} from '../../../shared/warningRegistry';
import type { SelectedPlace } from '../utils/places';
import {
	confirmSubscriptionToken,
	fetchSubscriptionStatus,
	submitSubscription,
	unsubscribeSubscriptionToken,
} from '../utils/researchClient';
import { useDesignSystem } from '../hooks/useDesignSystem';

interface SubscriptionOptInProps {
	monitoredPlace: SelectedPlace | null;
}

export default function SubscriptionOptIn({ monitoredPlace }: SubscriptionOptInProps) {
	const ds = useDesignSystem();
	const countryAuthorities = monitoredPlace?.countryCode
		? getAuthoritiesForCountry(monitoredPlace.countryCode)
		: [];
	const availableAuthorities: readonly WarningAuthoritySpec[] =
		countryAuthorities.length > 0 ? countryAuthorities : WARNING_AUTHORITY_REGISTRY;

	const [serviceStatus, setServiceStatus] = useState<SubscriptionServiceStatus | null>(null);
	const [email, setEmail] = useState('');
	const [selectedSourceId, setSelectedSourceId] = useState<string>(availableAuthorities[0]?.sourceId ?? 'no-metalerts');
	const [minSeverity, setMinSeverity] = useState<'moderate' | 'severe' | 'extreme'>('moderate');
	const [submitting, setSubmitting] = useState(false);
	const [statusMsg, setStatusMsg] = useState<string | null>(null);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const [previewToken, setPreviewToken] = useState<string | null>(null);
	const [unsubscribeToken, setUnsubscribeToken] = useState<string | null>(null);
	const [subStatus, setSubStatus] = useState<'pending_confirmation' | 'active' | 'unsubscribed' | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		const timer = window.setTimeout(async () => {
			try {
				const st = await fetchSubscriptionStatus(controller.signal);
				setServiceStatus(st);
			} catch {
				// Leave null on abort/network glitch so submit still surfaces server truth
			}
		}, 0);
		return () => {
			window.clearTimeout(timer);
			controller.abort();
		};
	}, []);

	const effectiveSourceId = availableAuthorities.some((a) => a.sourceId === selectedSourceId)
		? selectedSourceId
		: availableAuthorities[0]?.sourceId ?? 'no-metalerts';

	const deliveryUnavailable = serviceStatus !== null && !serviceStatus.available;

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!monitoredPlace || deliveryUnavailable) return;
		setSubmitting(true);
		setErrorMsg(null);
		setStatusMsg(null);
		try {
			const res = await submitSubscription({
				channel: 'email',
				destination: email.trim(),
				placeName: monitoredPlace.label,
				lat: monitoredPlace.lat,
				lng: monitoredPlace.lng,
				countryCode: monitoredPlace.countryCode ?? 'UN',
				sourceId: effectiveSourceId,
				minSeverity,
			});
			if (!res.ok) {
				setErrorMsg(res.message);
				if (res.code === 'delivery_unavailable' || res.code === 'db_unavailable') {
					setServiceStatus({
						available: false,
						mode: 'unavailable',
						smsAvailable: false,
						reason: res.message,
					});
				}
			} else {
				setPreviewToken(res.sandboxPreviewToken ?? null);
				setUnsubscribeToken(res.sandboxUnsubscribeToken ?? null);
				setSubStatus(res.status ?? 'pending_confirmation');
				setStatusMsg(res.message);
			}
		} catch (err) {
			setErrorMsg(err instanceof Error ? err.message : 'Subscription request failed');
		} finally {
			setSubmitting(false);
		}
	};

	const handleConfirmSandbox = async () => {
		if (!previewToken) return;
		setSubmitting(true);
		setErrorMsg(null);
		try {
			const res = await confirmSubscriptionToken(previewToken);
			if (!res.ok) setErrorMsg(res.message);
			else {
				setSubStatus(res.status ?? 'active');
				setStatusMsg(res.message);
				setPreviewToken(null);
			}
		} catch (err) {
			setErrorMsg(err instanceof Error ? err.message : 'Confirmation failed');
		} finally {
			setSubmitting(false);
		}
	};

	const handleUnsubscribe = async () => {
		if (!unsubscribeToken) return;
		setSubmitting(true);
		setErrorMsg(null);
		try {
			const res = await unsubscribeSubscriptionToken(unsubscribeToken);
			if (!res.ok) setErrorMsg(res.message);
			else {
				setSubStatus(res.status ?? 'unsubscribed');
				setStatusMsg(res.message);
			}
		} catch (err) {
			setErrorMsg(err instanceof Error ? err.message : 'Unsubscribe failed');
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<section
			data-testid="subscription-optin-section"
			aria-labelledby="subscription-optin-heading"
			className="rounded-xl p-4 sm:p-5 border space-y-3"
			style={{
				background: ds.surface.overlay,
				borderColor: ds.surface.border,
			}}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 id="subscription-optin-heading" className="text-sm font-bold flex items-center gap-2">
					{deliveryUnavailable ? (
						<BellOff size={16} className="text-amber-400" aria-hidden="true" />
					) : (
						<Bell size={16} className="text-blue-400" aria-hidden="true" />
					)}
					<span>Opt-In Warning Alerts (Double Opt-In Email)</span>
				</h2>
				<div className="flex flex-wrap items-center gap-1.5">
					{serviceStatus?.mode === 'sandbox' && (
						<span
							data-testid="subscription-sandbox-badge"
							className="inline-flex items-center px-2 py-0.5 rounded text-[11px] border border-amber-500/40 bg-amber-500/10 text-amber-200"
						>
							Sandbox Test Mode
						</span>
					)}
					<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border border-slate-600 text-slate-300">
						<MessageSquareOff size={11} aria-hidden="true" />
						<span>Regional SMS Deferred</span>
					</span>
				</div>
			</div>

			{deliveryUnavailable ? (
				<div
					role="status"
					data-testid="subscription-unavailable-banner"
					className="rounded-lg p-3 border border-amber-500/40 bg-amber-500/10 text-xs text-amber-200 space-y-1"
				>
					<div className="font-bold">Email alert delivery is not enabled on this deployment</div>
					<p>{serviceStatus?.reason ?? 'No email delivery provider is configured.'}</p>
				</div>
			) : (
				<p className="text-xs leading-relaxed" style={{ color: ds.text.secondary }}>
					Receive alerts only for verified warnings from supported official authorities matching your monitored coordinates.
					Regional SMS delivery is explicitly deferred (<code className="font-mono">501 sms_deferred</code>) until carrier delivery receipts and cost guardrails are enabled.
				</p>
			)}

			{!monitoredPlace ? (
				<p className="text-xs" style={{ color: ds.text.tertiary }}>
					Select a place above to configure warning subscriptions.
				</p>
			) : (
				<form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
					<label className="flex flex-col gap-1">
						<span style={{ color: ds.text.secondary }}>Email address</span>
						<input
							type="email"
							required
							disabled={deliveryUnavailable || submitting}
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="resident@example.com"
							data-testid="subscription-email-input"
							className="px-3 py-2 rounded-lg border bg-transparent disabled:opacity-50"
							style={{ borderColor: ds.surface.border, color: ds.text.primary }}
						/>
					</label>

					<label className="flex flex-col gap-1">
						<span style={{ color: ds.text.secondary }}>Official Authority</span>
						<select
							disabled={deliveryUnavailable || submitting}
							value={effectiveSourceId}
							onChange={(e) => setSelectedSourceId(e.target.value)}
							className="px-3 py-2 rounded-lg border disabled:opacity-50"
							style={{
								background: ds.surface.overlaySubtle,
								borderColor: ds.surface.border,
								color: ds.text.primary,
							}}
						>
							{availableAuthorities.map((a) => (
								<option key={a.sourceId} value={a.sourceId} style={{ background: '#111827' }}>
									{a.authorityName} ({a.countryCodes.join('/')})
								</option>
							))}
						</select>
					</label>

					<label className="flex flex-col gap-1">
						<span style={{ color: ds.text.secondary }}>Minimum Severity</span>
						<div className="flex gap-2">
							<select
								disabled={deliveryUnavailable || submitting}
								value={minSeverity}
								onChange={(e) => setMinSeverity(e.target.value as typeof minSeverity)}
								className="flex-1 px-2.5 py-2 rounded-lg border disabled:opacity-50"
								style={{
									background: ds.surface.overlaySubtle,
									borderColor: ds.surface.border,
									color: ds.text.primary,
								}}
							>
								<option value="moderate" style={{ background: '#111827' }}>Moderate+</option>
								<option value="severe" style={{ background: '#111827' }}>Severe+</option>
								<option value="extreme" style={{ background: '#111827' }}>Extreme only</option>
							</select>
							<button
								type="submit"
								disabled={deliveryUnavailable || submitting}
								data-testid="subscription-submit-btn"
								className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
							>
								<Mail size={13} aria-hidden="true" />
								<span>Subscribe</span>
							</button>
						</div>
					</label>
				</form>
			)}

			{errorMsg && (
				<p className="text-xs text-red-300" data-testid="subscription-error">
					{errorMsg}
				</p>
			)}

			{statusMsg && (
				<div
					data-testid="subscription-status-banner"
					className="rounded-lg p-3 border border-blue-500/40 bg-blue-500/10 text-xs space-y-2"
				>
					<div className="flex items-center justify-between gap-2">
						<span className="font-semibold text-blue-200">
							Status: <code className="font-mono">{subStatus}</code>
						</span>
						{subStatus && subStatus !== 'unsubscribed' && unsubscribeToken && (
							<button
								type="button"
								data-testid="subscription-unsub-btn"
								onClick={handleUnsubscribe}
								disabled={submitting}
								className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-400/50 text-red-200 hover:bg-red-500/20"
							>
								<Trash2 size={12} aria-hidden="true" />
								<span>Unsubscribe</span>
							</button>
						)}
					</div>
					<p style={{ color: ds.text.secondary }}>{statusMsg}</p>
					{previewToken && subStatus === 'pending_confirmation' && (
						<button
							type="button"
							data-testid="subscription-confirm-sandbox-btn"
							onClick={handleConfirmSandbox}
							disabled={submitting}
							className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
						>
							<CheckCircle2 size={13} aria-hidden="true" />
							<span>Confirm Sandbox Subscription</span>
						</button>
					)}
				</div>
			)}
		</section>
	);
}
