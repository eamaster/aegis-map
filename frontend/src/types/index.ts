/**
 * Type definitions for AegisMap
 */

export interface Disaster {
    id: string;
    type: 'fire' | 'volcano' | 'earthquake';
    title: string;
    lat: number;
    lng: number;
    date: string;
    severity: 'low' | 'medium' | 'high';
    magnitude?: number; // For earthquakes
}

export type DisasterSourceState = 'ok' | 'failed' | 'malformed';

/** Parsed from the X-Disaster-Sources response header ("eonet=ok;usgs=failed"). */
export interface DisasterSourceStatus {
    eonet: DisasterSourceState | 'unknown';
    usgs: DisasterSourceState | 'unknown';
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
