/**
 * useDesignSystem Hook
 * Provides theme-aware access to the centralized design system
 */

import { useTheme } from '../contexts/ThemeContext';
import {
    getGlassStyle,
    getResponsiveTextSize,
    getHeaderBorderColor,
    getAccentGradient,
    DESIGN_SYSTEM,
    type TypographyVariant,
} from '../constants/designSystem';

export function useDesignSystem() {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const themeKey = isDark ? 'dark' : 'light';

    return {
        // Theme state
        isDark,
        theme,

        // Pre-computed glass styles for current theme
        glass: {
            panel: getGlassStyle('panel', isDark),
            card: getGlassStyle('card', isDark),
            accent: getGlassStyle('accent', isDark),
        },

        // Helper function for custom glass variants
        getGlass: (variant: 'panel' | 'card' | 'accent') => getGlassStyle(variant, isDark),

        // Typography helper
        getTextSize: (variant: TypographyVariant) => getResponsiveTextSize(variant),

        // Header-specific helpers
        headerBorderColor: getHeaderBorderColor(isDark),
        accentGradient: getAccentGradient(isDark),

        // ✅ Theme-aware text colors from design system
        text: DESIGN_SYSTEM.text[themeKey],

        // ✅ Theme-aware surface colors from design system
        surface: DESIGN_SYSTEM.surface[themeKey],

        // Static tokens (not theme-dependent)
        dimensions: DESIGN_SYSTEM.dimensions,
        breakpoints: DESIGN_SYSTEM.breakpoints,
        typography: DESIGN_SYSTEM.typography,
        borderRadius: DESIGN_SYSTEM.borderRadius,
        colors: DESIGN_SYSTEM.colors,
        shadows: DESIGN_SYSTEM.shadows,
        animation: DESIGN_SYSTEM.animation,
        transitions: DESIGN_SYSTEM.transitions,
    };
}

// Re-export types for convenience
export type { TypographyVariant } from '../constants/designSystem';
