import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';


type Theme = 'light' | 'dark';

interface ThemeContextType {
    theme: Theme;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setTheme] = useState<Theme>(() => {
        // FORCE dark mode on first load, then check localStorage
        const saved = localStorage.getItem('aegis-theme') as Theme;
        // Remove any stored 'light' theme preference on app load
        if (!saved || saved === 'light') {
            localStorage.setItem('aegis-theme', 'dark');
            return 'dark';
        }
        return saved || 'dark';
    });

    useEffect(() => {
        // Apply theme to document
        document.documentElement.setAttribute('data-theme', theme);
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
