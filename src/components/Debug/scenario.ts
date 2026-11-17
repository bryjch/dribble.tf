import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'

import {
  CONDITION_FLAGS,
  ConditionFlag,
  MedigunKind,
  Resist,
  UberedKind,
} from '@components/Analyse/Data/StreamEvents'
import type { BuildingKind } from '@components/Analyse/Data/StreamEvents'
import type { SavedSetupCamera } from '@constants/types'
import { HEALTH_MAP } from '@constants/mappings'

//
// ─── DEBUG SCENARIO ─────────────────────────────────────────────────────────────
//
// What the /debug page plays: players, projectiles and buildings placed by hand, as plain data
// the page edits and the URL carries (?s=, lz-string). DebugSource turns it into a match; every
// state is a function of the tick (shots on a timer, a turning yaw, a rocket's flight that
// repeats), so pausing, scrubbing and screenshots give the same picture every time.
//
// Fields have defaults (normalizeScenario fills them), so old links keep opening and scripts
// can send only what they care about.
//

export type Vec3 = [number, number, number]
export type Team = 'red' | 'blue'

export interface DebugPlayer {
  /** Entity id: 1 to 32, as TF2's players. */
  id: number
  name: string
  team: Team
  /** 1 scout … 9 engineer (CLASS_MAP). */
  classId: number
  /** Feet, Source world coordinates. */
  pos: Vec3
  /** Pitch and yaw, degrees. */
  ang: [number, number]
  /** 0 is dead. */
  health: number
  conditions: ConditionFlag[]
  /** The medigun charge they are under (theirs or their medic's). */
  ubered: UberedKind | null
  /** A medic's medigun. */
  medigun: { kind: MedigunKind; releasing: boolean; resist: Resist | null } | null
  /** Medigun charge, 0 to 100. */
  charge: number
  /** Item definition index in hand (the viewmodel manifest's key); null for none. */
  weapon: number | null
  /** Fires every this many ticks, so the fire animation loops; 0 never. */
  fireEvery: number
  /** The entity id of the player a medic heals. */
  healTarget: number | null
  /** Turns on the spot, degrees a second. */
  spin: number
}

export const PROJECTILE_TYPES = ['rocket', 'pipebomb', 'stickybomb', 'healingBolt'] as const
export type ProjectileType = (typeof PROJECTILE_TYPES)[number]

export interface DebugProjectile {
  id: number
  type: ProjectileType
  team: Team
  /** Where it is, or where its flight starts. */
  pos: Vec3
  /** Degrees; a moving projectile faces where it flies. */
  yaw: number
  /** Units a second; all zero for one at rest. */
  vel: Vec3
  /** Falls as a pipe does (800 u/s²). */
  gravity: boolean
  /** A moving one flies for this many ticks, is gone for a few (it explodes), then flies again. */
  life: number
}

export interface DebugBuilding {
  id: number
  kind: BuildingKind
  team: Team
  level: number
  mini: boolean
  pos: Vec3
  yaw: number
  /** Percent of its max health. */
  health: number
  sapped: boolean
  constructing: boolean
  /** A teleporter entrance (else an exit). */
  entrance: boolean
  /** A sentry's turret sweeps from side to side. */
  sweep: boolean
  attacking: boolean
  /** The engineer's entity id; 0 for none. */
  builder: number
}

/**
 * Match events at a tick, for the killfeed, chat and match events. Not edited in the panel yet;
 * links and scripts can carry them.
 */
export type DebugEvent =
  | {
      type: 'kill'
      tick: number
      victim: number
      killer: number | null
      assister?: number | null
      weapon: string
      airshot?: boolean
    }
  | { type: 'chat'; tick: number; from: number | null; text: string; team?: boolean }
  | { type: 'uber'; tick: number; medic: number }

/** How the viewer opens: a tick (paused there, say mid-swing), a player's POV, a camera. */
export interface DebugView {
  tick?: number
  paused?: boolean
  pov?: number
  camera?: SavedSetupCamera
}

export interface Scenario {
  v: 1
  map: string
  players: DebugPlayer[]
  projectiles: DebugProjectile[]
  buildings: DebugBuilding[]
  events: DebugEvent[]
  view?: DebugView
}

export const DEFAULT_MAP = 'koth_product_final'
/** Ticks a debug match lasts: ten minutes at 66 ticks a second. */
export const DEBUG_TICKS = 39600
export const INTERVAL_PER_TICK = 0.015

