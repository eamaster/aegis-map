/**
 * MapBoard Component
 * Preserves a single persistent Mapbox GL instance while keeping the selected
 * event's double-circle marker and pinned data bubble geographically attached
 * across pointer leave, pan, zoom, globe rotation, layout resize, and refresh.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { debugLog } from '../utils/debug';
import toast from 'react-hot-toast';
import type {
	Disaster,
	DisasterSourceStatus,
	FireDetectionCell,
	ObservationWindow,
	VolcanoMode,
} from '../types';
import { DEFAULT_OBSERVATION_WINDOW, DEFAULT_VOLCANO_MODE } from '../config/disasters';
import {
	classifyMapboxError,
	DISASTER_LAYER_ICONS,
	DISASTER_LAYER_IDS,
	DISASTER_LAYER_PRIORITY,
	DISASTER_SOURCE_IDS,
	FALLBACK_SATELLITE_LAYER_ID,
	FALLBACK_SATELLITE_SOURCE_ID,
	FALLBACK_SATELLITE_TILE_TEMPLATE,
	isSatelliteFallbackRemembered,
	MAP_BASEMAP_CONFIG,
	MAP_INITIAL_VIEW,
	MAP_STYLES,
	rememberSatelliteFallback,
	rewriteSatelliteTileUrl,
	SELECTED_DISASTER_HALO_LAYER_ID,
	SELECTED_DISASTER_LAYER_ID,
	SELECTED_DISASTER_SOURCE_ID,
} from '../config/map';
import { describeDisasterSources } from '../utils/disasterSources';
import { cellToDisasterItem, fetchDisastersData } from '../utils/disastersClient';
import { buildDisasterPopupDom, isGlobePointOccluded } from '../utils/eventFormatters';
import { DESIGN_SYSTEM } from '../constants/designSystem';
import { useLocale } from '../hooks/useLocale';
import MapLegend from './MapLegend';

// Set Mapbox access token
const accessToken = import.meta.env.VITE_MAPBOX_TOKEN;
mapboxgl.accessToken = accessToken;

interface MapBoardProps {
	selectedDisaster?: Disaster | null;
	onDisasterSelect: (disaster: Disaster | null) => void;
	activeFilters: Set<string>;
	onFilterToggle: (type: string) => void;
	observationWindow?: ObservationWindow;
	onObservationWindowChange?: (window: ObservationWindow) => void;
	volcanoMode?: VolcanoMode;
	onVolcanoModeChange?: (mode: VolcanoMode) => void;
	onOpenNearMe?: () => void;
}

const toPointFeatureCollection = (items: Disaster[]): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
	type: 'FeatureCollection',
	features: items.map((item) => ({
		type: 'Feature',
		geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
		properties: { id: item.id, severity: item.severity },
	})),
});

/** Mount backup satellite imagery in Standard Satellite's bottom slot without rebuilding the style. */
const mountFallbackSatelliteLayer = (mapInstance: mapboxgl.Map) => {
	try {
		if (!mapInstance.getSource(FALLBACK_SATELLITE_SOURCE_ID)) {
			mapInstance.addSource(FALLBACK_SATELLITE_SOURCE_ID, {
				type: 'raster',
				tiles: [FALLBACK_SATELLITE_TILE_TEMPLATE],
				tileSize: 256,
				maxzoom: 19,
				attribution: 'Esri World Imagery',
			});
		}
		if (!mapInstance.getLayer(FALLBACK_SATELLITE_LAYER_ID)) {
			mapInstance.addLayer({
				id: FALLBACK_SATELLITE_LAYER_ID,
				type: 'raster',
				source: FALLBACK_SATELLITE_SOURCE_ID,
				slot: 'bottom',
				paint: { 'raster-opacity': 1 },
			});
		}
	} catch (err) {
		debugLog('map', `Could not mount backup satellite layer: ${err}`, 'warning');
	}
};

const removeDisasterLayers = (
	mapInstance: mapboxgl.Map | null,
	pulseIntervalRef?: { current: ReturnType<typeof setInterval> | null },
) => {
	if (!mapInstance) return;

	if (pulseIntervalRef?.current) {
		clearInterval(pulseIntervalRef.current);
		pulseIntervalRef.current = null;
	}

	DISASTER_LAYER_IDS.forEach((layerId) => {
		if (mapInstance.getLayer(layerId)) {
			try {
				mapInstance.removeLayer(layerId);
			} catch (e) {
				console.warn(`Could not remove layer ${layerId}:`, e);
			}
		}
	});

	DISASTER_SOURCE_IDS.forEach((sourceId) => {
		if (mapInstance.getSource(sourceId)) {
			try {
				mapInstance.removeSource(sourceId);
			} catch (e) {
				console.warn(`Could not remove source ${sourceId}:`, e);
			}
		}
	});
};

