import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useDesignSystem } from '../hooks/useDesignSystem';

export default function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();
    const ds = useDesignSystem();

    return (
        <button
            onClick={toggleTheme}
            className="p-2.5 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95 touch-target"
            style={{
                ...ds.glass.accent,
            }}
            aria-label="Toggle theme"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
            {theme === 'dark' ? (
                <Sun size={18} className="text-yellow-400" />
            ) : (
                <Moon size={18} className="text-gray-700" />
            )}
        </button>
    );
}
