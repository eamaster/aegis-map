import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useDesignSystem } from '../hooks/useDesignSystem';

export default function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();
    const ds = useDesignSystem();

    return (
        <button
            type="button"
            data-testid="theme-toggle-btn"
            onClick={toggleTheme}
            className="min-h-[38px] min-w-[38px] sm:min-h-[40px] sm:min-w-[40px] rounded-lg border flex items-center justify-center transition-colors hover:opacity-90"
            style={{
                background: ds.surface.overlaySubtle,
                borderColor: ds.surface.border,
            }}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
            {theme === 'dark' ? (
                <Sun size={17} style={{ color: '#fbbf24', strokeWidth: 2.5 }} />
            ) : (
                <Moon size={17} style={{ color: '#334155', strokeWidth: 2.5 }} />
            )}
        </button>
    );
}
