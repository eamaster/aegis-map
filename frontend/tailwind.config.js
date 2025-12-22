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
            backdropBlur: {
                xs: '2px',
                sm: '4px',
                md: '12px',
                lg: '16px',
                xl: '24px',
                '2xl': '40px',
                '3xl': '64px',
            },
        },
    },
    plugins: [],
    safelist: [
        // Backdrop blur
        'backdrop-blur-xs',
        'backdrop-blur-sm',
        'backdrop-blur-md',
        'backdrop-blur-lg',
        'backdrop-blur-xl',
        'backdrop-blur-2xl',
        'backdrop-blur-3xl',
        // Opacity patterns
        {
            pattern: /bg-(gray|white|black|blue|purple|red|orange|green|yellow|pink|indigo)-(50|100|200|300|400|500|600|700|800|900)\/(5|10|20|30|40|50|60|70|80|90|95|98)/,
        },
        {
            pattern: /from-(gray|white|black|blue|purple|red|orange|green)-(50|100|200|300|400|500|600|700|800|900)\/(5|10|20|30|40|50|60|70|80|90|95|98)/,
        },
        {
            pattern: /via-(gray|white|black|blue|purple|red|orange|green)-(50|100|200|300|400|500|600|700|800|900)\/(5|10|20|30|40|50|60|70|80|90|95|98)/,
        },
        {
            pattern: /to-(gray|white|black|blue|purple|red|orange|green)-(50|100|200|300|400|500|600|700|800|900)\/(5|10|20|30|40|50|60|70|80|90|95|98)/,
        },
        {
            pattern: /border-(gray|white|black|blue|purple|red|orange)-(50|100|200|300|400|500|600|700|800|900)\/(5|10|20|30|40|50|60|70|80|90|95)/,
        },
        // Gradients
        {
            pattern: /bg-gradient-to-(r|l|t|b|tr|tl|br|bl)/,
        },
        // Shadows
        {
            pattern: /shadow-\[.+\]/,
        },
        // Rounded corners
        'rounded-xl',
        'rounded-2xl',
        'rounded-3xl',
        'rounded-full',
        // Scales
        'scale-95',
        'scale-100',
        'scale-105',
        'scale-110',
        'scale-125',
        // Z-index
        'z-30',
        'z-50',
        'z-[100]',
        'z-[9999]',
        // Min width
        'min-w-0',
        // Flex wrap
        'flex-wrap',
        // Whitespace
        'whitespace-nowrap',
        // Text overflow
        'overflow-hidden',
        'text-ellipsis',
    ],
}
