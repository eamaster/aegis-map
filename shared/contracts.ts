/**
 * Canonical shared contracts, fleet metadata, solar geometry, and API envelopes
 * used by both backend (Cloudflare Worker) and frontend (Vite + React).
 *
 * Kept strictly compatible with TypeScript `erasableSyntaxOnly` and
 * `verbatimModuleSyntax` (no enums, namespaces, or parameter properties).
 */

export const APP_VERSION = '1.5.0';

export const API_CAPABILITIES = [
	'workers-ai-analyze-v1',
	'provider-status-v1',
	'firms-global-v2',
	'official-warnings-v1',
	'sar-stac-v1',
	'disaster-history-v1',
	'warning-subscriptions-v1',
] as const;

export type ApiCapability = (typeof API_CAPABILITIES)[number];

export const DISASTER_TYPES = ['fire', 'volcano', 'earthquake'] as const;
export type DisasterType = (typeof DISASTER_TYPES)[number];

export function isDisasterType(value: unknown): value is DisasterType {
	return typeof value === 'string' && (DISASTER_TYPES as readonly string[]).includes(value);
}

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

// ============================================================================
// Monitored Satellite Fleet & Capabilities
// ============================================================================

export type SensorCapabilities = {
	optical: boolean;
	thermal: boolean;
	sar: boolean;
	summary: string;
};

export const MONITORED_NORAD_IDS = [39084, 49260, 40697, 42063, 25994, 27424] as const;

export const MONITORED_FLEET_BY_NORAD: Readonly<
	Record<number, { canonicalName: string; names: readonly string[]; capabilities: SensorCapabilities }>
> = {
	39084: {
		canonicalName: 'LANDSAT 8',
		names: ['LANDSAT 8', 'LANDSAT-8', 'LANDSAT8'],
		capabilities: {
			optical: true,
			thermal: true,
			sar: false,
			summary: 'Landsat-8: optical multispectral (OLI) and thermal infrared (TIRS). No SAR.',
		},
	},
	49260: {
		canonicalName: 'LANDSAT 9',
		names: ['LANDSAT 9', 'LANDSAT-9', 'LANDSAT9'],
		capabilities: {
			optical: true,
			thermal: true,
			sar: false,
			summary: 'Landsat-9: optical multispectral (OLI-2) and thermal infrared (TIRS-2). No SAR.',
		},
	},
	40697: {
		canonicalName: 'SENTINEL-2A',
		names: ['SENTINEL-2A', 'SENTINEL 2A', 'S2A'],
		capabilities: {
			optical: true,
			thermal: false,
			sar: false,
			summary: 'Sentinel-2A: optical multispectral (MSI) only. No thermal. No SAR.',
		},
	},
	42063: {
		canonicalName: 'SENTINEL-2B',
		names: ['SENTINEL-2B', 'SENTINEL 2B', 'S2B'],
		capabilities: {
			optical: true,
			thermal: false,
			sar: false,
			summary: 'Sentinel-2B: optical multispectral (MSI) only. No thermal. No SAR.',
		},
	},
	25994: {
		canonicalName: 'TERRA',
		names: ['TERRA', 'EOS TERRA'],
		capabilities: {
			optical: true,
			thermal: true,
			sar: false,
			summary: 'Terra (MODIS): optical and thermal infrared bands. No SAR.',
		},
	},
	27424: {
		canonicalName: 'AQUA',
		names: ['AQUA', 'EOS AQUA'],
		capabilities: {
			optical: true,
			thermal: true,
			sar: false,
			summary: 'Aqua (MODIS): optical and thermal infrared bands. No SAR.',
		},
	},
};

