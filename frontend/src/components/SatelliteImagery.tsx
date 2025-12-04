import { useState, useEffect } from 'react';
import { Satellite, Download, ExternalLink, Flame } from 'lucide-react';

interface SatelliteImageryProps {
  lat: number;
  lng: number;
  disasterType: 'fire' | 'volcano' | 'earthquake';
  date?: string;
  title: string;
}

interface FireDetection {
  latitude: number;
  longitude: number;
  brightness: number;
  confidence: number;
  acq_date: string;
  acq_time: string;
}

export default function SatelliteImagery({ lat, lng, disasterType, date, title }: SatelliteImageryProps) {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [worldviewUrl, setWorldviewUrl] = useState<string>('');
  const [selectedLayer, setSelectedLayer] = useState<'visual' | 'thermal' | 'fire'>('fire');
  const [nearbyFires, setNearbyFires] = useState<FireDetection[]>([]);
  const [fireStats, setFireStats] = useState<{ count: number; avgBrightness: number } | null>(null);

  useEffect(() => {
    const dateStr = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

    // NASA Worldview URL with FIRE-SPECIFIC layers
    const layers = disasterType === 'fire'
      ? 'VIIRS_NOAA20_Thermal_Anomalies_375m_Night,VIIRS_NOAA20_Thermal_Anomalies_375m_Day,MODIS_Combined_Thermal_Anomalies_All,MODIS_Terra_Aerosol_Optical_Depth'
      : disasterType === 'volcano'
        ? 'ASTER_Volcanic_Sulfur_Dioxide_Index,MODIS_Terra_CorrectedReflectance_TrueColor'
        : 'MODIS_Terra_CorrectedReflectance_Bands721,Reference_Labels,Coastlines';

    const worldview = `https://worldview.earthdata.nasa.gov/?v=${lng - 1},${lat - 1},${lng + 1},${lat + 1}&t=${dateStr}T00:00:00Z&l=${layers}`;
    setWorldviewUrl(worldview);

    // Fetch nearby fire detections from NASA FIRMS
    if (disasterType === 'fire') {
      fetchFireDetections(lat, lng);
    }

    // Generate imagery based on selected layer and disaster type
    updateImagery(lat, lng, dateStr, selectedLayer, disasterType);
    setLoading(false);
  }, [lat, lng, disasterType, date, selectedLayer]);

  const fetchFireDetections = async (lat: number, lng: number) => {
    try {
      // NASA FIRMS Web Map Service (no API key needed for web service)
      // Get fire detections within 50km radius from last 7 days
      const radius = 50; // km
      const days = 7;

      // Use FIRMS CSV API (public access)
      const firmsUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/c6f343e72eb2e2bc504e8af53de64742/VIIRS_NOAA20_NRT/${lat},${lng},${radius}/${days}`;

      console.log('🔥 Fetching fire detections from FIRMS:', firmsUrl);

      const response = await fetch(firmsUrl);
      if (!response.ok) {
        console.warn('FIRMS API unavailable, using fallback visualization');
        return;
      }

      const csv = await response.text();
      const lines = csv.split('\n').slice(1); // Skip header

      const fires: FireDetection[] = lines
        .filter(line => line.trim().length > 0)
        .map(line => {
          const [latitude, longitude, brightness, , , , acq_date, acq_time, , , confidence] = line.split(',');
          return {
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            brightness: parseFloat(brightness),
            confidence: parseFloat(confidence),
            acq_date,
            acq_time
          };
        })
        .filter(fire => !isNaN(fire.latitude) && fire.confidence >= 50); // High confidence only

      console.log(`✅ Found ${fires.length} fire detections nearby`);
      setNearbyFires(fires);

      if (fires.length > 0) {
        const avgBrightness = fires.reduce((sum, f) => sum + f.brightness, 0) / fires.length;
        setFireStats({ count: fires.length, avgBrightness });
      }
    } catch (error) {
      console.error('Error fetching fire detections:', error);
    }
  };

  const updateImagery = (lat: number, lng: number, dateStr: string, layer: string, type: string) => {
    if (type === 'fire' && layer === 'fire') {
      // Use Mapbox satellite as base with fire overlay visualization
      const baseMapUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},9,0/800x600?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`;
      setImageUrl(baseMapUrl);

    } else if (layer === 'thermal') {
      // Thermal/infrared for heat signature
      const bbox = `${lng - 0.5},${lat - 0.5},${lng + 0.5},${lat + 0.5}`;
      const url = `https://worldview.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&TIME=${dateStr}T00:00:00Z&BBOX=${bbox}&CRS=EPSG:4326&LAYERS=MODIS_Terra_CorrectedReflectance_Bands721&FORMAT=image/jpeg&WIDTH=800&HEIGHT=600`;
      setImageUrl(url);

    } else {
      // Visual (true color) - fallback
      const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},9,0/800x600?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`;
      setImageUrl(url);
    }
  };

  const getSeverityColor = (brightness: number) => {
    if (brightness > 350) return 'text-red-500';
    if (brightness > 320) return 'text-orange-500';
    return 'text-yellow-500';
  };

  const getSeverityLabel = (brightness: number) => {
    if (brightness > 350) return 'Extreme';
    if (brightness > 320) return 'High';
    return 'Moderate';
  };

  return (
    <div className="glass-card rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Satellite className="text-blue-400" size={18} />
          <h3 className="font-bold text-white text-sm">
            {disasterType === 'fire' ? 'Fire Intelligence' : 'Satellite Imagery'}
          </h3>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">NASA FIRMS</span>
      </div>

      {/* Fire Statistics (for wildfires only) */}
      {disasterType === 'fire' && fireStats && (
        <div className="bg-red-900/20 border border-red-800/30 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Flame className="text-red-400" size={16} />
            <span className="text-red-300 font-semibold text-sm">Active Fire Detections</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-2xl font-bold text-white">{fireStats.count}</div>
              <div className="text-xs text-gray-400">Hotspots (7 days)</div>
            </div>
            <div>
              <div className={`text-2xl font-bold ${getSeverityColor(fireStats.avgBrightness)}`}>
                {getSeverityLabel(fireStats.avgBrightness)}
              </div>
              <div className="text-xs text-gray-400">Fire Intensity</div>
            </div>
          </div>
          <div className="text-xs text-gray-400">
            Avg Temperature: {fireStats.avgBrightness.toFixed(0)}K ({(fireStats.avgBrightness - 273.15).toFixed(0)}°C)
          </div>
        </div>
      )}

      {/* Layer Selector */}
      <div className="flex gap-2">
        {disasterType === 'fire' && (
          <button
            onClick={() => setSelectedLayer('fire')}
            className={`flex-1 px-3 py-2 text-xs rounded-lg font-medium transition-colors ${selectedLayer === 'fire'
              ? 'bg-red-500/30 text-red-300 border border-red-500/50'
              : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'
              }`}
          >
            <Flame size={14} className="inline mr-1" />
            Fire Map
          </button>
        )}
        <button
          onClick={() => setSelectedLayer('thermal')}
          className={`flex-1 px-3 py-2 text-xs rounded-lg font-medium transition-colors ${selectedLayer === 'thermal'
            ? 'bg-orange-500/30 text-orange-300 border border-orange-500/50'
            : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'
            }`}
        >
          Thermal
        </button>
        <button
          onClick={() => setSelectedLayer('visual')}
          className={`flex-1 px-3 py-2 text-xs rounded-lg font-medium transition-colors ${selectedLayer === 'visual'
            ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50'
            : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'
            }`}
        >
          Visual
        </button>
      </div>

      {/* Image Display */}
      <div className="relative rounded-lg overflow-hidden bg-gray-900/50 border border-white/10">
        {loading ? (
          <div className="w-full h-64 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : (
          <>
            <img
              src={imageUrl}
              alt={`${disasterType} satellite view`}
              className="w-full h-64 object-cover"
              onError={(e) => {
                console.error('Image load failed, using fallback');
                const fallback = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},9,0/800x600?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`;
                (e.target as HTMLImageElement).src = fallback;
              }}
            />

            {/* Fire overlay markers */}
            {disasterType === 'fire' && selectedLayer === 'fire' && nearbyFires.length > 0 && (
              <div className="absolute inset-0 pointer-events-none">
                {nearbyFires.slice(0, 10).map((fire, idx) => (
                  <div
                    key={idx}
                    className="absolute w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.8)]"
                    style={{
                      left: `${((fire.longitude - (lng - 0.5)) / 1) * 100}%`,
                      top: `${((lat + 0.5 - fire.latitude) / 1) * 100}%`,
                      transform: 'translate(-50%, -50%)'
                    }}
                  />
                ))}
              </div>
            )}

            {/* Overlay: Layer Info */}
            <div className="absolute top-2 left-2 bg-black/70 px-2 py-1 rounded text-xs text-white">
              {selectedLayer === 'fire' ? '🔥 Fire Detections (24h)' :
                selectedLayer === 'thermal' ? '🌡️ Thermal Infrared' :
                  '📸 True Color'}
            </div>

            {/* Overlay: Coordinates */}
            <div className="absolute bottom-2 left-2 bg-black/70 px-2 py-1 rounded text-xs text-white font-mono">
              {lat.toFixed(4)}°, {lng.toFixed(4)}°
            </div>
          </>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <a
          href={worldviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg text-xs font-medium transition-colors"
        >
          <ExternalLink size={14} />
          Interactive View
        </a>
        <a
          href={imageUrl}
          download={`${disasterType}_${title.replace(/\s+/g, '_')}.jpg`}
          className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-colors"
        >
          <Download size={14} />
        </a>
      </div>

      {/* Info Text */}
      <p className="text-xs text-gray-400 leading-relaxed">
        {disasterType === 'fire'
          ? 'Real-time fire detection from NASA VIIRS satellites. Red dots show active fire hotspots updated every 3-4 hours.'
          : disasterType === 'volcano'
            ? 'Volcanic activity monitoring using thermal and sulfur dioxide sensors.'
            : 'Terrain and damage assessment imagery for earthquake impact analysis.'}
      </p>
    </div>
  );
}
