import { useState, useEffect } from 'react';
import { Satellite, Download, ExternalLink, Flame, AlertCircle, MapPin } from 'lucide-react';

interface SatelliteImageryProps {
  lat: number;
  lng: number;
  disasterType: 'fire' | 'volcano' | 'earthquake';
  date?: string;
  title: string;
}

interface FireHotspot {
  latitude: number;
  longitude: number;
  bright_ti4: number; // Brightness temperature (Kelvin)
  confidence: string;  // 'l' (low), 'n' (nominal), 'h' (high)
  frp: number;         // Fire Radiative Power (MW)
  acq_date: string;
  acq_time: string;
}

export default function SatelliteImagery({ lat, lng, disasterType, date, title }: SatelliteImageryProps) {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [overlayUrl, setOverlayUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [worldviewUrl, setWorldviewUrl] = useState<string>('');
  const [selectedLayer, setSelectedLayer] = useState<'fire' | 'thermal' | 'visual'>('fire');
  const [fireHotspots, setFireHotspots] = useState<FireHotspot[]>([]);
  const [fireStats, setFireStats] = useState<{
    total: number;
    highConfidence: number;
    avgTemp: number;
    maxFRP: number;
  } | null>(null);

  const [fetchingFire, setFetchingFire] = useState(false);

  useEffect(() => {
    const dateStr = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

    // Set NASA Worldview URL with disaster-specific layers
    const layers = getWorldviewLayers(disasterType);
    const worldview = `https://worldview.earthdata.nasa.gov/?v=${lng - 1.5},${lat - 1.5},${lng + 1.5},${lat + 1.5}&t=${dateStr}&l=${layers}`;
    setWorldviewUrl(worldview);

    // Fetch fire data for wildfires
    if (disasterType === 'fire') {
      fetchFireHotspots(lat, lng);
    }

    // Update imagery based on selected layer
    updateImagery(lat, lng, dateStr);
  }, [lat, lng, disasterType, date, selectedLayer]);

  const getWorldviewLayers = (type: string): string => {
    switch (type) {
      case 'fire':
        return 'VIIRS_NOAA20_Thermal_Anomalies_375m_All,VIIRS_SNPP_Thermal_Anomalies_375m_All,MODIS_Combined_Thermal_Anomalies_All,MODIS_Terra_Aerosol,Coastlines_15m';
      case 'volcano':
        return 'ASTER_Volcanic_Sulfur_Dioxide_Index,MODIS_Terra_CorrectedReflectance_Bands721,MODIS_Aqua_CorrectedReflectance_Bands721,Coastlines_15m';
      case 'earthquake':
        return 'MODIS_Terra_CorrectedReflectance_Bands721,Landsat_WELD_CorrectedReflectance_Bands721_Global_Annual,Coastlines_15m';
      default:
        return 'Reference_Labels_15m,Coastlines_15m';
    }
  };

  const fetchFireHotspots = async (lat: number, lng: number) => {
    // Reset state before fetching
    setFireHotspots([]);
    setFireStats(null);
    setFetchingFire(true);

    try {
      // Use our backend proxy to hide the API key and avoid CORS issues
      const url = `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787'}/api/fire-hotspots?lat=${lat}&lng=${lng}`;

      console.log('🔥 Fetching FIRMS fire data:', url);

      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`FIRMS API error: ${response.status}`);
        return;
      }

      const data = await response.json();

      if (data.error) {
        console.warn(`Backend API error: ${data.error}`);
        return;
      }

      if (!data.hotspots || data.hotspots.length === 0) {
        console.log('No fire hotspots found in area');
        return;
      }

      const hotspots: FireHotspot[] = data.hotspots.filter((h: any) => h.confidence !== 'l' && h.confidence !== 'low');

      console.log(`✅ Found ${hotspots.length} fire hotspots`);
      setFireHotspots(hotspots);

      // Calculate statistics
      if (hotspots.length > 0) {
        const highConf = hotspots.filter(h => h.confidence === 'h' || h.confidence === 'high').length;
        const avgTemp = hotspots.reduce((sum, h) => sum + h.bright_ti4, 0) / hotspots.length;
        const maxFRP = Math.max(...hotspots.map(h => h.frp));

        setFireStats({
          total: hotspots.length,
          highConfidence: highConf,
          avgTemp,
          maxFRP
        });
      }
    } catch (error) {
      console.error('Error fetching FIRMS data:', error);
    } finally {
      setFetchingFire(false);
    }
  };

  const updateImagery = (lat: number, lng: number, dateStr: string) => {
    const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;

    if (disasterType === 'fire' && selectedLayer === 'fire') {
      // ✅ Base: High-res Mapbox satellite (better than MODIS 250m)
      const baseUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},14,0/800x600@2x?access_token=${mapboxToken}`;
      setImageUrl(baseUrl);

      // ✅ Fire overlay: Use MODERATE bbox (±0.1° = ~11km) to avoid pixelation
      // VIIRS is 375m resolution, so need at least 30 pixels across = 0.1° minimum
      const fireOverlay = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=VIIRS_NOAA20_Thermal_Anomalies_375m_All&TIME=${dateStr}&CRS=EPSG:4326&WIDTH=800&HEIGHT=600&BBOX=${lat - 0.1},${lng - 0.1},${lat + 0.1},${lng + 0.1}&FORMAT=image/png&TRANSPARENT=true`;
      setOverlayUrl(fireOverlay);

    } else if (selectedLayer === 'thermal') {
      // ✅ Thermal: Use MODIS with WIDER bbox to match its 250m-1km resolution
      // MODIS looks good at ±0.15° (~16km radius) - matches sensor resolution
      const thermalUrl = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Terra_CorrectedReflectance_Bands721&TIME=${dateStr}&CRS=EPSG:4326&WIDTH=800&HEIGHT=600&BBOX=${lat - 0.15},${lng - 0.15},${lat + 0.15},${lng + 0.15}&FORMAT=image/jpeg`;
      setImageUrl(thermalUrl);
      setOverlayUrl('');

    } else {
      // Visual (high-res satellite) - Zoom 15 for maximum street-level detail
      const visualUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},15,0/800x600@2x?access_token=${mapboxToken}`;
      setImageUrl(visualUrl);
      setOverlayUrl('');
    }

    setLoading(false);
  };

  const getSeverityLevel = (temp: number): { label: string; color: string } => {
    if (temp > 360) return { label: 'EXTREME', color: 'text-red-500' };
    if (temp > 340) return { label: 'HIGH', color: 'text-orange-500' };
    if (temp > 320) return { label: 'MODERATE', color: 'text-yellow-500' };
    return { label: 'LOW', color: 'text-gray-400' };
  };

  const getConfidenceColor = (conf: string): string => {
    if (conf === 'h') return 'bg-red-500';
    if (conf === 'n') return 'bg-orange-500';
    return 'bg-yellow-500';
  };

  return (
    <div className="glass-card rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Satellite className="text-blue-400" size={18} />
          <h3 className="font-bold text-white text-sm">
            {disasterType === 'fire' ? '🔥 Fire Intelligence' : '🛰️ Satellite Imagery'}
          </h3>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">NASA GIBS</span>
      </div>

      {/* Fire Statistics (Wildfires Only) */}
      {/* Fire Statistics (Wildfires Only) */}
      {disasterType === 'fire' && (
        <div className="min-h-[120px] transition-all duration-300">
          {fetchingFire ? (
            <div className="h-full flex flex-col items-center justify-center p-6 space-y-3 bg-gray-900/20 rounded-lg border border-gray-800/50">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-orange-500 border-t-transparent" />
              <p className="text-xs text-orange-400 font-medium animate-pulse">Scanning thermal sensors...</p>
            </div>
          ) : fireStats ? (
            <div className="bg-gradient-to-br from-red-900/30 to-orange-900/20 border border-red-800/40 rounded-lg p-3 space-y-3 animate-in fade-in duration-500">
              <div className="flex items-center gap-2">
                <Flame className="text-red-400" size={16} />
                <span className="text-red-300 font-semibold text-sm">Active Fire Hotspots (7 days)</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-black/30 rounded-lg p-2">
                  <div className="text-3xl font-bold text-white">{fireStats.total}</div>
                  <div className="text-xs text-gray-400">Total Hotspots</div>
                  <div className="mt-1 flex flex-col gap-0.5 text-[10px] font-medium">
                    <span className="text-red-400">{fireStats.highConfidence} High Confidence</span>
                    <span className="text-orange-300/80">{fireStats.total - fireStats.highConfidence} Nominal</span>
                  </div>
                </div>

                <div className="bg-black/30 rounded-lg p-2">
                  <div className={`text-3xl font-bold ${getSeverityLevel(fireStats.avgTemp).color}`}>
                    {getSeverityLevel(fireStats.avgTemp).label}
                  </div>
                  <div className="text-xs text-gray-400">Fire Intensity</div>
                  <div className="mt-1 text-xs text-gray-400">{fireStats.avgTemp.toFixed(0)}K / {(fireStats.avgTemp - 273.15).toFixed(0)}°C</div>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <AlertCircle className="text-orange-400" size={14} />
                <span className="text-gray-300">
                  Max Fire Power: <span className="text-orange-300 font-semibold">{fireStats.maxFRP.toFixed(1)} MW</span>
                </span>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-5 bg-gray-800/20 border border-gray-700/30 rounded-lg text-center">
              <Flame className="text-gray-600 mb-2" size={24} />
              <p className="text-sm text-gray-400 font-medium">No Active Hotspots</p>
              <p className="text-xs text-gray-500 mt-1 max-w-[200px]">
                Satellite thermal sensors have not detected significant heat anomalies in this area recently.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Layer Selector */}
      <div className="flex gap-2">
        {disasterType === 'fire' && (
          <button
            onClick={() => setSelectedLayer('fire')}
            className={`flex-1 px-3 py-2 text-xs rounded-lg font-medium transition-all ${selectedLayer === 'fire'
              ? 'bg-red-500/30 text-red-300 border-2 border-red-500/50 shadow-lg'
              : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
              }`}
          >
            <Flame size={14} className="inline mr-1" />
            Fire Hotspots
          </button>
        )}
        <button
          onClick={() => setSelectedLayer('thermal')}
          className={`flex-1 px-3 py-2 text-xs rounded-lg font-medium transition-all ${selectedLayer === 'thermal'
            ? 'bg-orange-500/30 text-orange-300 border-2 border-orange-500/50 shadow-lg'
            : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
            }`}
        >
          🌡️ Thermal
        </button>
        <button
          onClick={() => setSelectedLayer('visual')}
          className={`flex-1 px-3 py-2 text-xs rounded-lg font-medium transition-all ${selectedLayer === 'visual'
            ? 'bg-blue-500/30 text-blue-300 border-2 border-blue-500/50 shadow-lg'
            : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
            }`}
        >
          📸 Visual
        </button>
      </div>

      {/* Image Display */}
      <div className="relative rounded-lg overflow-hidden bg-gray-900/50 border border-white/10">
        {loading ? (
          <div className="w-full h-64 flex flex-col items-center justify-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
            <p className="text-xs text-gray-400">Loading satellite imagery...</p>
          </div>
        ) : (
          <div className="relative">
            {/* Base Image */}
            <img
              src={imageUrl}
              alt={`${disasterType} satellite view`}
              className="w-full h-64 object-cover"
              onError={(e) => {
                console.error('Image failed, using fallback');
                const fallback = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},8,0/800x600?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`;
                (e.target as HTMLImageElement).src = fallback;
              }}
            />

            {/* Fire Overlay (if applicable) */}
            {overlayUrl && (
              <img
                src={overlayUrl}
                alt="Fire overlay"
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                style={{ mixBlendMode: 'screen' }}
              />
            )}

            {/* Fire Hotspot Markers */}
            {disasterType === 'fire' && selectedLayer === 'fire' && fireHotspots.length > 0 && (
              <div className="absolute inset-0 pointer-events-none">
                {fireHotspots.slice(0, 20).map((hotspot, idx) => {
                  // ✅ FIXED: Match the image bbox size (±0.1° from fire overlay line 136)
                  const imgBboxSize = 0.2; // Total range: 0.2° (from lat-0.1 to lat+0.1)

                  // Calculate position relative to image center
                  const relLng = ((hotspot.longitude - lng) / imgBboxSize) * 100 + 50;
                  const relLat = ((lat - hotspot.latitude) / imgBboxSize) * 100 + 50;

                  // Debug logging (remove after testing)
                  if (idx === 0) {
                    console.log('🔥 Hotspot position calculation:', {
                      hotspot: { lat: hotspot.latitude, lng: hotspot.longitude },
                      center: { lat, lng },
                      relativePos: { relLng, relLat },
                      imgBboxSize
                    });
                  }

                  // Only show if within bounds (with small margin for edge cases)
                  if (relLng < -5 || relLng > 105 || relLat < -5 || relLat > 105) {
                    if (idx === 0) console.log('⚠️ Hotspot outside visible bounds, skipping');
                    return null;
                  }

                  return (
                    <div
                      key={idx}
                      className={`absolute w-3 h-3 rounded-full ${getConfidenceColor(hotspot.confidence)} animate-pulse shadow-lg`}
                      style={{
                        left: `${relLng}%`,
                        top: `${relLat}%`,
                        transform: 'translate(-50%, -50%)',
                        boxShadow: '0 0 15px rgba(239, 68, 68, 0.9)',
                        zIndex: 10
                      }}
                      title={`${hotspot.bright_ti4}K, ${hotspot.frp}MW, Conf: ${hotspot.confidence}`}
                    />
                  );
                })}
              </div>
            )}

            {/* Layer Label */}
            <div className="absolute top-2 left-2 bg-black/80 px-3 py-1.5 rounded-full text-xs text-white font-medium backdrop-blur-sm">
              {selectedLayer === 'fire' ? '🔥 Fire Detections (Real-Time)' :
                selectedLayer === 'thermal' ? '🌡️ Thermal Infrared (Bands 7-2-1)' :
                  '📸 True Color Satellite'}
            </div>

            {/* Coordinates */}
            <div className="absolute bottom-2 left-2 bg-black/80 px-2 py-1 rounded text-xs text-white font-mono backdrop-blur-sm">
              <MapPin size={10} className="inline mr-1" />
              {lat.toFixed(4)}°, {lng.toFixed(4)}°
            </div>

            {/* Data Timestamp */}
            <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-1 rounded text-xs text-gray-300 backdrop-blur-sm">
              {date ? new Date(date).toLocaleDateString() : 'Latest'}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <a
          href={worldviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-gradient-to-r from-blue-600/20 to-blue-500/20 hover:from-blue-600/30 hover:to-blue-500/30 text-blue-300 rounded-lg text-xs font-semibold transition-all border border-blue-500/30"
        >
          <ExternalLink size={14} />
          NASA Worldview
        </a>
        <a
          href={imageUrl}
          download={`${disasterType}_${title.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.jpg`}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 rounded-lg text-xs font-semibold transition-all border border-gray-600/50"
        >
          <Download size={14} />
        </a>
      </div>

      {/* Info Text */}
      <div className="text-xs text-gray-400 leading-relaxed bg-gray-900/30 p-2 rounded border border-gray-800">
        {disasterType === 'fire' && selectedLayer === 'fire' && (
          <p>
            🔴 <strong>Real-time fire detection</strong> from NASA VIIRS satellites. Red dots show active burning areas detected within last 7 days. Updates every 3-4 hours. Brightness indicates fire intensity.
          </p>
        )}
        {disasterType === 'fire' && selectedLayer === 'thermal' && (
          <p>
            🌡️ <strong>Thermal infrared imagery</strong> using MODIS Bands 7-2-1. Red/orange areas show heat signatures. Useful for detecting fires through smoke.
          </p>
        )}
        {selectedLayer === 'visual' && (
          <p>
            📸 <strong>High-resolution satellite imagery</strong>. True color composite for visual damage assessment and terrain analysis.
          </p>
        )}
        {disasterType === 'volcano' && (
          <p>
            🌋 <strong>Volcanic activity monitoring</strong> using thermal and SO₂ sensors. Click NASA Worldview for sulfur dioxide dispersion maps.
          </p>
        )}
        {disasterType === 'earthquake' && (
          <p>
            🌍 <strong>Terrain and infrastructure imagery</strong>. Use thermal layers to detect landslides and building damage patterns.
          </p>
        )}
      </div>
    </div>
  );
}
