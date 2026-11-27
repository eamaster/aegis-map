import { useEffect, useState } from 'react';
import { Bell, BellOff, CheckCircle2, Mail, MessageSquareOff, ShieldCheck } from 'lucide-react';
import type { SubscriptionServiceStatus } from '../../../shared/contracts';
import { getAuthoritiesForCountry } from '../../../shared/warningRegistry';
import { useDesignSystem } from '../hooks/useDesignSystem';
import { useLocale } from '../hooks/useLocale';
import { debugLog } from '../utils/debug';
import type { SelectedPlace } from '../utils/places';
import {
	confirmSubscriptionToken,
	submitSubscription,
	fetchSubscriptionStatus,
	unsubscribeSubscriptionToken,
} from '../utils/researchClient';

interface SubscriptionOptInProps {
	monitoredPlace: SelectedPlace | null;
	effectiveCountry: string | null;
}

export default function SubscriptionOptIn({ monitoredPlace, effectiveCountry }: SubscriptionOptInProps) {
	const ds = useDesignSystem();
	const { t } = useLocale();
	const [email, setEmail] = useState('');
	const [minSeverity, setMinSeverity] = useState<'moderate' | 'severe' | 'extreme'>('moderate');
	const [submitting, setSubmitting] = useState(false);
	const [statusMsg, setStatusMsg] = useState<string | null>(null);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const [previewToken, setPreviewToken] = useState<string | null>(null);
	const [unsubscribeToken, setUnsubscribeToken] = useState<string | null>(null);
	const [subStatus, setSubStatus] = useState<string | null>(null);
	const [serviceStatus, setServiceStatus] = useState<SubscriptionServiceStatus | null>(null);

	const authorities = getAuthoritiesForCountry(effectiveCountry);
	const primaryAuthority = authorities[0] ?? null;

	useEffect(() => {
		const controller = new AbortController();
		fetchSubscriptionStatus(controller.signal)
			.then((st) => {
				setServiceStatus(st);
				if (!st.available && st.reason) {
					// Keep operator configuration diagnostics (e.g. missing provider env vars) strictly in operator logs
					debugLog('backend', `Subscription service unavailable: ${st.reason}`, 'info');
				}
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setServiceStatus(null);
				}
			});
		return () => controller.abort();
	}, []);

	// Only render subscription controls when a place has been selected
	if (!monitoredPlace) {
		return null;
	}

	const deliveryUnavailable = serviceStatus !== null && !serviceStatus.available;

	const sanitizeResidentMessage = (msg: string | undefined, fallback: string): string => {
		if (!msg) return fallback;
		if (/RESEND_API_KEY|AEGIS_DB|501|sms_deferred/i.test(msg)) {
			debugLog('backend', `Subscription diagnostic: ${msg}`, 'warning');
			return fallback;
		}
		return msg;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!monitoredPlace || !primaryAuthority || deliveryUnavailable) return;

		setSubmitting(true);
		setErrorMsg(null);
		setStatusMsg(null);
		setPreviewToken(null);
		try {
			const res = await submitSubscription({
				channel: 'email',
				destination: email.trim(),
				placeName: monitoredPlace.label,
				lat: monitoredPlace.lat,
				lng: monitoredPlace.lng,
				countryCode: effectiveCountry ?? primaryAuthority.countryCodes[0],
				sourceId: primaryAuthority.sourceId,
				minSeverity,
			});
			if (!res.ok) {
				if (res.code === 'delivery_unavailable') {
					setServiceStatus({
						available: false,
						mode: 'unavailable',
						smsAvailable: false,
					});
				}
				setErrorMsg(sanitizeResidentMessage(res.message, t.subscriptionUnavailableBody));
			} else {
				setUnsubscribeToken(res.sandboxUnsubscribeToken ?? null);
				setSubStatus(res.status ?? 'pending_confirmation');
				setStatusMsg(sanitizeResidentMessage(res.message, 'Confirmation requested.'));
				if (res.sandboxPreviewToken) {
					setPreviewToken(res.sandboxPreviewToken);
				}
			}
		} catch (err) {
			setErrorMsg(err instanceof Error ? sanitizeResidentMessage(err.message, 'Subscription request failed.') : 'Subscription request failed.');
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
			if (!res.ok) setErrorMsg(sanitizeResidentMessage(res.message, 'Confirmation failed.'));
			else {
				setSubStatus(res.status ?? 'active');
				setStatusMsg(sanitizeResidentMessage(res.message, 'Subscription confirmed.'));
				setPreviewToken(null);
			}
		} catch (err) {
			setErrorMsg(err instanceof Error ? sanitizeResidentMessage(err.message, 'Confirmation failed.') : 'Confirmation failed.');
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
			if (!res.ok) setErrorMsg(sanitizeResidentMessage(res.message, 'Unsubscribe failed.'));
			else {
				setSubStatus(res.status ?? 'unsubscribed');
				setStatusMsg(sanitizeResidentMessage(res.message, 'Unsubscribed from warning emails.'));
			}
		} catch (err) {
			setErrorMsg(err instanceof Error ? sanitizeResidentMessage(err.message, 'Unsubscribe failed.') : 'Unsubscribe failed.');
		} finally {
			setSubmitting(false);
		}
	};

	// If the selected place's country has no supported official feed yet, do not show an irrelevant subscription form
	if (!primaryAuthority && !deliveryUnavailable) {
		return null;
	}

	return (
		<section
			data-testid="subscription-optin-section"
			aria-labelledby="subscription-optin-heading"
			className="rounded-2xl p-4 sm:p-5 border space-y-3.5 shadow-sm"
			style={{
				background: 'var(--color-surface-elevated)',
				borderColor: ds.surface.border,
			}}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 id="subscription-optin-heading" className="text-sm font-bold flex items-center gap-2" style={{ color: ds.text.primary }}>
					{deliveryUnavailable ? (
						<BellOff size={16} className="text-amber-400 shrink-0" aria-hidden="true" />
					) : (
						<Bell size={16} className="text-blue-400 shrink-0" aria-hidden="true" />
					)}
					<span>{t.subscriptionHeading}</span>
				</h2>
				<div className="flex flex-wrap items-center gap-1.5">
					{serviceStatus?.mode === 'sandbox' && (
						<span
							data-testid="subscription-sandbox-badge"
							className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border border-amber-500/40 bg-amber-500/10 text-amber-300"
						>
							Test Preview Mode
						</span>
					)}
					<span
						className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border"
						style={{ borderColor: ds.surface.border, color: ds.text.tertiary }}
					>
						<MessageSquareOff size={11} aria-hidden="true" />
						<span>{t.smsUnavailableBadge}</span>
					</span>
				</div>
			</div>

			{deliveryUnavailable ? (
				<div
					role="status"
					data-testid="subscription-unavailable-banner"
					className="rounded-xl p-3.5 border border-amber-500/40 bg-amber-500/10 text-xs space-y-1"
					style={{ color: ds.text.primary }}
				>
					<div className="font-bold">{t.subscriptionUnavailableTitle}</div>
					<p className="leading-relaxed" style={{ color: ds.text.secondary }}>
						{t.subscriptionUnavailableBody}
					</p>
				</div>
			) : (
				<p className="text-xs leading-relaxed" style={{ color: ds.text.secondary }}>
					Receive email updates when {primaryAuthority?.authorityName} publishes verified warnings matching{' '}
					<strong>{monitoredPlace.label}</strong>. Requires email confirmation; unsubscribe anytime.
				</p>
			)}

			<form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
				<label className="flex flex-col gap-1">
					<span className="font-semibold" style={{ color: ds.text.secondary }}>
						Email address
					</span>
					<input
						type="email"
						required
						disabled={deliveryUnavailable || submitting || !primaryAuthority}
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="resident@example.com"
						data-testid="subscription-email-input"
						className="min-h-[42px] px-3 py-2 rounded-xl border disabled:opacity-50"
						style={{
							background: 'var(--color-surface-card)',
							borderColor: ds.surface.border,
							color: ds.text.primary,
						}}
					/>
				</label>

				<label className="flex flex-col gap-1">
					<span className="font-semibold" style={{ color: ds.text.secondary }}>
						Minimum severity
					</span>
					<select
						value={minSeverity}
						disabled={deliveryUnavailable || submitting || !primaryAuthority}
						onChange={(e) => setMinSeverity(e.target.value as 'moderate' | 'severe' | 'extreme')}
						className="min-h-[42px] px-3 py-2 rounded-xl border disabled:opacity-50"
						style={{
							background: 'var(--color-surface-card)',
							borderColor: ds.surface.border,
							color: ds.text.primary,
						}}
					>
						<option value="moderate" style={{ background: '#111827', color: '#fff' }}>
							Moderate & above
						</option>
						<option value="severe" style={{ background: '#111827', color: '#fff' }}>
							Severe & Extreme
						</option>
						<option value="extreme" style={{ background: '#111827', color: '#fff' }}>
							Extreme only
						</option>
					</select>
				</label>

				<div className="flex items-end">
					<button
						type="submit"
						disabled={deliveryUnavailable || submitting || !primaryAuthority}
						data-testid="subscription-submit-btn"
						className="w-full min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white"
					>
						<Mail size={14} aria-hidden="true" />
						<span>{submitting ? 'Submitting…' : 'Request Email Alerts'}</span>
					</button>
				</div>
			</form>

			{errorMsg && (
				<div role="alert" className="rounded-xl p-2.5 border border-red-500/40 bg-red-500/10 text-xs text-red-300">
					{errorMsg}
				</div>
			)}

			{statusMsg && (
				<div
					role="status"
					data-testid="subscription-status-banner"
					className="rounded-xl p-3 border border-emerald-500/40 bg-emerald-500/10 text-xs space-y-2"
					style={{ color: ds.text.primary }}
				>
					<div className="flex items-center gap-1.5 font-semibold text-emerald-400">
						<CheckCircle2 size={14} aria-hidden="true" />
						<span>
							Status: {subStatus} — {statusMsg}
						</span>
					</div>

					<div className="flex flex-wrap gap-2">
						{previewToken && (
							<button
								type="button"
								onClick={handleConfirmSandbox}
								disabled={submitting}
								data-testid="subscription-confirm-sandbox-btn"
								className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
							>
								<ShieldCheck size={13} aria-hidden="true" />
								<span>Confirm Opt-In</span>
							</button>
						)}

						{unsubscribeToken && subStatus !== 'unsubscribed' && (
							<button
								type="button"
								onClick={handleUnsubscribe}
								disabled={submitting}
								data-testid="subscription-unsub-btn"
								className="min-h-[38px] px-3 py-1.5 rounded-lg border border-red-400/50 text-red-300 hover:bg-red-500/15 font-semibold"
							>
								Unsubscribe
							</button>
						)}
					</div>
				</div>
			)}
		</section>
	);
}
