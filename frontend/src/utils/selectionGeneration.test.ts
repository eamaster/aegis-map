import { describe, expect, it } from 'vitest';
import {
    analysisRequestIdentity,
    isCurrentGeneration,
    nextGeneration,
} from './selectionGeneration';

/**
 * Mirrors Sidebar generation-guard semantics without mounting React:
 * obsolete async completions must not mutate current state.
 */
async function simulateGuardedUpdate<T>(
    generation: number,
    getCurrent: () => number,
    work: () => Promise<T>,
    apply: (value: T) => void,
): Promise<boolean> {
    const value = await work();
    if (!isCurrentGeneration(generation, getCurrent())) return false;
    apply(value);
    return true;
}

describe('selectionGeneration', () => {
    it('advances generations monotonically and compares current selection', () => {
        expect(nextGeneration(0)).toBe(1);
        expect(nextGeneration(3)).toBe(4);
        expect(isCurrentGeneration(2, 2)).toBe(true);
        expect(isCurrentGeneration(2, 3)).toBe(false);
    });

    it('builds distinct request identities for retry and cloud unknown vs zero', () => {
        const base = {
            disasterId: 'evt-1',
            satelliteName: 'LANDSAT 9',
            passIso: '2026-10-08T15:00:00.000Z',
            cloudCover: 0 as number | null,
            retryToken: 0,
        };
        const a = analysisRequestIdentity(base);
        const b = analysisRequestIdentity({ ...base, cloudCover: null });
        const c = analysisRequestIdentity({ ...base, retryToken: 1 });
        expect(a).not.toBe(b);
        expect(a).not.toBe(c);
        expect(JSON.parse(a).retryToken).toBe(0);
        expect(JSON.parse(c).retryToken).toBe(1);
    });

    it('changes identity when disaster selection changes', () => {
        const a = analysisRequestIdentity({
            disasterId: 'a',
            satelliteName: 'LANDSAT 9',
            passIso: '2026-10-08T15:00:00.000Z',
            cloudCover: 10,
            retryToken: 0,
        });
        const b = analysisRequestIdentity({
            disasterId: 'b',
            satelliteName: 'LANDSAT 9',
            passIso: '2026-10-08T15:00:00.000Z',
            cloudCover: 10,
            retryToken: 0,
        });
        expect(a).not.toBe(b);
    });

    it('drops delayed out-of-order TLE/weather/analysis updates after selection change', async () => {
        let current = 1;
        const state: { tle?: string; weather?: number | null; analysis?: string } = {};

        const tleSlow = simulateGuardedUpdate(
            1,
            () => current,
            async () => {
                await new Promise((r) => setTimeout(r, 30));
                return 'stale-tle';
            },
            (v) => {
                state.tle = v;
            },
        );
        current = nextGeneration(current); // selection changed before slow TLE returns
        const tleApplied = await tleSlow;
        expect(tleApplied).toBe(false);
        expect(state.tle).toBeUndefined();

        const gen2 = current;
        const weatherOk = await simulateGuardedUpdate(
            gen2,
            () => current,
            async () => null as number | null,
            (v) => {
                state.weather = v;
            },
        );
        expect(weatherOk).toBe(true);
        expect(state.weather).toBeNull();

        const analysisStale = simulateGuardedUpdate(
            gen2,
            () => current,
            async () => {
                await new Promise((r) => setTimeout(r, 20));
                return 'stale-analysis';
            },
            (v) => {
                state.analysis = v;
            },
        );
        current = nextGeneration(current); // unmount / close / reselect
        expect(await analysisStale).toBe(false);
        expect(state.analysis).toBeUndefined();
    });

    it('allows a single intentional retry with a new identity after failure', () => {
        const failed = analysisRequestIdentity({
            disasterId: 'evt-1',
            satelliteName: 'LANDSAT 9',
            passIso: '2026-10-08T15:00:00.000Z',
            cloudCover: null,
            retryToken: 0,
        });
        const retry = analysisRequestIdentity({
            disasterId: 'evt-1',
            satelliteName: 'LANDSAT 9',
            passIso: '2026-10-08T15:00:00.000Z',
            cloudCover: null,
            retryToken: 1,
        });
        expect(failed).not.toBe(retry);
        // Strict Mode double-mount with same token must share identity (no auto-loop)
        const remount = analysisRequestIdentity({
            disasterId: 'evt-1',
            satelliteName: 'LANDSAT 9',
            passIso: '2026-10-08T15:00:00.000Z',
            cloudCover: null,
            retryToken: 1,
        });
        expect(retry).toBe(remount);
    });
});
