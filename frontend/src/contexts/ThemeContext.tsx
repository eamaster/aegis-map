import { createContext, useContext, useState, useEffect, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';


type Theme = 'light' | 'dark';

interface ThemeContextType {
    theme: Theme;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setTheme] = useState<Theme>(() => {
        // Enforce dark as the initial theme; respect saved value only if valid
        const saved = localStorage.getItem('aegis-theme') as Theme | null;
        return saved === 'light' || saved === 'dark' ? saved : 'dark';
    });

    // Apply theme to the document immediately to avoid a flash of incorrect theme
    useLayoutEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        document.body.setAttribute('data-theme', theme);
    }, [theme]);

    useEffect(() => {
        // Persist theme and ensure any late-loaded components see it
        document.documentElement.setAttribute('data-theme', theme);
        document.body.setAttribute('data-theme', theme);
        localStorage.setItem('aegis-theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'dark' ? 'light' : 'dark');
    };

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) throw new Error('useTheme must be used within ThemeProvider');
    return context;
}
