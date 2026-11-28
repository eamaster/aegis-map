import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, CheckCircle2, Mail, MessageSquareOff, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
	buildPushPlaceKey,
	canonicalizeSubscriptionCoordinates,
	type SubscriptionServiceStatus,
} from '../../../shared/contracts';
import { getAuthoritiesForCountry } from '../../../shared/warningRegistry';
import { useDesignSystem } from '../hooks/useDesignSystem';
import { useLocale } from '../hooks/useLocale';
import { debugLog } from '../utils/debug';
import {
	clearLocalPushDeviceState,
	loadLocalPushDeviceState,
	saveLocalPushDeviceState,
	type LocalPushDeviceState,
	type LocalPushPlaceRegistration,
	type PendingPushOperation,
} from '../utils/offlineCache';
import type { SelectedPlace } from '../utils/places';
import {
	confirmSubscriptionToken,
	fetchSubscriptionStatus,
	lookupPushRegistrations,
	submitSubscription,
	unsubscribePushPlace,
	unsubscribePushSubscriptionEndpoint,
	unsubscribeSubscriptionToken,
} from '../utils/researchClient';

interface SubscriptionOptInProps {
	monitoredPlace: SelectedPlace | null;
	effectiveCountry: string | null;
}

function urlBase64ToUint8Array(base64Url: string): Uint8Array {
	const cleaned = base64Url.trim().replace(/-/g, '+').replace(/_/g, '/');
	const padded = cleaned.padEnd(Math.ceil(cleaned.length / 4) * 4, '=');
	const raw = atob(padded);
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) {
		out[i] = raw.charCodeAt(i);
	}
	return out;
}

function readNotificationPermission(): NotificationPermission | 'unsupported' {
	if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
	return window.Notification.permission;
}

