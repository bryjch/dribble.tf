import {
  eventPlayers,
  isMatchMoment,
  KillEvent,
  MatchEvent,
  MatchEventKind,
} from '@utils/matchEvents'

//
// ─── MATCH EVENT FILTER ─────────────────────────────────────────────────────────
//
// What the match events sidebar narrows by: a team, a player, kinds of event, highlights, and
// (for a picked player) their kills, deaths, übers and drops.
//

export type Highlight = 'streak' | 'airshot' | 'drop'

export const HIGHLIGHTS: { key: Highlight; label: string }[] = [
  { key: 'streak', label: 'Streaks' },
  { key: 'airshot', label: 'Airshots' },
  { key: 'drop', label: 'Med drops' },
]

export type KindGroup = 'kill' | 'uber' | 'uberReady' | 'objective'

export const KIND_GROUPS: { key: KindGroup; label: string; kinds: MatchEventKind[] }[] = [
  { key: 'kill', label: 'Kills', kinds: ['kill'] },
  { key: 'uber', label: 'Übers', kinds: ['uber'] },
  { key: 'uberReady', label: 'Über ready', kinds: ['uberReady'] },
  { key: 'objective', label: 'Objectives', kinds: ['capture', 'roundStart', 'roundWin'] },
]

export const DEFAULT_KINDS: KindGroup[] = ['kill', 'uber', 'objective']

/** What a picked player did in an event. */
export type Role = 'kills' | 'deaths' | 'ubers' | 'drops'

export const ROLES: { key: Role; label: string }[] = [
  { key: 'kills', label: 'Kills' },
  { key: 'deaths', label: 'Deaths' },
  { key: 'ubers', label: 'Übers' },
  { key: 'drops', label: 'Drops' },
]

export interface EventFilter {
  /** The side that did it: the killer's for a kill, the medic's for an über. */
  team: 'red' | 'blue' | null
  /** The picked player, whose events alone are shown. */
  player: number | null
  kinds: KindGroup[]
  /** Kills with any of these; none for no restriction. */
  highlights: Highlight[]
  /** The picked player's kills, deaths, übers or drops (one of them); null for all they were in. */
  role: Role | null
}

export const emptyFilter = (): EventFilter => ({
  team: null,
  player: null,
  kinds: DEFAULT_KINDS,
  highlights: [],
  role: null,
})

/** How many things the drawer's filters narrow by, beyond the defaults. */
export const drawerFilterCount = (f: EventFilter) =>
  (f.team ? 1 : 0) +
  f.highlights.length +
  (f.kinds.length !== DEFAULT_KINDS.length || f.kinds.some(k => !DEFAULT_KINDS.includes(k)) ? 1 : 0)

const highlightHit = (e: KillEvent, highlights: Highlight[]) =>
  (highlights.includes('streak') && e.streak != null) ||
  (highlights.includes('airshot') && e.airshot) ||
  (highlights.includes('drop') && e.medicDrop)

/**
 * Whether an event is one of a player's kills, deaths, übers or drops. A drop is a medic dying
 * with a full charge: one the player caused, or (for a medic) suffered.
 */
export const hasRole = (e: MatchEvent, entityId: number, role: Role) => {
  if (role === 'ubers') return e.kind === 'uber' && e.medic.entityId === entityId
  if (e.kind !== 'kill') return false
  if (role === 'kills') return e.killer?.entityId === entityId
  if (role === 'deaths') return e.victim.entityId === entityId
  return e.medicDrop && (e.killer?.entityId === entityId || e.victim.entityId === entityId)
}

/** The side that did an event, for team filtering. */
const actingTeam = (e: MatchEvent) => {
  if (e.kind === 'kill') return e.killer?.team ?? ''
  if (e.kind === 'uber' || e.kind === 'uberReady') return e.medic.team
  return ''
}

/**
 * The events a filter lets through. Without a picked player or highlights, round results and
 * captures stay in whatever else is narrowed, so the list still reads as a match; with either,
 * only the player's own events, or the highlights, show.
 */
export function applyFilter(events: MatchEvent[], f: EventFilter): MatchEvent[] {
  const kinds = new Set(KIND_GROUPS.filter(k => f.kinds.includes(k.key)).flatMap(k => k.kinds))
  return events.filter(e => {
    if (isMatchMoment(e)) return f.player == null && !f.highlights.length && kinds.has(e.kind)
    if (!kinds.has(e.kind)) return false
    if (f.team && actingTeam(e) !== f.team) return false
    if (f.highlights.length && (e.kind !== 'kill' || !highlightHit(e, f.highlights))) return false
    if (f.player != null) {
      if (!eventPlayers(e).some(p => p.entityId === f.player)) return false
      if (f.role && !hasRole(e, f.player, f.role)) return false
    }
    return true
  })
}

/** A player's kills, deaths, übers and drops within some events, for the role chips. */
export function roleCounts(events: MatchEvent[], entityId: number): Record<Role, number> {
  const counts: Record<Role, number> = { kills: 0, deaths: 0, ubers: 0, drops: 0 }
  for (const e of events) for (const { key } of ROLES) if (hasRole(e, entityId, key)) counts[key]++
  return counts
}

/** Kills and übers per side within some events: a round's summary. */
export function summarize(events: MatchEvent[]) {
  const s = { blue: { kills: 0, ubers: 0 }, red: { kills: 0, ubers: 0 } }
  for (const e of events) {
    if (e.kind === 'kill' && (e.killer?.team === 'red' || e.killer?.team === 'blue'))
      s[e.killer.team].kills++
    if (e.kind === 'uber' && (e.medic.team === 'red' || e.medic.team === 'blue'))
      s[e.medic.team].ubers++
  }
  return s
}
