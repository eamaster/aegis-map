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
    // ✅ CRITICAL: Safelist for glassmorphism classes
    safelist: [
        // Backdrop blur utilities
        'backdrop-blur-xl',
        'backdrop-blur-2xl',
        'backdrop-blur-sm',
        'backdrop-blur-md',
        // Custom shadows
        {
            pattern: /shadow-\[.+\]/,
        },
        // Scale transforms
        {
            pattern: /scale-(102|105|125)/,
        },
        // Gradients
        {
            pattern: /bg-gradient-to-(r|br|tr|tl|b|t|l)/,
        },
        {
            pattern: /from-(gray|blue|purple|red|orange)-(100|200|300|400|500|600|700|800|900)/,
        },
        {
            pattern: /via-(gray|blue|purple|red|orange)-(100|200|300|400|500|600|700|800|900)/,
        },
        {
            pattern: /to-(gray|blue|purple|red|orange)-(100|200|300|400|500|600|700|800|900)/,
        },
        // Opacity classes for arbitrary values
        {
            pattern: /(bg|border|text)-(gray|white|black|blue|red|orange)-(100|200|300|400|500|600|700|800|900)\/\d+/,
        },
        // Rounded corners
        {
            pattern: /rounded-(xl|2xl|3xl)/,
        },
        // Custom tracking
        {
            pattern: /tracking-\[.+\]/,
        },
    ],
}
