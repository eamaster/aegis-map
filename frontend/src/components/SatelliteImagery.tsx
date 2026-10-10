import { useState, useEffect, useMemo } from 'react';
import { Satellite, Download, ExternalLink, Flame, AlertCircle, MapPin } from 'lucide-react';
import { useDesignSystem } from '../hooks/useDesignSystem';
import { apiUrl } from '../config/api';
import {
  createHotspotLoader,
  fireDisplayState,
  summarizeVisibleHotspots,
  type FireHotspotState,
} from '../utils/fireHotspots';
import { buildImagerySpec, hotspotImagePosition, type ImageryLayer } from '../utils/gibsImagery';

interface SatelliteImageryProps {
  lat: number;
  lng: number;
  disasterType: 'fire' | 'volcano' | 'earthquake';
  date?: string;
  title: string;
}

const MAX_MARKERS = 30;

const fireHotspotsUrl = (lat: number, lng: number) =>
  apiUrl(`/api/fire-hotspots?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`);

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

const getConfidenceColor = (conf: string | null): string => {
  if (conf === 'h') return 'bg-red-500';
  if (conf === 'n') return 'bg-orange-500';
  return 'bg-yellow-500';
};

export default function SatelliteImagery({ lat, lng, disasterType, date, title }: SatelliteImageryProps) {
  const ds = useDesignSystem();
  const [selectedLayer, setSelectedLayer] = useState<ImageryLayer>('visual');
  const [fireState, setFireState] = useState<FireHotspotState>({ state: 'idle' });
  const [loader] = useState(() => createHotspotLoader(fireHotspotsUrl, (input, init) => fetch(input, init), setFireState));
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [overlayFailedUrl, setOverlayFailedUrl] = useState<string | null>(null);
  const [overlayLoadedUrl, setOverlayLoadedUrl] = useState<string | null>(null);
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    if (disasterType !== 'fire') {
      loader.cancel();
      return;
    }
    loader.load(lat, lng);
    return () => loader.cancel();
  }, [lat, lng, disasterType, loader]);

  const spec = useMemo(
    () => buildImagerySpec(selectedLayer, lat, lng, new Date(), import.meta.env.VITE_MAPBOX_TOKEN ?? ''),
    [selectedLayer, lat, lng],
  );

  const worldviewUrl = useMemo(() => {
    const day = buildImagerySpec('falsecolor', lat, lng, new Date(), '').date;
    return `https://worldview.earthdata.nasa.gov/?v=${lng - 1.5},${lat - 1.5},${lng + 1.5},${lat + 1.5}&t=${day}&l=${getWorldviewLayers(disasterType)}`;
  }, [lat, lng, disasterType]);

  const imageStatus: 'loading' | 'loaded' | 'error' =
    failedUrl === spec.url ? 'error' : loadedUrl === spec.url ? 'loaded' : 'loading';
  const overlayUrl = spec.overlay?.url ?? null;
  const overlayStatus: 'none' | 'not-rendered' | 'loading' | 'loaded' | 'error' = !overlayUrl
    ? 'none'
    : overlayFailedUrl === overlayUrl
      ? 'error'
      : overlayLoadedUrl === overlayUrl
        ? 'loaded'
        : imageStatus === 'error'
          ? 'not-rendered'
          : 'loading';

  const effectiveFire: FireHotspotState = disasterType === 'fire' ? fireState : { state: 'idle' };
  const fireDisplay = fireDisplayState(effectiveFire);
  const loadedFire = effectiveFire.state === 'loaded' ? effectiveFire : null;
  const coverage = loadedFire?.data.coverage ?? (effectiveFire.state === 'unavailable' ? effectiveFire.coverage ?? null : null);
  const visibleHotspots = useMemo(() => loadedFire?.visible ?? [], [loadedFire]);
  const fireSummary = useMemo(() => summarizeVisibleHotspots(visibleHotspots), [visibleHotspots]);

  const { markers, offImage } = useMemo(() => {
    if (selectedLayer !== 'fire' || spec.halfSizeDeg === null) return { markers: [], offImage: 0 };
    const half = spec.halfSizeDeg;
    const placed = visibleHotspots
      .map((h) => ({ h, pos: hotspotImagePosition(h, lat, lng, half) }))
      .filter((m): m is { h: (typeof visibleHotspots)[number]; pos: { leftPct: number; topPct: number } } => m.pos !== null);
    return { markers: placed.slice(0, MAX_MARKERS), offImage: visibleHotspots.length - placed.length };
  }, [visibleHotspots, selectedLayer, spec.halfSizeDeg, lat, lng]);

  const windowLabel = coverage ? `${coverage.requestedStart} – ${coverage.requestedEnd} UTC` : '';
  const eventDateMs = date ? Date.parse(date) : NaN;
  const daysSinceDetection = Number.isFinite(eventDateMs)
    ? Math.floor((mountedAt - eventDateMs) / (1000 * 60 * 60 * 24))
    : null;

  const markImageLoaded = (url: string, setter: (url: string) => void = setLoadedUrl) => (el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalHeight !== 0) setter(url);
  };

  return (
    <div
      className="relative overflow-hidden transition-all duration-200"
      data-testid="satellite-imagery"
      data-firms-state={disasterType === 'fire' ? fireDisplay : 'not-applicable'}
      data-firms-coverage={coverage?.status ?? ''}
      data-firms-window={coverage ? `${coverage.requestedStart}/${coverage.requestedEnd}` : ''}
      data-firms-total={loadedFire ? String(loadedFire.data.totalCount) : ''}
      data-firms-visible={loadedFire ? String(loadedFire.visible.length) : ''}
      data-firms-sensor={loadedFire?.data.source ?? (effectiveFire.state === 'unavailable' ? effectiveFire.source ?? '' : '')}
      data-imagery-layer={spec.layer}
      data-imagery-product={spec.product}
      data-imagery-date={spec.date ?? ''}
      data-imagery-overlay-product={spec.overlay?.product ?? ''}
      data-imagery-overlay-date={spec.overlay?.date ?? ''}
      data-imagery-overlay-status={overlayStatus}
      data-imagery-status={imageStatus}
      data-imagery-limitation={spec.limitation ?? ''}
      data-imagery-markers={String(markers.length)}
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
      <div className="flex items-center justify-between" style={{ marginBottom: '12px' }}>
        <div className="flex items-center" style={{ gap: '10px' }}>
          <Satellite size={16} style={{ color: ds.colors.accent.blueLight }} />
          <h3 className="font-bold tracking-tight" style={{ fontSize: '0.875rem', color: ds.text.primary }}>
            {disasterType === 'fire' ? '🔥 Fire Intelligence' : '🛰️ Satellite Imagery'}
          </h3>
        </div>
        <span
          className="uppercase font-semibold"
          style={{ fontSize: '0.625rem', letterSpacing: '0.05em', color: ds.text.tertiary }}
        >
          {spec.provider} · {spec.layer === 'falsecolor' ? 'MODIS 7-2-1' : spec.layer === 'fire' ? 'MODIS + VIIRS' : 'Satellite basemap'}
        </span>
      </div>

      {/* Fire detections (wildfires only) */}
      {disasterType === 'fire' && (
        <div className="min-h-[120px] transition-all duration-300">
          {coverage?.status === 'partial' && (
            <div
              data-testid="firms-partial"
              className="text-xs"
              style={{
                padding: '8px 10px',
                marginBottom: '8px',
                borderRadius: ds.borderRadius.lg,
                background: 'rgba(234, 179, 8, 0.15)',
                border: '1px solid rgba(234, 179, 8, 0.4)',
                color: ds.text.primary,
              }}
            >
              Partial FIRMS coverage: no data returned for {coverage.missingDates.join(', ')} (UTC). Counts below cover the remaining days only.
            </div>
          )}

          {fireDisplay === 'loading' || fireDisplay === 'idle' ? (
            <div
              className="h-full flex flex-col items-center justify-center space-y-3"
              style={{
                padding: '20px',
                borderRadius: ds.borderRadius.lg,
                background: ds.surface.overlaySubtle,
                border: `1px solid ${ds.surface.border}`,
              }}
            >
              <div style={{ animation: 'spin 2s linear infinite' }}>
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, #fb923c, #f97316)',
                    boxShadow: '0 0 20px rgba(251, 146, 60, 0.4)',
                  }}
                >
                  <span className="text-lg">🔥</span>
                </div>
              </div>
              <p className="text-xs font-medium" style={{ color: '#fb923c' }}>Querying NASA FIRMS detections...</p>
              <style>{`
                @keyframes spin {
                  from { transform: rotate(0deg); }
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          ) : effectiveFire.state === 'unavailable' ? (
            <div
              className="h-full flex flex-col items-center justify-center text-center"
              style={{
                padding: '16px',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: ds.borderRadius.lg,
                marginBottom: '12px',
              }}
            >
              <AlertCircle size={22} className="mb-2" style={{ color: '#ef4444' }} />
              <p className="text-sm font-medium" style={{ color: '#ef4444' }}>Fire Detections Unavailable</p>
              <p className="text-xs mt-1 max-w-[260px]" style={{ color: ds.text.secondary }}>
                {effectiveFire.reason}. This is a data outage, not an absence of fires.
              </p>
              {effectiveFire.coverage && (
                <p className="text-xs mt-1 max-w-[260px]" style={{ color: ds.text.tertiary }}>
                  Requested: {effectiveFire.source ?? 'NASA FIRMS'}, {windowLabel}.
                </p>
              )}
            </div>
          ) : loadedFire && fireDisplay === 'detections' ? (
            <div
              className="space-y-3 animate-in fade-in duration-500"
              style={{
                padding: '12px',
                borderRadius: ds.borderRadius.lg,
                background: 'linear-gradient(135deg, rgba(220, 38, 38, 0.15), rgba(249, 115, 22, 0.1))',
                border: '1px solid rgba(220, 38, 38, 0.3)',
                marginBottom: '12px',
              }}
            >
              <div className="flex items-center" style={{ gap: '10px' }}>
                <Flame size={14} style={{ color: ds.isDark ? '#f87171' : '#dc2626' }} />
                <span className="font-semibold" style={{ fontSize: '0.875rem', color: ds.text.primary }}>
                  FIRMS Detections ({windowLabel})
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(0, 0, 0, 0.3)' }}>
                  <div className="text-3xl font-bold" style={{ color: ds.text.primary }}>{fireSummary.total}</div>
                  <div className="text-xs" style={{ color: ds.text.secondary }}>Shown Detections</div>
                  <div className="mt-1 flex flex-col gap-0.5" style={{ fontSize: '0.625rem', fontWeight: 500 }}>
                    <span style={{ color: '#f87171' }}>{fireSummary.high} High Confidence</span>
                    <span style={{ color: '#fed7aa' }}>{fireSummary.nominal} Nominal</span>
                    {fireSummary.unknown > 0 && (
                      <span style={{ color: ds.text.tertiary }}>{fireSummary.unknown} Confidence not reported</span>
                    )}
                    {loadedFire.hiddenLowConfidence > 0 && (
                      <span style={{ color: ds.text.tertiary }}>{loadedFire.hiddenLowConfidence} low-confidence hidden</span>
                    )}
                  </div>
                </div>

                <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(0, 0, 0, 0.3)' }}>
                  {fireSummary.maxBrightness !== null ? (
                    <>
                      <div className="text-2xl font-bold tabular-nums" style={{ color: ds.text.primary }}>
                        {fireSummary.maxBrightness.toFixed(1)} K
                      </div>
                      <div className="text-xs" style={{ color: ds.text.secondary }}>Max I-4 brightness temperature</div>
                    </>
                  ) : (
                    <div className="text-xs" style={{ color: ds.text.secondary }}>Brightness temperature not reported</div>
                  )}
                  {fireSummary.latestDetection && (
                    <div className="mt-1" style={{ fontSize: '0.625rem', color: ds.text.tertiary }}>
                      Latest detection {fireSummary.latestDetection}
                    </div>
                  )}
                </div>
              </div>
              <p style={{ fontSize: '0.625rem', color: ds.text.tertiary }}>
                Brightness temperature is the sensor's pixel radiometric value, not air or flame temperature, and not a severity rating.
              </p>

              <div className="flex items-center gap-2.5 text-xs">
                <AlertCircle size={13} style={{ color: '#fb923c' }} />
                <span style={{ color: ds.text.secondary }}>
                  Max Fire Radiative Power:{' '}
                  <span className="font-semibold" style={{ color: '#fb923c' }}>
                    {fireSummary.maxPower !== null ? `${fireSummary.maxPower.toFixed(1)} MW` : 'not reported'}
                  </span>
                </span>
              </div>
              <p style={{ fontSize: '0.625rem', color: ds.text.tertiary }}>
                Source: NASA FIRMS {loadedFire.data.sensor}, ±0.5° around the event.
              </p>
            </div>
          ) : (
            <div
              className="h-full flex flex-col items-center justify-center text-center"
              style={{
                padding: '16px',
                background: ds.surface.overlaySubtle,
                border: `1px solid ${ds.surface.border}`,
                borderRadius: ds.borderRadius.lg,
                marginBottom: '12px',
              }}
            >
              <Flame size={22} className="mb-2" style={{ color: ds.text.tertiary }} />
              {fireDisplay === 'filtered' && loadedFire ? (
                <>
                  <p className="text-sm font-medium" style={{ color: ds.text.secondary }}>
                    Only Low-Confidence Detections ({windowLabel})
                  </p>
                  <p className="text-xs mt-1 max-w-[260px]" style={{ color: ds.text.tertiary }}>
                    NASA FIRMS {loadedFire.data.sensor} reported {loadedFire.hiddenLowConfidence} low-confidence detection
                    {loadedFire.hiddenLowConfidence === 1 ? '' : 's'} in this ±0.5° area; they are hidden from the map view.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium" style={{ color: ds.text.secondary }}>No Detections ({windowLabel})</p>
                  <p className="text-xs mt-1 max-w-[260px]" style={{ color: ds.text.tertiary }}>
                    NASA FIRMS {loadedFire?.data.sensor ?? 'VIIRS'} returned no thermal anomalies in this ±0.5° area for the queried dates.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Historical event banner (only for a valid event date) */}
      {daysSinceDetection !== null && daysSinceDetection > 7 && (
        <div
          className="flex items-start"
          style={{
            padding: '10px',
            borderRadius: ds.borderRadius.lg,
            background: ds.isDark ? 'rgba(234, 179, 8, 0.15)' : 'rgba(234, 179, 8, 0.25)',
            border: ds.isDark ? '1px solid rgba(234, 179, 8, 0.4)' : '1px solid rgba(234, 179, 8, 0.5)',
            marginBottom: '12px',
            gap: '8px',
          }}
        >
          <AlertCircle className="flex-shrink-0" size={15} style={{ color: ds.isDark ? '#fbbf24' : '#ca8a04', marginTop: '2px' }} />
          <div>
            <p className="font-medium" style={{ fontSize: '0.75rem', color: ds.text.primary }}>
              <strong>{disasterType === 'volcano' ? 'Open volcanic event:' : 'Historical Event:'}</strong>{' '}
              {disasterType === 'volcano' ? 'NASA EONET reported it' : 'Latest reported observation'} {(() => {
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
              })()}{disasterType === 'volcano' ? ' and has not closed it; that date is not the latest activity.' : '.'}
            </p>
            <p style={{ fontSize: '0.75rem', color: ds.text.secondary, marginTop: '4px' }}>
              Imagery and detections below are recent, not from the event date. Conditions may differ.
            </p>
          </div>
        </div>
      )}

      {/* Layer selector */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        {disasterType === 'fire' && (
          <button
            onClick={() => setSelectedLayer('fire')}
            className="flex-1 font-medium transition-all"
            data-testid="imagery-tab-fire"
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
          onClick={() => setSelectedLayer('falsecolor')}
          className="flex-1 font-medium transition-all"
          data-testid="imagery-tab-falsecolor"
          style={{
            padding: '8px 12px',
            fontSize: '0.75rem',
            borderRadius: '10px',
            background: selectedLayer === 'falsecolor' ? 'rgba(249, 115, 22, 0.2)' : ds.surface.overlaySubtle,
            color: selectedLayer === 'falsecolor' ? (ds.isDark ? '#fdba74' : '#ea580c') : ds.text.secondary,
            border: selectedLayer === 'falsecolor' ? '2px solid rgba(249, 115, 22, 0.4)' : `1px solid ${ds.surface.border}`,
          }}
        >
          🛰️ 7-2-1 False Color
        </button>
        <button
          onClick={() => setSelectedLayer('visual')}
          className="flex-1 font-medium transition-all"
          data-testid="imagery-tab-visual"
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

      {/* Image display */}
      <div
        className="relative overflow-hidden"
        style={{
          borderRadius: ds.borderRadius.lg,
          background: ds.surface.overlaySubtle,
          border: `1px solid ${ds.surface.border}`,
          marginBottom: '12px',
        }}
      >
        {imageStatus === 'error' ? (
          <div className="w-full aspect-[4/3] flex flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertCircle size={48} style={{ color: ds.colors.status.warning }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: ds.text.primary }}>
                {spec.provider} Imagery Unavailable
              </p>
              <p className="text-xs mt-2" style={{ color: ds.text.secondary }}>
                {spec.label}
                {spec.date ? ` for ${spec.date}` : ''} could not be loaded.
              </p>
              {spec.provider === 'NASA GIBS' && (
                <p className="text-xs mt-2" style={{ color: ds.text.tertiary }}>
                  Try the <strong>Visual</strong> tab for Mapbox imagery, or check back later.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="relative w-full" style={{ aspectRatio: '4/3', backgroundColor: '#111827', minHeight: '300px' }}>
            {imageStatus === 'loading' && (
              <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-3 z-30" style={{ backgroundColor: 'rgba(17, 24, 39, 0.95)' }}>
                <div style={{ animation: 'spin 2s linear infinite' }}>
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center"
                    style={{
                      background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                      boxShadow: '0 0 30px rgba(59, 130, 246, 0.5), 0 0 60px rgba(59, 130, 246, 0.2)',
                    }}
                  >
                    <span className="text-3xl">🌐</span>
                  </div>
                </div>
                <p className="text-sm text-gray-300 font-medium">Loading {spec.label}...</p>
                <style>{`
                  @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                  }
                `}</style>
              </div>
            )}

            <img
              key={spec.url}
              ref={markImageLoaded(spec.url)}
              src={spec.url}
              alt={`${spec.label}${spec.date ? ` ${spec.date}` : ''}`}
              data-testid="imagery-base"
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                if (spec.layer === 'visual' && !img.dataset.fallback) {
                  img.dataset.fallback = '1';
                  img.src = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},8,0/800x600?access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`;
                  return;
                }
                setFailedUrl(spec.url);
              }}
              onLoad={() => setLoadedUrl(spec.url)}
            />

            <div className="absolute w-full h-full pointer-events-none" style={{ top: 0, left: 0 }}>
              {spec.overlay && overlayFailedUrl !== spec.overlay.url && (
                <img
                  key={spec.overlay.url}
                  ref={markImageLoaded(spec.overlay.url, setOverlayLoadedUrl)}
                  src={spec.overlay.url}
                  alt=""
                  data-testid="imagery-overlay"
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                  style={{ mixBlendMode: 'screen' }}
                  onError={() => setOverlayFailedUrl(spec.overlay?.url ?? null)}
                  onLoad={() => setOverlayLoadedUrl(spec.overlay?.url ?? null)}
                />
              )}

              {markers.map(({ h, pos }) => (
                <div
                  key={`${h.latitude}|${h.longitude}|${h.acq_date}|${h.acq_time}|${h.satellite}`}
                  className={`absolute rounded-full ${getConfidenceColor(h.confidence)} shadow-lg pointer-events-auto`}
                  style={{
                    width: '10px',
                    height: '10px',
                    left: `${pos.leftPct}%`,
                    top: `${pos.topPct}%`,
                    transform: 'translate(-50%, -50%)',
                    boxShadow: '0 0 20px rgba(239, 68, 68, 1), 0 0 40px rgba(239, 68, 68, 0.6)',
                    border: '2px solid white',
                    zIndex: 10,
                    animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                  }}
                  title={`${h.acq_date} ${h.acq_time} UTC · ${h.bright_ti4 ?? '?'}K · ${h.frp ?? '?'}MW · conf ${h.confidence ?? 'n/a'}`}
                />
              ))}

              <div
                className="absolute bg-black/90 px-2.5 py-1.5 rounded text-xs text-white font-medium backdrop-blur-sm pointer-events-none"
                style={{ top: '10px', left: '10px', zIndex: 20 }}
              >
                {spec.layer === 'fire' ? '🔥 Fire Data' : spec.layer === 'falsecolor' ? '🛰️ 7-2-1 False Color' : '📸 Visual'}
              </div>

              <div className="absolute bg-black/90 px-2 py-1 rounded text-xs text-white font-mono backdrop-blur-sm pointer-events-none" style={{ bottom: '8px', left: '8px', zIndex: 15 }}>
                <MapPin size={10} className="inline mr-1" />
                {lat.toFixed(3)}°, {lng.toFixed(3)}°
              </div>

              <div
                className="absolute bg-black/90 px-2 py-1 rounded text-xs text-white backdrop-blur-sm pointer-events-none"
                style={{ bottom: '8px', right: '8px', zIndex: 15 }}
              >
                {spec.date ? `requested ${spec.date}` : 'date n/a'}
                {spec.overlay ? ` | overlay ${spec.overlay.date}${overlayStatus === 'error' ? ' (failed)' : ''}` : ''}
              </div>
            </div>
          </div>
        )}
      </div>

      <p data-testid="imagery-caption" style={{ fontSize: '0.625rem', color: ds.text.tertiary, marginBottom: '12px', lineHeight: 1.5 }}>
        Image: {spec.label}
        {spec.date ? `, requested UTC day ${spec.date}; swath and cloud coverage not confirmed` : ''}.
        {spec.overlay && (overlayStatus === 'loading' || overlayStatus === 'loaded') &&
          ` Overlay: ${spec.overlay.label}, requested ${spec.overlay.date}; an empty overlay may mean no detections or no coverage.`}
        {spec.overlay && overlayStatus === 'error' && ` Overlay for ${spec.overlay.date} failed to load; thermal anomalies are not shown on the image.`}
        {spec.layer === 'fire' && loadedFire && ` Markers: FIRMS detections ${windowLabel} (multi-day; not the same period as the overlay).`}
        {spec.layer === 'fire' && offImage > 0 && ` ${offImage} detection(s) fall outside the drawable image and are not marked.`}
        {spec.layer === 'fire' && effectiveFire.state === 'unavailable' && ' No FIRMS markers: detection data unavailable.'}
      </p>
      {spec.limitation && (
        <p
          data-testid="imagery-limitation"
          className="flex items-start gap-1.5"
          style={{ fontSize: '0.625rem', color: '#fbbf24', marginTop: '-8px', marginBottom: '12px', lineHeight: 1.5 }}
        >
          <AlertCircle size={11} className="shrink-0 mt-0.5" />
          {spec.limitation}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2" style={{ marginBottom: '12px' }}>
        <a
          href={worldviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-gradient-to-r from-blue-600/20 to-blue-500/20 hover:from-blue-600/40 hover:to-blue-500/40 rounded-lg text-xs font-semibold transition-all border border-blue-500/40"
          style={{ color: '#60a5fa' }}
        >
          <ExternalLink size={14} />
          NASA Worldview
        </a>
        <a
          href={spec.url}
          download={`${disasterType}_${title.replace(/\s+/g, '_')}_${spec.date ?? 'basemap'}.jpg`}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-gray-600/30 to-gray-500/30 hover:from-gray-600/50 hover:to-gray-500/50 rounded-lg text-xs font-semibold transition-all border border-gray-400/40"
          style={{ color: '#d1d5db' }}
        >
          <Download size={14} />
        </a>
      </div>

      {/* Info text */}
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
            🔥 <strong style={{ color: ds.text.primary }}>Fire Hotspots:</strong> markers are NASA FIRMS VIIRS S-NPP detections
            {loadedFire ? ` for ${windowLabel}` : ''}; the red overlay is a single day of VIIRS thermal anomalies; the base is MODIS Aqua true color (±0.5° view).
            {markers.length > 0 && (
              <strong style={{ color: ds.colors.disaster.fire }}> {markers.length} marker{markers.length === 1 ? '' : 's'} shown.</strong>
            )}
          </p>
        )}
        {selectedLayer === 'falsecolor' && (
          <p>
            🛰️ <strong style={{ color: ds.text.primary }}>MODIS Terra bands 7-2-1</strong> false-color corrected reflectance (shortwave infrared, near infrared, red). Burn scars appear brown-red and vegetation green; active fires can appear bright orange. This is reflectance, not a temperature measurement.
          </p>
        )}
        {selectedLayer === 'visual' && (
          <p>
            📸 <strong style={{ color: ds.text.primary }}>Mapbox satellite basemap</strong> for geographic context. Acquisition date is not provided and may be months or years old.
          </p>
        )}
        {disasterType === 'volcano' && (
          <p>
            🌋 <strong style={{ color: ds.text.primary }}>Volcanic activity:</strong> open NASA Worldview for SO₂ index and reflectance layers.
          </p>
        )}
        {disasterType === 'earthquake' && (
          <p>
            🌍 <strong style={{ color: ds.text.primary }}>Location context</strong> for the affected area. Use NASA Worldview for additional layers.
          </p>
        )}
      </div>
    </div>
  );
}
