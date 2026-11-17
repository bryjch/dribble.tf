// Writes src/components/Debug/itemNames.json: every TF2 weapon's name and slot per class, read
// from items_game.txt, for the /debug page's viewmodel browser. The viewmodel manifest
// (public/models/viewmodels/manifest.json) only has item definition indexes; this names them,
// and lists the weapons that have no viewmodel built, so the browser can flag them.
//
//   node scripts/debug/item-names.mjs [--game-dir <tf>]
//
// game-dir defaults to scripts/convert-config.json's, as build-viewmodels.mjs reads it.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseKeyValues } from '../viewmodels/keyvalues.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const at = args.indexOf('--game-dir')
const configFile = path.join(repoRoot, 'scripts/convert-config.json')
const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {}
const gameDir = at >= 0 ? args[at + 1] : config['game-dir']
const itemsFile = path.join(gameDir ?? '', 'scripts/items/items_game.txt')
if (!gameDir || !fs.existsSync(itemsFile)) {
  console.error(`items_game.txt not found under ${gameDir}: pass --game-dir <tf>`)
  process.exit(1)
}

const CLASSES = [
  'scout',
  'soldier',
  'pyro',
  'demoman',
  'heavy',
  'engineer',
  'medic',
  'sniper',
  'spy',
]
const isObject = v => v && typeof v === 'object'
const deepMerge = (base, over) => {
  const out = { ...base }
  for (const [k, v] of Object.entries(over))
    out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k], v) : v
  return out
}
// The same prefab resolution as build-viewmodels.mjs.
function resolvePrefabs(item, prefabs, seen = new Set()) {
  let base = {}
  for (const name of String(item.prefab ?? '')
    .split(/\s+/)
    .filter(Boolean)) {
    const prefab = prefabs[name.toLowerCase()]
    if (!prefab || seen.has(name)) continue
    base = deepMerge(base, resolvePrefabs(prefab, prefabs, new Set([...seen, name])))
  }
  const { prefab: _, ...own } = item
  return deepMerge(base, own)
}

// Stock weapons are named by their TF_WEAPON_ token; these read as the game shows them.
const STOCK_NAMES = {
  ROCKETLAUNCHER: 'Rocket Launcher',
  GRENADELAUNCHER: 'Grenade Launcher',
  PIPEBOMBLAUNCHER: 'Stickybomb Launcher',
  SYRINGEGUN_MEDIC: 'Syringe Gun',
  MEDIGUN: 'Medi Gun',
  SNIPERRIFLE: 'Sniper Rifle',
  SMG: 'SMG',
  CLUB: 'Kukri',
  FIREAXE: 'Fire Axe',
  PISTOL_SCOUT: 'Pistol',
  SHOTGUN_SOLDIER: 'Shotgun',
  SHOTGUN_PYRO: 'Shotgun',
  SHOTGUN_HWG: 'Shotgun',
  SHOTGUN_PRIMARY: 'Shotgun',
  PDA_ENGINEER_BUILD: 'Construction PDA',
  PDA_ENGINEER_DESTROY: 'Destruction PDA',
  BUILDER: 'Toolbox',
  BUILDER_SPY: 'Sapper',
  PDA_SPY: 'Disguise Kit',
  INVIS: 'Invisibility Watch',
}

/** "TF_WEAPON_BAT" -> "Bat", "Upgradeable TF_WEAPON_BAT" -> "Bat (upgradeable)", "The X" -> "X". */
function displayName(raw) {
  const name = String(raw ?? '').trim()
  const stock = name.match(/^(Upgradeable )?TF_WEAPON_(\w+)$/i)
  if (stock) {
    const token = stock[2].toUpperCase()
    const words = token.toLowerCase().split('_')
    const pretty = STOCK_NAMES[token] ?? words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
    return stock[1] ? `${pretty} (upgradeable)` : pretty
  }
  return name.replace(/^The /, '').replace(/_/g, ' ')
}

const itemsGame = parseKeyValues(fs.readFileSync(itemsFile, 'utf8')).items_game
const prefabs = itemsGame.prefabs ?? {}
const out = {}
for (const [id, raw] of Object.entries(itemsGame.items ?? {})) {
  if (id === 'default') continue
  const item = resolvePrefabs(raw, prefabs)
  if (!/^tf_weapon_|^saxxy$/.test(String(item.item_class ?? ''))) continue
  const usedBy = isObject(item.used_by_classes) ? item.used_by_classes : {}
  const slots = {}
  for (const [cls, value] of Object.entries(usedBy)) {
    if (CLASSES.includes(cls)) slots[cls] = value !== '1' ? value : (item.item_slot ?? 'primary')
  }
  if (Object.keys(slots).length) out[id] = [displayName(item.name), slots]
}

const file = path.join(repoRoot, 'src/components/Debug/itemNames.json')
fs.writeFileSync(file, JSON.stringify(out) + '\n')
console.log(`Wrote ${Object.keys(out).length} weapons to ${path.relative(repoRoot, file)}`)
