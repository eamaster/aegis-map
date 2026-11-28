import type {
	HistoryApiResponse,
	PushLookupResponse,
	SarScenesApiResponse,
	SourceAnalyticsApiResponse,
	SubscriptionCreateRequest,
	SubscriptionResponse,
	SubscriptionServiceStatus,
} from '../../../shared/contracts';
import { apiUrl } from '../config/api';

export async function fetchSarScenes(options: {
	lat: number;
	lng: number;
	startIso?: string;
	endIso?: string;
	token?: string | null;
	signal?: AbortSignal;
}): Promise<SarScenesApiResponse> {
	const params = new URLSearchParams({
		lat: String(options.lat),
		lng: String(options.lng),
		limit: '6',
	});
	if (options.startIso) params.set('start', options.startIso);
	if (options.endIso) params.set('end', options.endIso);
	if (options.token) params.set('token', options.token);

	const res = await fetch(apiUrl(`/api/v1/sar-scenes?${params.toString()}`), { signal: options.signal });
	if (!res.ok) {
		let msg = `SAR STAC request failed (${res.status})`;
		try {
			const body = (await res.json()) as { error?: string; detail?: string };
			if (body.error) msg = body.detail ? `${body.error}: ${body.detail}` : body.error;
		} catch {
			// ignore parse error
		}
		throw new Error(msg);
	}
	return (await res.json()) as SarScenesApiResponse;
}

export async function fetchArchivedHistory(options: {
	type?: string;
	from?: string;
	to?: string;
	limit?: number;
	signal?: AbortSignal;
}): Promise<HistoryApiResponse> {
	const params = new URLSearchParams({ limit: String(options.limit ?? 50) });
	if (options.type && options.type !== 'all') params.set('type', options.type);
	if (options.from) params.set('from', options.from);
	if (options.to) params.set('to', options.to);

	const res = await fetch(apiUrl(`/api/v1/history?${params.toString()}`), { signal: options.signal });
	if (!res.ok) {
		throw new Error(`History API returned HTTP ${res.status}`);
	}
	return (await res.json()) as HistoryApiResponse;
}

export async function fetchSourceAnalytics(signal?: AbortSignal): Promise<SourceAnalyticsApiResponse> {
	const res = await fetch(apiUrl('/api/v1/analytics/sources'), { signal });
	if (!res.ok) {
		throw new Error(`Source analytics API returned HTTP ${res.status}`);
	}
	return (await res.json()) as SourceAnalyticsApiResponse;
}

export async function fetchSubscriptionStatus(signal?: AbortSignal): Promise<SubscriptionServiceStatus> {
	const res = await fetch(apiUrl('/api/v1/subscriptions/status'), { signal });
	if (!res.ok) {
		return {
			available: false,
			mode: 'unavailable',
			smsAvailable: false,
			reason: `Subscription status check failed (HTTP ${res.status}).`,
			pushAvailable: false,
			pushMode: 'unavailable',
			pushReason: `Subscription status check failed (HTTP ${res.status}).`,
		};
	}
	return (await res.json()) as SubscriptionServiceStatus;
}

async function parseSubscriptionJson(res: Response, fallbackMessage: string): Promise<SubscriptionResponse> {
	try {
		const body = (await res.json()) as Partial<SubscriptionResponse>;
		if (typeof body.ok === 'boolean') {
			return {
				...body,
				ok: body.ok,
				message: typeof body.message === 'string' && body.message ? body.message : fallbackMessage,
			};
		}
	} catch {
		// non-JSON error body
	}
	return {
		ok: false,
		code: `http_${res.status}`,
		message: fallbackMessage,
	};
}

export async function submitSubscription(req: SubscriptionCreateRequest): Promise<SubscriptionResponse> {
	const res = await fetch(apiUrl('/api/v1/subscriptions'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(req),
	});
	return parseSubscriptionJson(res, `Subscription request failed (HTTP ${res.status}).`);
}

export async function lookupPushRegistrations(
	endpoint: string,
	signal?: AbortSignal,
): Promise<PushLookupResponse> {
	const res = await fetch(apiUrl('/api/v1/subscriptions/push-lookup'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ endpoint }),
		signal,
	});
	if (!res.ok) {
		return {
			ok: false,
			registrations: [],
			code: `http_${res.status}`,
			message: `Push registration lookup failed (HTTP ${res.status}).`,
		};
	}
	return (await res.json()) as PushLookupResponse;
}

export async function confirmSubscriptionToken(token: string): Promise<SubscriptionResponse> {
	const res = await fetch(apiUrl('/api/v1/subscriptions/confirm'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token }),
	});
	return parseSubscriptionJson(res, `Confirmation failed (HTTP ${res.status}).`);
}

export async function unsubscribeSubscriptionToken(token: string): Promise<SubscriptionResponse> {
	const res = await fetch(apiUrl('/api/v1/subscriptions/unsubscribe'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token }),
	});
	return parseSubscriptionJson(res, `Unsubscribe failed (HTTP ${res.status}).`);
}

export async function unsubscribePushPlace(options: {
	endpoint: string;
	subscriptionId?: string;
	sourceId: string;
	lat: number;
	lng: number;
}): Promise<SubscriptionResponse> {
	const res = await fetch(apiUrl('/api/v1/subscriptions/unsubscribe'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			channel: 'web_push',
			endpoint: options.endpoint,
			scope: 'place',
			...(options.subscriptionId ? { subscriptionId: options.subscriptionId } : {}),
			sourceId: options.sourceId,
			lat: options.lat,
			lng: options.lng,
		}),
	});
	return parseSubscriptionJson(res, `Disabling push for this place failed (HTTP ${res.status}).`);
}

export async function unsubscribePushSubscriptionEndpoint(endpoint: string): Promise<SubscriptionResponse> {
	const res = await fetch(apiUrl('/api/v1/subscriptions/unsubscribe'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ channel: 'web_push', endpoint, scope: 'device' }),
	});
	return parseSubscriptionJson(res, `Disabling push on this device failed (HTTP ${res.status}).`);
}
