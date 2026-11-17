import type { CachedPlayer } from './PlayerTracks'
import type { CachedProjectile } from './ProjectileCache'
import type { CachedBuilding } from './BuildingCache'
import type { ObjectiveState } from './ObjectiveTimeline'
import type { ChatEntry, Header, PlayerRef, Round, Vector, World } from './Types'
import type { MatchUberEvent } from '@utils/matchEvents'

//
// ─── MATCH SOURCE ───────────────────────────────────────────────────────────────
//
// Whatever answers "what was the state at tick N" for a match (CONTEXT.md): a demo decoded up
// front (DemoSource), a live match fed by an stv.tf event stream (LiveSource), or a scripted
// scene from the /debug page (DebugSource, src/components/Debug). The viewer reads matches
// through this and nothing else.
//
// Ticks may be fractional: a source interpolates between the ticks around one, so the scene
// can be drawn at any moment between two ticks.
//

export interface CachedDeath {
  tick: number
  victim: PlayerRef
  assister: PlayerRef | null
  killer: PlayerRef | null
  weapon: string
  /** The victim was blast jumping (TF2's own airshot flag, stvtf's `airborne`). */
  airshot: boolean
  victimTeam: number
  assisterTeam: number
  killerTeam: number
}

/** A hit one player landed on another. */
export interface DamageHit {
  tick: number
  /** The attacker's entity id. */
  attacker: number
  /** The victim's entity id. */
  victim: number
  /**
   * Where the hit came from when that was not the attacker, in Source world coordinates: where
   * the projectile was launched from, the sticky, or the sentry. A demo's decoder works it out
   * (decoder/src/lib.rs, `locate_damage`); a live match has none.
   */
  from?: Vector
  amount: number
  crit: boolean
  minicrit: boolean
}

/** Hits by the attacker's entity id, each player's in tick order. */
export type DamageLog = Map<number, DamageHit[]>

/**
 * A player's scoreboard line, as stv.tf shows it: points, kills and deaths are the server's;
 * assists, damage and healing are counted from events (stvtf, like logs.tf).
 */
export interface ScoreLine {
  points: number
  kills: number
  deaths: number
  assists: number
  damage: number
  healing: number
  ping: number
}

export interface MatchSource {
  /**
   * A debug match plays like a demo (it stops at its end), but is never remembered: no saved
   * demo, no Recents progress, no bookmarks.
   */
  readonly kind: 'demo' | 'live' | 'debug'
  readonly header: Header
  /** Seconds per tick. */
  readonly intervalPerTick: number
  /** The map's extent, in Source world coordinates. */
  readonly world: World
  /** One past the last tick there is data for; a live match's grows. */
  readonly ticks: number
  /** Counts changes to deaths, rounds and übers: a demo's never change, a live match's do. */
  readonly revision: number

  readonly deaths: { [tick: string]: CachedDeath[] }
  readonly chat: ChatEntry[]
  readonly rounds: Round[]
  readonly uberPops: MatchUberEvent[]

  /** The hits a player (by entity id) landed on other players, in tick order. */
  damageBy(entityId: number): readonly DamageHit[]
  /** The hits other players landed on a player (by entity id), in tick order. */
  damageTo(entityId: number): readonly DamageHit[]
  playersAt(tick: number): CachedPlayer[]
  projectilesAt(tick: number): CachedProjectile[]
  buildingsAt(tick: number): CachedBuilding[]
  /** The objectives and round state; null before the first round state is known. */
  objectivesAt(tick: number): ObjectiveState | null
  /** Each player's scoreboard line at a tick, by entity id (as CachedPlayer.user has it). */
  scoresAt(tick: number): Map<number, ScoreLine>
  /** A player's team (2 red, 3 blue) by their slot, which chat entries name them by. */
  slotTeamAt(slot: number, tick: number): number
  /** The ticks rounds start at (when play begins after setup), from the round state. */
  roundStarts(): number[]
}

// ─── Interpolation shared by the sources ────────────────────────────────────────

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const lerpAngle = (a: number, b: number, t: number) =>
  a + (((((b - a) % 360) + 540) % 360) - 180) * t

/** Moving further than this in one tick is a respawn or a teleport: drawn there, not slid to. */
export const TELEPORT_PER_TICK = 256

const far = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) > TELEPORT_PER_TICK

/** Players between two ticks' states, `t` of the way from `a` to `b` (matched by entity id). */
export function lerpPlayers(a: CachedPlayer[], b: CachedPlayer[], t: number): CachedPlayer[] {
  if (t <= 0 || b.length === 0) return a
  const next = new Map(b.map(p => [p.user.entityId, p]))
  return a.map(p => {
    const q = next.get(p.user.entityId)
    if (!q || p.health > 0 !== q.health > 0 || far(p.position, q.position)) return p
    return {
      ...p,
      position: {
        x: lerp(p.position.x, q.position.x, t),
        y: lerp(p.position.y, q.position.y, t),
        z: lerp(p.position.z, q.position.z, t),
      },
      viewAngles: {
        x: lerp(p.viewAngles.x, q.viewAngles.x, t),
        y: lerpAngle(p.viewAngles.y, q.viewAngles.y, t),
        z: p.viewAngles.z,
      },
    }
  })
}

/** Projectiles between two ticks' states, `t` of the way from `a` to `b`. */
export function lerpProjectiles(
  a: CachedProjectile[],
  b: CachedProjectile[],
  t: number
): CachedProjectile[] {
  if (t <= 0 || b.length === 0) return a
  const next = new Map(b.map(p => [p.entityId, p]))
  return a.map(p => {
    const q = next.get(p.entityId)
    if (!q || q.type !== p.type || far(p.position, q.position)) return p
    return {
      ...p,
      position: {
        x: lerp(p.position.x, q.position.x, t),
        y: lerp(p.position.y, q.position.y, t),
        z: lerp(p.position.z, q.position.z, t),
      },
      rotation: {
        x: lerpAngle(p.rotation.x, q.rotation.x, t),
        y: lerpAngle(p.rotation.y, q.rotation.y, t),
        z: lerpAngle(p.rotation.z, q.rotation.z, t),
      },
    }
  })
}

/** States a round begins from: setup, or the end of the previous round. */
const BEFORE_ROUND = new Set([
  'preround',
  'team_win',
  'stalemate',
  'restart',
  'bonus',
  'between_rounds',
])

/**
 * Round starts from round-state keys: where play begins after setup or a previous round. A
 * round already running when the recording began (the state goes from init straight to
 * running) is left out: it was usually cut short by the match's real start.
 */
export function roundStartsFrom(keys: { tick: number; round: string }[]): number[] {
  const starts: number[] = []
  let previous = ''
  for (const key of keys) {
    if (key.round === 'running' && BEFORE_ROUND.has(previous)) starts.push(key.tick)
    previous = key.round
  }
  return starts
}
