/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#1c1917', soft: '#44403c', mute: '#78716c' },
        paper: { DEFAULT: '#faf8f4', raised: '#ffffff', sunk: '#f1ede6' },
        line: '#e4ddd2',
        accent: { DEFAULT: '#b45309', soft: '#fde8cd', deep: '#92400e' },
        good: '#15803d',
        warn: '#b45309',
        bad: '#b91c1c',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(28,25,23,0.06), 0 1px 1px rgba(28,25,23,0.04)',
        pop: '0 8px 24px rgba(28,25,23,0.14)',
      },
    },
  },
  plugins: [],
};
