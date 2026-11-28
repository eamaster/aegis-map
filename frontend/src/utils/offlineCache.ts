/**
 * Offline notice cache for resident Near me warnings.
 * Stores only public warning snapshots keyed by rounded place + country (never user PII).
 * Clearly separates:
 *  - empty first visit offline
 *  - cached valid snapshot
 *  - cached snapshot with expired warnings
 *  - live fresh snapshot
 */
import type { WarningsApiResponse } from '../../../shared/contracts';

const NOTICE_CACHE_PREFIX = 'aegis:warnings-cache:v1:';
const NOTICE_CACHE_INDEX_KEY = 'aegis:warnings-cache-index:v1';
const MAX_CACHED_PLACES = 10;

export interface CachedWarningsEntry {
	cacheKey: string;
	cachedAt: string;
	payload: WarningsApiResponse;
}

export interface OfflineWarningsState {
	status: 'live' | 'cached_valid' | 'cached_expired' | 'empty_offline';
	entry: CachedWarningsEntry | null;
	expiredWarningIds: string[];
}

export function buildNoticeCacheKey(lat: number, lng: number, countryCode: string | null): string {
	const cc = (countryCode ?? 'AUTO').toUpperCase();
	return `${lat.toFixed(2)}:${lng.toFixed(2)}:${cc}`;
}

export function saveCachedWarnings(
	lat: number,
	lng: number,
	countryCode: string | null,
	payload: WarningsApiResponse,
	storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
	nowMs: number = Date.now(),
): void {
	const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
	if (!target) return;

	const cacheKey = buildNoticeCacheKey(lat, lng, countryCode);
	const fullKey = `${NOTICE_CACHE_PREFIX}${cacheKey}`;
	const entry: CachedWarningsEntry = {
		cacheKey,
		cachedAt: new Date(nowMs).toISOString(),
		payload,
	};

	try {
		target.setItem(fullKey, JSON.stringify(entry));
		const rawIdx = target.getItem(NOTICE_CACHE_INDEX_KEY);
		const prevIdx: string[] = rawIdx ? (JSON.parse(rawIdx) as string[]) : [];
		const nextIdx = [cacheKey, ...prevIdx.filter((k) => k !== cacheKey)];
		while (nextIdx.length > MAX_CACHED_PLACES) {
			const dropped = nextIdx.pop();
			if (dropped) target.removeItem(`${NOTICE_CACHE_PREFIX}${dropped}`);
		}
		target.setItem(NOTICE_CACHE_INDEX_KEY, JSON.stringify(nextIdx));
	} catch {
		// Ignore quota errors
	}
}

export function loadCachedWarnings(
	lat: number,
	lng: number,
	countryCode: string | null,
	storage?: Pick<Storage, 'getItem'> | null,
	nowMs: number = Date.now(),
): OfflineWarningsState {
	const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
	if (!target) {
		return { status: 'empty_offline', entry: null, expiredWarningIds: [] };
	}

	const cacheKey = buildNoticeCacheKey(lat, lng, countryCode);
	try {
		const raw = target.getItem(`${NOTICE_CACHE_PREFIX}${cacheKey}`);
		if (!raw) {
			return { status: 'empty_offline', entry: null, expiredWarningIds: [] };
		}
		const entry = JSON.parse(raw) as CachedWarningsEntry;
		if (!entry?.payload || !Array.isArray(entry.payload.warnings)) {
			return { status: 'empty_offline', entry: null, expiredWarningIds: [] };
		}
		const expiredWarningIds = entry.payload.warnings
			.filter((w) => w.expiresAt && Date.parse(w.expiresAt) <= nowMs)
			.map((w) => w.id);
		return {
			status: expiredWarningIds.length > 0 ? 'cached_expired' : 'cached_valid',
			entry,
			expiredWarningIds,
		};
	} catch {
		return { status: 'empty_offline', entry: null, expiredWarningIds: [] };
	}
}

export interface LocalPushPlaceRegistration {
	subscriptionId: string;
	placeKey: string;
	placeName: string;
	countryCode: string;
	sourceId: string;
	lat: number;
	lng: number;
	minSeverity: 'moderate' | 'severe' | 'extreme';
	confirmedAt: string;
}