export function normalizeSatelliteName(name: string): string {
	return name.trim().toUpperCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

function compactSatelliteName(name: string): string {
	return normalizeSatelliteName(name).replace(/\s+/g, '');
}

const FLEET_ALIAS_INDEX: Map<string, { noradId: number; capabilities: SensorCapabilities }> = (() => {
	const map = new Map<string, { noradId: number; capabilities: SensorCapabilities }>();
	for (const [id, entry] of Object.entries(MONITORED_FLEET_BY_NORAD)) {
		const noradId = Number(id);
		for (const alias of entry.names) {
			map.set(normalizeSatelliteName(alias), { noradId, capabilities: entry.capabilities });
			map.set(compactSatelliteName(alias), { noradId, capabilities: entry.capabilities });
		}
	}
	return map;
})();

export function resolveSatelliteCapabilities(satelliteName: string): {
	noradId: number | null;
	capabilities: SensorCapabilities | null;
} {
	const spaced = normalizeSatelliteName(satelliteName);
	const compact = compactSatelliteName(satelliteName);
	const hit = FLEET_ALIAS_INDEX.get(spaced) ?? FLEET_ALIAS_INDEX.get(compact);
	return hit ?? { noradId: null, capabilities: null };
}

// ============================================================================
// Solar Geometry (NOAA Meeus)
// ============================================================================

export const SUN_ELEVATION_DAY_MIN_DEG = 0;
export const SUN_ELEVATION_TWILIGHT_MIN_DEG = -6;

export type Illumination = 'day' | 'twilight' | 'night';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function mod(value: number, divisor: number): number {
	return ((value % divisor) + divisor) % divisor;
}

/**
 * Geometric solar elevation in degrees above the horizon at a place and instant.
 * Pure: no I/O, no clock. Callers must pass validated finite inputs.
 */
export function solarElevationDeg(lat: number, lng: number, when: Date): number {
	const ms = when.getTime();
	const jd = ms / 86_400_000 + 2_440_587.5;
	const t = (jd - 2_451_545) / 36_525;

	const meanLongitude = mod(280.46646 + t * (36_000.76983 + t * 0.0003032), 360);
	const meanAnomaly = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
	const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
	const mRad = meanAnomaly * RAD;

	const equationOfCenter =
		Math.sin(mRad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
		Math.sin(2 * mRad) * (0.019993 - 0.000101 * t) +
		Math.sin(3 * mRad) * 0.000289;
	const trueLongitude = meanLongitude + equationOfCenter;

	const omega = 125.04 - 1934.136 * t;
	const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * RAD);

	const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
	const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);

	const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLongitude * RAD));

	const y = Math.tan((obliquity * RAD) / 2) ** 2;
	const l0 = meanLongitude * RAD;
	const equationOfTimeMin =
		4 *
		DEG *
		(y * Math.sin(2 * l0) -
			2 * eccentricity * Math.sin(mRad) +
			4 * eccentricity * y * Math.sin(mRad) * Math.cos(2 * l0) -
			0.5 * y * y * Math.sin(4 * l0) -
			1.25 * eccentricity * eccentricity * Math.sin(2 * mRad));

	const utcMinutes = mod(ms / 60_000, 1440);
	const trueSolarTimeMin = mod(utcMinutes + equationOfTimeMin + 4 * lng, 1440);
	const hourAngle = (trueSolarTimeMin / 4 - 180) * RAD;

	const latRad = lat * RAD;
	const cosZenith =
		Math.sin(latRad) * Math.sin(declination) + Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
	return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) * DEG;
}

export function classifyIllumination(sunElevationDegValue: number): Illumination {
	if (sunElevationDegValue > SUN_ELEVATION_DAY_MIN_DEG) return 'day';
	if (sunElevationDegValue >= SUN_ELEVATION_TWILIGHT_MIN_DEG) return 'twilight';
	return 'night';
}

export function illuminationAt(lat: number, lng: number, when: Date): Illumination {
	return classifyIllumination(solarElevationDeg(lat, lng, when));
}

// ============================================================================
// Official Warnings API (/api/v1/warnings)
// ============================================================================

export type WarningCoverageStatus =
	| 'active_warnings'
	| 'checked_no_warnings'
	| 'partial_coverage'
	| 'stale'
	| 'source_unavailable'
	| 'unsupported_jurisdiction';

export type WarningSourceHealthStatus = 'ok' | 'stale' | 'unavailable' | 'not_modified' | 'unsupported';

export type WarningLifecycleState = 'active' | 'upcoming' | 'expired' | 'cancelled' | 'superseded';

export type WarningSeverity = 'extreme' | 'severe' | 'moderate' | 'minor' | 'unknown';

export interface WarningLocalizedBlock {
	language: string;
	headline: string;
	event: string;
	description: string;
	instruction: string | null;
	areaDesc: string;
	web: string | null;
}

export interface OfficialWarningItem {
	id: string;
	identifier: string;
	sourceId: string;
	issuerName: string;
	issuerUrl: string;
	countryCode: string;
	msgType: 'Alert' | 'Update' | 'Cancel' | 'Ack' | 'Error';
	lifecycleState: WarningLifecycleState;
	category: string;
	severity: WarningSeverity;
	urgency: string;
	certainty: string;
	sentAt: string;
	effectiveAt: string | null;
	onsetAt: string | null;
	expiresAt: string | null;
	missingExpiry: boolean;
	clockSkewFlag: boolean;
	matchMethod: 'polygon' | 'circle' | 'geocode' | 'area_name' | 'country_only';
	matchUncertain: boolean;
	matchNote: string;
	primaryLanguage: string;
	translations: WarningLocalizedBlock[];
	bulletinUrl: string | null;
	attribution: string;
}

