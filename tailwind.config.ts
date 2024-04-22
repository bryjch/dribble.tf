/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'pp-panel': 'rgb(var(--pp-panel) / <alpha-value>)',
        'pp-accent-primary': 'rgb(var(--pp-accent-primary) / <alpha-value>)',
        'pp-accent-secondary': 'rgb(var(--pp-accent-secondary) / <alpha-value>)',
        'pp-accent-tertiary': 'rgb(var(--pp-accent-tertiary) / <alpha-value>)',

        'pp-actor-model-blue': 'rgb(var(--pp-actor-model-blue) / <alpha-value>)',
        'pp-actor-model-red': 'rgb(var(--pp-actor-model-red) / <alpha-value>)',
        'pp-pipebomb-blue': 'rgb(var(--pp-pipebomb-blue) / <alpha-value>)',
        'pp-pipebomb-red': 'rgb(var(--pp-pipebomb-red) / <alpha-value>)',
        'pp-stickybomb-blue': 'rgb(var(--pp-stickybomb-blue) / <alpha-value>)',
        'pp-stickybomb-red': 'rgb(var(--pp-stickybomb-red) / <alpha-value>)',

        'pp-killfeed-text-blue': 'rgb(var(--pp-killfeed-text-blue) / <alpha-value>)',
        'pp-killfeed-text-red': 'rgb(var(--pp-killfeed-text-red) / <alpha-value>)',
        'pp-focused-background-blue': 'rgb(var(--pp-focused-background-blue) / <alpha-value>)',
        'pp-focused-background-red': 'rgb(var(--pp-focused-background-red) / <alpha-value>)',
        'pp-healthbar-blue': 'rgb(var(--pp-healthbar-blue) / <alpha-value>)',
        'pp-healthbar-red': 'rgb(var(--pp-healthbar-red) / <alpha-value>)',
        'pp-health-overhealed': 'rgb(var(--pp-health-overhealed) / <alpha-value>)',
        'pp-health-low': 'rgb(var(--pp-health-low) / <alpha-value>)',
      },

      keyframes: {},

      animation: {},
    },
  },
  plugins: [],
}
