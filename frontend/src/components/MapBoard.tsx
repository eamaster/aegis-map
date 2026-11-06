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
import { describeDisasterSources } from '../utils/disasterSources';
import { cellToDisasterItem, fetchDisastersData } from '../utils/disastersClient';
import MapLegend from './MapLegend';

type LayerHandler = {
    type: 'click' | 'mouseenter' | 'mouseleave';
    layer: string;
    fn: (e: mapboxgl.MapMouseEvent) => void;
};

// Set Mapbox access token
const accessToken = import.meta.env.VITE_MAPBOX_TOKEN;
mapboxgl.accessToken = accessToken;

interface MapBoardProps {
    onDisasterSelect: (disaster: Disaster | null) => void;
    activeFilters: Set<string>;
    onFilterToggle: (type: string) => void;
    observationWindow?: ObservationWindow;
    onObservationWindowChange?: (window: ObservationWindow) => void;
    volcanoMode?: VolcanoMode;
    onVolcanoModeChange?: (mode: VolcanoMode) => void;
}

// Helper function to safely remove all disaster layers and sources
const removeDisasterLayers = (
    mapInstance: mapboxgl.Map | null,
    animationIds?: Record<string, ReturnType<typeof setInterval>>,
    handlers?: LayerHandler[]
) => {
    if (!mapInstance) return;

    // Layer-delegated listeners outlive removeLayer, so detach them explicitly
    if (handlers) {
        handlers.forEach(({ type, layer, fn }) => mapInstance.off(type, layer, fn));
        handlers.length = 0;
    }

    // Stop all animations first
    if (animationIds) {
        Object.values(animationIds).forEach(intervalId => {
            if (intervalId) clearInterval(intervalId);
        });
        // Clear the animation IDs object
        Object.keys(animationIds).forEach(key => delete animationIds[key]);
    }

    // Remove layers (must be done before removing sources)
    ['fires-layer', 'fire-cells-layer', 'earthquakes-layer', 'volcanoes-layer'].forEach(layerId => {
        if (mapInstance.getLayer(layerId)) {
            try {
                mapInstance.removeLayer(layerId);
            } catch (e) {
                console.warn(`  ⚠️ Could not remove layer ${layerId}:`, e);
            }
        }
    });

    // Remove sources
    ['fires', 'fire-cells', 'earthquakes', 'volcanoes'].forEach(sourceId => {
        if (mapInstance.getSource(sourceId)) {
            try {
                mapInstance.removeSource(sourceId);
            } catch (e) {
                console.warn(`  ⚠️ Could not remove source ${sourceId}:`, e);
            }
        }
    });
};


