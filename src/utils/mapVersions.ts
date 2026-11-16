//
// ─── MAP VERSIONS ───────────────────────────────────────────────────────────────
//
// Demos name the exact map version a server ran (cp_process_f12, koth_bagel_rc11), and maps are
// built per version. A Map Family is a name without its version (cp_process, koth_bagel); a demo
// whose version wasn't built is shown on the nearest built version of its family.
//

/** Stages in release order, by the letters a version token starts with. */
const STAGES: Record<string, number> = {
  a: 1,
  alpha: 1,
  pre: 2,
  preb: 2,
  b: 3,
  beta: 3,
  rc: 4,
  f: 5,
  final: 5,
  v: 5,
  u: 6,
}

const VERSION_TOKEN = /^(a|alpha|pre|preb|b|beta|rc|f|final|v|u)(\d+[a-z]?\d*)?$/

/** Whether a name token is a version: f12, rc17a3, b8a, final, final1, u13, v1. */
const isVersionToken = (token: string): boolean => {
  const match = VERSION_TOKEN.exec(token)
  // A bare stage letter is a word (koth_a_b?), except "final".
  return Boolean(match) && (Boolean(match![2]) || match![1] === 'final')
}

/** The map's name without its version: cp_process_f12 -> cp_process, cp_sunshine -> cp_sunshine. */
export function mapFamily(mapName: string): string {
  const tokens = mapName.toLowerCase().split('_')
  while (tokens.length > 2 && isVersionToken(tokens[tokens.length - 1])) tokens.pop()
  return tokens.join('_')
}

/**
 * A comparable rank for a map's version: [stage, ...numbers]. A name with no version (an
 * official map such as cp_sunshine) ranks above every staged one.
 */
export function versionRank(mapName: string): number[] {
  const family = mapFamily(mapName)
  const version = mapName.toLowerCase().slice(family.length + 1)
  if (!version) return [9]
  const match = VERSION_TOKEN.exec(version.split('_').pop()!)
  if (!match) return [0]
  const numbers = (match[2] ?? '0').split(/[a-z]/).map(Number)
  const letter = /[a-z]/.exec(match[2] ?? '')?.[0]
  // rc17a3: 17, then a=1, 3. b8a: 8, a=1.
  return [
    STAGES[match[1]],
    numbers[0] ?? 0,
    letter ? letter.charCodeAt(0) - 96 : 0,
    numbers[1] ?? 0,
  ]
}

const compareRanks = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0)
    if (difference) return difference
  }
  return 0
}

/**
 * Which of `built` to show a demo of `mapName` on: the map itself, else the nearest built version
 * of its family: the oldest one at or after the demo's (the closest layout a later fix kept),
 * else the newest before it. Null when the family has none.
 */
export function pickMapVersion(
  mapName: string,
  built: readonly string[]
): { map: string; exact: boolean } | null {
  const name = mapName.toLowerCase()
  if (built.includes(name)) return { map: name, exact: true }
  const family = mapFamily(name)
  const versions = built
    .filter(candidate => mapFamily(candidate) === family)
    .sort((a, b) => compareRanks(versionRank(a), versionRank(b)))
  if (!versions.length) return null
  const rank = versionRank(name)
  const after = versions.find(candidate => compareRanks(versionRank(candidate), rank) >= 0)
  return { map: after ?? versions[versions.length - 1], exact: false }
}

/** One map per family, its newest built version, by family name. */
export function newestPerFamily(built: readonly string[]): string[] {
  const newest = new Map<string, string>()
  for (const map of built) {
    const family = mapFamily(map)
    const known = newest.get(family)
    if (!known || compareRanks(versionRank(map), versionRank(known)) > 0) newest.set(family, map)
  }
  return [...newest.values()].sort((a, b) => mapFamily(a).localeCompare(mapFamily(b)))
}
