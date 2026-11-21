/**
 * MapBoard Component - SAFE MODE Mapbox Implementation
 * Uses useRef to prevent unnecessary map re-renders
 */

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { debugLog } from '../utils/debug';
import toast from 'react-hot-toast';
import type { Disaster, DisasterSourceStatus, FireDetectionCell, ObservationWindow, VolcanoMode } from '../types';
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
    SELECTED_DISASTER_LAYER_ID,
    SELECTED_DISASTER_SOURCE_ID,
} from '../config/map';
import { describeDisasterSources } from '../utils/disasterSources';
import { cellToDisasterItem, fetchDisastersData } from '../utils/disastersClient';
import { DESIGN_SYSTEM } from '../constants/designSystem';
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

// Helper function to safely remove all disaster layers and sources
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

export default function MapBoard({
    selectedDisaster = null,
    onDisasterSelect,
    activeFilters,
    onFilterToggle,
    observationWindow = DEFAULT_OBSERVATION_WINDOW,
    onObservationWindowChange,
    volcanoMode = DEFAULT_VOLCANO_MODE,
    onVolcanoModeChange,
}: MapBoardProps) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const tooltipRef = useRef<mapboxgl.Popup | null>(null);
    const hoveredIdRef = useRef<string | null>(null);
    const onDisasterSelectRef = useRef(onDisasterSelect);
    useEffect(() => {
        onDisasterSelectRef.current = onDisasterSelect;
    }, [onDisasterSelect]);

    const [disasters, setDisasters] = useState<Disaster[]>([]);
    const [fireCells, setFireCells] = useState<FireDetectionCell[]>([]);
    const [detectionCountTotal, setDetectionCountTotal] = useState<number>(0);
    const [isV2, setIsV2] = useState<boolean>(true);
    const [loading, setLoading] = useState(Boolean(accessToken));
    const [mapError, setMapError] = useState<string>(
        !accessToken ? 'Mapbox access token is missing! Check .env file.' : ''
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

    /** Resolve the single topmost rendered disaster feature at `point` in strict visual priority order. */
    const resolveTopFeature = (
        mapInstance: mapboxgl.Map,
        point: mapboxgl.PointLike,
    ): { disaster: Disaster; icon: string } | null => {
        const presentLayers = DISASTER_LAYER_PRIORITY.filter((id) => mapInstance.getLayer(id));
        if (presentLayers.length === 0) return null;
        const features = mapInstance.queryRenderedFeatures(point, { layers: presentLayers });
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

    // Add disaster data layers to map (bottom-to-top matching DISASTER_LAYER_PRIORITY)
    const addDisasterLayers = (items: Disaster[]) => {
        if (!map.current) return;
        const mapInstance = map.current;

        removeDisasterLayers(mapInstance, pulseIntervalRef);

        const visible = items.filter((d) => activeFilters.has(d.type));
        const fireDetections = visible.filter((d) => d.type === 'fire_detection');
        const earthquakes = visible.filter((d) => d.type === 'earthquake');
        const volcanoes = visible.filter((d) => d.type === 'volcano');
        const fires = visible.filter((d) => d.type === 'fire');

        // 1. Satellite thermal cells (bottom of disaster stack so confirmed events stay clickable on top)
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
                paint: {
                    'circle-color': [
                        'match',
                        ['get', 'severity'],
                        'high', DESIGN_SYSTEM.colors.disaster.fire,
                        'medium', DESIGN_SYSTEM.colors.disaster.fire_detection,
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

        // 2. Point disaster layers (earthquakes -> volcanoes -> confirmed wildfires on top)
        const pointSpecs: Array<{
            sourceId: (typeof DISASTER_SOURCE_IDS)[number];
            layerId: (typeof DISASTER_LAYER_PRIORITY)[number];
            records: Disaster[];
            color: string;
        }> = [
            { sourceId: 'earthquakes', layerId: 'earthquakes-layer', records: earthquakes, color: DESIGN_SYSTEM.colors.disaster.earthquake },
            { sourceId: 'volcanoes', layerId: 'volcanoes-layer', records: volcanoes, color: DESIGN_SYSTEM.colors.disaster.volcano },
            { sourceId: 'fires', layerId: 'fires-layer', records: fires, color: DESIGN_SYSTEM.colors.disaster.fire },
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

        // Single shared pulse animation for high-severity markers across active point layers
        if (animatedLayerIds.length > 0) {
            pulseIntervalRef.current = setInterval(() => {
                if (!map.current) return;
                const phase = (Date.now() % 2000) / 2000;
                const radius = 10 + Math.sin(phase * Math.PI * 2) * 3;
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
                        // Layer may be torn down during filter update
                    }
                }
            }, 50);
        }

        // Keep selection ring layer on top of disaster layers when present
        if (mapInstance.getLayer(SELECTED_DISASTER_LAYER_ID)) {
            try {
                mapInstance.moveLayer(SELECTED_DISASTER_LAYER_ID);
            } catch {
                // Best-effort ordering
            }
        }
    };

    // Load disasters from backend
    const loadDisasters = async () => {
        try {
            debugLog('backend', `Fetching disasters (${observationWindow}, ${volcanoMode})`, 'info');

            const result = await fetchDisastersData({ window: observationWindow, volcanoMode });
            setIsV2(result.isV2);
            setSourceStatus(result.sourceStatus);
            setLoadFailed(false);

            // Convert thermal cells into selectable Disaster items
            const cellItems = result.fireCells.map(cellToDisasterItem);
            const allItems = [...result.wildfires, ...result.volcanoes, ...result.earthquakes, ...cellItems];
            disastersByIdRef.current = new Map(allItems.map((d) => [d.id, d]));

            setDisasters(allItems);
            setFireCells(result.fireCells);
            setDetectionCountTotal(result.detectionCountTotal);
            setLastUpdated(result.fetchedAt);
            setLoading(false);
            setIsRefreshing(false);

            debugLog(
                'disasters',
                `Loaded ${allItems.length} total items: ${result.wildfires.length} wildfires, ${result.detectionCountTotal} hotspots (${result.fireCells.length} cells), ${result.volcanoes.length} volcanoes, ${result.earthquakes.length} quakes`,
                'success'
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
                        style: {
                            minWidth: '250px',
                        },
                    }
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
    };

    // Manual refresh handler
    const handleRefresh = async () => {
        setIsRefreshing(true);
        // Existing layers stay until new data arrives; the effect below swaps them
        await loadDisasters();
    };

    // Initialize map only once
    useEffect(() => {
        if (map.current) return; // Prevent re-initialization

        if (!mapContainerRef.current) {
            console.error('Map container ref is null');
            return;
        }

        if (!accessToken) {
            return;
        }

        try {
            // Create map instance using official Mapbox Standard Satellite style (Mapbox GL JS v3)
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

            // Preserve & recover WebGL context cleanly if browser temporarily suspends GPU resources
            const canvas = mapInstance.getCanvas();
            const handleContextLost = (evt: Event) => {
                evt.preventDefault();
                debugLog('map', 'WebGL context lost; awaiting restoration', 'warning');
            };
            const handleContextRestored = () => {
                debugLog('map', 'WebGL context restored; resizing map', 'info');
                mapInstance.resize();
            };
            canvas.addEventListener('webglcontextlost', handleContextLost);
            canvas.addEventListener('webglcontextrestored', handleContextRestored);

            // Compact attribution in bottom-left
            mapInstance.addControl(
                new mapboxgl.AttributionControl({
                    compact: true,
                    customAttribution: '© Mapbox © OpenStreetMap',
                }),
                'bottom-left',
            );

            // DEBUG: Expose map and selection handler for debugging / E2E
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).mapDebug = mapInstance;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).selectDisasterDebug = (d: Disaster | null) => onDisasterSelectRef.current(d);

            // Navigation & geolocate controls
            mapInstance.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
            mapInstance.addControl(
                new mapboxgl.GeolocateControl({
                    positionOptions: { enableHighAccuracy: true },
                    trackUserLocation: true,
                }),
                'bottom-right',
            );

            // Unified priority-ordered click handler: selects the exact topmost feature and keeps its position visible
            mapInstance.on('click', (e) => {
                const hit = resolveTopFeature(mapInstance, e.point);
                if (!hit) return;
                e.preventDefault();
                e.originalEvent?.stopPropagation();
                onDisasterSelectRef.current(hit.disaster);

                // Keep user's exact zoom & position; only nudge if the right sidebar (420px) would cover the point on desktop
                const rect = mapInstance.getCanvas().getBoundingClientRect();
                if (window.innerWidth >= 768 && e.point.x > rect.width - 440) {
                    mapInstance.easeTo({
                        center: [hit.disaster.lng, hit.disaster.lat],
                        zoom: mapInstance.getZoom(),
                        padding: { left: 280, right: 440, top: 64, bottom: 24 },
                        duration: 450,
                    });
                }
            });

            // Unified hover tooltip handler: always matches the exact topmost clickable feature
            mapInstance.on('mousemove', (e) => {
                const hit = resolveTopFeature(mapInstance, e.point);
                if (!hit) {
                    if (hoveredIdRef.current !== null) {
                        hoveredIdRef.current = null;
                        mapInstance.getCanvas().style.cursor = '';
                        tooltipRef.current?.remove();
                        tooltipRef.current = null;
                    }
                    return;
                }

                mapInstance.getCanvas().style.cursor = 'pointer';
                if (hoveredIdRef.current === hit.disaster.id && tooltipRef.current) {
                    return;
                }
                hoveredIdRef.current = hit.disaster.id;

                tooltipRef.current?.remove();
                const content = document.createElement('div');
                content.className = 'text-sm font-medium';
                const { disaster: selected, icon } = hit;
                if (selected.type === 'fire_detection') {
                    const count = selected.detectionCell?.detectionCount ?? '';
                    const frp =
                        selected.detectionCell?.maxFrp !== null && selected.detectionCell?.maxFrp !== undefined
                            ? ` (Peak FRP: ${selected.detectionCell.maxFrp} MW)`
                            : '';
                    content.innerHTML = `
                        <div style="font-weight: 700; color: ${DESIGN_SYSTEM.colors.disaster.fire_detection};">${icon} Satellite Hotspots Cell</div>
                        <div style="font-size: 0.75rem;">${count} detections${frp}</div>
                        <div style="font-size: 0.65rem; color: #9ca3af; margin-top: 2px;">Sensor thermal signature — not confirmed perimeter</div>
                    `;
                } else {
                    const magText = selected.magnitude !== undefined ? ` M${selected.magnitude}` : '';
                    const areaText =
                        selected.areaAcres !== undefined
                            ? ` (${Math.round(selected.areaAcres).toLocaleString()} ac)`
                            : '';
                    content.textContent = `${icon} ${selected.title}${magText}${areaText}`;
                }

                tooltipRef.current = new mapboxgl.Popup({
                    closeButton: false,
                    closeOnClick: false,
                    className: 'disaster-tooltip',
                })
                    .setLngLat([selected.lng, selected.lat])
                    .setDOMContent(content)
                    .addTo(mapInstance);
            });

            mapInstance.on('mouseleave', () => {
                hoveredIdRef.current = null;
                mapInstance.getCanvas().style.cursor = '';
                tooltipRef.current?.remove();
                tooltipRef.current = null;
            });

            // Classify map errors: swap satellite raster tiles in-place on HTTP 429 (no setStyle rebuild, always satellite)
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

            // Load disaster data immediately in parallel with map
            // eslint-disable-next-line react-hooks/set-state-in-effect
            loadDisasters();

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
            });

            return () => {
                canvas.removeEventListener('webglcontextlost', handleContextLost);
                canvas.removeEventListener('webglcontextrestored', handleContextRestored);
                tooltipRef.current?.remove();
                tooltipRef.current = null;
                removeDisasterLayers(mapInstance, pulseIntervalRef);
                mapInstance.remove();
                map.current = null;
                styleLoadedRef.current = false;
                setIsMapLoaded(false);
            };
        } catch (error) {
            console.error('Error creating map:', error);
            setMapError(`Failed to create map: ${error}`);
            setLoading(false);
        }
    }, []); // Empty dependency array = run once

    // Reload when observation window or volcano mode changes
    const isFirstMountRef = useRef(true);
    useEffect(() => {
        if (isFirstMountRef.current) {
            isFirstMountRef.current = false;
            return;
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadDisasters();
    }, [observationWindow, volcanoMode]);

    // Re-render layers when map is loaded, filters change, or disasters update
    useEffect(() => {
        if (!map.current || !isMapLoaded) return;

        removeDisasterLayers(map.current, pulseIntervalRef);
        if (disasters.length > 0) addDisasterLayers(disasters);
    }, [isMapLoaded, activeFilters, disasters]);

    // Pin a persistent highlight ring on the selected disaster without rebuilding disaster layers
    useEffect(() => {
        if (!map.current || !isMapLoaded) return;
        const mapInstance = map.current;
        const data: GeoJSON.FeatureCollection<GeoJSON.Point> = selectedDisaster
            ? {
                  type: 'FeatureCollection',
                  features: [
                      {
                          type: 'Feature',
                          geometry: { type: 'Point', coordinates: [selectedDisaster.lng, selectedDisaster.lat] },
                          properties: { id: selectedDisaster.id },
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

        if (!mapInstance.getLayer(SELECTED_DISASTER_LAYER_ID)) {
            mapInstance.addLayer({
                id: SELECTED_DISASTER_LAYER_ID,
                type: 'circle',
                source: SELECTED_DISASTER_SOURCE_ID,
                slot: 'top',
                paint: {
                    'circle-radius': 15,
                    'circle-color': 'rgba(59, 130, 246, 0.25)',
                    'circle-stroke-width': 3,
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-opacity': 1,
                },
            });
        }
    }, [isMapLoaded, selectedDisaster]);

    // Calculate disaster counts
    const disasterCounts = {
        fires: disasters.filter(d => d.type === 'fire').length,
        fireDetections: detectionCountTotal,
        fireCells: fireCells.length,
        volcanoes: disasters.filter(d => d.type === 'volcano').length,
        earthquakes: disasters.filter(d => d.type === 'earthquake').length,
        total: disasters.length,
    };

    return (
        <div className="relative w-full h-full">
            <div ref={mapContainerRef} className="absolute inset-0" />

            {/* Error message */}
            {mapError && (
                <div className="absolute inset-0 flex items-center justify-center bg-red-900 bg-opacity-80 z-20">
                    <div className="bg-red-800 px-8 py-6 rounded-lg shadowAegis-2xl max-w-md text-center">
                        <h2 className="text-2xl font-bold text-white mb-2">Map Error</h2>
                        <p className="text-white">{mapError}</p>
                        <p className="text-gray-300 text-sm mt-4">
                            Check browser console (F12) for more details.
                        </p>
                    </div>
                </div>
            )}

            {/* Loading overlay - DYNAMIC ANIMATED VERSION */}
            {loading && !mapError && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 9999,
                        background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.95), rgba(31, 41, 55, 0.95))',
                        backdropFilter: 'blur(16px)',
                        WebkitBackdropFilter: 'blur(16px)',
                    }}
                >
                    <div
                        className="rounded-2xl max-w-md text-center relative overflow-hidden"
                        style={{
                            padding: '32px 40px',
                            background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.98), rgba(31, 41, 55, 0.98))',
                            backdropFilter: 'blur(32px)',
                            WebkitBackdropFilter: 'blur(32px)',
                            border: '2px solid rgba(59, 130, 246, 0.3)',
                            boxShadow: '0 25px 80px rgba(0, 0, 0, 0.9), 0 0 1px rgba(59, 130, 246, 0.5)',
                        }}
                    >
                        {/* Animated gradient overlays */}
                        <div
                            className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl opacity-30 pointer-events-none"
                            style={{
                                background: 'radial-gradient(circle, rgba(59, 130, 246, 0.5), transparent 70%)',
                                animation: 'pulse 3s ease-in-out infinite',
                            }}
                        />
                        <div
                            className="absolute bottom-0 left-0 w-64 h-64 rounded-full blur-3xl opacity-30 pointer-events-none"
                            style={{
                                background: 'radial-gradient(circle, rgba(147, 51, 234, 0.5), transparent 70%)',
                                animation: 'pulse 3s ease-in-out infinite 1.5s',
                            }}
                        />

                        {/* Rotating globe with glow */}
                        <div className="mb-6 flex justify-center relative">
                            <div
                                className="relative"
                                style={{
                                    animation: 'spin 4s linear infinite',
                                }}
                            >
                                <div
                                    className="w-20 h-20 rounded-full flex items-center justify-center relative"
                                    style={{
                                        background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                        boxShadow: '0 0 40px rgba(59, 130, 246, 0.6), 0 0 80px rgba(59, 130, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
                                    }}
                                >
                                    <span className="text-4xl relative z-10">🌐</span>
                                    {/* Orbiting ring */}
                                    <div
                                        className="absolute inset-0 rounded-full"
                                        style={{
                                            border: '2px solid rgba(255, 255, 255, 0.3)',
                                            animation: 'pulse 2s ease-in-out infinite',
                                        }}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Title with gradient */}
                        <h3
                            className="text-2xl font-black mb-3 relative z-10"
                            style={{
                                background: 'linear-gradient(135deg, #60a5fa, #a78bfa)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                                letterSpacing: '-0.02em',
                            }}
                        >
                            Initializing AegisMap
                        </h3>

                        {/* Loading text with typing animation effect */}
                        <p
                            className="text-sm mb-4 relative z-10"
                            style={{
                                color: '#e5e7eb',
                                fontWeight: '600',
                            }}
                        >
                            Loading disaster data from multiple sources...
                        </p>

                        {/* Data sources tags */}
                        <div className="flex flex-wrap justify-center gap-2 mb-6 relative z-10">
                            {['NASA EONET', 'USGS', 'NASA FIRMS', 'Open-Meteo'].map((source, index) => (
                                <span
                                    key={source}
                                    className="text-xs px-3 py-1.5 rounded-full font-bold"
                                    style={{
                                        background: 'rgba(59, 130, 246, 0.15)',
                                        color: '#60a5fa',
                                        border: '1px solid rgba(59, 130, 246, 0.3)',
                                        boxShadow: '0 0 12px rgba(59, 130, 246, 0.2)',
                                        animation: `fadeIn 0.5s ease-out ${index * 0.15}s both`,
                                    }}
                                >
                                    {source}
                                </span>
                            ))}
                        </div>

                        {/* Animated progress bar */}
                        <div
                            className="w-full rounded-full h-2 overflow-hidden relative z-10"
                            style={{
                                background: 'rgba(75, 85, 99, 0.5)',
                                boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.5)',
                            }}
                        >
                            <div
                                className="h-full relative overflow-hidden"
                                style={{
                                    background: 'linear-gradient(90deg, #3b82f6, #8b5cf6, #3b82f6)',
                                    backgroundSize: '200% 100%',
                                    animation: 'shimmer 2s linear infinite',
                                    boxShadow: '0 0 12px rgba(59, 130, 246, 0.6)',
                                    width: '100%',
                                }}
                            >
                                {/* Moving shine effect */}
                                <div
                                    className="absolute inset-0"
                                    style={{
                                        background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent)',
                                        animation: 'slide 1.5s ease-in-out infinite',
                                    }}
                                />
                            </div>
                        </div>

                        {/* Loading dots */}
                        <div className="flex justify-center gap-2 mt-4 relative z-10">
                            {[0, 1, 2].map((i) => (
                                <div
                                    key={i}
                                    className="w-2 h-2 rounded-full"
                                    style={{
                                        background: '#60a5fa',
                                        boxShadow: '0 0 8px rgba(96, 165, 250, 0.6)',
                                        animation: `bounce 1.4s ease-in-out ${i * 0.2}s infinite`,
                                    }}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Add keyframes for animations */}
                    <style>{`
                        @keyframes spin {
                            from { transform: rotate(0deg); }
                            to { transform: rotate(360deg); }
                        }
                        @keyframes shimmer {
                            0% { background-position: -200% 0; }
                            100% { background-position: 200% 0; }
                        }
                        @keyframes slide {
                            0% { transform: translateX(-100%); }
                            100% { transform: translateX(100%); }
                        }
                        @keyframes bounce {
                            0%, 80%, 100% { transform: scale(0); opacity: 0.5; }
                            40% { transform: scale(1); opacity: 1; }
                        }
                        @keyframes fadeIn {
                            from { opacity: 0; transform: translateY(-10px); }
                            to { opacity: 1; transform: translateY(0); }
                        }
                    `}</style>
                </div>
            )}

            {/* Map Legend - always stays visible once disaster data has loaded */}
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
                />
            )}

            {/* Removed DisasterSummary - too cluttered */}
        </div>
    );
}

