/**
 * Central application and AI configuration.
 * Model identity, generation settings, app version, and analysis cache
 * version are kept here but semantically separate.
 */

/** Public API / health-check version (independent of AI provider). */
export const APP_VERSION = '1.3.0';

/**
 * Capabilities reported by the health route. The Pages release gate
 * (.github/workflows/deploy.yml) refuses to publish a frontend unless the
 * production backend reports every capability that frontend relies on.
 * - workers-ai-analyze-v1: /api/analyze success responses carry source "workers-ai".
 * - provider-status-v1: FIRMS coverage windows/unavailable (502), disaster
 *   source headers, and TLE status headers.
 */
export const API_CAPABILITIES = ['workers-ai-analyze-v1', 'provider-status-v1'] as const;

/**
 * Analysis cache + prompt schema version.
 * Bump when prompt text, capability context, or response semantics change.
 * Independent of APP_VERSION and provider API versions.
 * wai-v3: location/illumination/elevation context in the prompt and bucketed
 * cache identity (see ANALYSIS_*_BUCKET* below).
 */
export const ANALYSIS_CACHE_VERSION = 'wai-v3';

/**
 * Accepted ranges for numeric /api/analyze fields. Documented once here; the
 * frontend mirrors lat/lng/elevation bounds in its own coordinate checks and
 * the README API Reference lists them for clients.
 */
export const ANALYZE_LIMITS = {
	cloudCover: { min: 0, max: 100 },
	lat: { min: -90, max: 90 },
	lng: { min: -180, max: 180 },
	maxElevationDeg: { min: 0, max: 90 },
} as const;

/**
 * Illumination classes from geometric solar elevation at the event location:
 * day: sun > DAY_MIN; twilight: TWILIGHT_MIN <= sun <= DAY_MIN; night: below.
 * -6° is the end of civil twilight.
 */
export const SUN_ELEVATION_DAY_MIN_DEG = 0;
export const SUN_ELEVATION_TWILIGHT_MIN_DEG = -6;

/**
 * Analysis cache identity (and, deliberately, the prompt) only sees these
 * coarse values, so every input that reaches the model is also in the key
 * and nothing finer than the model needs fragments the cache:
 * - cloud cover: bands [0,10) [10,25) [25,50) [50,75) [75,90) [90,100]
 * - max elevation: bands [0,10) [10,25) [25,40) [40,60) [60,90]; 25/15/5 are
 *   the frontend's pass-search thresholds, so very low/low passes are distinct
 * - pass time: floored to a 30 min window (the frontend's pass time is the
 *   first 5 min sample after "now", so exact values never repeat across users)
 * - location: rounded to 1 decimal (~11 km); fire centroids drift slightly
 */
export const ANALYSIS_CLOUD_BUCKET_EDGES_PCT = [10, 25, 50, 75, 90] as const;
export const ANALYSIS_ELEVATION_BUCKET_EDGES_DEG = [10, 25, 40, 60] as const;
export const ANALYSIS_PASS_TIME_BUCKET_MINUTES = 30;
export const ANALYSIS_LOCATION_DECIMALS = 1;
/** Max elevation below this is described to the model as oblique geometry. Must be a bucket edge. */
export const ANALYSIS_LOW_ELEVATION_BELOW_DEG = 25;

/** Supported Workers AI text-generation model IDs for this project. */
export const SUPPORTED_AI_MODELS = [
	'@cf/meta/llama-3.1-8b-instruct-fp8',
	'@cf/meta/llama-3.3-70b-instruct-fp8-fast',
] as const;

export type SupportedAiModel = (typeof SUPPORTED_AI_MODELS)[number];

/** Provisional / default production model (free-plan efficient). */
export const DEFAULT_AI_MODEL: SupportedAiModel = '@cf/meta/llama-3.1-8b-instruct-fp8';

export const AI_GENERATION = {
	/** Short two-sentence guidance; do not copy Gemini thinking-token budgets. */
	max_tokens: 160,
	temperature: 0.3,
} as const;

/** Analysis result cache TTL (seconds). */
export const ANALYSIS_CACHE_TTL_SECONDS = 7200;

