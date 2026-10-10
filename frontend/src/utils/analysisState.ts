/**
 * AI Insight panel state. Pass analysis needs a real predicted pass, so
 * missing orbital data or no pass blocks the request; those are not Workers
 * AI failures. Real failures are classified from the /api/analyze error code.
 */
export type AnalysisViewState =
    | 'waiting-orbit'
    | 'blocked-orbit'
    | 'no-pass'
    | 'waiting'
    | 'loading'
    | 'ready'
    | 'error-config'
    | 'error-capacity'
    | 'error-provider'
    | 'error-request'
    | 'error-network';

export function analysisViewState(input: {
    passState: 'loading' | 'pass' | 'no-pass' | 'unavailable';
    loading: boolean;
    hasAnalysis: boolean;
    errorCode: string | null;
}): AnalysisViewState {
    if (input.passState === 'loading') return 'waiting-orbit';
    if (input.passState === 'unavailable') return 'blocked-orbit';
    if (input.passState === 'no-pass') return 'no-pass';
    if (input.loading) return 'loading';
    if (input.hasAnalysis) return 'ready';
    if (input.errorCode === null) return 'waiting';
    if (input.errorCode === 'config' || input.errorCode === 'access') return 'error-config';
    if (input.errorCode === 'quota_exhausted' || input.errorCode === 'capacity') return 'error-capacity';
    if (input.errorCode === 'invalid_request') return 'error-request';
    if (input.errorCode === 'network') return 'error-network';
    return 'error-provider';
}

export function describeAnalysisError(code: string | undefined, fallback: string): string {
    switch (code) {
        case 'config':
        case 'access':
            return 'Analysis service is not configured correctly on the server.';
        case 'quota_exhausted':
            return 'Workers AI daily allocation is used up; analysis will be available again later.';
        case 'capacity':
            return 'Workers AI is temporarily at capacity; retry shortly.';
        case 'timeout':
            return 'Workers AI did not respond in time.';
        case 'malformed_output':
            return 'Workers AI returned an unusable response.';
        case 'invalid_request':
            return 'The analysis request was rejected as invalid.';
        default:
            return `Analysis unavailable (${fallback}).`;
    }
}

/** Text for states where no analysis request is made. */
export function blockedAnalysisMessage(state: AnalysisViewState): string | null {
    switch (state) {
        case 'waiting-orbit':
            return 'Waiting for orbital data to predict the next pass…';
        case 'blocked-orbit':
            return 'No analysis requested: it needs a predicted pass, and orbital data is unavailable.';
        case 'no-pass':
            return 'No analysis requested: no monitored satellite pass is predicted in the next 24 hours.';
        default:
            return null;
    }
}
