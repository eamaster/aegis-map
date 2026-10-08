/**
 * API Configuration
 * Single source of truth for API base URL (no trailing slash).
 */
function normalizeApiBase(value: string): string {
	return value.replace(/\/+$/, '');
}

export const API_BASE = normalizeApiBase(
	import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787',
);

export function apiUrl(path: string): string {
	const normalized = path.startsWith('/') ? path : `/${path}`;
	return `${API_BASE}${normalized}`;
}
