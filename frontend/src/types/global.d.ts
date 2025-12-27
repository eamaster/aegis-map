/**
 * Global Type Definitions
 * Defines types for window globals and debugging utilities
 */

interface AegisDebug {
    log: (category: string, message: string, level: string, data?: any) => void;
}

declare global {
    interface Window {
        aegisDebug?: AegisDebug;
        mapDebug?: any;
    }
}

export { };
