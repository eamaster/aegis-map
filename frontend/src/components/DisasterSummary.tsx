/**
 * DisasterSummary Component - Geographic Intelligence Display
 * Shows WHERE disasters are happening with regional breakdown
 */

import React from 'react';
import { MapPin, AlertTriangle, Clock } from 'lucide-react';

interface Disaster {
  id: string;
  type: 'fire' | 'volcano' | 'earthquake';
  title: string;
  lat: number;
  lng: number;
  date: string;
  severity: 'low' | 'medium' | 'high';
  magnitude?: number;
}

interface DisasterSummaryProps {
  disasters: Disaster[];
}

export const DisasterSummary: React.FC<DisasterSummaryProps> = ({ disasters }) => {
  // Group by region based on coordinates
  const getRegion = (lat: number, lng: number): string => {
    if (lat > 60) return '🇦🇶 Arctic';
    if (lat > 25 && lng > -130 && lng < -60) return '🇺🇸 North America';
    if (lat > 35 && lng > -20 && lng < 60) return '🇪🇺 Europe & Middle East';
    if (lat > -10 && lng > 60 && lng < 180) return '🌏 Asia Pacific';
    if (lat < -10 && lng > 110 && lng < 180) return '🇦🇺 Australia';
    if (lat < 0 && lng > -80 && lng < -30) return '🇧🇷 South America';
    if (lat > 0 && lng > -20 && lng < 55) return '🌍 Africa';
    return '🌎 Other';
  };

  // Calculate regional statistics
  const regionStats = disasters.reduce((acc, d) => {
    const region = getRegion(d.lat, d.lng);
    if (!acc[region]) {
      acc[region] = { total: 0, fires: 0, volcanoes: 0, earthquakes: 0, highSeverity: 0 };
    }
    acc[region].total++;
    if (d.type === 'fire') acc[region].fires++;
    if (d.type === 'volcano') acc[region].volcanoes++;
    if (d.type === 'earthquake') acc[region].earthquakes++;
    if (d.severity === 'high') acc[region].highSeverity++;
    return acc;
  }, {} as Record<string, any>);

  // Get most recent disasters
  const recent = disasters
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  // Get high severity disasters
  const critical = disasters
    .filter(d => d.severity === 'high')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8);

  // Format time ago
  const getTimeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  };

  return (
    <div className="space-y-4">
      {/* Regional Overview */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <MapPin size={16} className="text-blue-400" />
          <h3 className="font-bold text-white text-sm uppercase tracking-wide">Regional Breakdown</h3>
        </div>
        <div className="space-y-2">
          {Object.entries(regionStats)
            .sort(([, a], [, b]) => (b as any).total - (a as any).total)
            .slice(0, 6)
            .map(([region, stats]: any) => (
              <div key={region} className="bg-gray-800/40 hover:bg-gray-800/60 p-3 rounded-lg border border-white/5 transition-all">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold text-white text-sm">{region}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs font-medium">{stats.total} total</span>
                    {stats.highSeverity > 0 && (
                      <span className="bg-red-500/20 text-red-400 text-xs font-bold px-2 py-0.5 rounded-full border border-red-500/30">
                        ⚠ {stats.highSeverity}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-3 text-xs">
                  {stats.fires > 0 && (
                    <span className="text-red-400 font-medium">🔥 {stats.fires}</span>
                  )}
                  {stats.earthquakes > 0 && (
                    <span className="text-orange-400 font-medium">🌍 {stats.earthquakes}</span>
                  )}
                  {stats.volcanoes > 0 && (
                    <span className="text-orange-500 font-medium">🌋 {stats.volcanoes}</span>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Critical Events */}
      {critical.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-red-400" />
            <h3 className="font-bold text-red-400 text-sm uppercase tracking-wide">Critical Events</h3>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
            {critical.map(d => (
              <div key={d.id} className="bg-red-900/20 hover:bg-red-900/30 p-2.5 rounded-lg border border-red-800/40 transition-all">
                <div className="font-semibold text-red-300 text-sm mb-1 leading-tight">{d.title}</div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">
                    {d.type === 'fire' && '🔥 Wildfire'}
                    {d.type === 'volcano' && '🌋 Volcano'}
                    {d.type === 'earthquake' && '🌍 Earthquake'}
                    {d.magnitude && ` M${d.magnitude.toFixed(1)}`}
                  </span>
                  <span className="text-red-400 font-medium">{getTimeAgo(d.date)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={16} className="text-green-400" />
          <h3 className="font-bold text-white text-sm uppercase tracking-wide">Latest Activity</h3>
        </div>
        <div className="space-y-1.5">
          {recent.map(d => (
            <div key={d.id} className="flex justify-between items-start p-2 bg-gray-800/30 hover:bg-gray-800/50 rounded-lg transition-all">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-white truncate">{d.title}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {d.type === 'fire' && '🔥'}
                  {d.type === 'volcano' && '🌋'}
                  {d.type === 'earthquake' && '🌍'}
                  <span className="ml-1">
                    {d.lat.toFixed(1)}°, {d.lng.toFixed(1)}°
                  </span>
                </div>
              </div>
              <span className="text-xs text-gray-400 ml-2 flex-shrink-0 font-medium">{getTimeAgo(d.date)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Data Freshness Indicator */}
      <div className="pt-3 border-t border-white/10">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500 font-medium">📡 NASA EONET + USGS</span>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-green-400 font-semibold">Live</span>
          </div>
        </div>
      </div>
    </div>
  );
};

