/**
 * Global Type Definitions
 * Defines types for window globals and debugging utilities
 */

export interface AegisDebug {
    log: (category: string, message: string, level: string, data?: unknown) => void;
}

declare global {
    interface Window {
        aegisDebug?: AegisDebug;
        mapDebug?: unknown;
        selectDisasterDebug?: (disaster: unknown) => void;
    }
}

export {};
