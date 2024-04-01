/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'pp-panel': 'rgb(var(--pp-panel) / <alpha-value>)',
        'pp-accent-primary': 'rgb(var(--pp-accent-primary) / <alpha-value>)',
        'pp-accent-secondary': 'rgb(var(--pp-accent-secondary) / <alpha-value>)',
        'pp-killfeed-text-blue': 'rgb(var(--pp-killfeed-text-blue) / <alpha-value>)',
        'pp-killfeed-text-red': 'rgb(var(--pp-killfeed-text-red) / <alpha-value>)',
      },
    },
  },
  plugins: [],
}
