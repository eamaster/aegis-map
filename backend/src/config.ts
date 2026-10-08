/**
 * Central application and AI configuration.
 * Model identity, generation settings, app version, and analysis cache
 * version are kept here but semantically separate.
 */

/** Public API / health-check version (independent of AI provider). */
export const APP_VERSION = '1.2.0';

/**
 * Analysis cache + prompt schema version.
 * Bump when prompt text, capability context, or response semantics change.
 * Independent of APP_VERSION and provider API versions.
 */
export const ANALYSIS_CACHE_VERSION = 'wai-v2';

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

/** Merge defaults with optional comma-separated Worker var (deduped, trimmed). */
export function resolveAllowedOrigins(extra?: string | null): string[] {
	const allowed = new Set<string>(DEFAULT_CORS_ORIGINS);
	if (extra) {
		for (const part of extra.split(',')) {
			const origin = part.trim();
			if (origin) allowed.add(origin);
		}
	}
	return [...allowed];
}

/** Reflect request Origin only when it is on the allowlist. */
export function reflectCorsOrigin(
	requestOrigin: string | undefined,
	allowed: readonly string[],
): string | undefined {
	if (!requestOrigin) return undefined;
	return allowed.includes(requestOrigin) ? requestOrigin : undefined;
}

export const DISASTER_TYPES = ['fire', 'volcano', 'earthquake'] as const;
export type DisasterType = (typeof DISASTER_TYPES)[number];

export function isDisasterType(value: unknown): value is DisasterType {
	return typeof value === 'string' && (DISASTER_TYPES as readonly string[]).includes(value);
}
