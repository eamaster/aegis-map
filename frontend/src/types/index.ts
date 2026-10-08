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
