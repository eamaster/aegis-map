/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                disaster: {
                    fire: '#FF4444',
                    volcano: '#FF6B35',
                    earthquake: '#FF8C00',
                }
            },
            // ✅ Add custom backdrop blur
            backdropBlur: {
                '2xl': '40px',
            },
        },
    },
    plugins: [],
    // ✅ CRITICAL: Explicit safelist for ALL glassmorphism classes
    safelist: [
        // === BACKDROP BLUR (CRITICAL) ===
        'backdrop-blur-xl',
        'backdrop-blur-2xl',
        'backdrop-blur-sm',
        'backdrop-blur-md',

        // === OPACITY BACKGROUNDS ===
        'bg-gray-900/40',
        'bg-gray-900/50',
        'bg-gray-900/60',
        'bg-gray-900/95',
        'bg-gray-800/50',
        'bg-gray-800/60',
        'bg-gray-800/30',
        'bg-blue-500/10',
        'bg-blue-500/20',
        'bg-blue-600/20',
        'bg-purple-500/10',
        'bg-purple-500/20',
        'bg-purple-600/20',
        'bg-red-600/30',
        'bg-red-500/30',
        'bg-orange-600/30',
        'bg-orange-500/30',
        'bg-white/5',
        'bg-white/10',
        'bg-white/20',

        // === BORDER OPACITY ===
        'border-white/10',
        'border-white/20',
        'border-red-400/60',
        'border-orange-400/60',
        'border-orange-500/60',
        'border-blue-400/30',

        // === TEXT OPACITY ===
        'text-white/80',

        // === GRADIENT DIRECTIONS ===
        'bg-gradient-to-r',
        'bg-gradient-to-br',
        'bg-gradient-to-tr',
        'bg-gradient-to-tl',

        // === GRADIENT COLORS ===
        'from-gray-900/50',
        'from-gray-800/60',
        'from-blue-600/30',
        'from-blue-500/20',
        'from-blue-500/10',
        'from-purple-500/10',
        'from-red-600/30',
        'from-orange-600/30',
        'from-white',
        'from-blue-100',
        'via-gray-800/50',
        'via-gray-900/60',
        'via-blue-600/20',
        'via-purple-500/20',
        'via-purple-500/10',
        'via-purple-600/20',
        'via-red-500/30',
        'via-red-600/30',
        'via-orange-500/30',
        'via-blue-100',
        'to-gray-900/50',
        'to-gray-800/60',
        'to-blue-600/30',
        'to-blue-500/20',
        'to-red-600/30',
        'to-orange-600/30',
        'to-transparent',
        'to-purple-100',

        // === ROUNDED CORNERS ===
        'rounded-xl',
        'rounded-2xl',
        'rounded-3xl',
        'rounded-full',
        'rounded-b-3xl',

        // === SCALE TRANSFORMS ===
        'scale-102',
        'scale-105',
        'scale-125',

        // === BLUR ===
        'blur-xl',
        'blur-3xl',

        // === TEXT SIZES ===
        'text-6xl',

        // === BG CLIP TEXT ===
        'bg-clip-text',
        'text-transparent',

        // === TRACKING ===
        'tracking-tight',
        'tracking-[0.2em]',
        'tracking-[0.15em]',

        // === DROP SHADOW ===
        'drop-shadow-[0_2px_8px_rgba(255,255,255,0.3)]',
        'drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]',

        // === CUSTOM SHADOWS (ARBITRARY VALUES) ===
        'shadow-[0_8px_32px_rgba(0,0,0,0.4)]',
        'shadow-[0_0_12px_rgba(74,222,128,0.8)]',
        'shadow-[0_0_12px_rgba(74,222,128,0.9)]',
        'shadow-[0_20px_60px_rgba(0,0,0,0.6)]',
        'shadow-[0_0_16px_rgba(239,68,68,1)]',
        'shadow-[0_0_16px_rgba(255,140,0,1)]',
        'shadow-[0_0_16px_rgba(255,107,53,1)]',
        'shadow-[0_0_20px_rgba(239,68,68,0.4)]',
        'shadow-[0_0_20px_rgba(255,140,0,0.4)]',
        'shadow-[0_0_20px_rgba(255,107,53,0.4)]',

        // === Z-INDEX ===
        'z-30',
        'z-50',
        'z-10',

        // === OPACITY ===
        'opacity-60',
        'opacity-75',
        'opacity-100',

        // === HOVER STATES ===
        'hover:bg-gray-900/60',
        'hover:bg-white/10',
        'hover:bg-white/20',
        'hover:bg-blue-500/20',
        'hover:text-white',
        'hover:text-blue-300',
        'hover:text-gray-400',
        'hover:opacity-100',
        'hover:border-white/20',
        'hover:scale-105',

        // === GROUP HOVER ===
        'group-hover:bg-gray-500',
        'group-hover:text-gray-400',
    ],
}
