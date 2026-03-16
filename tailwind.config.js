/** @type {import('tailwindcss').Config} */
export default {
    content: ['./src/**/*.html', './src/**/*.{ts,tsx}'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                mm: {
                    bg: 'var(--mm-bg, #1e1e2e)',
                    sidebar: 'var(--mm-sidebar, #282839)',
                    text: 'var(--mm-text, #dddfe4)',
                    textSecondary: 'var(--mm-text-secondary, #999db0)',
                    accent: 'var(--mm-accent, #5d89ea)',
                    accentHover: 'var(--mm-accent-hover, #4a73d1)',
                    border: 'var(--mm-border, #3b3b4f)',
                    input: 'var(--mm-input, #2b2b3d)',
                    hover: 'var(--mm-hover, #32324a)',
                    success: 'var(--mm-success, #3db887)',
                    warning: 'var(--mm-warning, #f5ab00)',
                    error: 'var(--mm-error, #d24b4e)',
                },
            },
        },
    },
    plugins: [],
};
