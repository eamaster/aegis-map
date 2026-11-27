/**
 * Copernicus Data Space Ecosystem (CDSE) STAC Sentinel-1 GRD search adapter.
 * Queries confirmed acquired SAR scenes by event geometry and time window.
 * Strictly labeled as confirmed acquisitions (distinct from predicted overpasses).
 */

import type { SarSceneItem, SarScenesApiResponse } from '../../shared/contracts';
import { validateCoordinates } from './firms';

const CDSE_STAC_SEARCH_URL = 'https://stac.dataspace.copernicus.eu/v1/search';
const CDSE_STAC_ITEM_BASE = 'https://stac.dataspace.copernicus.eu/v1/collections/sentinel-1-grd/items';
const CDSE_TIMEOUT_MS = 10_000;
const SAR_CACHE_TTL_SECONDS = 900; // 15 min
const REQUEST_UA = 'AegisMap/1.5 (https://github.com/eamaster/aegis-map)';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function buildSarBboxes(lat: number, lng: number, deltaDeg = 0.45): Array<[number, number, number, number]> {
	const south = Math.max(-90, Number((lat - deltaDeg).toFixed(4)));
	const north = Math.min(90, Number((lat + deltaDeg).toFixed(4)));
	const west = lng - deltaDeg;
	const east = lng + deltaDeg;
	if (west < -180) {
		return [
			[Number((west + 360).toFixed(4)), south, 180, north],
			[-180, south, Number(east.toFixed(4)), north],
		];
	}
	if (east > 180) {
		return [
			[Number(west.toFixed(4)), south, 180, north],
			[-180, south, Number((east - 360).toFixed(4)), north],
		];
	}
	return [[Number(west.toFixed(4)), south, Number(east.toFixed(4)), north]];
}

export function isValidStacNextToken(token: string | undefined | null): token is string {
	if (!token || typeof token !== 'string') return false;
	return /^next:sentinel-1-grd:[A-Za-z0-9_.:-]{4,200}$/.test(token.trim());
}

function parseStacFeature(raw: unknown): SarSceneItem | null {
	if (!raw || typeof raw !== 'object') return null;
	const f = raw as {
		id?: unknown;
		collection?: unknown;
		bbox?: unknown;
		geometry?: unknown;
		properties?: Record<string, unknown>;
		assets?: Record<string, { href?: unknown }>;
		links?: Array<{ rel?: unknown; href?: unknown }>;
	};
	if (typeof f.id !== 'string' || !f.id) return null;
	const props = f.properties ?? {};
	const dt = typeof props.datetime === 'string' && Number.isFinite(Date.parse(props.datetime))
		? new Date(Date.parse(props.datetime)).toISOString()
		: null;
	if (!dt) return null;

	const bbox: [number, number, number, number] =
		Array.isArray(f.bbox) &&
		f.bbox.length >= 4 &&
		f.bbox.slice(0, 4).every((n) => typeof n === 'number' && Number.isFinite(n))
			? [f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3]]
			: [-180, -90, 180, 90];

	const polarizations = Array.isArray(props['sar:polarizations'])
		? (props['sar:polarizations'] as unknown[]).filter((p): p is string => typeof p === 'string')
		: [];

	const stacSelf =
		(Array.isArray(f.links) ? f.links.find((l) => l.rel === 'self' && typeof l.href === 'string')?.href : null) ??
		`${CDSE_STAC_ITEM_BASE}/${encodeURIComponent(f.id)}`;

	const centerLat = ((bbox[1] + bbox[3]) / 2).toFixed(4);
	const centerLng = ((bbox[0] + bbox[2]) / 2).toFixed(4);
	const day = dt.slice(0, 10);
	const copernicusBrowserUrl = `https://browser.dataspace.copernicus.eu/?zoom=9&lat=${centerLat}&lng=${centerLng}&themeId=DEFAULT-THEME&datasetId=S1_AWS_IW_VVVH&fromTime=${day}T00%3A00%3A00.000Z&toTime=${day}T23%3A59%3A59.999Z`;

	const thumbHref = typeof f.assets?.thumbnail?.href === 'string' ? f.assets.thumbnail.href : null;
	const productHref = typeof f.assets?.Product?.href === 'string' ? f.assets.Product.href : null;

	return {
		id: f.id,
		collection: 'sentinel-1-grd',
		platform: typeof props.platform === 'string' ? props.platform : 'sentinel-1',
		datetime: dt,
		startDatetime: typeof props.start_datetime === 'string' ? props.start_datetime : null,
		endDatetime: typeof props.end_datetime === 'string' ? props.end_datetime : null,
		instrumentMode: typeof props['sar:instrument_mode'] === 'string' ? props['sar:instrument_mode'] : null,
		polarizations,
		orbitState: typeof props['sat:orbit_state'] === 'string' ? props['sat:orbit_state'] : null,
		relativeOrbit: typeof props['sat:relative_orbit'] === 'number' ? props['sat:relative_orbit'] : null,
		incidenceAngleDeg:
			typeof props['view:incidence_angle'] === 'number'
				? Math.round((props['view:incidence_angle'] as number) * 10) / 10
				: null,
		bbox,
		geometry:
			f.geometry && typeof f.geometry === 'object'
				? (f.geometry as { type: string; coordinates?: unknown })
				: null,
		stacItemUrl: String(stacSelf),
		copernicusBrowserUrl,
		thumbnailUrl: thumbHref,
		productLink: productHref,
	};
}