export interface WarningSourceReport {
	sourceId: string;
	authorityName: string;
	countryCodes: readonly string[];
	status: WarningSourceHealthStatus;
	checkedAt: string;
	lastSuccessAt: string | null;
	activeAlertCount: number;
	matchedAlertCount: number;
	unsupportedHazards: readonly string[];
	attribution: string;
	termsUrl: string;
	errorReason?: string;
}

export interface WarningsApiResponse {
	version: 1;
	query: {
		lat: number;
		lng: number;
		countryCode: string | null;
		checkedAt: string;
	};
	coverageStatus: WarningCoverageStatus;
	coverageExplanation: string;
	warnings: OfficialWarningItem[];
	sources: WarningSourceReport[];
}

// ============================================================================
// Sentinel-1 SAR STAC API (/api/v1/sar-scenes)
// ============================================================================

export interface GeoJsonGeometry {
	type: string;
	coordinates?: unknown;
	geometries?: unknown;
}

export interface SarSceneItem {
	id: string;
	collection: 'sentinel-1-grd';
	platform: string;
	datetime: string;
	startDatetime: string | null;
	endDatetime: string | null;
	instrumentMode: string | null;
	polarizations: string[];
	orbitState: string | null;
	relativeOrbit: number | null;
	incidenceAngleDeg: number | null;
	bbox: [number, number, number, number];
	geometry: GeoJsonGeometry | null;
	stacItemUrl: string;
	copernicusBrowserUrl: string;
	thumbnailUrl: string | null;
	productLink: string | null;
}

export interface SarScenesApiResponse {
	version: 1;
	epistemicLabel: 'confirmed_acquisition';
	disclaimer: string;
	query: {
		lat: number;
		lng: number;
		start: string;
		end: string;
		radiusKm: number;
	};
	scenes: SarSceneItem[];
	nextToken: string | null;
	cached: boolean;
	fetchedAt: string;
}

// ============================================================================
// Historical Archive & Source-Health Analytics (/api/v1/history, /api/v1/analytics/sources)
// ============================================================================

export type EventProvenance = 'live_captured' | 'reconstructed_backfill';

export interface ArchivedEventRevision {
	revisionNumber: number;
	observedAt: string;
	title: string;
	severity: string;
	lat: number;
	lng: number;
	sourceTimestamp: string;
}

export interface ArchivedDisasterEvent {
	id: string;
	upstreamId: string;
	source: 'eonet' | 'usgs' | 'gdacs';
	type: DisasterType;
	title: string;
	lat: number;
	lng: number;
	severity: 'low' | 'medium' | 'high';
	eventTime: string;
	firstSeenAt: string;
	ingestedAt: string;
	provenance: EventProvenance;
	attribution: string;
	magnitude?: number | null;
	areaAcres?: number | null;
	gdacsMatchId?: string | null;
	revisions?: ArchivedEventRevision[];
}

export interface HistoryApiResponse {
	version: 1;
	storageAvailable: boolean;
	total: number;
	events: ArchivedEventWithMeta[];
	note?: string;
}

export type ArchivedEventWithMeta = ArchivedDisasterEvent;

export interface ProviderHealthSummary {
	provider: string;
	runs: number;
	okRuns: number;
	failedRuns: number;
	avgLatencyMs: number | null;
	lastRunAt: string | null;
	lastStatus: string | null;
	totalRecords: number;
	totalRejected: number;
}

export interface SourceAnalyticsApiResponse {
	version: 1;
	storageAvailable: boolean;
	generatedAt: string;
	providers: ProviderHealthSummary[];
	note?: string;
}

// ============================================================================
// Subscriptions API (/api/v1/subscriptions)
// ============================================================================

export interface SubscriptionCreateRequest {
	channel: 'email' | 'sms';
	destination: string;
	placeName: string;
	lat: number;
	lng: number;
	countryCode: string;
	sourceId: string;
	minSeverity?: 'moderate' | 'severe' | 'extreme';
}

export interface SubscriptionResponse {
	ok: boolean;
	subscriptionId?: string;
	status?: 'pending_confirmation' | 'active' | 'unsubscribed';
	transportMode?: 'sandbox' | 'resend';
	sandboxPreviewToken?: string;
	message: string;
	code?: string;
}
