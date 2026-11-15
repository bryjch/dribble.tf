/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Semantic tokens from src/theme/tokens.css; prefer these over raw colours in overlays.
      colors: {
        'ui-ground': 'rgb(var(--ui-ground) / <alpha-value>)',
        'ui-raised': 'rgb(var(--ui-raised) / <alpha-value>)',
        'ui-line': 'rgb(var(--ui-line) / <alpha-value>)',
        'ui-ink': 'rgb(var(--ui-ink) / <alpha-value>)',
        'ui-ink-muted': 'rgb(var(--ui-ink-muted) / <alpha-value>)',
        'ui-ink-faint': 'rgb(var(--ui-ink-faint) / <alpha-value>)',
        'ui-accent': 'rgb(var(--ui-accent) / <alpha-value>)',
        'ui-accent-ink': 'rgb(var(--ui-accent-ink) / <alpha-value>)',
        'ui-focus': 'rgb(var(--ui-focus) / <alpha-value>)',
        'ui-good': 'rgb(var(--ui-good) / <alpha-value>)',
        'ui-warn': 'rgb(var(--ui-warn) / <alpha-value>)',
        'ui-bad': 'rgb(var(--ui-bad) / <alpha-value>)',
        'team-red': 'rgb(var(--ui-red) / <alpha-value>)',
        'team-blu': 'rgb(var(--ui-blu) / <alpha-value>)',
        'team-red-ink': 'rgb(var(--ui-red-ink) / <alpha-value>)',
        'team-blu-ink': 'rgb(var(--ui-blu-ink) / <alpha-value>)',

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

      borderRadius: {
        panel: 'var(--ui-radius-panel)',
        control: 'var(--ui-radius-control)',
        chip: 'var(--ui-radius-chip)',
      },

      fontFamily: {
        body: 'var(--ui-font-body)',
        hud: 'var(--ui-font-hud)',
        display: 'var(--ui-font-display)',
      },

      keyframes: {},

      animation: {},
    },
  },
  plugins: [],
}