export async function searchSentinel1GrdScenes(options: {
	lat: number;
	lng: number;
	startIso?: string;
	endIso?: string;
	limit?: number;
	token?: string;
	kv?: KVNamespace;
	fetchImpl?: FetchLike;
	now?: Date;
}): Promise<SarScenesApiResponse> {
	const coordCheck = validateCoordinates(options.lat, options.lng);
	if (!coordCheck.valid) {
		throw new Error(coordCheck.reason ?? 'Invalid coordinates');
	}

	const now = options.now ?? new Date();
	const endMs = options.endIso && Number.isFinite(Date.parse(options.endIso)) ? Date.parse(options.endIso) : now.getTime();
	const startMs =
		options.startIso && Number.isFinite(Date.parse(options.startIso))
			? Date.parse(options.startIso)
			: endMs - 14 * 24 * 60 * 60 * 1000;

	const start = new Date(Math.min(startMs, endMs)).toISOString();
	const end = new Date(Math.max(startMs, endMs)).toISOString();
	const limit = Math.max(1, Math.min(20, options.limit ?? 8));
	const nextTokenIn = isValidStacNextToken(options.token) ? options.token.trim() : undefined;

	const cacheKey = `sar:stac:v1:${options.lat.toFixed(2)}:${options.lng.toFixed(2)}:${start.slice(0, 13)}:${end.slice(0, 13)}:${limit}:${nextTokenIn ?? 'p1'}`;
	if (options.kv) {
		try {
			const cachedRaw = await options.kv.get(cacheKey);
			if (cachedRaw) {
				const cached = JSON.parse(cachedRaw) as SarScenesApiResponse;
				if (cached && cached.version === 1 && Array.isArray(cached.scenes)) {
					return { ...cached, cached: true };
				}
			}
		} catch {
			// Ignore cache read error
		}
	}

	const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
	const bboxes = buildSarBboxes(options.lat, options.lng);
	const scenes: SarSceneItem[] = [];
	const seenIds = new Set<string>();
	let nextTokenOut: string | null = null;

	for (const bbox of bboxes) {
		const payload: Record<string, unknown> = {
			collections: ['sentinel-1-grd'],
			bbox,
			datetime: `${start}/${end}`,
			limit,
		};
		if (nextTokenIn) {
			payload.token = nextTokenIn;
		}

		const res = await fetchImpl(CDSE_STAC_SEARCH_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': REQUEST_UA,
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(CDSE_TIMEOUT_MS),
		});
		if (!res.ok) {
			throw new Error(`Copernicus STAC HTTP ${res.status}`);
		}
		const body = (await res.json()) as {
			features?: unknown[];
			links?: Array<{ rel?: string; body?: { token?: string } }>;
		};
		if (!body || !Array.isArray(body.features)) {
			throw new Error('Malformed Copernicus STAC response');
		}
		for (const feat of body.features) {
			const item = parseStacFeature(feat);
			if (item && !seenIds.has(item.id)) {
				seenIds.add(item.id);
				scenes.push(item);
			}
		}
		const nextLink = body.links?.find((l) => l.rel === 'next' && typeof l.body?.token === 'string');
		if (nextLink?.body?.token) {
			nextTokenOut = nextLink.body.token;
		}
	}

	scenes.sort((a, b) => Date.parse(b.datetime) - Date.parse(a.datetime));

	const response: SarScenesApiResponse = {
		version: 1,
		epistemicLabel: 'confirmed_acquisition',
		disclaimer:
			'Confirmed Sentinel-1 C-band SAR Ground Range Detected (GRD) acquisitions from Copernicus Data Space STAC. Acquisitions are distinct from orbital overpass predictions and derived interpretations.',
		query: {
			lat: options.lat,
			lng: options.lng,
			start,
			end,
			radiusKm: 50,
		},
		scenes,
		nextToken: nextTokenOut,
		cached: false,
		fetchedAt: now.toISOString(),
	};

	if (options.kv) {
		await options.kv.put(cacheKey, JSON.stringify(response), { expirationTtl: SAR_CACHE_TTL_SECONDS }).catch(() => {});
	}

	return response;
}