function checkMapPointOccluded(mapInstance: mapboxgl.Map, lng: number, lat: number): boolean {
	try {
		const transform = mapInstance.transform as unknown as {
			isLocationOccluded?: (ll: mapboxgl.LngLat) => boolean;
		};
		if (typeof transform?.isLocationOccluded === 'function') {
			if (transform.isLocationOccluded(new mapboxgl.LngLat(lng, lat))) {
				return true;
			}
		}
	} catch {
		// Fall through to pure spherical check
	}
	const center = mapInstance.getCenter();
	return isGlobePointOccluded(center.lng, center.lat, lng, lat, mapInstance.getZoom());
}

export default function MapBoard({
	selectedDisaster = null,
	onDisasterSelect,
	activeFilters,
	onFilterToggle,
	observationWindow = DEFAULT_OBSERVATION_WINDOW,
	onObservationWindowChange,
	volcanoMode = DEFAULT_VOLCANO_MODE,
	onVolcanoModeChange,
	onOpenNearMe,
}: MapBoardProps) {
	const { t } = useLocale();
	const mapContainerRef = useRef<HTMLDivElement>(null);
	const map = useRef<mapboxgl.Map | null>(null);
	const hoverPopupRef = useRef<mapboxgl.Popup | null>(null);
	const pinnedPopupRef = useRef<mapboxgl.Popup | null>(null);
	const hoveredIdRef = useRef<string | null>(null);
	const nudgedSelectionKeyRef = useRef<string | null>(null);

	const onDisasterSelectRef = useRef(onDisasterSelect);
	useEffect(() => {
		onDisasterSelectRef.current = onDisasterSelect;
	}, [onDisasterSelect]);

	const selectedDisasterRef = useRef<Disaster | null>(selectedDisaster);
	useEffect(() => {
		selectedDisasterRef.current = selectedDisaster;
	}, [selectedDisaster]);

	const deselectLabelRef = useRef(t.deselectEventLabel);
	useEffect(() => {
		deselectLabelRef.current = t.deselectEventLabel;
	}, [t.deselectEventLabel]);

	const [disasters, setDisasters] = useState<Disaster[]>([]);
	const [fireCells, setFireCells] = useState<FireDetectionCell[]>([]);
	const [detectionCountTotal, setDetectionCountTotal] = useState<number>(0);
	const [isV2, setIsV2] = useState<boolean>(true);
	const [loading, setLoading] = useState(Boolean(accessToken));
	const [mapError, setMapError] = useState<string>(
		!accessToken ? 'Mapbox access token is missing! Check .env file.' : '',
	);
	const [lastUpdated, setLastUpdated] = useState<Date | undefined>(undefined);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [isMapLoaded, setIsMapLoaded] = useState(false);
	const [sourceStatus, setSourceStatus] = useState<DisasterSourceStatus | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const isInitialLoadRef = useRef(true);
	const styleLoadedRef = useRef(false);
	const basemapFallbackAppliedRef = useRef(isSatelliteFallbackRemembered(accessToken));
	const disastersByIdRef = useRef<Map<string, Disaster>>(new Map());
	const pulseIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const activeFiltersRef = useRef(activeFilters);
	useEffect(() => {
		activeFiltersRef.current = activeFilters;
	}, [activeFilters]);

	/** Keep pinned popup attached when on visible hemisphere and detached when on far side of globe. */
	const syncPinnedPopupVisibility = useCallback(() => {
		const mapInstance = map.current;
		const popup = pinnedPopupRef.current;
		const sel = selectedDisasterRef.current;
		if (!mapInstance || !popup || !sel) {
			popup?.remove();
			return;
		}
		const occluded = checkMapPointOccluded(mapInstance, sel.lng, sel.lat);
		if (occluded) {
			if (popup.isOpen()) {
				popup.remove();
			}
			return;
		}
		popup.setLngLat([sel.lng, sel.lat]);
		if (!popup.isOpen()) {
			popup.addTo(mapInstance);
		}
	}, []);

	/** Resolve the single topmost rendered disaster feature at `point` (with touch tolerance fallback). */
	const resolveTopFeature = (
		mapInstance: mapboxgl.Map,
		point: { x: number; y: number },
		allowTouchTolerance = false,
	): { disaster: Disaster; icon: string } | null => {
		const presentLayers = DISASTER_LAYER_PRIORITY.filter((id) => mapInstance.getLayer(id));
		if (presentLayers.length === 0) return null;

		let features = mapInstance.queryRenderedFeatures([point.x, point.y], { layers: presentLayers });
		if (features.length === 0 && allowTouchTolerance) {
			const pad = 12;
			features = mapInstance.queryRenderedFeatures(
				[
					[point.x - pad, point.y - pad],
					[point.x + pad, point.y + pad],
				],
				{ layers: presentLayers },
			);
		}
		if (features.length === 0) return null;

		for (const layerId of presentLayers) {
			const match = features.find((f) => f.layer?.id === layerId);
			const id = match?.properties?.id;
			if (typeof id === 'string') {
				const disaster = disastersByIdRef.current.get(id);
				if (disaster) {
					return { disaster, icon: DISASTER_LAYER_ICONS[layerId] };
				}
			}
		}
		return null;
	};

	const addDisasterLayers = useCallback((items: Disaster[]) => {
		if (!map.current) return;
		const mapInstance = map.current;

		removeDisasterLayers(mapInstance, pulseIntervalRef);

		const fireDetections: Disaster[] = [];
		const earthquakes: Disaster[] = [];
		const volcanoes: Disaster[] = [];
		const fires: Disaster[] = [];
		for (const d of items) {
			if (d.type === 'fire_detection') fireDetections.push(d);
			else if (d.type === 'earthquake') earthquakes.push(d);
			else if (d.type === 'volcano') volcanoes.push(d);
			else if (d.type === 'fire') fires.push(d);
		}

		const filters = activeFiltersRef.current;

		if (fireDetections.length > 0) {
			debugLog('map', `Adding fire-cells layer with ${fireDetections.length} cells`, 'info');
			mapInstance.addSource('fire-cells', {
				type: 'geojson',
				data: toPointFeatureCollection(fireDetections),
			});
			mapInstance.addLayer({
				id: 'fire-cells-layer',
				type: 'circle',
				source: 'fire-cells',
				slot: 'top',
				layout: {
					visibility: filters.has('fire_detection') ? 'visible' : 'none',
				},
				paint: {
					'circle-color': [
						'match',
						['get', 'severity'],
						'high',
						DESIGN_SYSTEM.colors.disaster.fire,
						'medium',
						DESIGN_SYSTEM.colors.disaster.fire_detection,
						DESIGN_SYSTEM.colors.disaster.earthquake,
					],
					'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3.5, 4, 5.5, 8, 9, 12, 14],
					'circle-stroke-width': 1.5,
					'circle-stroke-color': '#ffffff',
					'circle-stroke-opacity': 0.85,
					'circle-opacity': 0.82,
				},
			});
		}

		const pointSpecs: Array<{
			type: Disaster['type'];
			sourceId: (typeof DISASTER_SOURCE_IDS)[number];
			layerId: (typeof DISASTER_LAYER_PRIORITY)[number];
			records: Disaster[];
			color: string;
		}> = [
			{
				type: 'earthquake',
				sourceId: 'earthquakes',
				layerId: 'earthquakes-layer',
				records: earthquakes,
				color: DESIGN_SYSTEM.colors.disaster.earthquake,
			},
			{
				type: 'volcano',
				sourceId: 'volcanoes',
				layerId: 'volcanoes-layer',
				records: volcanoes,
				color: DESIGN_SYSTEM.colors.disaster.volcano,
			},
			{
				type: 'fire',
				sourceId: 'fires',
				layerId: 'fires-layer',
				records: fires,
				color: DESIGN_SYSTEM.colors.disaster.fire,
			},
		];

		const animatedLayerIds: string[] = [];
		for (const spec of pointSpecs) {
			if (spec.records.length === 0) continue;
			mapInstance.addSource(spec.sourceId, {
				type: 'geojson',
				data: toPointFeatureCollection(spec.records),
			});
			mapInstance.addLayer({
				id: spec.layerId,
				type: 'circle',
				source: spec.sourceId,
				slot: 'top',
				layout: {
					visibility: filters.has(spec.type) ? 'visible' : 'none',
				},
				paint: {
					'circle-radius': ['case', ['==', ['get', 'severity'], 'high'], 10, 8],
					'circle-color': spec.color,
					'circle-stroke-width': ['case', ['==', ['get', 'severity'], 'high'], 4, 3],
					'circle-stroke-color': '#ffffff',
					'circle-stroke-opacity': 1.0,
					'circle-opacity': 0.9,
				},
			});
			if (spec.records.some((r) => r.severity === 'high')) {
				animatedLayerIds.push(spec.layerId);
			}
		}

		const prefersReducedMotion =
			typeof window !== 'undefined' &&
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (animatedLayerIds.length > 0 && !prefersReducedMotion) {
			pulseIntervalRef.current = setInterval(() => {
				if (!map.current || (typeof document !== 'undefined' && document.hidden)) return;
				const phase = (Date.now() % 2000) / 2000;
				const radius = 10 + Math.sin(phase * Math.PI * 2) * 2.5;
				for (const layerId of animatedLayerIds) {
					if (!map.current.getLayer(layerId)) continue;
					try {
						map.current.setPaintProperty(layerId, 'circle-radius', [
							'case',
							['==', ['get', 'severity'], 'high'],
							radius,
							8,
						]);
					} catch {
						// Layer may be torn down during dataset update
					}
				}
			}, 250);
		}

		// Keep double-circle selection layers above all disaster layers
		for (const selLayerId of [SELECTED_DISASTER_HALO_LAYER_ID, SELECTED_DISASTER_LAYER_ID]) {
			if (mapInstance.getLayer(selLayerId)) {
				try {
					mapInstance.moveLayer(selLayerId);
				} catch {
					// Best-effort ordering
				}
			}
		}
	}, []);

	// Load disasters from backend and reconcile any active selection
	const loadDisasters = useCallback(async () => {
		try {
			debugLog('backend', `Fetching disasters (${observationWindow}, ${volcanoMode})`, 'info');

			const result = await fetchDisastersData({ window: observationWindow, volcanoMode });
			setIsV2(result.isV2);
			setSourceStatus(result.sourceStatus);
			setLoadFailed(false);

			const cellItems = result.fireCells.map(cellToDisasterItem);
			const allItems = [...result.wildfires, ...result.volcanoes, ...result.earthquakes, ...cellItems];
			const nextMap = new Map(allItems.map((d) => [d.id, d]));
			disastersByIdRef.current = nextMap;

			setDisasters(allItems);
			setFireCells(result.fireCells);
			setDetectionCountTotal(result.detectionCountTotal);
			setLastUpdated(result.fetchedAt);
			setLoading(false);
			setIsRefreshing(false);

			// Reconcile currently selected event with refreshed dataset
			const currentSelected = selectedDisasterRef.current;
			if (currentSelected) {
				const updated = nextMap.get(currentSelected.id);
				if (updated) {
					const changed =
						updated.lat !== currentSelected.lat ||
						updated.lng !== currentSelected.lng ||
						updated.title !== currentSelected.title ||
						updated.severity !== currentSelected.severity ||
						updated.date !== currentSelected.date ||
						updated.magnitude !== currentSelected.magnitude ||
						updated.areaAcres !== currentSelected.areaAcres;
					if (changed) {
						onDisasterSelectRef.current(
							currentSelected.isArchived
								? {
										...updated,
										isArchived: true,
										archiveProvenance: currentSelected.archiveProvenance,
										archiveAttribution: currentSelected.archiveAttribution,
								  }
								: updated,
						);
					}
				} else if (!currentSelected.isArchived && !result.sourceStatus?.partial) {
					onDisasterSelectRef.current(null);
					toast('Selected event is no longer in the active feed.', {
						id: 'selected-disaster-cleared',
						duration: 4000,
					});
				}
			}

			debugLog(
				'disasters',
				`Loaded ${allItems.length} total items: ${result.wildfires.length} wildfires, ${result.detectionCountTotal} hotspots (${result.fireCells.length} cells), ${result.volcanoes.length} volcanoes, ${result.earthquakes.length} quakes`,
				'success',
			);

			const degraded = describeDisasterSources(result.sourceStatus);
			if (degraded) {
				toast(degraded, { duration: 6000, icon: '⚠️' });
			}

			if (!isInitialLoadRef.current) {
				toast.success(
					`✓ Refreshed: ${result.wildfires.length} wildfires, ${result.detectionCountTotal.toLocaleString()} hotspots, ${result.earthquakes.length} quakes, ${result.volcanoes.length} volcanoes`,
					{
						duration: 3000,
						style: { minWidth: '240px' },
					},
				);
			}
			isInitialLoadRef.current = false;
		} catch (error) {
			console.error('Error loading disasters:', error);
			debugLog('disasters', `FAILED to load disasters: ${error}`, 'error', { error: String(error) });
			setLoading(false);
			setIsRefreshing(false);
			setLoadFailed(true);
			isInitialLoadRef.current = false;

			toast.error(`Failed to load disaster data: ${error}`, {
				duration: 5000,
			});
		}
	}, [observationWindow, volcanoMode]);

	const handleRefresh = async () => {
		setIsRefreshing(true);
		await loadDisasters();
	};

	// Initialize Mapbox GL instance once
	useEffect(() => {
		if (map.current) return;
		if (!mapContainerRef.current) {
			console.error('Map container ref is null');
			return;
		}
		if (!accessToken) {
			return;
		}

		try {
			const mapInstance = new mapboxgl.Map({
				container: mapContainerRef.current,
				style: MAP_STYLES.primary,
				config: MAP_BASEMAP_CONFIG,
				center: MAP_INITIAL_VIEW.center,
				zoom: MAP_INITIAL_VIEW.zoom,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				projection: { name: MAP_INITIAL_VIEW.projection } as any,
				pitch: MAP_INITIAL_VIEW.pitch,
				bearing: MAP_INITIAL_VIEW.bearing,
				attributionControl: false,
				transformRequest: (url) => {
					if (!basemapFallbackAppliedRef.current) return { url };
					const rewritten = rewriteSatelliteTileUrl(url);
					return rewritten ? { url: rewritten } : { url };
				},
			});
			map.current = mapInstance;

			const canvas = mapInstance.getCanvas();
			const handleContextLost = (evt: Event) => {
				evt.preventDefault();
				debugLog('map', 'WebGL context lost; awaiting restoration', 'warning');
			};
			const handleContextRestored = () => {
				debugLog('map', 'WebGL context restored; resizing map', 'info');
				mapInstance.resize();
				syncPinnedPopupVisibility();
			};
			canvas.addEventListener('webglcontextlost', handleContextLost);
			canvas.addEventListener('webglcontextrestored', handleContextRestored);

			mapInstance.addControl(
				new mapboxgl.AttributionControl({
					compact: true,
					customAttribution: '© Mapbox © OpenStreetMap',
				}),
				'bottom-left',
			);

			// Expose map and selection helper for diagnostics / E2E verification
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(window as any).mapDebug = mapInstance;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(window as any).selectDisasterDebug = (d: Disaster | null) => onDisasterSelectRef.current(d);

			mapInstance.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
			mapInstance.addControl(
				new mapboxgl.GeolocateControl({
					positionOptions: { enableHighAccuracy: true },
					trackUserLocation: true,
				}),
				'bottom-right',
			);

			// ResizeObserver keeps canvas & projection crisp when desktop Sidebar opens/closes or phone rotates
			let resizeObserver: ResizeObserver | null = null;
			if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
				resizeObserver = new ResizeObserver(() => {
					if (!map.current) return;
					map.current.resize();
					syncPinnedPopupVisibility();
				});
				resizeObserver.observe(mapContainerRef.current);
			}

			// Click / Tap selection (priority-ordered with coarse-pointer touch tolerance)
			mapInstance.on('click', (e) => {
				const origTarget = e.originalEvent?.target as HTMLElement | null;
				if (origTarget?.closest?.('.mapboxgl-popup, .legend-responsive')) {
					return;
				}
				const isTouchLike =
					(typeof TouchEvent !== 'undefined' && e.originalEvent instanceof TouchEvent) ||
					(typeof PointerEvent !== 'undefined' &&
						e.originalEvent instanceof PointerEvent &&
						e.originalEvent.pointerType === 'touch') ||
					(typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);

				const hit = resolveTopFeature(mapInstance, e.point, isTouchLike);
				if (!hit) return;

				e.preventDefault();
				e.originalEvent?.stopPropagation();
				hoverPopupRef.current?.remove();
				hoverPopupRef.current = null;
				hoveredIdRef.current = null;
				onDisasterSelectRef.current(hit.disaster);
			});

			// Lightweight hover preview ONLY when no event is pinned
			mapInstance.on('mousemove', (e) => {
				const hit = resolveTopFeature(mapInstance, e.point, false);
				if (!hit) {
					mapInstance.getCanvas().style.cursor = '';
					if (hoveredIdRef.current !== null) {
						hoveredIdRef.current = null;
						hoverPopupRef.current?.remove();
						hoverPopupRef.current = null;
					}
					return;
				}

				mapInstance.getCanvas().style.cursor = 'pointer';

				// Never override or compete with an active selected event's pinned bubble
				if (selectedDisasterRef.current !== null) {
					if (hoverPopupRef.current) {
						hoverPopupRef.current.remove();
						hoverPopupRef.current = null;
						hoveredIdRef.current = null;
					}
					return;
				}

				if (hoveredIdRef.current === hit.disaster.id && hoverPopupRef.current) {
					return;
				}
				hoveredIdRef.current = hit.disaster.id;

				hoverPopupRef.current?.remove();
				const content = buildDisasterPopupDom(hit.disaster, { mode: 'hover' });
				hoverPopupRef.current = new mapboxgl.Popup({
					closeButton: false,
					closeOnClick: false,
					offset: 16,
					maxWidth: '280px',
					className: 'disaster-tooltip disaster-hover-popup',
				})
					.setLngLat([hit.disaster.lng, hit.disaster.lat])
					.setDOMContent(content)
					.addTo(mapInstance);
			});

			mapInstance.on('mouseleave', () => {
				hoveredIdRef.current = null;
				mapInstance.getCanvas().style.cursor = '';
				hoverPopupRef.current?.remove();
				hoverPopupRef.current = null;
			});

			// Keep pinned bubble synced with globe horizon occlusion on camera movement
			const onCameraSync = () => syncPinnedPopupVisibility();
			mapInstance.on('move', onCameraSync);
			mapInstance.on('zoom', onCameraSync);
			mapInstance.on('rotate', onCameraSync);
			mapInstance.on('pitch', onCameraSync);
			mapInstance.on('resize', onCameraSync);

			mapInstance.on('error', (e) => {
				const action = classifyMapboxError(
					e as { sourceId?: string; error?: { status?: number; message?: string; url?: string } },
					{ hasFallbackApplied: basemapFallbackAppliedRef.current },
				);
				if (action.kind === 'fallback_satellite_tiles') {
					basemapFallbackAppliedRef.current = true;
					rememberSatelliteFallback(accessToken);
					debugLog('map', action.reason, 'warning');
					toast(action.reason, { id: 'map-basemap-fallback', duration: 5000, icon: '🛰️' });
					if (styleLoadedRef.current || mapInstance.isStyleLoaded()) {
						mountFallbackSatelliteLayer(mapInstance);
					}
					return;
				}
				if (action.kind === 'fatal') {
					console.error('Fatal Mapbox error:', e);
					setMapError(action.message);
					setLoading(false);
					return;
				}
				debugLog('map', `Non-fatal Mapbox tile/source error: ${action.detail}`, 'warning');
			});

			mapInstance.on('load', () => {
				styleLoadedRef.current = true;
				debugLog('map', 'Map finished loading', 'success');
				if (basemapFallbackAppliedRef.current) {
					mountFallbackSatelliteLayer(mapInstance);
				}
				setIsMapLoaded(true);
			});
			mapInstance.on('style.load', () => {
				styleLoadedRef.current = true;
				if (basemapFallbackAppliedRef.current) {
					mountFallbackSatelliteLayer(mapInstance);
				}
				setIsMapLoaded(true);
				syncPinnedPopupVisibility();
			});

			return () => {
				resizeObserver?.disconnect();
				canvas.removeEventListener('webglcontextlost', handleContextLost);
				canvas.removeEventListener('webglcontextrestored', handleContextRestored);
				hoverPopupRef.current?.remove();
				hoverPopupRef.current = null;
				pinnedPopupRef.current?.remove();
				pinnedPopupRef.current = null;
				removeDisasterLayers(mapInstance, pulseIntervalRef);
				mapInstance.remove();
				map.current = null;
				styleLoadedRef.current = false;
				setIsMapLoaded(false);
			};
		} catch (error) {
			console.error('Error creating map:', error);
			queueMicrotask(() => {
				setMapError(`Failed to create map: ${error}`);
				setLoading(false);
			});
		}
	}, [syncPinnedPopupVisibility]);

	useEffect(() => {
		const timer = setTimeout(() => {
			void loadDisasters();
		}, 0);
		return () => clearTimeout(timer);
	}, [loadDisasters]);

	useEffect(() => {
		if (!map.current || !isMapLoaded) return;
		removeDisasterLayers(map.current, pulseIntervalRef);
		if (disasters.length > 0) addDisasterLayers(disasters);
	}, [isMapLoaded, disasters, addDisasterLayers]);

	useEffect(() => {
		if (!map.current || !isMapLoaded) return;
		const mapInstance = map.current;
		const mapping: Array<[string, string]> = [
			['fires-layer', 'fire'],
			['fire-cells-layer', 'fire_detection'],
			['volcanoes-layer', 'volcano'],
			['earthquakes-layer', 'earthquake'],
		];
		for (const [layerId, type] of mapping) {
			if (mapInstance.getLayer(layerId)) {
				try {
					mapInstance.setLayoutProperty(
						layerId,
						'visibility',
						activeFilters.has(type) ? 'visible' : 'none',
					);
				} catch {
					// Best-effort visibility update
				}
			}
		}
	}, [isMapLoaded, activeFilters]);

	// Authoritative selection effect: double-circle marker + persistent pinned bubble + dynamic safe-area nudge
	useEffect(() => {
		if (!map.current || !isMapLoaded) return;
		const mapInstance = map.current;

		// Always clear any transient hover popup when selection state changes
		hoverPopupRef.current?.remove();
		hoverPopupRef.current = null;
		hoveredIdRef.current = null;

		const data: GeoJSON.FeatureCollection<GeoJSON.Point> = selectedDisaster
			? {
					type: 'FeatureCollection',
					features: [
						{
							type: 'Feature',
							geometry: {
								type: 'Point',
								coordinates: [selectedDisaster.lng, selectedDisaster.lat],
							},
							properties: { id: selectedDisaster.id, type: selectedDisaster.type },
						},
					],
			  }
			: { type: 'FeatureCollection', features: [] };

		const existingSource = mapInstance.getSource(SELECTED_DISASTER_SOURCE_ID) as
			| mapboxgl.GeoJSONSource
			| undefined;
		if (existingSource) {
			existingSource.setData(data);
		} else {
			mapInstance.addSource(SELECTED_DISASTER_SOURCE_ID, { type: 'geojson', data });
		}

		// Outer glow ring of the double-circle selection marker
		if (!mapInstance.getLayer(SELECTED_DISASTER_HALO_LAYER_ID)) {
			mapInstance.addLayer({
				id: SELECTED_DISASTER_HALO_LAYER_ID,
				type: 'circle',
				source: SELECTED_DISASTER_SOURCE_ID,
				slot: 'top',
				paint: {
					'circle-radius': 21,
					'circle-color': 'rgba(59, 130, 246, 0.14)',
					'circle-stroke-width': 2,
					'circle-stroke-color': '#60a5fa',
					'circle-stroke-opacity': 0.9,
				},
			});
		}

		// Inner crisp ring of the double-circle selection marker
		if (!mapInstance.getLayer(SELECTED_DISASTER_LAYER_ID)) {
			mapInstance.addLayer({
				id: SELECTED_DISASTER_LAYER_ID,
				type: 'circle',
				source: SELECTED_DISASTER_SOURCE_ID,
				slot: 'top',
				paint: {
					'circle-radius': 13,
					'circle-color': 'rgba(37, 99, 235, 0.28)',
					'circle-stroke-width': 3,
					'circle-stroke-color': '#ffffff',
					'circle-stroke-opacity': 1,
				},
			});
		}

		for (const selLayerId of [SELECTED_DISASTER_HALO_LAYER_ID, SELECTED_DISASTER_LAYER_ID]) {
			if (mapInstance.getLayer(selLayerId)) {
				try {
					mapInstance.moveLayer(selLayerId);
				} catch {
					// Best-effort ordering
				}
			}
		}

		if (!selectedDisaster) {
			nudgedSelectionKeyRef.current = null;
			pinnedPopupRef.current?.remove();
			pinnedPopupRef.current = null;
			return;
		}

		// Create or update the single pinned popup anchored to [lng, lat]
		const dom = buildDisasterPopupDom(selectedDisaster, {
			mode: 'pinned',
			deselectLabel: deselectLabelRef.current,
			onClose: () => onDisasterSelectRef.current(null),
		});

		if (!pinnedPopupRef.current) {
			pinnedPopupRef.current = new mapboxgl.Popup({
				closeButton: false,
				closeOnClick: false,
				offset: 20,
				maxWidth: '300px',
				className: 'disaster-tooltip disaster-pinned-popup',
			});
		}
		pinnedPopupRef.current.setLngLat([selectedDisaster.lng, selectedDisaster.lat]).setDOMContent(dom);
		syncPinnedPopupVisibility();

		// Measure real overlay obstructions after layout settles (Sidebar flex mount / mobile sheet)
		const selectionKey = `${selectedDisaster.id}:${selectedDisaster.lng.toFixed(4)},${selectedDisaster.lat.toFixed(4)}`;
		if (nudgedSelectionKeyRef.current === selectionKey) {
			return;
		}
		nudgedSelectionKeyRef.current = selectionKey;

		const rafId = requestAnimationFrame(() => {
			if (!map.current || !mapContainerRef.current) return;
			const m = map.current;
			m.resize();

			const canvasRect = mapContainerRef.current.getBoundingClientRect();
			if (canvasRect.width <= 0 || canvasRect.height <= 0) return;

			let safeLeft = 20;
			let safeRight = 20;
			const safeTop = Math.min(132, Math.max(84, Math.round(canvasRect.height * 0.2)));
			let safeBottom = 36;

			const legendEl = document.querySelector('.legend-responsive');
			if (legendEl) {
				const lRect = legendEl.getBoundingClientRect();
				// Account for expanded desktop legend on whichever inline side (LTR left or RTL right) it sits
				if (lRect.height > 80 && lRect.width < canvasRect.width * 0.65) {
					const centerOffset = lRect.left + lRect.width / 2 - canvasRect.left;
					if (centerOffset < canvasRect.width / 2) {
						safeLeft = Math.min(Math.round(canvasRect.width * 0.42), Math.max(20, Math.round(lRect.right - canvasRect.left + 20)));
					} else {
						safeRight = Math.min(Math.round(canvasRect.width * 0.42), Math.max(20, Math.round(canvasRect.right - lRect.left + 20)));
					}
				}
			}

			const sidebarEl = document.querySelector('[data-testid="sidebar"]');
			if (sidebarEl) {
				const sRect = sidebarEl.getBoundingClientRect();
				// Mobile bottom sheet overlaps the bottom of the map container
				const overlapsHorizontally = sRect.width >= canvasRect.width * 0.75;
				const overlapsBottom = sRect.top < canvasRect.bottom - 8 && sRect.top > canvasRect.top + 40;
				if (overlapsHorizontally && overlapsBottom) {
					safeBottom = Math.min(
						Math.round(canvasRect.height * 0.52),
						Math.max(40, Math.round(canvasRect.bottom - sRect.top + 28)),
					);
				}
			}

			const prefersReducedMotion =
				typeof window.matchMedia === 'function' &&
				window.matchMedia('(prefers-reduced-motion: reduce)').matches;

			const occluded = checkMapPointOccluded(m, selectedDisaster.lng, selectedDisaster.lat);
			const pt = m.project([selectedDisaster.lng, selectedDisaster.lat]);
			const outOfSafeBounds =
				pt.x < safeLeft + 32 ||
				pt.x > canvasRect.width - safeRight - 32 ||
				pt.y < safeTop ||
				pt.y > canvasRect.height - safeBottom;

			if (occluded || outOfSafeBounds) {
				const targetZoom = selectedDisaster.isArchived
					? Math.max(m.getZoom(), 4.2)
					: m.getZoom();
				m.easeTo({
					center: [selectedDisaster.lng, selectedDisaster.lat],
					zoom: targetZoom,
					bearing: m.getBearing(),
					pitch: m.getPitch(),
					padding: {
						top: safeTop,
						bottom: safeBottom,
						left: safeLeft,
						right: safeRight,
					},
					duration: prefersReducedMotion ? 0 : occluded ? 550 : 380,
				});
			}
			syncPinnedPopupVisibility();
		});

		return () => cancelAnimationFrame(rafId);
	}, [isMapLoaded, selectedDisaster, syncPinnedPopupVisibility]);

	// Re-render pinned popup localized close label if UI locale changes while selected
	useEffect(() => {
		if (!selectedDisaster || !pinnedPopupRef.current) return;
		const dom = buildDisasterPopupDom(selectedDisaster, {
			mode: 'pinned',
			deselectLabel: t.deselectEventLabel,
			onClose: () => onDisasterSelectRef.current(null),
		});
		pinnedPopupRef.current.setDOMContent(dom);
	}, [t.deselectEventLabel, selectedDisaster]);

	const disasterCounts = useMemo(() => {
		let fires = 0;
		let volcanoes = 0;
		let earthquakes = 0;
		for (const d of disasters) {
			if (d.type === 'fire') fires++;
			else if (d.type === 'volcano') volcanoes++;
			else if (d.type === 'earthquake') earthquakes++;
		}
		return {
			fires,
			fireDetections: detectionCountTotal,
			fireCells: fireCells.length,
			volcanoes,
			earthquakes,
			total: disasters.length,
		};
	}, [disasters, detectionCountTotal, fireCells.length]);

	const visibleDisasters = useMemo(
		() => disasters.filter((d) => activeFilters.has(d.type)),
		[disasters, activeFilters],
	);

	return (
		<div className="relative w-full h-full">
			<div ref={mapContainerRef} className="absolute inset-0" />

			{/* Error message — keeps resident Near me text view accessible */}
			{mapError && (
				<div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 z-20 p-4">
					<div className="bg-slate-900 border border-red-500/40 px-6 py-5 rounded-xl shadow-2xl max-w-md text-center">
						<h2 className="text-lg font-bold text-white mb-2">Interactive Map Unavailable</h2>
						<p className="text-red-200 text-sm">{mapError}</p>
						<p className="text-gray-300 text-xs mt-3">
							Official local warnings, instructions, and emergency contact tools do not require the map.
						</p>
						{onOpenNearMe && (
							<button
								type="button"
								onClick={onOpenNearMe}
								data-testid="map-error-open-near-me"
								className="mt-4 min-h-[42px] px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
							>
								Open Near Me (Text View)
							</button>
						)}
					</div>
				</div>
			)}

			{/* Loading overlay */}
			{loading && !mapError && (
				<div
					className="absolute inset-0 flex items-center justify-center z-40 p-4"
					style={{
						background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.94), rgba(31, 41, 55, 0.94))',
						backdropFilter: 'blur(12px)',
						WebkitBackdropFilter: 'blur(12px)',
					}}
				>
					<div
						className="rounded-2xl max-w-sm w-full text-center p-6 border"
						style={{
							background: 'rgba(17, 24, 39, 0.96)',
							borderColor: 'rgba(59, 130, 246, 0.35)',
							boxShadow: '0 20px 60px rgba(0, 0, 0, 0.7)',
						}}
					>
						<div className="text-3xl mb-3" aria-hidden="true">
							🌐
						</div>
						<h3 className="text-lg font-black text-blue-400 mb-1.5">Initializing AegisMap</h3>
						<p className="text-xs text-slate-300 font-medium mb-4">
							Loading active observations from NASA EONET, USGS, and NASA FIRMS…
						</p>
						<div className="flex flex-wrap justify-center gap-1.5">
							{['NASA EONET', 'USGS', 'NASA FIRMS', 'Open-Meteo'].map((source) => (
								<span
									key={source}
									className="text-[11px] px-2.5 py-1 rounded-full font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30"
								>
									{source}
								</span>
							))}
						</div>
					</div>
				</div>
			)}

			{/* Map Legend + Keyboard-Accessible Event List */}
			{!loading && (
				<MapLegend
					counts={disasterCounts}
					lastUpdated={lastUpdated}
					onRefresh={handleRefresh}
					isRefreshing={isRefreshing}
					activeFilters={activeFilters}
					onFilterToggle={onFilterToggle}
					sourceStatus={sourceStatus}
					loadFailed={loadFailed}
					observationWindow={observationWindow}
					onObservationWindowChange={onObservationWindowChange}
					volcanoMode={volcanoMode}
					onVolcanoModeChange={onVolcanoModeChange}
					isV2={isV2}
					events={visibleDisasters}
					selectedDisasterId={selectedDisaster?.id ?? null}
					onSelectDisaster={onDisasterSelect}
				/>
			)}
		</div>
	);
}
