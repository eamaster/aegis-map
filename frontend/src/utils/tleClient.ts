/**
 * Shared /api/tles client. The response is the whole monitored fleet, so
 * every selection can reuse it: concurrent callers share one in-flight
 * request, a success is reused for a short window, and a failure that
 * carries Retry-After is not re-requested before then. An intentional retry
 * (force) skips both, but still joins a request that is already running.
 * Sharing is per browser tab; it does not coordinate other clients.
 *
 * Callers never abort the shared request; they discard results for stale
 * selections with their own generation guard.
 */
import { apiUrl } from '../config/api';

export type TleFetchResult =
    | { ok: true; text: string; headers: Headers }
    | { ok: false; status: number | null; code: string; missing: number[]; retryAfterSeconds: number | null };

export const TLE_CLIENT_REUSE_MS = 10 * 60 * 1000;
/** The Worker may wait on CelesTrak for up to 25 s per satellite on a cold cache. */
export const TLE_CLIENT_TIMEOUT_MS = 45_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function requestTles(fetchImpl: FetchLike, url: string): Promise<TleFetchResult> {
    let response: Response;
    try {
        response = await fetchImpl(url, { signal: AbortSignal.timeout(TLE_CLIENT_TIMEOUT_MS) });
    } catch (err) {
        const code = err instanceof DOMException && err.name === 'TimeoutError' ? 'timeout' : 'network';
        return { ok: false, status: null, code, missing: [], retryAfterSeconds: null };
    }
    const text = await response.text().catch(() => '');
    if (response.ok) return { ok: true, text, headers: response.headers };

    let body: { code?: unknown; missing?: unknown; retryAfterSeconds?: unknown } = {};
    try {
        body = JSON.parse(text);
    } catch {
        /* non-JSON error body */
    }
    const header = Number(response.headers.get('Retry-After'));
    const retryAfterSeconds =
        typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : Number.isFinite(header) && header > 0 ? header : null;
    return {
        ok: false,
        status: response.status,
        code: typeof body.code === 'string' ? body.code : `http_${response.status}`,
        missing: Array.isArray(body.missing) ? body.missing.filter((id): id is number => typeof id === 'number') : [],
        retryAfterSeconds,
    };
}

export function createTleClient(options: { fetchImpl?: FetchLike; url?: string; now?: () => number } = {}) {
    const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
    const url = options.url ?? apiUrl('/api/tles');
    const now = options.now ?? Date.now;
    let inFlight: Promise<TleFetchResult> | null = null;
    let settled: { result: TleFetchResult; reuseUntil: number } | null = null;

    return {
        load({ force = false }: { force?: boolean } = {}): Promise<TleFetchResult> {
            if (inFlight) return inFlight;
            if (!force && settled && now() < settled.reuseUntil) return Promise.resolve(settled.result);
            inFlight = requestTles(fetchImpl, url).then((result) => {
                const reuseMs = result.ok
                    ? TLE_CLIENT_REUSE_MS
                    : result.retryAfterSeconds !== null
                      ? result.retryAfterSeconds * 1000
                      : 0;
                settled = reuseMs > 0 ? { result, reuseUntil: now() + reuseMs } : null;
                inFlight = null;
                return result;
            });
            return inFlight;
        },
    };
}

export const tleClient = createTleClient();
