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
        },
    },
    plugins: [],
    // ✅ CRITICAL: Force Tailwind to generate ALL glassmorphism classes
    // This is the KEY FIX - without this, Tailwind purges these classes
    safelist: [
        // Backdrop blur (MUST be safelisted)
        'backdrop-blur-sm',
        'backdrop-blur-md',
        'backdrop-blur-lg',
        'backdrop-blur-xl',
        'backdrop-blur-2xl',
        // ALL glassmorphism patterns
        { pattern: /backdrop-blur-.+/ },
        { pattern: /bg-(gray|white|blue|purple|red|orange)-(100|200|300|400|500|600|700|800|900)\/\d+/ },
        { pattern: /from-(gray|white|blue|purple|red|orange)-(100|200|300|400|500|600|700|800|900)\/\d+/ },
        { pattern: /via-(gray|white|blue|purple|red|orange)-(100|200|300|400|500|600|700|800|900)\/\d+/ },
        { pattern: /to-(gray|white|blue|purple|red|orange)-(100|200|300|400|500|600|700|800|900)\/\d+/ },
        { pattern: /border-(gray|white|blue|purple|red|orange)-(100|200|300|400|500|600|700|800|900)\/\d+/ },
        { pattern: /shadow-\[.+\]/ },
        { pattern: /rounded-(xl|2xl|3xl)/ },
        { pattern: /tracking-\[.+\]/ },
        { pattern: /bg-gradient-to-(r|br|tr|tl|b|t|l)/ },
        { pattern: /scale-(102|105|110|125)/ },
    ],
}
