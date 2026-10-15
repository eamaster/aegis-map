/**
 * Disaster observation windows and volcano modes.
 * Mirrors the backend API contract (backend/src/config.ts).
 */

export const OBSERVATION_WINDOWS = ['24h', '7d'] as const;
export type ObservationWindow = (typeof OBSERVATION_WINDOWS)[number];
export const DEFAULT_OBSERVATION_WINDOW: ObservationWindow = '24h';

export function isObservationWindow(value: unknown): value is ObservationWindow {
	return typeof value === 'string' && (OBSERVATION_WINDOWS as readonly string[]).includes(value);
}

export const VOLCANO_MODES = ['context', 'strict'] as const;
export type VolcanoMode = (typeof VOLCANO_MODES)[number];
export const DEFAULT_VOLCANO_MODE: VolcanoMode = 'context';

export function isVolcanoMode(value: unknown): value is VolcanoMode {
	return typeof value === 'string' && (VOLCANO_MODES as readonly string[]).includes(value);
}
