import { useState, useEffect } from 'react';
import { Satellite, Download, ExternalLink, Flame, AlertCircle, MapPin } from 'lucide-react';
import { useDesignSystem } from '../hooks/useDesignSystem';

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
  const ds = useDesignSystem();
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
  const [modisDate, setModisDate] = useState<string>('');
  const [firmsDate, setFirmsDate] = useState<string>('');

  const [fetchingFire, setFetchingFire] = useState(false);

  useEffect(() => {
    // ✅ CRITICAL: MODIS imagery has 3-4 day processing delay
    // MODIS imagery date for Fire Hotspots and Thermal tabs
    const modisDate = new Date();
    modisDate.setDate(modisDate.getDate() - 4);
    const modisDateStr = modisDate.toISOString().split('T')[0];

    // Set NASA Worldview URL with disaster-specific layers
    const layers = getWorldviewLayers(disasterType);
    // Always use MODIS date for Worldview (MODIS layers)
    const worldview = `https://worldview.earthdata.nasa.gov/?v=${lng - 1.5},${lat - 1.5},${lng + 1.5},${lat + 1.5}&t=${modisDateStr}&l=${layers}`;
    setWorldviewUrl(worldview);

    // Fetch fire data for wildfires (uses near real-time FIRMS API)
    if (disasterType === 'fire') {
      fetchFireHotspots(lat, lng);
    }

    // ✅ Update imagery - only MODIS layers need the date parameter
    if (selectedLayer === 'visual') {
      updateImagery(lat, lng, '');  // Mapbox doesn't use date parameter
    } else {
      updateImagery(lat, lng, modisDateStr);  // MODIS layers use 4-day-old date
    }
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
        return;
      }

      const hotspots: FireHotspot[] = data.hotspots.filter((h: any) => h.confidence !== 'l' && h.confidence !== 'low');

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
      // ✅ Fire Hotspots: MODIS Aqua True Color (natural colors) + VIIRS overlay
      // CRITICAL: All three (base, overlay, markers) use SAME ±0.5° bbox for alignment
      const bboxSize = 0.5; // ±0.5° = ~55km radius - MUST match marker calculation!

      // MODIS has 3-day processing delay, use historical date for base layer
      const modisDateObj = new Date();
      modisDateObj.setDate(modisDateObj.getDate() - 3);
      const modisDateStr = modisDateObj.toISOString().split('T')[0];
      setModisDate(modisDateObj.toLocaleDateString());

      // VIIRS has near real-time availability (3-hour latency), use today's date
      const firmsDateStr = new Date().toISOString().split('T')[0];
      setFirmsDate(new Date().toLocaleDateString());

      console.log('🔥 Fire Hotspots WMS Config:', {
        center: { lat, lng },
        bboxSize,
        bboxRange: {
          lat: [lat - bboxSize, lat + bboxSize],
          lng: [lng - bboxSize, lng + bboxSize]
        },
        modisDate: modisDateStr,
        firmsDate: firmsDateStr,
        stateDates: { modisDate, firmsDate }
      });

      // Base layer: MODIS Aqua natural color (WMS with explicit BBOX)
      // GIBS WMS 1.3.0 EPSG:4326 uses lat,lng order: minLat,minLng,maxLat,maxLng
      const baseUrl = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Aqua_CorrectedReflectance_TrueColor&TIME=${modisDateStr}&CRS=EPSG:4326&WIDTH=800&HEIGHT=600&BBOX=${lat - bboxSize},${lng - bboxSize},${lat + bboxSize},${lng + bboxSize}&FORMAT=image/jpeg`;
      setImageUrl(baseUrl);

      // VIIRS fire overlay - use SAME bbox order and today's date for current fire data
      const fireOverlay = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=VIIRS_NOAA20_Thermal_Anomalies_375m_All&TIME=${firmsDateStr}&CRS=EPSG:4326&WIDTH=800&HEIGHT=600&BBOX=${lat - bboxSize},${lng - bboxSize},${lat + bboxSize},${lng + bboxSize}&FORMAT=image/png&TRANSPARENT=true`;
      setOverlayUrl(fireOverlay);

    } else if (selectedLayer === 'thermal') {
      // Thermal: MODIS Bands 7-2-1 (use 4-day-old date)
      // GIBS WMS 1.3.0 EPSG:4326 uses lat,lng order: minLat,minLng,maxLat,maxLng
      const thermalBbox = 0.3;
      const thermalUrl = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Terra_CorrectedReflectance_Bands721&TIME=${dateStr}&CRS=EPSG:4326&WIDTH=800&HEIGHT=600&BBOX=${lat - thermalBbox},${lng - thermalBbox},${lat + thermalBbox},${lng + thermalBbox}&FORMAT=image/jpeg`;
      setImageUrl(thermalUrl);
      setOverlayUrl('');

    } else {
      // Visual: Mapbox high-res
      const visualUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},15,0/800x600@2x?access_token=${mapboxToken}`;
      setImageUrl(visualUrl);
      setOverlayUrl('');
    }

    setLoading(false);
  };

  const getSeverityLevel = (temp: number): { label: string; color: string } => {
    if (temp > 360) return { label: 'EXTREME', color: '#ef4444' };
    if (temp > 340) return { label: 'HIGH', color: '#f97316' };
    if (temp > 320) return { label: 'MODERATE', color: '#fbbf24' };
    return { label: 'LOW', color: '#9ca3af' };
  };

  const getConfidenceColor = (conf: string): string => {
    if (conf === 'h') return 'bg-red-500';
    if (conf === 'n') return 'bg-orange-500';
    return 'bg-yellow-500';
  };

  return (
    <div
      className="relative overflow-hidden transition-all duration-200"
      style={{
        padding: '14px',
        borderRadius: ds.borderRadius.lg,
        background: ds.surface.overlay,
        border: `1px solid ${ds.surface.border}`,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
        marginBottom: '12px',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: '10px' }}
      >
        <div className="flex items-center" style={{ gap: '10px' }}>
          <Satellite size={16} style={{ color: ds.colors.accent.blueLight }} />
          <h3
            className="font-bold tracking-tight"
            style={{
              fontSize: '0.875rem',
              color: ds.text.primary,
            }}
          >
            {disasterType === 'fire' ? '🔥 Fire Intelligence' : '🛰️ Satellite Imagery'}
          </h3>
        </div>
        <span
          className="uppercase font-semibold"
          style={{
            fontSize: '0.625rem',
            letterSpacing: '0.05em',
            color: ds.text.tertiary,
          }}
        >
          {selectedLayer === 'thermal' ? 'NASA GIBS' : selectedLayer === 'fire' ? 'NASA GIBS + Mapbox' : 'Mapbox Satellite'}
        </span>
      </div>

      {/* Fire Statistics (Wildfires Only) */}
      {disasterType === 'fire' && (
        <div className="min-h-[120px] transition-all duration-300">
          {fetchingFire ? (
            <div
              className="h-full flex flex-col items-center justify-center space-y-3"
              style={
                {
                  padding: '20px',
                  borderRadius: ds.borderRadius.lg,
                  background: ds.surface.overlaySubtle,
                  border: `1px solid ${ds.surface.border}`,
                }}
            >
              <div className="animate-spin rounded-full h-6 w-6" style={{ border: '2px solid #fb923c', borderTopColor: 'transparent' }} />
              <p className="text-xs font-medium animate-pulse" style={{ color: '#fb923c' }}>Scanning thermal sensors...</p>
            </div>
          ) : fireStats ? (
            <div
              className="space-y-3 animate-in fade-in duration-500"
              style={{
                padding: '12px',
                borderRadius: ds.borderRadius.lg,
                background: 'linear-gradient(135deg, rgba(220, 38, 38, 0.15), rgba(249, 115, 22, 0.1))',
                border: '1px solid rgba(220, 38, 38, 0.3)',
              }}
            >
              <div className="flex items-center" style={{ gap: '10px' }}>
                <Flame size={14} style={{ color: ds.isDark ? '#f87171' : '#dc2626' }} />
                <span className="font-semibold" style={{ fontSize: '0.875rem', color: ds.text.primary }}>Active Fire Hotspots (7 days)</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div
                  style={{
                    padding: '10px',
                    borderRadius: '8px',
                    background: 'rgba(0, 0, 0, 0.3)',
                  }}
                >
                  <div className="text-3xl font-bold" style={{ color: ds.text.primary }}>{fireStats.total}</div>
                  <div className="text-xs" style={{ color: ds.text.secondary }}>Total Hotspots</div>
                  <div className="mt-1 flex flex-col gap-0.5" style={{ fontSize: '0.625rem', fontWeight: 500 }}>
                    <span style={{ color: '#f87171' }}>{fireStats.highConfidence} High Confidence</span>
                    <span style={{ color: '#fed7aa' }}>{fireStats.total - fireStats.highConfidence} Nominal</span>
                  </div>
                </div>

                <div
                  style={{
                    padding: '10px',
                    borderRadius: '8px',
                    background: 'rgba(0, 0, 0, 0.3)',
                  }}
                >
                  <div className="text-3xl font-bold" style={{ color: getSeverityLevel(fireStats.avgTemp).color.replace('text-', '') }}>
                    {getSeverityLevel(fireStats.avgTemp).label}
                  </div>
                  <div className="text-xs" style={{ color: ds.text.secondary }}>Fire Intensity</div>
                  <div className="mt-1 text-xs" style={{ color: ds.text.secondary }}>
                    {(fireStats.avgTemp - 273.15).toFixed(0)}°C
                    <span style={{ color: ds.text.tertiary, marginLeft: '4px' }}>({fireStats.avgTemp.toFixed(0)}K)</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 text-xs">
                <AlertCircle size={13} style={{ color: '#fb923c' }} />
                <span style={{ color: ds.text.secondary }}>
                  Max Fire Power: <span className="font-semibold" style={{ color: '#fb923c' }}>{fireStats.maxFRP.toFixed(1)} MW</span>
                  <span style={{ fontSize: '0.625rem', marginLeft: '4px', color: ds.text.tertiary }}>(industrial-scale heat)</span>
                </span>
              </div>
            </div>
          ) : (
            <div
              className="h-full flex flex-col items-center justify-center text-center"
              style={{
                padding: '16px',
                background: ds.surface.overlaySubtle,
                border: `1px solid ${ds.surface.border}`,
                borderRadius: ds.borderRadius.lg,
              }}
            >
              <Flame size={22} className="mb-2" style={{ color: ds.text.tertiary }} />
              <p className="text-sm font-medium" style={{ color: ds.text.secondary }}>No Active Hotspots</p>
              <p className="text-xs mt-1 max-w-[200px]" style={{ color: ds.text.tertiary }}>
                Satellite thermal sensors have not detected significant heat anomalies in this area recently.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Historical Event Warning Banner - REDESIGNED */}
      {(() => {
        const disasterDate = date ? new Date(date) : new Date();
        const daysSinceDetection = Math.floor((Date.now() - disasterDate.getTime()) / (1000 * 60 * 60 * 24));
        const isHistorical = daysSinceDetection > 7;
        return isHistorical ? (
          <div
            className="flex items-start"
            style={{
              padding: '10px',
              borderRadius: ds.borderRadius.lg,
              background: ds.isDark ? 'rgba(234, 179, 8, 0.15)' : 'rgba(234, 179, 8, 0.25)',
              border: ds.isDark ? '1px solid rgba(234, 179, 8, 0.4)' : '1px solid rgba(234, 179, 8, 0.5)',
              marginBottom: '10px',
              gap: '8px',
            }}
          >
            <AlertCircle className="flex-shrink-0" size={15} style={{ color: ds.isDark ? '#fbbf24' : '#ca8a04', marginTop: '2px' }} />
            <div>
              <p className="font-medium" style={{ fontSize: '0.75rem', color: ds.text.primary }}>
                <strong>Historical Event:</strong> First detected {(() => {
                  if (daysSinceDetection >= 365) {
                    const years = Math.floor(daysSinceDetection / 365);
                    const months = Math.floor((daysSinceDetection % 365) / 30);
                    return months > 0 ? `${years} year${years > 1 ? 's' : ''} and ${months} month${months > 1 ? 's' : ''} ago` : `${years} year${years > 1 ? 's' : ''} ago`;
                  } else if (daysSinceDetection >= 30) {
                    const months = Math.floor(daysSinceDetection / 30);
                    const days = daysSinceDetection % 30;
                    return days > 0 ? `${months} month${months > 1 ? 's' : ''} and ${days} day${days > 1 ? 's' : ''} ago` : `${months} month${months > 1 ? 's' : ''} ago`;
                  }
                  return `${daysSinceDetection} day${daysSinceDetection > 1 ? 's' : ''} ago`;
                })()}.
              </p>
              <p style={{ fontSize: '0.75rem', color: ds.text.secondary, marginTop: '4px' }}>
                Showing current satellite imagery and fire hotspots (last 7 days). Conditions may differ from initial detection.
              </p>
            </div>
          </div>
        ) : null;
      })()}

      {/* Layer Selector - REDESIGNED */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
        {disasterType === 'fire' && (
          <button
            onClick={() => setSelectedLayer('fire')}
            className="flex-1 font-medium transition-all"
            style={{
              padding: '8px 12px',
              fontSize: '0.75rem',
              borderRadius: '10px',
              background: selectedLayer === 'fire' ? 'rgba(239, 68, 68, 0.2)' : ds.surface.overlaySubtle,
              color: selectedLayer === 'fire' ? (ds.isDark ? '#fca5a5' : '#dc2626') : ds.text.secondary,
              border: selectedLayer === 'fire' ? '2px solid rgba(239, 68, 68, 0.4)' : `1px solid ${ds.surface.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <Flame size={13} />
            Fire Hotspots
          </button>
        )}
        <button
          onClick={() => setSelectedLayer('thermal')}
          className="flex-1 font-medium transition-all"
          style={{
            padding: '8px 12px',
            fontSize: '0.75rem',
            borderRadius: '10px',
            background: selectedLayer === 'thermal' ? 'rgba(249, 115, 22, 0.2)' : ds.surface.overlaySubtle,
            color: selectedLayer === 'thermal' ? (ds.isDark ? '#fdba74' : '#ea580c') : ds.text.secondary,
            border: selectedLayer === 'thermal' ? '2px solid rgba(249, 115, 22, 0.4)' : `1px solid ${ds.surface.border}`,
          }}
        >
          🌡️ Thermal
        </button>
        <button
          onClick={() => setSelectedLayer('visual')}
          className="flex-1 font-medium transition-all"
          style={{
            padding: '8px 12px',
            fontSize: '0.75rem',
            borderRadius: '10px',
            background: selectedLayer === 'visual' ? 'rgba(59, 130, 246, 0.2)' : ds.surface.overlaySubtle,
            color: selectedLayer === 'visual' ? '#93c5fd' : ds.text.secondary,
            border: selectedLayer === 'visual' ? '2px solid rgba(59, 130, 246, 0.4)' : `1px solid ${ds.surface.border}`,
          }}
        >
          📸 Visual
        </button>
      </div>

      {/* Image Display - REDESIGNED */}
      <div
        className="relative overflow-hidden"
        style={{
          borderRadius: ds.borderRadius.lg,
          background: ds.surface.overlaySubtle,
          border: `1px solid ${ds.surface.border}`,
          marginBottom: '10px',
        }}
      >
        {loading ? (
          <div className="w-full aspect-[4/3] flex flex-col items-center justify-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
            <p className="text-xs text-gray-400">Loading satellite imagery...</p>
          </div>
        ) : (
          <div className="relative w-full bg-gray-900" style={{ display: 'inline-block' }}>
            {/* Base Image - positions the container */}
            <img
              src={imageUrl}
              alt={`${disasterType} satellite view`}
              className="w-full h-auto block"
              onError={(e) => {
                console.error('Image failed, using fallback');
                const fallback = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},8,0/800x600?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`;
                (e.target as HTMLImageElement).src = fallback;
              }}
            />

            {/* Absolute positioned overlay layer - covers entire image */}
            <div className="absolute w-full h-full pointer-events-none" style={{ top: 0, left: 0 }}>
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
                <>
                  {fireHotspots.slice(0, 30).map((hotspot, idx) => {
                    // ✅ SYNCHRONIZED: Match WMS bbox (±0.5° range)
                    const bboxSize = 0.5;
                    const imgBboxSize = bboxSize * 2; // Total range: 1.0°

                    // Calculate position relative to image center (50% = center)
                    const relLng = ((lng - hotspot.longitude) / imgBboxSize) * 100 + 50;
                    const relLat = ((lat - hotspot.latitude) / imgBboxSize) * 100 + 50;

                    // ✅ DEBUG: Log marker position (REMOVE after verifying fix works)
                    if (idx === 0) {
                      console.log('🎯 First Fire Marker:', {
                        hotspot: { lat: hotspot.latitude, lng: hotspot.longitude },
                        center: { lat, lng },
                        calculated: { left: `${relLng.toFixed(1)}%`, top: `${relLat.toFixed(1)}%` },
                        bboxSize
                      });
                    }

                    // Only show if within bounds (with small margin for edge cases)
                    if (relLng < -5 || relLng > 105 || relLat < -5 || relLat > 105) {
                      return null;
                    }

                    return (
                      <div
                        key={idx}
                        className={`absolute rounded-full ${getConfidenceColor(hotspot.confidence)} shadow-lg pointer-events-auto`}
                        style={{
                          width: '10px',
                          height: '10px',
                          left: `${relLng}%`,
                          top: `${relLat}%`,
                          transform: 'translate(-50%, -50%)',
                          boxShadow: '0 0 20px rgba(239, 68, 68, 1), 0 0 40px rgba(239, 68, 68, 0.6)',
                          border: '2px solid white',
                          zIndex: 10,
                          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                        }}
                        title={`${hotspot.bright_ti4}K, ${hotspot.frp}MW, Conf: ${hotspot.confidence}`}
                      />
                    );
                  })}
                </>
              )}

              {/* Layer Label */}
              <div className="absolute bg-black/90 px-2 py-1 rounded text-xs text-white font-medium backdrop-blur-sm pointer-events-none" style={{ top: '8px', left: '8px', zIndex: 15 }}>
                {selectedLayer === 'fire' ? '🔥 Fire Data' :
                  selectedLayer === 'thermal' ? '🌡️ Thermal' :
                    '📸 Visual'}
              </div>

              {/* Coordinates */}
              <div className="absolute bg-black/90 px-2 py-1 rounded text-xs text-white font-mono backdrop-blur-sm pointer-events-none" style={{ bottom: '8px', left: '8px', zIndex: 15 }}>
                <MapPin size={10} className="inline mr-1" />
                {lat.toFixed(3)}°, {lng.toFixed(3)}°
              </div>

              {/* Data Timestamp */}
              <div className="absolute bg-black/90 px-2 py-1 rounded text-xs text-white backdrop-blur-sm pointer-events-none" style={{ bottom: '8px', right: '8px', zIndex: 15 }}>
                {selectedLayer === 'thermal' ? (
                  <span title="MODIS infrared imagery has 3-4 day processing delay">
                    {(() => {
                      const d = new Date();
                      d.setDate(d.getDate() - 4);
                      return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });
                    })()}
                  </span>
                ) : selectedLayer === 'fire' ? (
                  <span title="MODIS base: 3 days ago | VIIRS fires: today">
                    {(() => {
                      const d = new Date();
                      d.setDate(d.getDate() - 3);
                      return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });
                    })()} | {new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })}
                  </span>
                ) : (
                  <span title="Mapbox commercial satellite imagery">
                    Live
                  </span>
                )}
              </div>
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

      {/* Info Text - REDESIGNED */}
      <div
        className="leading-relaxed"
        style={{
          fontSize: '0.75rem',
          color: ds.text.secondary,
          padding: '10px',
          borderRadius: ds.borderRadius.lg,
          background: ds.surface.overlaySubtle,
          border: `1px solid ${ds.surface.border}`,
        }}
      >
        {disasterType === 'fire' && selectedLayer === 'fire' && (
          <p>
            🔥 <strong style={{ color: ds.text.primary }}>Fire Hotspots:</strong> NASA VIIRS satellite fire detections (bright dots = active fires, last 7 days) overlaid on MODIS natural color imagery (regional ~55km view).
            {fireHotspots.length > 0 && (
              <span> <strong style={{ color: ds.colors.disaster.fire }}>{fireHotspots.length} hotspots detected.</strong></span>
            )}
            {' '}Switch to <strong>Visual</strong> tab for street-level detail.
          </p>
        )}
        {disasterType === 'fire' && selectedLayer === 'thermal' && (
          <p>
            🌡️ <strong style={{ color: ds.text.primary }}>Thermal infrared imagery</strong> using MODIS Bands 7-2-1. Red/orange areas show heat signatures. Useful for detecting fires through smoke.
          </p>
        )}
        {selectedLayer === 'visual' && (
          <p>
            📸 <strong style={{ color: ds.text.primary }}>High-resolution satellite imagery</strong>. True color composite for visual damage assessment and terrain analysis.
          </p>
        )}
        {disasterType === 'volcano' && (
          <p>
            🌋 <strong style={{ color: ds.text.primary }}>Volcanic activity monitoring</strong> using thermal and SO₂ sensors. Click NASA Worldview for sulfur dioxide dispersion maps.
          </p>
        )}
        {disasterType === 'earthquake' && (
          <p>
            🌍 <strong style={{ color: ds.text.primary }}>Terrain and infrastructure imagery</strong>. Use thermal layers to detect landslides and building damage patterns.
          </p>
        )}
      </div>
    </div>
  );
}

