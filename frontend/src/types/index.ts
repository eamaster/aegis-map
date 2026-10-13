/**
 * Type definitions for AegisMap
 */

export type ObservationWindow = '24h' | '7d';
export type VolcanoMode = 'context' | 'strict';

export type DetectionIntensity = 'low' | 'medium' | 'high';

export interface FireDetectionCell {
    cellId: string;
    lat: number;
    lng: number;
    bounds: [number, number, number, number]; // [west, south, east, north]
    detectionCount: number;
    maxFrp: number | null;
    avgFrp: number | null;
    maxBrightTi4: number | null;
    latestAcqTime: string; // ISO UTC string
    confidenceCounts: {
        high: number;
        nominal: number;
        low: number;
        unknown: number;
    };
    dayNightCounts: {
        day: number;
        night: number;
        unknown: number;
    };
    satelliteCounts: Record<string, number>;
    intensity: DetectionIntensity;
}

export interface Disaster {
    id: string;
    type: 'fire' | 'volcano' | 'earthquake' | 'fire_detection';
    title: string;
    lat: number;
    lng: number;
    date: string;
    severity: 'low' | 'medium' | 'high';
    magnitude?: number; // For earthquakes
    areaAcres?: number; // For wildfires (EONET size)
    detectionCell?: FireDetectionCell; // For satellite fire detections
    isHistoricalContext?: boolean; // For open volcanoes outside strict window
}

export interface DisastersV2Response {
    version: 2;
    window: ObservationWindow;
    windowRange: {
        startInclusive: string;
        endExclusive: string;
    };
    summary: {
        namedFires: number;
        fireDetections: number;
        fireCells: number;
        earthquakes: number;
        volcanoes: number;
    };
    wildfires: Disaster[];
    fireCells: FireDetectionCell[];
    earthquakes: Disaster[];
    volcanoes: Disaster[];
    sources: {
        eonet: { status: DisasterSourceState; count: number; rejected: number };
        usgs: { status: DisasterSourceState; count: number; rejected: number };
        firms: {
            status: 'ok' | 'stale' | 'partial' | 'unavailable';
            generatedAt: string;
            isLkgFallback?: boolean;
            sensors: Record<string, { status: string; rawRows: number; acceptedRows: number }>;
            accounting: {
                rawRows: number;
                malformedRows: number;
                outOfWindowRows: number;
                duplicateRows: number;
                acceptedDetections: number;
            };
        };
    };
    fetchedAt: string;
}

export type DisasterSourceState = 'ok' | 'failed' | 'malformed';

/** Parsed from the X-Disaster-Sources response header ("eonet=ok;usgs=failed"). */
export interface DisasterSourceStatus {
    eonet: DisasterSourceState | 'unknown';
    usgs: DisasterSourceState | 'unknown';
    firms?: 'ok' | 'stale' | 'partial' | 'unavailable' | 'unknown';
    partial: boolean;
}

/** One FIRMS VIIRS detection as returned by /api/fire-hotspots (missing values are null). */
export interface FireHotspot {
    latitude: number;
    longitude: number;
    bright_ti4: number | null;
    bright_ti5: number | null;
    scan: number | null;
    track: number | null;
    acq_date: string;
    acq_time: string;
    satellite: string;
    confidence: 'l' | 'n' | 'h' | null;
    version: string | null;
    frp: number | null;
    daynight: 'D' | 'N' | null;
}

export type FirmsWindowStatus = 'ok' | 'http_error' | 'timeout' | 'network_error' | 'malformed';

export interface FirmsWindowResult {
    id: 'recent' | 'prior';
    startDate: string;
    endDate: string;
    dayRange: number;
    status: FirmsWindowStatus;
    httpStatus?: number;
    detections: number;
    rejectedRows: number;
}

/** 'unavailable' only arrives on the 502 error body, never on a 200 payload. */
export interface FirmsCoverage {
    status: 'complete' | 'partial' | 'unavailable';
    timezone: 'UTC';
    requestedStart: string;
    requestedEnd: string;
    missingDates: string[];
    windows: FirmsWindowResult[];
}

export interface FireHotspotsPayload {
    hotspots: FireHotspot[];
    totalCount: number;
    highConfidence: number;
    nominalConfidence: number;
    lowConfidence: number;
    unknownConfidence: number;
    maxBrightness: number | null;
    maxPower: number | null;
    source: string;
    sensor: string;
    coverage: FirmsCoverage;
}

export interface WeatherData {
    hourly: {
        time: string[];
        cloud_cover: number[];
    };
}

export interface AIAnalysisRequest {
    disasterTitle: string;
    satelliteName: string;
    passTime: string;
    /** Known cover [0,100], or null when weather data is unavailable. */
    cloudCover: number | null;
    disasterType: Disaster['type'];
    lat?: number;
    lng?: number;
    maxElevationDeg?: number;
}

export interface AIAnalysisResponse {
    analysis?: string;
    cached?: boolean;
    source?: 'workers-ai';
    error?: string;
    code?: string;
    message?: string;
    details?: {
        error?: string;
    };
}
