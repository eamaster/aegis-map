/**
 * AegisMap Design System
 * Centralized constants for consistent UI across all components
 */

export const DESIGN_SYSTEM = {
    // ===== SPACING =====
    spacing: {
        header: {
            height: '56px',
            padding: '8px 24px',
        },
        sidebar: {
            width: '420px',
            padding: '20px',
        },
        legend: {
            width: '280px',
            padding: '20px',
        },
    },

    // ===== BORDER RADIUS =====
    borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        xxl: '24px',
        full: '9999px',
    },

    // ===== SHADOWS =====
    shadows: {
        sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
        md: '0 4px 6px rgba(0, 0, 0, 0.1)',
        lg: '0 10px 15px rgba(0, 0, 0, 0.15)',
        xl: '0 20px 25px rgba(0, 0, 0, 0.2)',
        glow: {
            blue: '0 0 20px rgba(59, 130, 246, 0.3)',
            purple: '0 0 20px rgba(147, 51, 234, 0.3)',
            green: '0 0 12px rgba(74, 222, 128, 0.5)',
        },
    },

    // ===== COLORS =====
    colors: {
        disaster: {
            fire: '#ef4444',
            volcano: '#f97316',
            earthquake: '#f59e0b',
        },
        status: {
            success: '#10b981',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6',
        },
    },

    // ===== ANIMATIONS =====
    transitions: {
        fast: '150ms',
        normal: '200ms',
        slow: '300ms',
    },
} as const;

// Helper function to get glass style based on theme
export const getGlassStyle = (isDark: boolean) => ({
    background: isDark ? 'rgba(17, 24, 39, 0.85)' : 'rgba(255, 255, 255, 0.85)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
});