export const CLASS_IDS = {
  scout: 1,
  sniper: 2,
  soldier: 3,
  demoman: 4,
  medic: 5,
  heavy: 6,
  pyro: 7,
  spy: 8,
  engineer: 9,
} as const
export const CLASS_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(CLASS_IDS).map(([name, id]) => [id, name])
)
/** TF2's class order (scoreboard, class select). */
export const CLASS_ORDER = [1, 3, 7, 4, 6, 9, 5, 2, 8]

/** Each class's stock primary, secondary and melee (item definition indexes). */
export const STOCK_WEAPONS: Record<number, [number, number, number]> = {
  1: [13, 23, 0],
  2: [14, 16, 3],
  3: [18, 10, 6],
  4: [19, 20, 1],
  5: [17, 29, 8],
  6: [15, 11, 5],
  7: [21, 12, 2],
  8: [24, 4, 735],
  9: [9, 22, 7],
}

export const MEDIGUN_ITEMS: Record<MedigunKind, number> = {
  medigun: 29,
  kritzkrieg: 35,
  quickfix: 411,
  vaccinator: 998,
}

export const BUILDING_MAX_HEALTH: Record<BuildingKind, number[]> = {
  sentry: [150, 180, 216],
  dispenser: [150, 180, 216],
  teleporter: [150, 180, 216],
}
export const MINI_SENTRY_HEALTH = 100

export const ALL_CONDITIONS: ConditionFlag[] = CONDITION_FLAGS.map(([flag]) => flag)

export const UBERED_KINDS: UberedKind[] = [
  'uber',
  'kritz',
  'quickfix',
  'vaccinator_bullet',
  'vaccinator_blast',
  'vaccinator_fire',
]

// ─── Defaults ───────────────────────────────────────────────────────────────────

export const emptyScenario = (map = DEFAULT_MAP): Scenario => ({
  v: 1,
  map,
  players: [],
  projectiles: [],
  buildings: [],
  events: [],
})

export function newPlayer(fields: Partial<DebugPlayer> & { id: number }): DebugPlayer {
  const classId = fields.classId ?? 1
  return {
    name: `Player ${fields.id}`,
    team: 'red',
    classId,
    pos: [0, 0, 0],
    ang: [0, 0],
    health: HEALTH_MAP[classId] ?? 125,
    conditions: [],
    ubered: null,
    medigun: null,
    charge: 0,
    weapon: STOCK_WEAPONS[classId]?.[0] ?? null,
    fireEvery: 0,
    healTarget: null,
    spin: 0,
    ...fields,
  }
}

export const newProjectile = (
  fields: Partial<DebugProjectile> & { id: number }
): DebugProjectile => ({
  type: 'rocket',
  team: 'red',
  pos: [0, 0, 0],
  yaw: 0,
  vel: [0, 0, 0],
  gravity: false,
  life: 66,
  ...fields,
})

export const newBuilding = (fields: Partial<DebugBuilding> & { id: number }): DebugBuilding => ({
  kind: 'sentry',
  team: 'red',
  level: 1,
  mini: false,
  pos: [0, 0, 0],
  yaw: 0,
  health: 100,
  sapped: false,
  constructing: false,
  entrance: false,
  sweep: false,
  attacking: false,
  builder: 0,
  ...fields,
})

// ─── Normalising (links and scripts) ────────────────────────────────────────────

const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const vec = (value: unknown, fallback: Vec3): Vec3 =>
  Array.isArray(value) && value.length === 3
    ? [num(value[0], 0), num(value[1], 0), num(value[2], 0)]
    : fallback
const team = (value: unknown): Team => (value === 'blue' ? 'blue' : 'red')
const list = <T>(value: unknown): T[] => (Array.isArray(value) ? value : [])

