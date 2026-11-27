import type {
	HistoryApiResponse,
	SarScenesApiResponse,
	SourceAnalyticsApiResponse,
	SubscriptionCreateRequest,
	SubscriptionResponse,
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

export async function submitSubscription(req: SubscriptionCreateRequest): Promise<SubscriptionResponse> {
	const res = await fetch(apiUrl('/api/v1/subscriptions'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(req),
	});
	return (await res.json()) as SubscriptionResponse;
}

export async function confirmSubscriptionToken(token: string): Promise<SubscriptionResponse> {
	const res = await fetch(apiUrl('/api/v1/subscriptions/confirm'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token }),
	});
	return (await res.json()) as SubscriptionResponse;
}

export async function unsubscribeSubscriptionToken(token: string): Promise<SubscriptionResponse> {
	const res = await fetch(apiUrl('/api/v1/subscriptions/unsubscribe'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token }),
	});
	return (await res.json()) as SubscriptionResponse;
}
