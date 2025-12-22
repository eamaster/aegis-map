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
        // Component-specific
        panel: '0px',      // Sharp corners for panels like MapLegend
        card: '16px',      // rounded-2xl for cards
        button: '12px',    // rounded-xl for buttons
        pill: '9999px',    // rounded-full
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
        // Brand accent color
        accent: {
            blue: 'rgb(59, 130, 246)',
            blueLight: 'rgb(96, 165, 250)',
            blueDim: 'rgba(59, 130, 246, 0.2)',
        },
    },

    // ===== GLASS MORPHISM PRESETS =====
    glass: {
        panel: {
            dark: {
                background: 'rgba(17, 24, 39, 0.95)',
                backdropFilter: 'blur(32px)',
                WebkitBackdropFilter: 'blur(32px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
            },
            light: {
                background: 'rgba(255, 255, 255, 0.95)',
                backdropFilter: 'blur(32px)',
                WebkitBackdropFilter: 'blur(32px)',
                border: '1px solid rgba(0, 0, 0, 0.1)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)',
            },
        },
        card: {
            dark: {
                background: 'rgba(30, 41, 59, 0.7)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            },
            light: {
                background: 'rgba(248, 250, 252, 0.7)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(0, 0, 0, 0.05)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.1)',
            },
        },
        accent: {
            dark: {
                background: 'rgba(59, 130, 246, 0.15)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                boxShadow: '0 4px 16px rgba(59, 130, 246, 0.25)',
            },
            light: {
                background: 'rgba(59, 130, 246, 0.1)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
                boxShadow: '0 4px 16px rgba(59, 130, 246, 0.15)',
            },
        },
    },

    // ===== RESPONSIVE BREAKPOINTS =====
    breakpoints: {
        mobile: '640px',
        tablet: '768px',
        desktop: '1024px',
        wide: '1280px',
    },

    // ===== COMPONENT DIMENSIONS (RESPONSIVE) =====
    dimensions: {
        header: {
            height: { mobile: '56px', desktop: '64px' },
        },
        sidebar: {
            width: { mobile: '100vw', tablet: '420px', desktop: '480px' },
        },
        legend: {
            width: { mobile: '90vw', tablet: '320px' },
        },
    },

    // ===== TYPOGRAPHY SCALE =====
    typography: {
        hero: { mobile: '2.5rem', desktop: '3.75rem' },     // 40px / 60px
        h1: { mobile: '1.5rem', desktop: '2rem' },          // 24px / 32px
        h2: { mobile: '1.25rem', desktop: '1.5rem' },       // 20px / 24px
        body: { mobile: '0.875rem', desktop: '1rem' },      // 14px / 16px
        caption: { mobile: '0.75rem', desktop: '0.875rem' }, // 12px / 14px
    },

    // ===== ANIMATIONS =====
    transitions: {
        fast: '150ms',
        normal: '200ms',
        slow: '300ms',
    },

    animation: {
        slideIn: 'cubic-bezier(0.16, 1, 0.3, 1)',
        smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
        bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
    },
} as const;

// ===== HELPER FUNCTIONS =====

/**
 * Get glass style preset based on variant and theme
 */
export function getGlassStyle(
    variant: 'panel' | 'card' | 'accent',
    isDark: boolean
): React.CSSProperties {
    const theme = isDark ? 'dark' : 'light';
    return DESIGN_SYSTEM.glass[variant][theme];
}

/**
 * Get responsive text size as CSS properties with clamp
 */
export function getResponsiveTextSize(
    variant: keyof typeof DESIGN_SYSTEM.typography
): React.CSSProperties {
    const { mobile, desktop } = DESIGN_SYSTEM.typography[variant];
    return {
        fontSize: `clamp(${mobile}, 3vw, ${desktop})`,
    };
}

/**
 * Get header border color based on theme
 */
export function getHeaderBorderColor(isDark: boolean): string {
    return isDark ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.15)';
}

/**
 * Get accent gradient background for headers/overlays
 */
export function getAccentGradient(isDark: boolean): string {
    if (isDark) {
        return 'linear-gradient(135deg, rgba(10, 15, 28, 0.98) 0%, rgba(17, 24, 39, 0.98) 100%)';
    }
    return 'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.98) 100%)';
}

// Type exports for TypeScript
export type GlassVariant = 'panel' | 'card' | 'accent';
export type TypographyVariant = keyof typeof DESIGN_SYSTEM.typography;