export default function MapBoard({
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
    const disastersByIdRef = useRef<Map<string, Disaster>>(new Map());

    // Animation interval refs for proper cleanup
    const animationIdsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
    const layerHandlersRef = useRef<LayerHandler[]>([]);

    // Selection always resolves to the backend record so valid zero values survive
    const bindLayerInteractions = (layerId: string, icon: string) => {
        if (!map.current) return;

        const resolve = (e: mapboxgl.MapMouseEvent): Disaster | undefined => {
            const id = e.features?.[0]?.properties?.id;
            return typeof id === 'string' ? disastersByIdRef.current.get(id) : undefined;
        };

        const onClick = (e: mapboxgl.MapMouseEvent) => {
            e.preventDefault();
            e.originalEvent?.stopPropagation();
            const selected = resolve(e);
            if (!selected) {
                console.warn(`Clicked ${layerId} feature has no matching disaster record`);
                return;
            }
            onDisasterSelect(selected);
        };

        const onEnter = (e: mapboxgl.MapMouseEvent) => {
            if (!map.current) return;
            map.current.getCanvas().style.cursor = 'pointer';
            const selected = resolve(e);
            if (!selected) return;

            tooltipRef.current?.remove();
            const content = document.createElement('div');
            content.className = 'text-sm font-medium';
            if (selected.type === 'fire_detection') {
                const count = selected.detectionCell?.detectionCount ?? '';
                const frp = selected.detectionCell?.maxFrp !== null && selected.detectionCell?.maxFrp !== undefined
                    ? ` (Peak FRP: ${selected.detectionCell.maxFrp} MW)`
                    : '';
                content.innerHTML = `
                    <div style="font-weight: 700; color: #f97316;">${icon} Satellite Hotspots Cell</div>
                    <div style="font-size: 0.75rem;">${count} detections${frp}</div>
                    <div style="font-size: 0.65rem; color: #9ca3af; margin-top: 2px;">Sensor thermal signature — not confirmed perimeter</div>
                `;
            } else {
                const magText = selected.magnitude !== undefined ? ` M${selected.magnitude}` : '';
                const areaText = selected.areaAcres !== undefined ? ` (${Math.round(selected.areaAcres).toLocaleString()} ac)` : '';
                content.textContent = `${icon} ${selected.title}${magText}${areaText}`;
            }
            tooltipRef.current = new mapboxgl.Popup({
                closeButton: false,
                closeOnClick: false,
                className: 'disaster-tooltip'
            })
                .setLngLat(e.lngLat)
                .setDOMContent(content)
                .addTo(map.current);
        };

        const onLeave = () => {
            if (map.current) map.current.getCanvas().style.cursor = '';
            tooltipRef.current?.remove();
            tooltipRef.current = null;
        };

        const handlers: LayerHandler[] = [
            { type: 'click', layer: layerId, fn: onClick },
            { type: 'mouseenter', layer: layerId, fn: onEnter },
            { type: 'mouseleave', layer: layerId, fn: onLeave },
        ];
        handlers.forEach(({ type, layer, fn }) => map.current?.on(type, layer, fn));
        layerHandlersRef.current.push(...handlers);
    };

    // Add disaster data layers to map
    const addDisasterLayers = (disasters: Disaster[]) => {
        if (!map.current) return;

        // Safety check: Clean up any existing layers first
        removeDisasterLayers(map.current, animationIdsRef.current, layerHandlersRef.current);

        // ✅ Filter disasters based on active filters
        const visibleDisasters = disasters.filter(d => activeFilters.has(d.type));

        // Separate disasters by type
        const fires = visibleDisasters.filter((d) => d.type === 'fire');
        const fireDetections = visibleDisasters.filter((d) => d.type === 'fire_detection');
        const volcanoes = visibleDisasters.filter((d) => d.type === 'volcano');
        const earthquakes = visibleDisasters.filter((d) => d.type === 'earthquake');

        // Add fires layer
        if (fires.length > 0) {
            // DEBUG: Log layer creation
            debugLog(
                'map',
                `Adding fires layer with ${fires.length} markers`,
                'info'
            );

            map.current.addSource('fires', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: fires.map((disaster) => ({
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: [disaster.lng, disaster.lat],
                        },
                        properties: disaster,
                    })),
                },
            });

            map.current.addLayer({
                id: 'fires-layer',
                type: 'circle',
                source: 'fires',
                paint: {
                    'circle-radius': [
                        'case',
                        ['==', ['get', 'severity'], 'high'],
                        10, // Larger for high severity
                        8
                    ],
                    'circle-color': '#FF4444',
                    'circle-stroke-width': [
                        'case',
                        ['==', ['get', 'severity'], 'high'],
                        4, // Thicker stroke for high severity
                        3  // Better visibility on satellite
                    ],
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-opacity': 1.0,
                    'circle-opacity': 0.9,
                },
            });

            // Add pulsing effect for high-severity fires
            const animateFires = () => {
                if (!map.current || !map.current.getLayer('fires-layer')) return;

                const phase = (Date.now() % 2000) / 2000; // 2 second cycle
                const radius = 10 + Math.sin(phase * Math.PI * 2) * 3;

                try {
                    map.current.setPaintProperty('fires-layer', 'circle-radius', [
                        'case',
                        ['==', ['get', 'severity'], 'high'],
                        radius,
                        8
                    ]);
                } catch {
                    // Layer might be removed during animation
                }
            };

            // Start animation loop for high-severity markers
            const firesAnimationId = setInterval(animateFires, 50);
            // Store animation ID for cleanup
            animationIdsRef.current.fires = firesAnimationId;

            bindLayerInteractions('fires-layer', '🔥');
        }

        // Add satellite thermal detection cells layer (FIRMS VIIRS)
        if (fireDetections.length > 0) {
            debugLog(
                'map',
                `Adding fire-cells layer with ${fireDetections.length} cells`,
                'info'
            );

            map.current.addSource('fire-cells', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: fireDetections.map((cellItem) => ({
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: [cellItem.lng, cellItem.lat],
                        },
                        properties: cellItem,
                    })),
                },
            });

            map.current.addLayer({
                id: 'fire-cells-layer',
                type: 'circle',
                source: 'fire-cells',
                paint: {
                    'circle-color': [
                        'match',
                        ['get', 'severity'],
                        'high', '#ef4444',
                        'medium', '#f97316',
                        /* default/low */ '#f59e0b'
                    ],
                    'circle-radius': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        1, 3.5,
                        4, 5.5,
                        8, 9,
                        12, 14
                    ],
                    'circle-stroke-width': 1.5,
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-opacity': 0.85,
                    'circle-opacity': 0.82,
                },
            });

            bindLayerInteractions('fire-cells-layer', '🛰️');
        }

        // Add earthquakes layer
        if (earthquakes.length > 0) {
            map.current.addSource('earthquakes', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: earthquakes.map((disaster) => ({
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: [disaster.lng, disaster.lat],
                        },
                        properties: disaster,
                    })),
                },
            });

            map.current.addLayer({
                id: 'earthquakes-layer',
                type: 'circle',
                source: 'earthquakes',
                paint: {
                    'circle-radius': [
                        'case',
                        ['==', ['get', 'severity'], 'high'],
                        10, // Larger for high severity
                        8
                    ],
                    'circle-color': '#FF8C00',
                    'circle-stroke-width': [
                        'case',
                        ['==', ['get', 'severity'], 'high'],
                        4, // Thicker stroke for high severity
                        3  // Better visibility on satellite
                    ],
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-opacity': 1.0,
                    'circle-opacity': 0.9,
                },
            });

            // Add pulsing effect for high-severity earthquakes
            const animateEarthquakes = () => {
                if (!map.current || !map.current.getLayer('earthquakes-layer')) return;

                const phase = (Date.now() % 2000) / 2000; // 2 second cycle
                const radius = 10 + Math.sin(phase * Math.PI * 2) * 3;

                try {
                    map.current.setPaintProperty('earthquakes-layer', 'circle-radius', [
                        'case',
                        ['==', ['get', 'severity'], 'high'],
                        radius,
                        8
                    ]);
                } catch {
                    // Layer might be removed during animation
                }
            };

            const earthquakesAnimationId = setInterval(animateEarthquakes, 50);
            animationIdsRef.current.earthquakes = earthquakesAnimationId;

            bindLayerInteractions('earthquakes-layer', '🌍');
        }

        // Add volcanoes layer (similar to fires but different color)
        if (volcanoes.length > 0) {
            map.current.addSource('volcanoes', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: volcanoes.map((disaster) => ({
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: [disaster.lng, disaster.lat],
                        },
                        properties: disaster,
                    })),
                },
            });

            map.current.addLayer({
                id: 'volcanoes-layer',
                type: 'circle',
                source: 'volcanoes',
                paint: {
                    'circle-radius': [
                        'case',
                        ['==', ['get', 'severity'], 'high'],
                        10, // Larger for high severity
                        8
                    ],
                    'circle-color': '#FF6B35',
                    'circle-stroke-width': [
                        'case',
                        ['==', ['get', 'severity'], 'high'],
                        4, // Thicker stroke for high severity
                        3  // Better visibility on satellite
                    ],
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-opacity': 1.0,
                    'circle-opacity': 0.9,
                },
            });

            // Add pulsing effect for high-severity volcanoes
            const animateVolcanoes = () => {
                if (!map.current || !map.current.getLayer('volcanoes-layer')) return;

                const phase = (Date.now() % 2000) / 2000; // 2 second cycle
                const radius = 10 + Math.sin(phase * Math.PI * 2) * 3;

                try {
                    map.current.setPaintProperty('volcanoes-layer', 'circle-radius', [
                        'case',
                        ['==', ['get', 'severity'], 'high'],
                        radius,
                        8
                    ]);
                } catch {
                    // Layer might be removed during animation
                }
            };

            const volcanoesAnimationId = setInterval(animateVolcanoes, 50);
            animationIdsRef.current.volcanoes = volcanoesAnimationId;

            bindLayerInteractions('volcanoes-layer', '🌋');
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
            // Create map instance with Standard Satellite style
            map.current = new mapboxgl.Map({
                container: mapContainerRef.current,
                style: 'mapbox://styles/mapbox/standard-satellite',
                center: [0, 20], // ✅ Global center (Africa/Europe visible)
                zoom: 1.3, // ✅ Full globe view showing all continents
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                projection: { name: 'globe' } as any,
                pitch: 0, // Flat view for better overview
                bearing: 0, // North-up orientation
                attributionControl: false, // ✅ Remove default cluttered attribution
            });

            // ✅ Add compact attribution in bottom-left
            map.current.addControl(
                new mapboxgl.AttributionControl({
                    compact: true,
                    customAttribution: '© Mapbox © OpenStreetMap'
                }),
                'bottom-left'
            );

            // DEBUG: Expose map and selection handler for console debugging
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).mapDebug = map.current;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).selectDisasterDebug = onDisasterSelect;

            // Add navigation controls
            map.current.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

            // Add geolocate control
            map.current.addControl(
                new mapboxgl.GeolocateControl({
                    positionOptions: {
                        enableHighAccuracy: true,
                    },
                    trackUserLocation: true,
                }),
                'bottom-right'
            );

            // Handle map errors
            map.current.on('error', (e) => {
                console.error('Mapbox error:', e);
                setMapError(`Map error: ${e.error.message}`);
                setLoading(false);
            });

            // ✅ PERFORMANCE: Load disaster data immediately in parallel with map
            // Don't wait for map to finish loading - fetch data while map renders
            // eslint-disable-next-line react-hooks/set-state-in-effect
            loadDisasters();

            // Add disaster layers when map finishes loading
            map.current.on('load', () => {
                console.log('✅ Map finished loading');
                setIsMapLoaded(true);
            });
            map.current.on('style.load', () => {
                setIsMapLoaded(true);
            });
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

        removeDisasterLayers(map.current, animationIdsRef.current, layerHandlersRef.current);
        if (disasters.length > 0) addDisasterLayers(disasters);
    }, [isMapLoaded, activeFilters, disasters]);

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

            {/* Map Legend - shows disaster types and counts */}
            {!loading && !mapError && (
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

