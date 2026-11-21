import { describe, expect, it } from 'vitest';
import { analysisViewState, blockedAnalysisMessage, describeAnalysisError } from './analysisState';

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

    it('formats generic provider failures cleanly and keeps configuration failures actionable', () => {
        const providerMsg = describeAnalysisError('provider', 'Analysis temporarily unavailable');
        expect(providerMsg).toBe('Analysis is temporarily unavailable. Try again shortly.');
        expect(providerMsg).not.toContain('Analysis unavailable (Analysis temporarily unavailable)');

        const configMsg = describeAnalysisError('config', 'Configured AI model is retired or unavailable');
        expect(configMsg).toContain('server configuration');
        expect(configMsg).toContain('Configured AI model is retired or unavailable');
        expect(describeAnalysisError('config', '')).toContain('not configured correctly');

        expect(describeAnalysisError('access', 'AI provider access restricted')).toContain('not configured correctly');
        expect(describeAnalysisError('quota_exhausted', 'ignored')).toContain('daily allocation');
        expect(describeAnalysisError('capacity', 'ignored')).toContain('capacity');
        expect(describeAnalysisError('timeout', 'ignored')).toContain('in time');
        expect(describeAnalysisError('malformed_output', 'ignored')).toContain('unusable response');
        expect(describeAnalysisError('invalid_request', 'ignored')).toContain('invalid');
        expect(describeAnalysisError(undefined, 'HTTP 502')).toBe('Analysis unavailable (HTTP 502).');
    });
});