export default function SubscriptionOptIn({ monitoredPlace, effectiveCountry }: SubscriptionOptInProps) {
	const ds = useDesignSystem();
	const { locale, t } = useLocale();
	const [email, setEmail] = useState('');
	const [minSeverity, setMinSeverity] = useState<'moderate' | 'severe' | 'extreme'>('moderate');
	const [submitting, setSubmitting] = useState(false);
	const [pushBusy, setPushBusy] = useState(false);
	const [statusMsg, setStatusMsg] = useState<string | null>(null);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const [pushErrorMsg, setPushErrorMsg] = useState<string | null>(null);
	const [pushStatusMsg, setPushStatusMsg] = useState<string | null>(null);
	const [previewToken, setPreviewToken] = useState<string | null>(null);
	const [unsubscribeToken, setUnsubscribeToken] = useState<string | null>(null);
	const [subStatus, setSubStatus] = useState<string | null>(null);
	const [serviceStatus, setServiceStatus] = useState<SubscriptionServiceStatus | null>(null);
	const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() =>
		readNotificationPermission(),
	);
	const [browserEndpoint, setBrowserEndpoint] = useState<string | null>(null);
	const [confirmedRegistrations, setConfirmedRegistrations] = useState<Record<string, LocalPushPlaceRegistration>>({});
	const [pendingPushOp, setPendingPushOp] = useState<PendingPushOperation | null>(null);

	const authorities = getAuthoritiesForCountry(effectiveCountry);
	const primaryAuthority = authorities[0] ?? null;

	const currentPlaceKey =
		monitoredPlace && primaryAuthority
			? buildPushPlaceKey(primaryAuthority.sourceId, monitoredPlace.lat, monitoredPlace.lng)
			: null;

	const isSecureContext = typeof window !== 'undefined' && window.isSecureContext !== false;
	const pushBrowserSupported =
		isSecureContext &&
		typeof window !== 'undefined' &&
		'Notification' in window &&
		'serviceWorker' in navigator &&
		'PushManager' in window;

	const persistDeviceState = useCallback(
		(
			endpoint: string | null,
			registrations: Record<string, LocalPushPlaceRegistration>,
			pendingOp: PendingPushOperation | null,
		) => {
			setBrowserEndpoint(endpoint);
			setConfirmedRegistrations(registrations);
			setPendingPushOp(pendingOp);
			if (!endpoint && Object.keys(registrations).length === 0 && !pendingOp) {
				clearLocalPushDeviceState();
				return;
			}
			if (endpoint) {
				const next: LocalPushDeviceState = {
					endpoint,
					registrations,
					pendingOp,
					updatedAt: new Date().toISOString(),
				};
				saveLocalPushDeviceState(next);
			}
		},
		[],
	);

	useEffect(() => {
		const controller = new AbortController();
		fetchSubscriptionStatus(controller.signal)
			.then((st) => {
				setServiceStatus(st);
				if (!st.available && st.reason) {
					debugLog('backend', `Subscription service unavailable: ${st.reason}`, 'info');
				}
				if (!st.pushAvailable && st.pushReason) {
					debugLog('backend', `Web Push unavailable: ${st.pushReason}`, 'info');
				}
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setServiceStatus(null);
				}
			});
		return () => controller.abort();
	}, []);

	// Reconcile browser push endpoint against confirmed server registrations (per place)
	useEffect(() => {
		setNotificationPermission(readNotificationPermission());
		setPushErrorMsg(null);
		setPushStatusMsg(null);

		if (!pushBrowserSupported) {
			setBrowserEndpoint(null);
			setConfirmedRegistrations({});
			setPendingPushOp(null);
			return;
		}

		let cancelled = false;
		const controller = new AbortController();
		const stored = loadLocalPushDeviceState();

		navigator.serviceWorker
			.getRegistration()
			.then(async (reg) => {
				const browserSub = await reg?.pushManager?.getSubscription();
				if (cancelled) return;

				if (!browserSub?.endpoint) {
					// No active browser PushSubscription: stale local metadata cannot establish active coverage
					if (stored?.pendingOp && stored.pendingOp.kind !== 'unsubscribe_browser') {
						setBrowserEndpoint(null);
						setConfirmedRegistrations({});
						setPendingPushOp(null);
					} else {
						clearLocalPushDeviceState();
						setBrowserEndpoint(null);
						setConfirmedRegistrations({});
						setPendingPushOp(null);
					}
					return;
				}

				const endpoint = browserSub.endpoint;
				setBrowserEndpoint(endpoint);
				const matchingLocal = stored?.endpoint === endpoint ? stored : null;
				if (matchingLocal) {
					setConfirmedRegistrations(matchingLocal.registrations);
					setPendingPushOp(matchingLocal.pendingOp);
				} else {
					setConfirmedRegistrations({});
					setPendingPushOp(null);
				}

				// Authoritative server reconciliation (recovers lost local metadata & detects 410-expired endpoints)
				try {
					const lookup = await lookupPushRegistrations(endpoint, controller.signal);
					if (cancelled) return;
					if (lookup.ok) {
						const serverMap: Record<string, LocalPushPlaceRegistration> = {};
						for (const item of lookup.registrations) {
							serverMap[item.placeKey] = {
								subscriptionId: item.subscriptionId,
								placeKey: item.placeKey,
								placeName: item.placeName,
								countryCode: item.countryCode,
								sourceId: item.sourceId,
								lat: item.lat,
								lng: item.lng,
								minSeverity: item.minSeverity,
								confirmedAt: new Date().toISOString(),
							};
						}
						// Clear any pending server-register op if the server already confirmed that place
						let nextPending = matchingLocal?.pendingOp ?? null;
						if (nextPending?.kind === 'register_server' && nextPending.placeKey && serverMap[nextPending.placeKey]) {
							nextPending = null;
						}
						if (nextPending?.kind === 'unsubscribe_place' && nextPending.placeKey && !serverMap[nextPending.placeKey]) {
							nextPending = null;
						}
						if (nextPending?.kind === 'unsubscribe_device' && Object.keys(serverMap).length === 0) {
							nextPending = { kind: 'unsubscribe_browser' };
						}
						persistDeviceState(endpoint, serverMap, nextPending);
					}
				} catch {
					// Offline/network error: keep only previously server-confirmed local state for this exact endpoint
				}
			})
			.catch(() => {
				if (!cancelled) {
					setBrowserEndpoint(null);
					setConfirmedRegistrations({});
					setPendingPushOp(null);
				}
			});

		return () => {
			cancelled = true;
			controller.abort();
		};
	}, [pushBrowserSupported, currentPlaceKey, persistDeviceState]);

	// Only render subscription controls when a place has been selected
	if (!monitoredPlace) {
		return null;
	}

	const deliveryUnavailable = serviceStatus !== null && !serviceStatus.available;
	const pushUnavailable = serviceStatus !== null && !serviceStatus.pushAvailable;

	const sanitizeResidentMessage = (msg: string | undefined, fallback: string): string => {
		if (!msg) return fallback;
		if (/RESEND_API_KEY|AEGIS_DB|VAPID_|501|sms_deferred|https?:\/\/|p256dh|auth/i.test(msg)) {
			debugLog('backend', 'Subscription service returned a sanitized diagnostic error.', 'warning');
			return fallback;
		}
		return msg;
	};

	// If the selected place's country has no supported official feed yet, do not show an irrelevant subscription form
	if (!primaryAuthority && !deliveryUnavailable) {
		return null;
	}

	const activeRegForCurrentPlace =
		browserEndpoint && currentPlaceKey ? confirmedRegistrations[currentPlaceKey] ?? null : null;
	const allConfirmedRegs = Object.values(confirmedRegistrations);
	const otherActivePlacesCount = activeRegForCurrentPlace
		? Math.max(0, allConfirmedRegs.length - 1)
		: allConfirmedRegs.length;
	const hasAnyConfirmedOnDevice = Boolean(browserEndpoint && allConfirmedRegs.length > 0);

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
				locale,
			});
			if (!res.ok) {
				if (res.code === 'delivery_unavailable') {
					setServiceStatus((prev) => ({
						available: false,
						mode: 'unavailable',
						smsAvailable: false,
						pushAvailable: prev?.pushAvailable ?? false,
						pushMode: prev?.pushMode ?? 'unavailable',
						vapidPublicKey: prev?.vapidPublicKey,
						pushReason: prev?.pushReason,
					}));
				}
				setErrorMsg(sanitizeResidentMessage(res.message, t.emailSubFailedError));
			} else {
				setUnsubscribeToken(res.sandboxUnsubscribeToken ?? null);
				setSubStatus(res.status ?? 'pending_confirmation');
				setStatusMsg(sanitizeResidentMessage(res.message, t.subscriptionHeading));
				if (res.sandboxPreviewToken) {
					setPreviewToken(res.sandboxPreviewToken);
				}
			}
		} catch {
			setErrorMsg(t.emailSubFailedError);
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
			if (!res.ok) setErrorMsg(sanitizeResidentMessage(res.message, t.emailConfirmFailedError));
			else {
				setSubStatus(res.status ?? 'active');
				setStatusMsg(sanitizeResidentMessage(res.message, t.pushActiveBadge));
				setPreviewToken(null);
			}
		} catch {
			setErrorMsg(t.emailConfirmFailedError);
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
			if (!res.ok) setErrorMsg(sanitizeResidentMessage(res.message, t.emailUnsubFailedError));
			else {
				setSubStatus(res.status ?? 'unsubscribed');
				setStatusMsg(sanitizeResidentMessage(res.message, t.pushDisabledSuccess));
			}
		} catch {
			setErrorMsg(t.emailUnsubFailedError);
		} finally {
			setSubmitting(false);
		}
	};

	const registerPlaceOnServer = async (params: {
		sub: PushSubscription;
		placeName: string;
		lat: number;
		lng: number;
		countryCode: string;
		sourceId: string;
		severity: 'moderate' | 'severe' | 'extreme';
	}) => {
		const json = params.sub.toJSON() as {
			endpoint?: string;
			expirationTime?: number | null;
			keys?: { p256dh?: string; auth?: string };
		};
		const endpoint = json.endpoint ?? params.sub.endpoint;
		const p256dh = json.keys?.p256dh ?? '';
		const auth = json.keys?.auth ?? '';
		if (!endpoint || !p256dh || !auth) {
			setPushErrorMsg(t.pushIncompleteKeysError);
			return;
		}

		const placeKey = buildPushPlaceKey(params.sourceId, params.lat, params.lng);
		const rounded = canonicalizeSubscriptionCoordinates(params.lat, params.lng);
		const pendingReg: PendingPushOperation = {
			kind: 'register_server',
			placeKey,
			placeName: params.placeName,
			sourceId: params.sourceId,
			lat: rounded.lat,
			lng: rounded.lng,
			countryCode: params.countryCode,
			minSeverity: params.severity,
		};

		try {
			const res = await submitSubscription({
				channel: 'web_push',
				destination: endpoint,
				placeName: params.placeName,
				lat: params.lat,
				lng: params.lng,
				countryCode: params.countryCode,
				sourceId: params.sourceId,
				minSeverity: params.severity,
				locale,
				pushSubscription: {
					endpoint,
					expirationTime: json.expirationTime ?? null,
					keys: { p256dh, auth },
				},
			});

			if (!res.ok || !res.subscriptionId) {
				if (res.code === 'push_delivery_unavailable') {
					setServiceStatus((prev) => ({
						available: prev?.available ?? false,
						mode: prev?.mode ?? 'unavailable',
						smsAvailable: false,
						reason: prev?.reason,
						pushAvailable: false,
						pushMode: 'unavailable',
						pushReason: res.message,
					}));
					persistDeviceState(endpoint, confirmedRegistrations, null);
					setPushErrorMsg(t.pushUnavailableNotice);
					return;
				}
				// Browser push succeeded, server registration failed -> preserve retry state, do NOT mark place active
				persistDeviceState(endpoint, confirmedRegistrations, pendingReg);
				setPushErrorMsg(t.pushServerRegFailedRetry);
				return;
			}

			const nextRegs: Record<string, LocalPushPlaceRegistration> = {
				...confirmedRegistrations,
				[placeKey]: {
					subscriptionId: res.subscriptionId,
					placeKey,
					placeName: params.placeName,
					countryCode: params.countryCode,
					sourceId: params.sourceId,
					lat: rounded.lat,
					lng: rounded.lng,
					minSeverity: params.severity,
					confirmedAt: new Date().toISOString(),
				},
			};
			persistDeviceState(endpoint, nextRegs, null);
			setPushStatusMsg(t.pushActiveSummary.replace('{place}', params.placeName));
		} catch {
			persistDeviceState(endpoint, confirmedRegistrations, pendingReg);
			setPushErrorMsg(t.pushServerRegFailedRetry);
		}
	};

	const handleEnablePush = async () => {
		if (!monitoredPlace || !primaryAuthority || !pushBrowserSupported || pushUnavailable) return;
		setPushBusy(true);
		setPushErrorMsg(null);
		setPushStatusMsg(null);
		try {
			const permission = await window.Notification.requestPermission();
			setNotificationPermission(permission);
			if (permission !== 'granted') {
				setPushErrorMsg(t.pushPermissionDeniedBody);
				return;
			}

			const reg =
				(await navigator.serviceWorker.getRegistration()) ??
				(await navigator.serviceWorker.ready);
			if (!reg?.pushManager) {
				setPushErrorMsg(t.pushUnsupportedNotice);
				return;
			}

			let sub = await reg.pushManager.getSubscription();
			if (!sub) {
				const vapidKey = serviceStatus?.vapidPublicKey;
				if (!vapidKey) {
					setPushErrorMsg(t.pushUnavailableNotice);
					return;
				}
				const applicationServerKey = urlBase64ToUint8Array(vapidKey);
				sub = await reg.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: applicationServerKey as unknown as BufferSource,
				});
			}

			const countryCode = effectiveCountry ?? primaryAuthority.countryCodes[0];
			await registerPlaceOnServer({
				sub,
				placeName: monitoredPlace.label,
				lat: monitoredPlace.lat,
				lng: monitoredPlace.lng,
				countryCode,
				sourceId: primaryAuthority.sourceId,
				severity: minSeverity,
			});
		} catch {
			setPushErrorMsg(t.pushServerRegFailedRetry);
		} finally {
			setPushBusy(false);
		}
	};

	const finalizeBrowserUnsubscribe = async (
		sub: PushSubscription | null | undefined,
		endpoint: string,
		successMessage: string,
	) => {
		if (!sub) {
			persistDeviceState(null, {}, null);
			setPushStatusMsg(successMessage);
			return;
		}
		try {
			const ok = await sub.unsubscribe();
			if (!ok) {
				persistDeviceState(endpoint, {}, { kind: 'unsubscribe_browser' });
				setPushErrorMsg(t.pushBrowserUnsubFailedRetry);
				return;
			}
			persistDeviceState(null, {}, null);
			setPushStatusMsg(successMessage);
		} catch {
			// Server already removed alerts, browser unsubscribe failed -> keep pending op & surface honest warning
			persistDeviceState(endpoint, {}, { kind: 'unsubscribe_browser' });
			setPushErrorMsg(t.pushBrowserUnsubFailedRetry);
		}
	};

	const handleDisablePushForCurrentPlace = async () => {
		if (!monitoredPlace || !primaryAuthority || !currentPlaceKey) return;
		setPushBusy(true);
		setPushErrorMsg(null);
		setPushStatusMsg(null);
		try {
			const reg = await navigator.serviceWorker.getRegistration();
			const sub = await reg?.pushManager?.getSubscription();
			const endpoint = sub?.endpoint ?? browserEndpoint;
			if (!endpoint) {
				persistDeviceState(null, {}, null);
				setPushStatusMsg(t.pushPlaceDisabledSuccess.replace('{place}', monitoredPlace.label));
				return;
			}

			const targetReg = confirmedRegistrations[currentPlaceKey];
			const rounded = canonicalizeSubscriptionCoordinates(monitoredPlace.lat, monitoredPlace.lng);
			const pendingUnsub: PendingPushOperation = {
				kind: 'unsubscribe_place',
				placeKey: currentPlaceKey,
				placeName: monitoredPlace.label,
				sourceId: primaryAuthority.sourceId,
				lat: rounded.lat,
				lng: rounded.lng,
				subscriptionId: targetReg?.subscriptionId,
			};

			let res;
			try {
				res = await unsubscribePushPlace({
					endpoint,
					subscriptionId: targetReg?.subscriptionId,
					sourceId: primaryAuthority.sourceId,
					lat: rounded.lat,
					lng: rounded.lng,
				});
			} catch {
				// Server failure -> preserve local state and allow retry
				persistDeviceState(endpoint, confirmedRegistrations, pendingUnsub);
				setPushErrorMsg(t.pushServerUnsubFailedRetry);
				return;
			}

			if (!res.ok && res.code !== 'not_found') {
				persistDeviceState(endpoint, confirmedRegistrations, pendingUnsub);
				setPushErrorMsg(t.pushServerUnsubFailedRetry);
				return;
			}

			const nextRegs = { ...confirmedRegistrations };
			delete nextRegs[currentPlaceKey];
			const remainingCount =
				typeof res.remainingCount === 'number' ? res.remainingCount : Object.keys(nextRegs).length;

			if (remainingCount > 0) {
				// Preserve browser PushSubscription and other enrolled places!
				persistDeviceState(endpoint, nextRegs, null);
				setPushStatusMsg(
					t.pushPlaceDisabledOthersActive
						.replace('{place}', monitoredPlace.label)
						.replace('{count}', String(remainingCount)),
				);
			} else {
				// No other places remain on this browser -> cleanly unsubscribe browser subscription too
				await finalizeBrowserUnsubscribe(
					sub,
					endpoint,
					t.pushPlaceDisabledSuccess.replace('{place}', monitoredPlace.label),
				);
			}
		} finally {
			setPushBusy(false);
		}
	};

	const handleDisablePushOnDevice = async () => {
		setPushBusy(true);
		setPushErrorMsg(null);
		setPushStatusMsg(null);
		try {
			const reg = await navigator.serviceWorker.getRegistration();
			const sub = await reg?.pushManager?.getSubscription();
			const endpoint = sub?.endpoint ?? browserEndpoint;
			if (!endpoint) {
				persistDeviceState(null, {}, null);
				setPushStatusMsg(t.pushDisabledSuccess);
				return;
			}

			let res;
			try {
				res = await unsubscribePushSubscriptionEndpoint(endpoint);
			} catch {
				persistDeviceState(endpoint, confirmedRegistrations, { kind: 'unsubscribe_device' });
				setPushErrorMsg(t.pushServerUnsubFailedRetry);
				return;
			}

			if (!res.ok && res.code !== 'not_found') {
				persistDeviceState(endpoint, confirmedRegistrations, { kind: 'unsubscribe_device' });
				setPushErrorMsg(t.pushServerUnsubFailedRetry);
				return;
			}

			await finalizeBrowserUnsubscribe(sub, endpoint, t.pushDisabledSuccess);
		} finally {
			setPushBusy(false);
		}
	};

	const handleRetryPendingPushOp = async () => {
		if (!pendingPushOp) return;
		setPushBusy(true);
		setPushErrorMsg(null);
		setPushStatusMsg(null);
		try {
			const reg = await navigator.serviceWorker.getRegistration();
			const sub = await reg?.pushManager?.getSubscription();
			const endpoint = sub?.endpoint ?? browserEndpoint;

			if (pendingPushOp.kind === 'unsubscribe_browser') {
				if (!endpoint) {
					persistDeviceState(null, {}, null);
					setPushStatusMsg(t.pushDisabledSuccess);
				} else {
					await finalizeBrowserUnsubscribe(sub, endpoint, t.pushDisabledSuccess);
				}
				return;
			}

			if (pendingPushOp.kind === 'unsubscribe_device') {
				setPushBusy(false);
				await handleDisablePushOnDevice();
				return;
			}

			if (pendingPushOp.kind === 'unsubscribe_place' && endpoint && pendingPushOp.sourceId && pendingPushOp.lat != null && pendingPushOp.lng != null) {
				try {
					const res = await unsubscribePushPlace({
						endpoint,
						subscriptionId: pendingPushOp.subscriptionId,
						sourceId: pendingPushOp.sourceId,
						lat: pendingPushOp.lat,
						lng: pendingPushOp.lng,
					});
					if (!res.ok && res.code !== 'not_found') {
						setPushErrorMsg(t.pushServerUnsubFailedRetry);
						return;
					}
					const nextRegs = { ...confirmedRegistrations };
					if (pendingPushOp.placeKey) delete nextRegs[pendingPushOp.placeKey];
					const remainingCount =
						typeof res.remainingCount === 'number' ? res.remainingCount : Object.keys(nextRegs).length;
					if (remainingCount > 0) {
						persistDeviceState(endpoint, nextRegs, null);
						setPushStatusMsg(
							t.pushPlaceDisabledOthersActive
								.replace('{place}', pendingPushOp.placeName ?? monitoredPlace.label)
								.replace('{count}', String(remainingCount)),
						);
					} else {
						await finalizeBrowserUnsubscribe(
							sub,
							endpoint,
							t.pushPlaceDisabledSuccess.replace('{place}', pendingPushOp.placeName ?? monitoredPlace.label),
						);
					}
				} catch {
					setPushErrorMsg(t.pushServerUnsubFailedRetry);
				}
				return;
			}

			if (pendingPushOp.kind === 'register_server' && sub && pendingPushOp.sourceId && pendingPushOp.lat != null && pendingPushOp.lng != null) {
				await registerPlaceOnServer({
					sub,
					placeName: pendingPushOp.placeName ?? monitoredPlace.label,
					lat: pendingPushOp.lat,
					lng: pendingPushOp.lng,
					countryCode: pendingPushOp.countryCode ?? effectiveCountry ?? primaryAuthority?.countryCodes[0] ?? 'NO',
					sourceId: pendingPushOp.sourceId,
					severity: pendingPushOp.minSeverity ?? minSeverity,
				});
			}
		} finally {
			setPushBusy(false);
		}
	};

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
					{deliveryUnavailable && pushUnavailable ? (
						<BellOff size={16} className="text-amber-400 shrink-0" aria-hidden="true" />
					) : (
						<Bell size={16} className="text-blue-400 shrink-0" aria-hidden="true" />
					)}
					<span>{t.subscriptionHeading}</span>
				</h2>
				<div className="flex flex-wrap items-center gap-1.5">
					{(serviceStatus?.mode === 'sandbox' || serviceStatus?.pushMode === 'sandbox') && (
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

			{/* Separate explicit Browser Web Push opt-in (per-place confirmed state + explicit device scope) */}
			<div
				data-testid="web-push-optin-card"
				data-push-active-place={activeRegForCurrentPlace ? 'true' : 'false'}
				data-push-active-count={String(allConfirmedRegs.length)}
				className="rounded-xl p-3 border space-y-2 text-xs"
				style={{
					background: 'var(--color-surface-card)',
					borderColor: ds.surface.border,
				}}
			>
				<div className="flex items-center justify-between gap-2">
					<span className="font-bold flex items-center gap-1.5" style={{ color: ds.text.primary }}>
						<BellRing size={14} className="text-blue-400 shrink-0" aria-hidden="true" />
						<span>{t.pushHeading}</span>
					</span>
					{activeRegForCurrentPlace && (
						<span
							data-testid="push-active-badge"
							className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
						>
							{t.pushActiveBadge}
						</span>
					)}
				</div>

				{!pushBrowserSupported ? (
					<p data-testid="push-unsupported-notice" className="leading-relaxed" style={{ color: ds.text.secondary }}>
						{t.pushUnsupportedNotice}
					</p>
				) : pushUnavailable || serviceStatus === null ? (
					<p data-testid="push-unavailable-notice" className="leading-relaxed" style={{ color: ds.text.secondary }}>
						{t.pushUnavailableNotice}
					</p>
				) : notificationPermission === 'denied' ? (
					<div
						data-testid="push-permission-denied"
						className="rounded-lg p-2.5 border border-amber-500/40 bg-amber-500/10 space-y-1"
						style={{ color: ds.text.primary }}
					>
						<div className="font-semibold flex items-center gap-1.5 text-amber-300">
							<ShieldAlert size={13} aria-hidden="true" />
							<span>{t.pushPermissionDeniedTitle}</span>
						</div>
						<p className="leading-relaxed" style={{ color: ds.text.secondary }}>
							{t.pushPermissionDeniedBody}
						</p>
					</div>
				) : activeRegForCurrentPlace ? (
					<div className="space-y-2">
						<p className="leading-relaxed" style={{ color: ds.text.secondary }}>
							{pushStatusMsg ?? t.pushActiveSummary.replace('{place}', monitoredPlace.label)}
						</p>
						{otherActivePlacesCount > 0 && (
							<p data-testid="push-other-places-note" className="text-[11px]" style={{ color: ds.text.tertiary }}>
								{t.pushOtherPlacesNote.replace('{count}', String(otherActivePlacesCount))}
							</p>
						)}
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={handleDisablePushForCurrentPlace}
								disabled={pushBusy}
								data-testid="disable-push-alerts-btn"
								className="min-h-[38px] px-3 py-1.5 rounded-lg border border-red-400/50 text-red-300 hover:bg-red-500/15 font-semibold cursor-pointer disabled:opacity-50"
							>
								{pushBusy ? '…' : t.pushDisablePlaceBtn}
							</button>
							{otherActivePlacesCount > 0 && (
								<button
									type="button"
									onClick={handleDisablePushOnDevice}
									disabled={pushBusy}
									data-testid="disable-push-device-btn"
									className="min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer disabled:opacity-50"
									style={{
										borderColor: ds.surface.border,
										color: ds.text.secondary,
										background: ds.surface.overlaySubtle,
									}}
								>
									{pushBusy ? '…' : t.pushDisableDeviceBtn}
								</button>
							)}
						</div>
					</div>
				) : (
					<div className="space-y-2">
						<p className="leading-relaxed" style={{ color: ds.text.secondary }}>
							{t.pushReadyBody}
						</p>
						{otherActivePlacesCount > 0 && (
							<p data-testid="push-other-places-note" className="text-[11px]" style={{ color: ds.text.tertiary }}>
								{t.pushOtherPlacesNote.replace('{count}', String(otherActivePlacesCount))}
							</p>
						)}
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={handleEnablePush}
								disabled={pushBusy || !primaryAuthority}
								data-testid="enable-push-alerts-btn"
								className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white cursor-pointer"
							>
								<BellRing size={14} aria-hidden="true" />
								<span>{pushBusy ? '…' : hasAnyConfirmedOnDevice ? t.pushEnablePlaceBtn : t.pushEnableBtn}</span>
							</button>
							{hasAnyConfirmedOnDevice && (
								<button
									type="button"
									onClick={handleDisablePushOnDevice}
									disabled={pushBusy}
									data-testid="disable-push-device-btn"
									className="min-h-[40px] px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer disabled:opacity-50"
									style={{
										borderColor: ds.surface.border,
										color: ds.text.secondary,
										background: ds.surface.overlaySubtle,
									}}
								>
									{pushBusy ? '…' : t.pushDisableDeviceBtn}
								</button>
							)}
						</div>
					</div>
				)}

				{pushErrorMsg && (
					<div role="alert" data-testid="push-error-banner" className="rounded-lg p-2.5 border border-red-500/40 bg-red-500/10 text-red-300 space-y-2">
						<p>{pushErrorMsg}</p>
						{pendingPushOp && (
							<button
								type="button"
								onClick={handleRetryPendingPushOp}
								disabled={pushBusy}
								data-testid="retry-push-op-btn"
								className="min-h-[34px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-red-400/50 bg-red-500/15 hover:bg-red-500/25 text-red-200 font-semibold cursor-pointer disabled:opacity-50"
							>
								<RotateCcw size={12} aria-hidden="true" />
								<span>{t.pushRetryBtn}</span>
							</button>
						)}
					</div>
				)}
				{pushStatusMsg && !activeRegForCurrentPlace && (
					<div role="status" data-testid="push-status-banner" className="rounded-lg p-2 border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
						{pushStatusMsg}
					</div>
				)}
			</div>

			{/* Email alerts: show real form only when server email delivery is available; hide inert inputs when unavailable */}
			{deliveryUnavailable ? (
				<div
					role="status"
					data-testid="subscription-unavailable-banner"
					className="rounded-xl p-3.5 border border-amber-500/40 bg-amber-500/10 text-xs space-y-1"
					style={{ color: ds.text.primary }}
				>
					<div data-testid="subscription-email-unavailable" className="font-bold">
						{t.subscriptionUnavailableTitle}
					</div>
					<p className="leading-relaxed" style={{ color: ds.text.secondary }}>
						{t.subscriptionUnavailableBody}
					</p>
				</div>
			) : (
				<>
					<p className="text-xs leading-relaxed" style={{ color: ds.text.secondary }}>
						{t.subscriptionEmailDesc
							.replace('{authority}', primaryAuthority?.authorityName ?? '')
							.replace('{place}', monitoredPlace.label)}
					</p>

					<form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
						<label className="flex flex-col gap-1">
							<span className="font-semibold" style={{ color: ds.text.secondary }}>
								{t.subscriptionEmailLabel}
							</span>
							<input
								type="email"
								required
								disabled={submitting || !primaryAuthority}
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
								{t.subscriptionSeverityLabel}
							</span>
							<select
								value={minSeverity}
								disabled={submitting || !primaryAuthority}
								onChange={(e) => setMinSeverity(e.target.value as 'moderate' | 'severe' | 'extreme')}
								className="min-h-[42px] px-3 py-2 rounded-xl border disabled:opacity-50"
								style={{
									background: 'var(--color-surface-card)',
									borderColor: ds.surface.border,
									color: ds.text.primary,
								}}
							>
								<option value="moderate" style={{ background: '#111827', color: '#fff' }}>
									{t.subscriptionSeverityModerate}
								</option>
								<option value="severe" style={{ background: '#111827', color: '#fff' }}>
									{t.subscriptionSeveritySevere}
								</option>
								<option value="extreme" style={{ background: '#111827', color: '#fff' }}>
									{t.subscriptionSeverityExtreme}
								</option>
							</select>
						</label>

						<div className="flex items-end">
							<button
								type="submit"
								disabled={submitting || !primaryAuthority}
								data-testid="subscription-submit-btn"
								className="w-full min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white cursor-pointer"
							>
								<Mail size={14} aria-hidden="true" />
								<span>{submitting ? '…' : t.subscriptionSubmitBtn}</span>
							</button>
						</div>
					</form>
				</>
			)}

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
