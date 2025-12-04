/**
 * MapBoard Component - SAFE MODE Mapbox Implementation
 * Uses useRef to prevent unnecessary map re-renders
 */

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import toast from 'react-hot-toast';
import type { Disaster } from '../types';
import MapLegend from './MapLegend';

// Set Mapbox access token
const accessToken = import.meta.env.VITE_MAPBOX_TOKEN;
console.log('Mapbox Token:', accessToken ? 'Token loaded' : 'ERROR: Token not found!');
mapboxgl.accessToken = accessToken;

interface MapBoardProps {
    onDisasterSelect: (disaster: Disaster | null) => void;
}

export default function MapBoard({ onDisasterSelect }: MapBoardProps) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const [disasters, setDisasters] = useState<Disaster[]>([]);
    const [loading, setLoading] = useState(true);
    const [mapError, setMapError] = useState<string>('');
    const [lastUpdated, setLastUpdated] = useState<Date | undefined>(undefined);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Store tooltips to clean them up
    const tooltipRef = useRef<mapboxgl.Popup | null>(null);

    // Track if this is the first load (component scope, not module scope)
    const isInitialLoadRef = useRef(true);

    // Initialize map only once
    useEffect(() => {
        if (map.current) return; // Prevent re-initialization

        if (!mapContainer.current) {
            console.error('Map container ref is null');
            return;
        }

        if (!accessToken) {
            const error = 'Mapbox access token is missing! Check .env file.';
            console.error(error);
            setMapError(error);
            setLoading(false);
            return;
        }

        console.log('Initializing Mapbox map...');

        try {
            // Create map instance
            map.current = new mapboxgl.Map({
                container: mapContainer.current,
                style: 'mapbox://styles/mapbox/dark-v11',
                center: [-100, 40], // US West Coast focus
                zoom: 3.5,
                projection: { name: 'globe' } as any, // 3D globe
            });

            // DEBUG: Expose map for console debugging
            (window as any).mapDebug = map.current;
            console.log('Map instance created. Access via window.mapDebug');

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

            // Load disaster data when map is ready
            map.current.on('load', () => {
                console.log('Map loaded successfully!');
                loadDisasters();
            });
        } catch (error) {
            console.error('Error creating map:', error);
            setMapError(`Failed to create map: ${error}`);
            setLoading(false);
        }
    }, []); // Empty dependency array = run once

    // Load disasters from backend
    const loadDisasters = async () => {
        try {
            const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

            // DEBUG: Log API call
            (window as any).aegisDebug?.log('backend', `Fetching disasters from ${API_BASE}/api/disasters`, 'info');

            const response = await fetch(`${API_BASE}/api/disasters`);
            const data: Disaster[] = await response.json();

            // DEBUG: Validate disaster data
            if (!Array.isArray(data)) {
                (window as any).aegisDebug?.log('disasters', 'ERROR: Response is not an array', 'error', { data });
                setLoading(false);
                isInitialLoadRef.current = false; // Mark as no longer initial load even on error
                return;
            }


            const fireCount = data.filter(d => d.type === 'fire').length;
            const volcanoCount = data.filter(d => d.type === 'volcano').length;
            const earthquakeCount = data.filter(d => d.type === 'earthquake').length;

            // DEBUG: Log disaster stats
            (window as any).aegisDebug?.log(
                'disasters',
                `Loaded ${data.length} disasters: ${fireCount} fires, ${volcanoCount} volcanoes, ${earthquakeCount} earthquakes`,
                'success',
                { count: data.length, types: { fires: fireCount, volcanoes: volcanoCount, earthquakes: earthquakeCount } }
            );

            // DEBUG: Confirm backend is online
            (window as any).aegisDebug?.log('backend', 'Backend connection successful', 'success');

            // Validate coordinates
            const invalid = data.filter(d =>
                Math.abs(d.lat) > 90 || Math.abs(d.lng) > 180
            );
            if (invalid.length > 0) {
                (window as any).aegisDebug?.log(
                    'disasters',
                    `WARNING: Found ${invalid.length} disasters with invalid coordinates`,
                    'warning',
                    invalid
                );
            }

            setDisasters(data);
            setLoading(false);
            setLastUpdated(new Date());
            setIsRefreshing(false);

            if (map.current) {
                addDisasterLayers(data);
            }

            // Show success toast only on manual refresh, not initial load
            if (!isInitialLoadRef.current) {
                toast.success(
                    `✓ Refreshed: ${data.length} disasters\n${fireCount} 🔥 ${earthquakeCount} 🌍 ${volcanoCount} 🌋`,
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
            (window as any).aegisDebug?.log(
                'disasters',
                `FAILED to load disasters: ${error}`,
                'error',
                { error: String(error) }
            );
            setLoading(false);
            setIsRefreshing(false);
            isInitialLoadRef.current = false; // Mark as no longer initial load even on error

            // Show error toast
            toast.error(`Failed to load disaster data: ${error}`, {
                duration: 5000,
            });
        }
    };

    // Manual refresh handler
    const handleRefresh = async () => {
        setIsRefreshing(true);

        // Remove existing layers and sources before refreshing
        if (map.current) {
            ['fires-layer', 'earthquakes-layer', 'volcanoes-layer'].forEach(layerId => {
                if (map.current?.getLayer(layerId)) {
                    map.current.removeLayer(layerId);
                }
            });
            ['fires', 'earthquakes', 'volcanoes'].forEach(sourceId => {
                if (map.current?.getSource(sourceId)) {
                    map.current.removeSource(sourceId);
                }
            });
        }

        await loadDisasters();
    };

    // Add disaster data layers to map
    const addDisasterLayers = (disasters: Disaster[]) => {
        if (!map.current) return;

        // Separate disasters by type
        const fires = disasters.filter((d) => d.type === 'fire');
        const volcanoes = disasters.filter((d) => d.type === 'volcano');
        const earthquakes = disasters.filter((d) => d.type === 'earthquake');

        // Add fires layer
        if (fires.length > 0) {
            // DEBUG: Log layer creation
            (window as any).aegisDebug?.log(
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
                        3, // Thicker stroke for high severity
                        2
                    ],
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.8,
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
                } catch (e) {
                    // Layer might be removed during animation
                }
            };

            // Start animation loop for high-severity markers
            const firesAnimationId = setInterval(animateFires, 50);
            // Store animation ID for cleanup
            (map.current as any).firesAnimationId = firesAnimationId;

            // Add click handler
            map.current.on('click', 'fires-layer', (e) => {
                e.preventDefault();
                e.originalEvent?.stopPropagation();
                if (e.features && e.features[0]) {
                    const props = e.features[0].properties as any;
                    console.log('🔥 Fire marker clicked!', props);
                    // Handle both uppercase and lowercase coordinate properties
                    const lat = props.lat || props.Lat || props.latitude || props.Latitude || e.lngLat.lat;
                    const lng = props.lng || props.Lng || props.longitude || props.Longitude || e.lngLat.lng;
                    const disaster = {
                        id: props.id || `fire_${Date.now()}`,
                        type: props.type || 'fire',
                        title: props.title || props.name || 'Fire Event',
                        lat: parseFloat(String(lat)),
                        lng: parseFloat(String(lng)),
                        date: props.date || props.start || new Date().toISOString(),
                        severity: props.severity || 'medium',
                    };
                    console.log('Selected disaster:', disaster);
                    onDisasterSelect(disaster);
                }
            });

            // Change cursor on hover
            map.current.on('mouseenter', 'fires-layer', (e) => {
                if (map.current) map.current.getCanvas().style.cursor = 'pointer';

                // Show tooltip
                if (e.features && e.features[0]) {
                    const props = e.features[0].properties as any;
                    const title = props.title || props.name || 'Fire Event';

                    // Remove existing tooltip
                    if (tooltipRef.current) {
                        tooltipRef.current.remove();
                    }

                    // Create new tooltip
                    if (map.current) {
                        tooltipRef.current = new mapboxgl.Popup({
                            closeButton: false,
                            closeOnClick: false,
                            className: 'disaster-tooltip'
                        })
                            .setLngLat(e.lngLat)
                            .setHTML(`<div class="text-sm font-medium">🔥 ${title}</div>`)
                            .addTo(map.current);
                    }
                }
            });

            map.current.on('mouseleave', 'fires-layer', () => {
                if (map.current) map.current.getCanvas().style.cursor = '';

                // Remove tooltip
                if (tooltipRef.current) {
                    tooltipRef.current.remove();
                    tooltipRef.current = null;
                }
            });
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
                        3, // Thicker stroke for high severity
                        2
                    ],
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.8,
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
                } catch (e) {
                    // Layer might be removed during animation
                }
            };

            const earthquakesAnimationId = setInterval(animateEarthquakes, 50);
            (map.current as any).earthquakesAnimationId = earthquakesAnimationId;

            // Add click handler
            map.current.on('click', 'earthquakes-layer', (e) => {
                e.preventDefault();
                e.originalEvent?.stopPropagation();
                if (e.features && e.features[0]) {
                    const props = e.features[0].properties as any;
                    console.log('🌍 Earthquake marker clicked!', props);
                    // Handle both uppercase and lowercase coordinate properties
                    const latValue = props.lat || props.Lat || props.latitude || props.Latitude || e.lngLat.lat;
                    const lngValue = props.lng || props.Lng || props.longitude || props.Longitude || e.lngLat.lng;
                    const latNum = parseFloat(String(latValue));
                    const lngNum = parseFloat(String(lngValue));

                    // Validate coordinates
                    if (isNaN(latNum) || isNaN(lngNum)) {
                        console.error('❌ Invalid coordinates:', { latValue, lngValue, latNum, lngNum });
                        return;
                    }

                    // Ensure lowercase lat/lng for consistency
                    const disaster = {
                        id: props.id || `earthquake_${Date.now()}`,
                        type: props.type || 'earthquake',
                        title: props.title || props.name || 'Earthquake Event',
                        lat: latNum, // lowercase
                        lng: lngNum, // lowercase
                        date: props.date || props.start || new Date().toISOString(),
                        severity: props.severity || 'medium',
                        magnitude: props.magnitude ? parseFloat(props.magnitude) : undefined,
                    };
                    console.log('✅ Selected disaster (validated):', disaster);
                    onDisasterSelect(disaster);
                }
            });

            // Change cursor on hover
            map.current.on('mouseenter', 'earthquakes-layer', (e) => {
                if (map.current) map.current.getCanvas().style.cursor = 'pointer';

                // Show tooltip
                if (e.features && e.features[0]) {
                    const props = e.features[0].properties as any;
                    const title = props.title || props.name || 'Earthquake Event';
                    const magnitude = props.magnitude ? ` M${props.magnitude}` : '';

                    // Remove existing tooltip
                    if (tooltipRef.current) {
                        tooltipRef.current.remove();
                    }

                    // Create new tooltip
                    if (map.current) {
                        tooltipRef.current = new mapboxgl.Popup({
                            closeButton: false,
                            closeOnClick: false,
                            className: 'disaster-tooltip'
                        })
                            .setLngLat(e.lngLat)
                            .setHTML(`<div class="text-sm font-medium">🌍 ${title}${magnitude}</div>`)
                            .addTo(map.current);
                    }
                }
            });

            map.current.on('mouseleave', 'earthquakes-layer', () => {
                if (map.current) map.current.getCanvas().style.cursor = '';

                // Remove tooltip
                if (tooltipRef.current) {
                    tooltipRef.current.remove();
                    tooltipRef.current = null;
                }
            });
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
                        3, // Thicker stroke for high severity
                        2
                    ],
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.8,
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
                } catch (e) {
                    // Layer might be removed during animation
                }
            };

            const volcanoesAnimationId = setInterval(animateVolcanoes, 50);
            (map.current as any).volcanoesAnimationId = volcanoesAnimationId;

            // Add click handler
            map.current.on('click', 'volcanoes-layer', (e) => {
                e.preventDefault();
                e.originalEvent?.stopPropagation();
                if (e.features && e.features[0]) {
                    const props = e.features[0].properties as any;
                    console.log('🌋 Volcano marker clicked!', props);
                    // Handle both uppercase and lowercase coordinate properties
                    const lat = props.lat || props.Lat || props.latitude || props.Latitude || e.lngLat.lat;
                    const lng = props.lng || props.Lng || props.longitude || props.Longitude || e.lngLat.lng;
                    const disaster = {
                        id: props.id || `volcano_${Date.now()}`,
                        type: props.type || 'volcano',
                        title: props.title || props.name || 'Volcano Event',
                        lat: parseFloat(String(lat)),
                        lng: parseFloat(String(lng)),
                        date: props.date || props.start || new Date().toISOString(),
                        severity: props.severity || 'medium',
                    };
                    console.log('Selected disaster:', disaster);
                    onDisasterSelect(disaster);
                }
            });

            // Change cursor on hover
            map.current.on('mouseenter', 'volcanoes-layer', (e) => {
                if (map.current) map.current.getCanvas().style.cursor = 'pointer';

                // Show tooltip
                if (e.features && e.features[0]) {
                    const props = e.features[0].properties as any;
                    const title = props.title || props.name || 'Volcano Event';

                    // Remove existing tooltip
                    if (tooltipRef.current) {
                        tooltipRef.current.remove();
                    }

                    // Create new tooltip
                    if (map.current) {
                        tooltipRef.current = new mapboxgl.Popup({
                            closeButton: false,
                            closeOnClick: false,
                            className: 'disaster-tooltip'
                        })
                            .setLngLat(e.lngLat)
                            .setHTML(`<div class="text-sm font-medium">🌋 ${title}</div>`)
                            .addTo(map.current);
                    }
                }
            });

            map.current.on('mouseleave', 'volcanoes-layer', () => {
                if (map.current) map.current.getCanvas().style.cursor = '';

                // Remove tooltip
                if (tooltipRef.current) {
                    tooltipRef.current.remove();
                    tooltipRef.current = null;
                }
            });
        }
    };

    // Calculate disaster counts
    const disasterCounts = {
        fires: disasters.filter(d => d.type === 'fire').length,
        volcanoes: disasters.filter(d => d.type === 'volcano').length,
        earthquakes: disasters.filter(d => d.type === 'earthquake').length,
        total: disasters.length,
    };

    return (
        <div className="relative w-full h-full">
            <div ref={mapContainer} className="absolute inset-0" />

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

            {/* Loading overlay */}
            {loading && !mapError && (
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
                    <div className="bg-gray-900 px-6 py-4 rounded-lg shadow-2xl">
                        <p className="text-white text-lg">Loading disaster data...</p>
                    </div>
                </div>
            )}

            {/* Map Legend - shows disaster types and counts */}
            {!loading && !mapError && (
                <MapLegend
                    counts={disasterCounts}
                    lastUpdated={lastUpdated}
                    onRefresh={handleRefresh}
                    isRefreshing={isRefreshing}
                />
            )}

            {/* Removed DisasterSummary - too cluttered */}
        </div>
    );
}
