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
    cloudCover: number;
}

export interface AIAnalysisResponse {
    analysis: string;
}