/** A scenario from anything (a link, a script): unknown fields dropped, missing ones defaulted. */
export function normalizeScenario(raw: any): Scenario {
  const players = list<any>(raw?.players).map((p, i) => {
    const base = newPlayer({ id: num(p?.id, i + 1), classId: num(p?.classId, 1) })
    return {
      ...base,
      name: typeof p?.name === 'string' ? p.name : base.name,
      team: team(p?.team),
      pos: vec(p?.pos, base.pos),
      ang: Array.isArray(p?.ang) ? [num(p.ang[0], 0), num(p.ang[1], 0)] : base.ang,
      health: num(p?.health, base.health),
      conditions: list<string>(p?.conditions).filter((c): c is ConditionFlag =>
        ALL_CONDITIONS.includes(c as ConditionFlag)
      ),
      ubered: UBERED_KINDS.includes(p?.ubered) ? p.ubered : null,
      medigun:
        p?.medigun?.kind in MEDIGUN_ITEMS
          ? {
              kind: p.medigun.kind,
              releasing: !!p.medigun.releasing,
              resist: ['bullet', 'blast', 'fire'].includes(p.medigun.resist)
                ? p.medigun.resist
                : null,
            }
          : null,
      charge: num(p?.charge, 0),
      weapon:
        p?.weapon === null
          ? null
          : Number.isInteger(p?.weapon) && p.weapon >= 0
            ? p.weapon
            : base.weapon,
      fireEvery: num(p?.fireEvery, 0),
      healTarget: p?.healTarget == null ? null : num(p.healTarget, 0) || null,
      spin: num(p?.spin, 0),
    } satisfies DebugPlayer
  })
  const projectiles = list<any>(raw?.projectiles).map((p, i) => {
    const base = newProjectile({ id: num(p?.id, 100 + i) })
    return {
      ...base,
      type: PROJECTILE_TYPES.includes(p?.type) ? p.type : base.type,
      team: team(p?.team),
      pos: vec(p?.pos, base.pos),
      yaw: num(p?.yaw, 0),
      vel: vec(p?.vel, base.vel),
      gravity: !!p?.gravity,
      life: Math.max(1, num(p?.life, base.life)),
    } satisfies DebugProjectile
  })
  const buildings = list<any>(raw?.buildings).map((b, i) => {
    const base = newBuilding({ id: num(b?.id, 200 + i) })
    return {
      ...base,
      kind: b?.kind === 'dispenser' || b?.kind === 'teleporter' ? b.kind : 'sentry',
      team: team(b?.team),
      level: Math.min(3, Math.max(1, num(b?.level, 1))),
      mini: !!b?.mini,
      pos: vec(b?.pos, base.pos),
      yaw: num(b?.yaw, 0),
      health: num(b?.health, 100),
      sapped: !!b?.sapped,
      constructing: !!b?.constructing,
      entrance: !!b?.entrance,
      sweep: !!b?.sweep,
      attacking: !!b?.attacking,
      builder: num(b?.builder, 0),
    } satisfies DebugBuilding
  })
  const events = list<any>(raw?.events).filter(
    e => (e?.type === 'kill' || e?.type === 'chat' || e?.type === 'uber') && Number.isFinite(e.tick)
  ) as DebugEvent[]
  const view = raw?.view && typeof raw.view === 'object' ? (raw.view as DebugView) : undefined
  return {
    v: 1,
    map: typeof raw?.map === 'string' && /^[a-z0-9_]{1,128}$/.test(raw.map) ? raw.map : DEFAULT_MAP,
    players,
    projectiles,
    buildings,
    events,
    ...(view ? { view } : {}),
  }
}

// ─── Links ──────────────────────────────────────────────────────────────────────

const round = (value: unknown): unknown =>
  typeof value === 'number'
    ? Math.round(value * 10) / 10
    : Array.isArray(value)
      ? value.map(round)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round(v)]))
        : value

export const encodeScenario = (scenario: Scenario) =>
  compressToEncodedURIComponent(JSON.stringify(round(scenario)))

export function decodeScenario(token: string): Scenario | null {
  try {
    const json = decompressFromEncodedURIComponent(token)
    return json ? normalizeScenario(JSON.parse(json)) : null
  } catch {
    return null
  }
}

/** A scenario's link: this page with ?s=, keeping the flags it was opened with (?bench, ?perf). */
export function scenarioUrl(scenario: Scenario, base = window.location.href): string {
  const url = new URL(base)
  url.searchParams.delete('preset')
  url.searchParams.set('s', encodeScenario(scenario))
  return url.toString()
}

// ─── Ids ────────────────────────────────────────────────────────────────────────

export const nextPlayerId = (scenario: Scenario) => {
  const used = new Set(scenario.players.map(p => p.id))
  for (let id = 1; id <= 32; id++) if (!used.has(id)) return id
  return null
}

export const nextObjectId = (scenario: Scenario, from: number) =>
  Math.max(from - 1, ...scenario.projectiles.map(p => p.id), ...scenario.buildings.map(b => b.id)) +
  1
