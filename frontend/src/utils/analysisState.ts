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

/**
 * User-facing text for a structured /api/analyze failure. `serverMessage` is the
 * Worker's sanitized message (never raw provider output); it is only appended where
 * it tells an operator what to fix.
 */
export function describeAnalysisError(code: string | undefined, serverMessage: string): string {
    const cleanDetail = serverMessage.trim().replace(/\.+$/, '');
    switch (code) {
        case 'config':
            return cleanDetail
                ? `Analysis service requires server configuration attention: ${cleanDetail}.`
                : 'Analysis service is not configured correctly on the server.';
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
        case 'provider':
            return 'Analysis is temporarily unavailable. Try again shortly.';
        default:
            return cleanDetail ? `Analysis unavailable (${cleanDetail}).` : 'Analysis is temporarily unavailable.';
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
