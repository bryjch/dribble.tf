// Which maps recent demos use that dribble.tf hasn't built: reads demos.tf's public demo list and
// matches each demo's map the way the viewer does (src/utils/mapVersions.ts) against
// public/models/maps/index.json.
//
//   npm run maps:popular -- [--pages 60] [--min-players 8] [--top 20]
//
// --pages: pages of 50 demos to read, newest first (60 is about a week). --min-players: skip
// smaller games (mge, jump, 1v1). Prints coverage, the maps with no 3D map, the versions shown on
// another build, and a build:maps command for the most played of them.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { pickMapVersion } = await import(path.join(repoRoot, 'src/utils/mapVersions.ts'))

const options = { pages: 60, 'min-players': 8, top: 20 }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const key = argv[i].replace(/^--/, '')
  if (!(key in options) || !Number.isFinite(Number(argv[i + 1]))) {
    console.error('usage: popular-maps.mjs [--pages 60] [--min-players 8] [--top 20]')
    process.exit(1)
  }
  options[key] = Number(argv[++i])
}

const API = 'https://api.demos.tf/demos'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const demos = []
for (let page = 1; page <= options.pages; page++) {
  const response = await fetch(`${API}?page=${page}`, {
    headers: { 'user-agent': 'dribble.tf-map-survey' },
  })
  if (!response.ok) {
    console.warn(`page ${page}: HTTP ${response.status}, stopping`)
    break
  }
  const batch = await response.json()
  if (!Array.isArray(batch) || !batch.length) break
  demos.push(...batch)
  process.stderr.write(`\rread ${demos.length} demos`)
  await sleep(300) // a public API: no hurry
}
process.stderr.write('\n')

const games = demos.filter(demo => demo.playerCount >= options['min-players'] && demo.map)
if (!games.length) {
  console.log('No demos to count.')
  process.exit(0)
}
const indexFile = path.join(repoRoot, 'public/models/maps/index.json')
const built = Object.keys(JSON.parse(fs.readFileSync(indexFile, 'utf8')).maps ?? {})

const missing = new Map()
const other = new Map()
let exact = 0
for (const demo of games) {
  const map = demo.map.toLowerCase()
  const picked = pickMapVersion(map, built)
  if (!picked) missing.set(map, (missing.get(map) ?? 0) + 1)
  else if (picked.exact) exact++
  else other.set(map, { count: (other.get(map)?.count ?? 0) + 1, shown: picked.map })
}

const days = times =>
  Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 86400))
const share = count => `${((100 * count) / games.length).toFixed(1)}%`
const otherCount = [...other.values()].reduce((sum, { count }) => sum + count, 0)
const missingCount = games.length - exact - otherCount

console.log(
  `\n${games.length} demos with ${options['min-players']}+ players over ${days(games.map(demo => demo.time))} days, ${built.length} maps built:`
)
console.log(`  exact version   ${String(exact).padStart(5)}  ${share(exact)}`)
console.log(`  another version ${String(otherCount).padStart(5)}  ${share(otherCount)}`)
console.log(`  no 3D map       ${String(missingCount).padStart(5)}  ${share(missingCount)}`)

const top = entries => entries.sort((a, b) => b[1] - a[1]).slice(0, options.top)
const missingTop = top([...missing])
const otherTop = top([...other].map(([map, { count, shown }]) => [map, count, shown]))

console.log('\nNo 3D map:')
for (const [map, count] of missingTop) console.log(`  ${String(count).padStart(5)}  ${map}`)
if (!missingTop.length) console.log('  (none)')

console.log('\nShown on another version (building the exact one is closer):')
for (const [map, count, shown] of otherTop)
  console.log(`  ${String(count).padStart(5)}  ${map} (shows ${shown})`)
if (!otherTop.length) console.log('  (none)')

const suggest = [...missingTop, ...otherTop]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([map]) => map)
if (suggest.length) console.log(`\nTo build the 10 most played of those:\n  npm run build:maps -- ${suggest.join(' ')}`)
