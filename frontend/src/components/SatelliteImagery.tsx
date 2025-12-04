import { useState, useEffect } from 'react';
import { Satellite, Download, ExternalLink } from 'lucide-react';

interface SatelliteImageryProps {
  lat: number;
  lng: number;
  disasterType: 'fire' | 'volcano' | 'earthquake';
  date?: string;
}

export default function SatelliteImagery({ lat, lng, disasterType, date }: SatelliteImageryProps) {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [worldviewUrl, setWorldviewUrl] = useState<string>('');

  useEffect(() => {
    // Generate NASA Worldview URL for interactive viewing
    const dateStr = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const worldview = `https://worldview.earthdata.nasa.gov/?v=${lng - 2},${lat - 2},${lng + 2},${lat + 2}&t=${dateStr}T00:00:00Z&l=Reference_Labels_15m,Reference_Features_15m,Coastlines_15m,VIIRS_NOAA20_Thermal_Anomalies_375m_Night,VIIRS_NOAA20_Thermal_Anomalies_375m_Day,MODIS_Combined_Thermal_Anomalies_All`;
    setWorldviewUrl(worldview);

    // Generate static map image using NASA GIBS WMTS endpoint
    // Format: https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{layer}/default/{date}/250m/{z}/{y}/{x}.png
    const zoom = 7; // Zoom level (higher = more detail)

    // Calculate tile coordinates from lat/lng
    const tilex = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
    const tiley = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));

    // Use MODIS True Color for visual imagery
    const gibsUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${dateStr}/250m/${zoom}/${tiley}/${tilex}.jpg`;

    setImageUrl(gibsUrl);
    setLoading(false);
  }, [lat, lng, disasterType, date]);

  return (
    <div className="glass-card rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Satellite className="text-blue-400" size={18} />
          <h3 className="font-bold text-white text-sm">Satellite Imagery</h3>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">NASA GIBS</span>
      </div>

      {/* Image Display */}
      <div className="relative rounded-lg overflow-hidden bg-gray-900/50 border border-white/10">
        {loading ? (
          <div className="w-full h-48 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : (
          <img
            src={imageUrl}
            alt="Satellite view of disaster area"
            className="w-full h-48 object-cover"
            onError={(e) => {
              // Fallback to alternative imagery if GIBS fails
              const fallbackUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},8,0/400x300?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`;
              (e.target as HTMLImageElement).src = fallbackUrl;
            }}
          />
        )}

        {/* Overlay: Coordinates */}
        <div className="absolute bottom-2 left-2 bg-black/70 px-2 py-1 rounded text-xs text-white font-mono">
          {lat.toFixed(4)}°N, {lng.toFixed(4)}°E
        </div>
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
          View in Worldview
        </a>
        <a
          href={imageUrl}
          download={`disaster_${lat}_${lng}.jpg`}
          className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-colors"
        >
          <Download size={14} />
        </a>
      </div>

      {/* Info Text */}
      <p className="text-xs text-gray-400 leading-relaxed">
        Imagery from NASA's MODIS satellite. Click "View in Worldview" for interactive exploration with multiple satellite layers and time-lapse animation.
      </p>
    </div>
  );
}