/**
 * Resolve the model ID from an optional server-side override.
 * Rejects arbitrary values that are not in the supported allowlist.
 */
export function resolveAiModel(override?: string | null): SupportedAiModel {
	if (!override || override.trim() === '') {
		return DEFAULT_AI_MODEL;
	}
	const trimmed = override.trim();
	if ((SUPPORTED_AI_MODELS as readonly string[]).includes(trimmed)) {
		return trimmed as SupportedAiModel;
	}
	throw new Error(`Unsupported AI model override: ${trimmed}`);
}

/**
 * Built-in CORS origins for local Vite and GitHub Pages.
 * Additional production hosts come from the `CORS_ORIGINS` Worker var
 * (comma-separated). CORS is not authentication.
 */
export const DEFAULT_CORS_ORIGINS = [
	'http://localhost:5173',
	'http://127.0.0.1:5173',
	'http://localhost:4173',
	'http://127.0.0.1:4173',
	'https://eamaster.github.io',
] as const;

/** Accept only scheme + host (+ optional port); reject paths/queries/fragments. */
export function isValidCorsOrigin(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
		return value === url.origin;
	} catch {
		return false;
	}
}

/** Merge defaults with optional comma-separated Worker var (deduped, trimmed). */
export function resolveAllowedOrigins(extra?: string | null): string[] {
	const allowed = new Set<string>(DEFAULT_CORS_ORIGINS);
	if (extra) {
		for (const part of extra.split(',')) {
			const origin = part.trim();
			if (origin && isValidCorsOrigin(origin)) allowed.add(origin);
		}
	}
	return [...allowed];
}

/** Reflect request Origin only when it is on the allowlist (exact match). */
export function reflectCorsOrigin(
	requestOrigin: string | undefined,
	allowed: readonly string[],
): string | undefined {
	if (!requestOrigin || !isValidCorsOrigin(requestOrigin)) return undefined;
	return allowed.includes(requestOrigin) ? requestOrigin : undefined;
}

export const DISASTER_TYPES = ['fire', 'volcano', 'earthquake'] as const;
export type DisasterType = (typeof DISASTER_TYPES)[number];

export function isDisasterType(value: unknown): value is DisasterType {
	return typeof value === 'string' && (DISASTER_TYPES as readonly string[]).includes(value);
}

/**
 * Severity thresholds (disasters.ts). A value at a threshold takes the higher
 * class (>=), matching the earthquake rule.
 *
 * Earthquakes (USGS magnitude): >= 6.0 high, >= 4.5 medium, else low.
 * Wildfires (EONET latest geometry magnitudeValue, normalized to acres):
 *   >= 10,000 acres high; >= 1,000 acres medium; else low. 1,000 acres is the
 *   NWCG size class F lower bound; 10,000 is a round bar for very large fires.
 *   Measured on 2026-10-12 against the 144 open EONET wildfires (min 500,
 *   median 1,100, p90 8,761, max 80,000 acres): 66 low / 65 medium / 13 high.
 *   Missing/invalid size keeps the previous default (medium).
 * Volcanoes: EONET volcano geometries carry no magnitude (all 32 open events
 *   had magnitudeValue null on 2026-10-12) and no other structured intensity
 *   field, so severity stays the default medium rather than inventing one.
 */
export const EARTHQUAKE_SEVERITY_MIN_MAGNITUDE = { high: 6.0, medium: 4.5 } as const;
export const WILDFIRE_SEVERITY_MIN_ACRES = { high: 10_000, medium: 1_000 } as const;
/** Severity used when a type has no usable intensity data. */
export const DEFAULT_DISASTER_SEVERITY = 'medium' as const;

/** EONET magnitudeUnit (lower-cased) -> acres multiplier. Unknown units are not guessed. */
export const AREA_UNIT_TO_ACRES: Readonly<Record<string, number>> = {
	acres: 1,
	acre: 1,
	ha: 2.471053814671653,
	hectare: 2.471053814671653,
	hectares: 2.471053814671653,
	km2: 247.1053814671653,
	'km^2': 247.1053814671653,
	'sq km': 247.1053814671653,
	sqkm: 247.1053814671653,
	mi2: 640,
	'sq mi': 640,
	sqmi: 640,
};
