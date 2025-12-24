import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useDesignSystem } from '../hooks/useDesignSystem';

export default function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();
    const ds = useDesignSystem();

    return (
        <button
            onClick={toggleTheme}
            className="transition-all duration-200 hover:scale-105 active:scale-95"
            style={{
                padding: '10px',
                borderRadius: '10px',
                background: ds.surface.overlaySubtle,
                border: `1px solid ${ds.surface.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}
            aria-label="Toggle theme"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
            {theme === 'dark' ? (
                <Sun size={18} style={{ color: '#fbbf24', strokeWidth: 2.5 }} />
            ) : (
                <Moon size={18} style={{ color: '#374151', strokeWidth: 2.5 }} />
            )}
        </button>
    );
}
