/**
 * Selection generation helpers for Sidebar request lifecycle.
 * Stale async completions must not update UI for a newer disaster selection.
 */

export type SelectionGeneration = number;

export function nextGeneration(current: SelectionGeneration): SelectionGeneration {
    return current + 1;
}

export function isCurrentGeneration(
    expected: SelectionGeneration,
    actual: SelectionGeneration,
): boolean {
    return expected === actual;
}

export function analysisRequestIdentity(input: {
    disasterId: string;
    satelliteName: string;
    passIso: string;
    cloudCover: number | null;
    retryToken: number;
}): string {
    return JSON.stringify({
        disasterId: input.disasterId,
        satelliteName: input.satelliteName,
        passIso: input.passIso,
        cloudCover: input.cloudCover,
        retryToken: input.retryToken,
    });
}
