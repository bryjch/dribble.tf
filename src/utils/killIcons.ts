import { KILL_ICON_ALIASES } from '@constants/killIconAliases'

// Every kill icon, resolved at build time.
//
// The killfeeds used to build each URL with
// `new URL(`/src/assets/kill_icons/${name}.png`, import.meta.url)`. Vite compiles that template
// into a lookup table over the folder, and a weapon with no icon looks up `undefined` - so the
// browser requested `/assets/undefined` (a 404 for every such kill) before the <img> error
// handler swapped in the skull. Looking the icon up here picks the skull with no request.
const icons = import.meta.glob('/src/assets/kill_icons/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const SKULL = icons['/src/assets/kill_icons/skull.png']

const reportedMissing = new Set<string>()

/** The kill icon for a weapon as the demo names it, or the skull when there is none. */
export const killIconUrl = (weapon: string): string => {
  const name = KILL_ICON_ALIASES[weapon] || weapon
  const url = icons[`/src/assets/kill_icons/${name}.png`]
  if (url) return url
  if (import.meta.env.DEV && !reportedMissing.has(name)) {
    reportedMissing.add(name)
    console.log(`Missing kill icon: ${name}`)
  }
  return SKULL
}
