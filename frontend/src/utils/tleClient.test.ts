import { describe, expect, it } from 'vitest';
import { createTleClient, TLE_CLIENT_REUSE_MS } from './tleClient';

const TLE = 'TERRA\n1 25994U ...\n2 25994 ...';

function harness(responses: Array<() => Response | Promise<Response>>) {
    let t = 1_000_000;
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
        calls.push(url);
        const next = responses.shift();
        if (!next) throw new Error('unexpected request');
        return next();
    };
    const client = createTleClient({ fetchImpl, url: 'https://api.example/api/tles', now: () => t });
    return { client, calls, advance: (ms: number) => (t += ms) };
}

const unavailable = (retryAfterSeconds: number | null) => () =>
    new Response(JSON.stringify({ code: 'tle_unavailable', missing: [25994], failed: [], retryAfterSeconds }), {
        status: 502,
        headers: retryAfterSeconds !== null ? { 'Retry-After': String(retryAfterSeconds) } : {},
    });

describe('shared TLE client', () => {
    it('gives concurrent and repeated selections one request', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const { client, calls } = harness([async () => (await gate, new Response(TLE))]);
        const a = client.load();
        const b = client.load();
        release();
        const [ra, rb] = await Promise.all([a, b]);
        expect(ra).toBe(rb);
        expect(ra.ok).toBe(true);
        await client.load();
        expect(calls).toHaveLength(1);
    });

    it('requests again after the reuse window', async () => {
        const { client, calls, advance } = harness([() => new Response(TLE), () => new Response(TLE)]);
        await client.load();
        advance(TLE_CLIENT_REUSE_MS + 1);
        await client.load();
        expect(calls).toHaveLength(2);
    });

    it('honors Retry-After for ordinary loads but lets an intentional retry through', async () => {
        const { client, calls, advance } = harness([unavailable(600), unavailable(540), () => new Response(TLE)]);
        const first = await client.load();
        expect(first).toEqual({ ok: false, status: 502, code: 'tle_unavailable', missing: [25994], retryAfterSeconds: 600 });
        await client.load();
        expect(calls).toHaveLength(1);

        const retried = await client.load({ force: true });
        expect(retried.ok).toBe(false);
        expect(calls).toHaveLength(2);

        advance(541_000);
        expect((await client.load()).ok).toBe(true);
        expect(calls).toHaveLength(3);
    });

    it('does not cache failures without Retry-After or network errors', async () => {
        const { client, calls } = harness([
            unavailable(null),
            () => {
                throw new TypeError('Failed to fetch');
            },
            () => new Response(TLE),
        ]);
        expect(await client.load()).toMatchObject({ ok: false, code: 'tle_unavailable', retryAfterSeconds: null });
        expect(await client.load()).toMatchObject({ ok: false, status: null, code: 'network' });
        expect((await client.load()).ok).toBe(true);
        expect(calls).toHaveLength(3);
    });

    it('labels non-JSON error bodies by HTTP status', async () => {
        const { client } = harness([() => new Response('<html>Bad gateway</html>', { status: 502 })]);
        expect(await client.load()).toMatchObject({ ok: false, code: 'http_502' });
    });
});
