/**
 * Development-only debug logger
 * Prevents debug overhead in production builds
 */
export const debugLog = (
    category: string,
    message: string,
    level: string = 'info',
    data?: any
) => {
    if (import.meta.env.DEV && window.aegisDebug) {
        window.aegisDebug.log(category, message, level, data);
    }
};