export interface PendingPushOperation {
	kind: 'register_server' | 'unsubscribe_place' | 'unsubscribe_device' | 'unsubscribe_browser';
	placeKey?: string;
	placeName?: string;
	sourceId?: string;
	lat?: number;
	lng?: number;
	countryCode?: string;
	subscriptionId?: string;
	minSeverity?: 'moderate' | 'severe' | 'extreme';
}

export interface LocalPushDeviceState {
	endpoint: string;
	registrations: Record<string, LocalPushPlaceRegistration>;
	pendingOp: PendingPushOperation | null;
	updatedAt: string;
}

const PUSH_SUB_STORAGE_KEY_V2 = 'aegis:push-sub:v2';
const LEGACY_PUSH_SUB_STORAGE_KEY_V1 = 'aegis:push-sub:v1';

export function saveLocalPushDeviceState(
	state: LocalPushDeviceState,
	storage?: Pick<Storage, 'setItem' | 'removeItem'> | null,
): void {
	const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
	if (!target) return;
	try {
		target.setItem(PUSH_SUB_STORAGE_KEY_V2, JSON.stringify(state));
		target.removeItem?.(LEGACY_PUSH_SUB_STORAGE_KEY_V1);
	} catch {
		// ignore quota error
	}
}

export function loadLocalPushDeviceState(
	storage?: Pick<Storage, 'getItem'> | null,
): LocalPushDeviceState | null {
	const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
	if (!target) return null;
	try {
		const raw = target.getItem(PUSH_SUB_STORAGE_KEY_V2);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<LocalPushDeviceState>;
		if (typeof parsed.endpoint !== 'string' || !parsed.endpoint) return null;
		const regs: Record<string, LocalPushPlaceRegistration> = {};
		if (parsed.registrations && typeof parsed.registrations === 'object') {
			for (const [k, v] of Object.entries(parsed.registrations)) {
				if (
					v &&
					typeof v.subscriptionId === 'string' &&
					typeof v.placeKey === 'string' &&
					typeof v.sourceId === 'string' &&
					typeof v.lat === 'number' &&
					typeof v.lng === 'number'
				) {
					regs[k] = {
						subscriptionId: v.subscriptionId,
						placeKey: v.placeKey,
						placeName: typeof v.placeName === 'string' ? v.placeName : '',
						countryCode: typeof v.countryCode === 'string' ? v.countryCode : '',
						sourceId: v.sourceId,
						lat: v.lat,
						lng: v.lng,
						minSeverity:
							v.minSeverity === 'extreme' || v.minSeverity === 'severe' ? v.minSeverity : 'moderate',
						confirmedAt: typeof v.confirmedAt === 'string' ? v.confirmedAt : '',
					};
				}
			}
		}
		return {
			endpoint: parsed.endpoint,
			registrations: regs,
			pendingOp: parsed.pendingOp && typeof parsed.pendingOp.kind === 'string' ? parsed.pendingOp : null,
			updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
		};
	} catch {
		return null;
	}
}

export function clearLocalPushDeviceState(
	storage?: Pick<Storage, 'removeItem'> | null,
): void {
	const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
	if (!target) return;
	try {
		target.removeItem(PUSH_SUB_STORAGE_KEY_V2);
		target.removeItem(LEGACY_PUSH_SUB_STORAGE_KEY_V1);
	} catch {
		// ignore
	}
}

export async function clearAllLocalResidentData(
	storage?: Pick<Storage, 'length' | 'key' | 'removeItem'> | null,
): Promise<void> {
	const local = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
	if (local) {
		const keysToRemove: string[] = [];
		for (let i = 0; i < local.length; i++) {
			const k = local.key(i);
			if (k && k.startsWith('aegis')) keysToRemove.push(k);
		}
		for (const k of keysToRemove) {
			local.removeItem(k);
		}
	}
	if (typeof window !== 'undefined') {
		try {
			window.sessionStorage.clear();
		} catch {
			// ignore
		}
		if ('caches' in window) {
			const names = await window.caches.keys();
			await Promise.all(names.filter((n) => n.startsWith('aegis-')).map((n) => window.caches.delete(n)));
		}
		if ('serviceWorker' in navigator) {
			const regs = await navigator.serviceWorker.getRegistrations();
			for (const reg of regs) {
				try {
					const pushSub = await reg.pushManager?.getSubscription();
					if (pushSub) {
						await pushSub.unsubscribe();
					}
				} catch {
					// ignore push unsubscribe failures when clearing local state
				}
			}
			await Promise.all(regs.map((r) => r.unregister()));
		}
	}
}
