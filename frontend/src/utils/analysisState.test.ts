import { describe, expect, it } from 'vitest';
import { analysisViewState, blockedAnalysisMessage } from './analysisState';

const base = { passState: 'pass' as const, loading: false, hasAnalysis: false, errorCode: null };

describe('AI Insight state', () => {
    it('reports missing prerequisites as blocked, not as AI failures', () => {
        expect(analysisViewState({ ...base, passState: 'loading' })).toBe('waiting-orbit');
        expect(analysisViewState({ ...base, passState: 'unavailable' })).toBe('blocked-orbit');
        expect(analysisViewState({ ...base, passState: 'no-pass' })).toBe('no-pass');
        expect(blockedAnalysisMessage('blocked-orbit')).toMatch(/orbital data is unavailable/);
        expect(blockedAnalysisMessage('blocked-orbit')).not.toMatch(/AI/);
    });

    it('distinguishes loading, success, and each class of real analysis failure', () => {
        expect(analysisViewState({ ...base, loading: true })).toBe('loading');
        expect(analysisViewState({ ...base, hasAnalysis: true })).toBe('ready');
        expect(analysisViewState(base)).toBe('waiting');
        expect(analysisViewState({ ...base, errorCode: 'config' })).toBe('error-config');
        expect(analysisViewState({ ...base, errorCode: 'quota_exhausted' })).toBe('error-capacity');
        expect(analysisViewState({ ...base, errorCode: 'capacity' })).toBe('error-capacity');
        expect(analysisViewState({ ...base, errorCode: 'timeout' })).toBe('error-provider');
        expect(analysisViewState({ ...base, errorCode: 'network' })).toBe('error-network');
        expect(blockedAnalysisMessage('error-provider')).toBeNull();
    });
});
