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
            }
        },
    },
    plugins: [],
}
