//
// ─── THEMES ─────────────────────────────────────────────────────────────────────
//
// Every overlay is drawn from the semantic tokens in tokens.css and the component hooks in
// base.css (`.hud-player`, `.ui-panel`, ...). A theme is a stylesheet that redefines those
// tokens under `html[data-theme='<id>']`, and may restyle any hook. Components never name a
// theme; switching one is setting an attribute, the way a custom HUD replaces TF2's .res files
// without touching the game.
//
// A theme is picked from Settings, or with ?theme=<id> in the URL (which is then remembered).
//

export type ThemeId = 'modern' | 'mannco' | 'legacy'

export interface ThemeDefinition {
  id: ThemeId
  label: string
  /** Fonts the theme draws with, fetched only when it is first used. */
  loadFonts?: () => Promise<unknown>
}

/** In the order Settings lists them. */
export const THEMES: ThemeDefinition[] = [
  {
    // Flat comp-HUD bars after stv.tf: dense, condensed, numbers first (modern.css).
    id: 'modern',
    label: 'Modern',
    loadFonts: () => import('@fontsource-variable/roboto-condensed'),
  },
  {
    // TF2's own HUD and menus: TanLight on TanDarker, chunky type (mannco.css).
    id: 'mannco',
    label: 'Mann Co.',
    loadFonts: () => import('@fontsource-variable/rubik'),
  },
  {
    // dribble.tf as it looked before themes: the token defaults in tokens.css, no stylesheet.
    id: 'legacy',
    label: 'Legacy',
  },
]

/** Anything without a valid saved theme, including the old 'scrim' and 'classic', gets this. */
export const DEFAULT_THEME: ThemeId = 'modern'

export const isThemeId = (value: unknown): value is ThemeId =>
  typeof value === 'string' && THEMES.some(theme => theme.id === value)

/** ?theme=<id>, if the URL names one. */
export const getThemeFromUrl = (): ThemeId | null => {
  const value = new URLSearchParams(window.location.search).get('theme')
  return isThemeId(value) ? value : null
}

const loadedFonts = new Set<ThemeId>()

export const applyTheme = (id: ThemeId | undefined) => {
  // A saved theme that no longer exists falls back to the default.
  const theme = THEMES.find(t => t.id === id) ?? THEMES.find(t => t.id === DEFAULT_THEME)!
  document.documentElement.dataset.theme = theme.id

  if (theme.loadFonts && !loadedFonts.has(theme.id)) {
    loadedFonts.add(theme.id)
    theme.loadFonts().catch(error => console.error(`Fonts for ${theme.id} failed to load`, error))
  }
}
