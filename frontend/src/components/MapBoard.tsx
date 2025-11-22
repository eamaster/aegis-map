/**
 * MapBoard Component - SAFE MODE Mapbox Implementation
 * Uses useRef to prevent unnecessary map re-renders
 */

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { Disaster } from '../types';

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
                projection: { name: 'mercator' } as any, // Flat map
            });

            console.log('Map instance created');

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
            const response = await fetch(`${API_BASE}/api/disasters`);
            const data: Disaster[] = await response.json();
            setDisasters(data);
            setLoading(false);

            // Add disaster markers to map
            if (map.current) {
                addDisasterLayers(data);
            }
        } catch (error) {
            console.error('Error loading disasters:', error);
            setLoading(false);
        }
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
                    'circle-radius': 8,
                    'circle-color': '#FF4444',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.8,
                },
            });

            // Add click handler
            map.current.on('click', 'fires-layer', (e) => {
                if (e.features && e.features[0]) {
                    const disaster = e.features[0].properties as any;
                    onDisasterSelect({
                        ...disaster,
                        lat: parseFloat(disaster.lat),
                        lng: parseFloat(disaster.lng),
                    });
                }
            });

            // Change cursor on hover
            map.current.on('mouseenter', 'fires-layer', () => {
                if (map.current) map.current.getCanvas().style.cursor = 'pointer';
            });

            map.current.on('mouseleave', 'fires-layer', () => {
                if (map.current) map.current.getCanvas().style.cursor = '';
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
                    'circle-radius': 8,
                    'circle-color': '#FF8C00',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.8,
                },
            });

            // Add click handler
            map.current.on('click', 'earthquakes-layer', (e) => {
                if (e.features && e.features[0]) {
                    const disaster = e.features[0].properties as any;
                    onDisasterSelect({
                        ...disaster,
                        lat: parseFloat(disaster.lat),
                        lng: parseFloat(disaster.lng),
                        magnitude: parseFloat(disaster.magnitude),
                    });
                }
            });

            // Change cursor on hover
            map.current.on('mouseenter', 'earthquakes-layer', () => {
                if (map.current) map.current.getCanvas().style.cursor = 'pointer';
            });

            map.current.on('mouseleave', 'earthquakes-layer', () => {
                if (map.current) map.current.getCanvas().style.cursor = '';
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
                    'circle-radius': 8,
                    'circle-color': '#FF6B35',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.8,
                },
            });

            // Add click handler
            map.current.on('click', 'volcanoes-layer', (e) => {
                if (e.features && e.features[0]) {
                    const disaster = e.features[0].properties as any;
                    onDisasterSelect({
                        ...disaster,
                        lat: parseFloat(disaster.lat),
                        lng: parseFloat(disaster.lng),
                    });
                }
            });

            // Change cursor on hover
            map.current.on('mouseenter', 'volcanoes-layer', () => {
                if (map.current) map.current.getCanvas().style.cursor = 'pointer';
            });

            map.current.on('mouseleave', 'volcanoes-layer', () => {
                if (map.current) map.current.getCanvas().style.cursor = '';
            });
        }
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



            {/* Statistics */}
            {!loading && !mapError && (
                <div className="absolute bottom-4 left-4 bg-gray-900 bg-opacity-90 px-4 py-3 rounded-lg shadow-lg z-10">
                    <p className="text-white text-sm">
                        <span className="font-bold">{disasters.length}</span> active disasters
                    </p>
                </div>
            )}
        </div>
    );
}
