import { CachedPlayer, lastAtOrBefore } from './PlayerTracks'
import { CachedProjectile } from './ProjectileCache'
import { CachedBuilding } from './BuildingCache'
import { ObjectiveState, ObjectiveTimeline } from './ObjectiveTimeline'
import { getMapBoundaries } from '../MapBoundaries'
import { ChatEntry, Header, PlayerRef, Round, World } from './Types'
import { CachedDeath, MatchSource, lerp, lerpAngle, roundStartsFrom } from './MatchSource'
import type { MatchUberEvent } from '@utils/matchEvents'
import {
  BUILDING_KINDS,
  BuildingKind,
  CLASS_IDS,
  StreamMessage,
  chargeBits,
  conditionBits,
  medigunOf,
  uberedOf,
  TEAM_IDS,
  teamName,
  toChatEntry,
  toDeath,
  toRound,
  toUberPop,
} from './StreamEvents'

export type { StreamMessage }

//
// ─── LIVE MATCH SOURCE ──────────────────────────────────────────────────────────
//
// The match source for a live match, fed by an stv.tf event stream instead of a .dem file. The
// viewer only ever asks a match source for the state at a tick, so this keeps every snapshot
// stv.tf sends and answers the same questions from them.
//
// stv.tf sends full snapshots (not deltas) about every 4 server ticks; the viewer asks for
// every tick, so positions are interpolated between the two snapshots around it. Snapshots
// are packed into typed arrays to keep half an hour of match in a few tens of MB.
//
// Ticks here start at 1 at the first snapshot, like a demo's.
//

// Per player, per snapshot: present, x, y, z, pitch, yaw, health, classId, teamId, uber, heal
// target, seconds until respawn, condition bits, charge bits (both as StreamEvents.ts packs them),
// the item in hand plus one (0 for none)
const STRIDE = 15
const [PRESENT, X, Y, Z, PITCH, YAW, HEALTH, CLASS, TEAM, UBER, HEAL, RESPAWN, CONDS, CHARGE, WEAPON] = Array.from(
  { length: STRIDE },
  (_, i) => i
)

// Per projectile, per snapshot: id, type, x, y, z, yaw, team
const P_STRIDE = 7

// Per building, per snapshot: id, kind, team, builder entity, x, y, z, yaw, aim (NaN for none),
// health, max health, level, flags (as BuildingCache keeps them), target entity
const B_STRIDE = 14
const [B_ID, B_KIND, B_TEAM, B_BUILDER, B_X, B_Y, B_Z, B_YAW, B_AIM, B_HP, B_MAX, B_LEVEL, B_FLAGS, B_TARGET] =
  Array.from({ length: B_STRIDE }, (_, i) => i)

// Snapshots further apart than this (a pause in the stream) are not interpolated across.
const MAX_INTERP_GAP_TICKS = 33
// Moving further than this between two snapshots is a respawn or a teleport, not movement.
const TELEPORT_DISTANCE = 512
// Half an hour of snapshots at stv.tf's rate to rewind through; older ones are dropped a
// minute's worth at a time, so the array is not shifted on every snapshot.
const MAX_FRAMES = 30 * 60 * 17
const TRIM_FRAMES = 60 * 17
// Server ticks going back this far are a new map or a server restart, not jitter.
const TICK_RESET = 200
// One shot is often seen more than once (the bullets, the clip, the projectile) and flames on
// every snapshot; shots this close to the last one kept are merged, as the demo decoder does.
const SHOT_MERGE_TICKS = 3

// Only what dribble.tf has models for; see ProjectileTypeMap.
const PROJECTILE_TYPES: Record<string, number> = {
  Rocket: 1,
  EnergyBall: 1,
  Pipe: 2,
  LooseCannon: 2,
  Sticky: 3,
  HealingArrow: 4,
}

type Vec3 = [number, number, number]

interface Frame {
  tick: number
  players: Float32Array
  projectiles: Float32Array
  buildings: Float32Array
}

export class LiveSource implements MatchSource {
  readonly kind = 'live' as const
  header: Header
  intervalPerTick: number
  world: World = { boundaryMin: { x: 0, y: 0, z: 0 }, boundaryMax: { x: 0, y: 0, z: 0 } }
  ticks = 1
  revision = 0
  deaths: { [tick: string]: CachedDeath[] } = {}
  chat: ChatEntry[] = []
  rounds: Round[] = []
  uberPops: MatchUberEvent[] = []
  frames: Frame[] = []
  readonly objectives: ObjectiveTimeline

  // Players by slot: one slot per stv.tf player id, in the order they were first seen.
  private players = new Map<number, PlayerRef>()

  // The server tick the first snapshot had, and the latest one seen.
  private baseTick: number | null = null
  private lastServerTick = 0
  // A kill or chat line from the history replayed on a reconnect is skipped up to here.
  private lastEventTick = 0
  private slots = new Map<number, number>()
  // Per slot, the ticks they fired on (sorted), and their weapon and clip in the last snapshot.
  private shots: number[][] = []
  private lastClip = new Map<number, [number, number]>()
  // Every projectile in the last snapshot, by id, to see new ones fired.
  private inFlight = new Map<number, string>()

  /** Called when the server's ticks start over: a restarted server, or a replay looping. */
  onReset: (() => void) | null = null

  constructor(map: string, hostname: string, intervalPerTick: number, world: Vec3[] | null) {
    this.header = {
      demo_type: 'stv.tf',
      version: 0,
      protocol: 0,
      server: hostname,
      nick: 'stv.tf',
      map,
      game: 'tf',
      duration: 0,
      ticks: 0,
      frames: 0,
      signon: 0,
    }
    this.intervalPerTick = intervalPerTick
    this.objectives = new ObjectiveTimeline(undefined, intervalPerTick)
    this.setWorld(world)
  }

  /** Whether the scene can be placed yet: maps dribble.tf knows carry their own bounds. */
  get hasWorld() {
    return this.world.boundaryMax.x !== this.world.boundaryMin.x
  }

  /** The map's extent: dribble.tf's own bounds for a map it knows, else the stream's. */
  setWorld(world: Vec3[] | null) {
    const known = getMapBoundaries(this.header.map)
    if (known) {
      this.world = { boundaryMin: known.boundaryMin, boundaryMax: known.boundaryMax }
    } else if (world) {
      const [min, max] = world
      this.world = {
        boundaryMin: { x: min[0], y: min[1], z: min[2] },
        boundaryMax: { x: max[0], y: max[1], z: max[2] },
      }
    }
  }

  get latestTick() {
    return this.frames.length ? this.frames[this.frames.length - 1].tick : 1
  }

  //
  // ─── INGEST ─────────────────────────────────────────────────────────────────────
  //

  handle(m: StreamMessage) {
    switch (m.type) {
      case 'world':
        if (!this.hasWorld) this.setWorld([m.min, m.max])
        return
      case 'snapshot':
        return this.addSnapshot(m)
    }

    if (m.tick == null || this.baseTick == null) return
    // Feed lines from before the first snapshot have no place on the timeline.
    if (m.tick < this.baseTick) return
    if (m.history && m.tick <= this.lastEventTick) return
    if (!m.history) this.lastEventTick = Math.max(this.lastEventTick, m.tick)
    const tick = this.localTick(m.tick)

    switch (m.type) {
      case 'kill':
        return this.addKill(tick, m)
      case 'chat':
        return this.addChat(tick, m)
      case 'uber':
        return this.addUber(tick, m)
      case 'round_win':
        this.rounds = [...this.rounds, toRound(tick, m)]
        this.revision++
        return
      case 'shot':
        if (m.player != null) this.addShot(this.slotOf(m.player), tick)
        return
    }
  }

  /** Records a shot, merged with one just before or after it. */
  private addShot(slot: number, tick: number) {
    const ticks = (this.shots[slot] ??= [])
    let i = ticks.length
    while (i > 0 && ticks[i - 1] > tick) i--
    if (i > 0 && tick - ticks[i - 1] <= SHOT_MERGE_TICKS) return
    if (i < ticks.length && ticks[i] - tick <= SHOT_MERGE_TICKS) return
    ticks.splice(i, 0, tick)
  }

  private localTick(serverTick: number) {
    return serverTick - (this.baseTick ?? serverTick) + 1
  }

  private slotOf(id: number) {
    let slot = this.slots.get(id)
    if (slot === undefined) {
      slot = this.slots.size
      this.slots.set(id, slot)
    }
    return slot
  }

  private addSnapshot(m: StreamMessage) {
    if (m.tick == null) return
    if (this.baseTick != null && m.tick < this.lastServerTick - TICK_RESET) {
      this.onReset?.()
      return
    }
    // A reconnect starts with the latest snapshot again.
    if (this.baseTick != null && m.tick <= this.lastServerTick) return
    this.baseTick ??= m.tick
    this.lastServerTick = m.tick

    const players: any[] = m.players ?? []
    const entOf = new Map<number, number>(players.map(p => [p.id, p.ent]))
    for (const p of players) this.slotOf(p.id)

    const data = new Float32Array(this.slots.size * STRIDE)
    for (const p of players) {
      const slot = this.slotOf(p.id)
      const o = slot * STRIDE
      const team = teamName(p.team)
      this.players.set(slot, {
        user: { name: p.name, userId: p.id, steamId: p.steamid, entityId: p.ent, team },
      })
      data[o + PRESENT] = 1
      data[o + X] = p.pos ? p.pos[0] : NaN
      data[o + Y] = p.pos ? p.pos[1] : NaN
      data[o + Z] = p.pos ? p.pos[2] : NaN
      data[o + PITCH] = p.pitch ?? 0
      data[o + YAW] = p.yaw ?? 0
      data[o + HEALTH] = p.alive ? Math.max(1, p.hp) : 0
      data[o + CLASS] = CLASS_IDS[p.class] ?? 0
      data[o + TEAM] = TEAM_IDS[p.team] ?? 0
      data[o + UBER] = p.class === 'medic' ? (p.uber ?? 0) : NaN
      data[o + HEAL] = p.medigun?.target != null ? (entOf.get(p.medigun.target) ?? 0) : 0
      // stv.tf says how long a dead player has left, once the server has set it.
      data[o + RESPAWN] = p.respawn ?? NaN
      data[o + CONDS] = conditionBits(p.conds)
      data[o + CHARGE] = chargeBits(p.ubered, p.medigun)
      data[o + WEAPON] = p.weapon ? p.weapon.item + 1 : 0

      // Firing shows as flames, or the clip going down with the same weapon in hand.
      const before = this.lastClip.get(slot)
      const clip: [number, number] | null =
        p.weapon?.clip != null ? [p.weapon.item, p.weapon.clip] : null
      if (p.alive && (p.flames || (before && clip && before[0] === clip[0] && clip[1] < before[1]))) {
        this.addShot(slot, this.localTick(m.tick))
      }
      if (clip) this.lastClip.set(slot, clip)
      else this.lastClip.delete(slot)
    }

    // A projectile not in the last snapshot was just fired by its owner.
    const inFlight = new Map<number, string>()
    for (const p of m.projectiles ?? []) {
      if (this.inFlight.get(p.id) !== p.kind && p.owner != null) {
        this.addShot(this.slotOf(p.owner), this.localTick(m.tick))
      }
      inFlight.set(p.id, p.kind)
    }
    this.inFlight = inFlight

    const placed = (m.buildings ?? []).filter((b: any) => BUILDING_KINDS.indexOf(b.kind) > 0)
    const buildings = new Float32Array(placed.length * B_STRIDE)
    placed.forEach((b: any, i: number) => {
      const o = i * B_STRIDE
      const flags =
        (b.sapped ? 1 : 0) |
        (b.building ? 2 : 0) |
        (b.mini ? 4 : 0) |
        (b.entrance ? 8 : 0) |
        (b.attacking ? 32 : 0)
      buildings[o + B_ID] = b.id
      buildings[o + B_KIND] = BUILDING_KINDS.indexOf(b.kind)
      buildings[o + B_TEAM] = TEAM_IDS[b.team] ?? 0
      buildings[o + B_BUILDER] = b.builder != null ? (entOf.get(b.builder) ?? 0) : 0
      buildings.set(b.pos, o + B_X)
      buildings[o + B_YAW] = b.yaw ?? 0
      buildings[o + B_AIM] = b.aim ?? NaN
      buildings[o + B_HP] = b.hp
      buildings[o + B_MAX] = b.max_hp
      buildings[o + B_LEVEL] = b.level
      buildings[o + B_FLAGS] = flags
      buildings[o + B_TARGET] = b.target != null ? (entOf.get(b.target) ?? 0) : 0
    })

    const kept = (m.projectiles ?? []).filter((p: any) => PROJECTILE_TYPES[p.kind] && p.pos)
    const projectiles = new Float32Array(kept.length * P_STRIDE)
    kept.forEach((p: any, i: number) => {
      const o = i * P_STRIDE
      projectiles[o] = p.id
      projectiles[o + 1] = PROJECTILE_TYPES[p.kind]
      projectiles.set(p.pos, o + 2)
      projectiles[o + 5] = p.yaw ?? 0
      projectiles[o + 6] = TEAM_IDS[p.team] ?? 0
    })

    this.objectives.record(this.localTick(m.tick), m, id => entOf.get(id) ?? 0)
    this.frames.push({ tick: this.localTick(m.tick), players: data, projectiles, buildings })
    if (this.frames.length > MAX_FRAMES + TRIM_FRAMES) this.frames.splice(0, TRIM_FRAMES)
    this.ticks = this.latestTick + 1
  }

  private playerRef(id: number | null | undefined, names?: Record<string, { name: string; team: string }>) {
    if (id == null) return null
    const slot = this.slots.get(id)
    const known = slot !== undefined ? this.players.get(slot) : undefined
    if (known) return { user: { ...known.user } }
    const named = names?.[id]
    if (!named) return null
    return {
      user: { name: named.name, userId: id, steamId: '', entityId: -1, team: teamName(named.team) },
    }
  }

  private addKill(tick: number, m: StreamMessage) {
    const death = toDeath(tick, m, id => this.playerRef(id, m.names))
    if (!death) return
    // A new object, so memos keyed on it see the change.
    this.deaths = { ...this.deaths, [tick]: [...(this.deaths[tick] ?? []), death] }
    this.revision++
  }

  private addChat(tick: number, m: StreamMessage) {
    const slot = m.player != null ? (this.slots.get(m.player) ?? null) : null
    const entry = toChatEntry(tick, m, slot)
    if (entry) this.chat.push(entry)
  }

  private addUber(tick: number, m: StreamMessage) {
    const pop = toUberPop(tick, m, id => this.playerRef(id))
    if (!pop) return
    this.uberPops.push(pop)
    this.revision++
  }

  //
  // ─── QUERIES ────────────────────────────────────────────────────────────────────
  //

  /** The last snapshot at or before the tick (the first one before any). */
  private frameIndexAt(tick: number) {
    const frames = this.frames
    let lo = 0
    let hi = frames.length - 1
    if (hi < 0) return -1
    if (tick < frames[0].tick) return 0
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (frames[mid].tick <= tick) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** The snapshots around a tick, and how far between them it is. */
  private around(tick: number) {
    const i = this.frameIndexAt(tick)
    if (i < 0) return null
    const a = this.frames[i]
    const b = this.frames[i + 1]
    const gap = b ? b.tick - a.tick : 0
    const t = b && gap <= MAX_INTERP_GAP_TICKS ? Math.min(1, Math.max(0, (tick - a.tick) / gap)) : 0
    return { i, a, b: t > 0 ? b : undefined, t }
  }

  slotTeamAt(slot: number, tick: number): number {
    const frame = this.frames[this.frameIndexAt(tick)]
    const o = slot * STRIDE
    if (!frame || o >= frame.players.length) return 0
    return frame.players[o + TEAM]
  }

  objectivesAt(tick: number): ObjectiveState | null {
    return this.objectives.at(tick)
  }

  roundStarts(): number[] {
    return roundStartsFrom(this.objectives.data.round)
  }

  playersAt(tick: number): CachedPlayer[] {
    const at = this.around(tick)
    const players: CachedPlayer[] = []
    if (!at) return players
    const { a, b, t } = at

    for (let slot = 0; slot < this.slots.size; slot++) {
      const ref = this.players.get(slot)
      if (!ref) continue
      const o = slot * STRIDE
      const p = a.players
      const present = o < p.length && p[o + PRESENT] === 1 && !Number.isNaN(p[o + X])
      const teamId = present ? p[o + TEAM] : 0
      const health = present ? p[o + HEALTH] : 0

      let x = present ? p[o + X] : 0
      let y = present ? p[o + Y] : 0
      let z = present ? p[o + Z] : 0
      let pitch = present ? p[o + PITCH] : 0
      let yaw = present ? p[o + YAW] : 0

      const q = b?.players
      if (
        present &&
        q &&
        o < q.length &&
        q[o + PRESENT] === 1 &&
        q[o + HEALTH] > 0 === health > 0
      ) {
        const dist = Math.hypot(q[o + X] - x, q[o + Y] - y, q[o + Z] - z)
        if (dist < TELEPORT_DISTANCE) {
          x = lerp(x, q[o + X], t)
          y = lerp(y, q[o + Y], t)
          z = lerp(z, q[o + Z], t)
          pitch = lerp(pitch, q[o + PITCH], t)
          yaw = lerpAngle(yaw, q[o + YAW], t)
        }
      }

      const team = teamId === 2 ? 'red' : teamId === 3 ? 'blue' : ''
      players.push({
        position: { x, y, z },
        viewAngles: { x: pitch, y: yaw, z: 0 },
        user: { ...ref.user, team },
        health,
        teamId,
        classId: present ? p[o + CLASS] : 0,
        team,
        connected: present ? 1 : 0,
        chargeLevel: present && !Number.isNaN(p[o + UBER]) ? p[o + UBER] : null,
        healTarget: present && p[o + HEAL] ? p[o + HEAL] : null,
        respawnTick:
          present && health === 0 && !Number.isNaN(p[o + RESPAWN])
            ? a.tick + Math.round(p[o + RESPAWN] / this.intervalPerTick)
            : null,
        conditions: present ? p[o + CONDS] : 0,
        ubered: present ? uberedOf(p[o + CHARGE]) : null,
        medigun: present ? medigunOf(p[o + CHARGE]) : null,
        weapon: present && p[o + WEAPON] > 0 ? p[o + WEAPON] - 1 : null,
        lastShotTick: lastAtOrBefore(this.shots[slot], tick),
      })
    }
    return players
  }

  buildingsAt(tick: number): CachedBuilding[] {
    const at = this.around(tick)
    if (!at) return []
    const { a, b, t } = at
    const next = new Map<number, number>()
    if (b) {
      for (let o = 0; o < b.buildings.length; o += B_STRIDE) next.set(b.buildings[o + B_ID], o)
    }

    const out: CachedBuilding[] = []
    const q = a.buildings
    for (let o = 0; o < q.length; o += B_STRIDE) {
      let aim: number | null = Number.isNaN(q[o + B_AIM]) ? null : q[o + B_AIM]
      const n = next.get(q[o + B_ID])
      if (aim !== null && b && n !== undefined && !Number.isNaN(b.buildings[n + B_AIM])) {
        aim = lerpAngle(aim, b.buildings[n + B_AIM], t)
      }
      const flags = q[o + B_FLAGS]
      out.push({
        entityId: q[o + B_ID],
        kind: BUILDING_KINDS[q[o + B_KIND]] as BuildingKind,
        team: q[o + B_TEAM],
        builder: q[o + B_BUILDER],
        level: q[o + B_LEVEL],
        health: q[o + B_HP],
        maxHealth: q[o + B_MAX],
        position: { x: q[o + B_X], y: q[o + B_Y], z: q[o + B_Z] },
        yaw: q[o + B_YAW],
        aim,
        target: q[o + B_TARGET] || null,
        sapped: (flags & 1) !== 0,
        constructing: (flags & 2) !== 0,
        mini: (flags & 4) !== 0,
        entrance: (flags & 8) !== 0,
        attacking: (flags & 32) !== 0,
      })
    }
    return out
  }

  projectilesAt(tick: number): CachedProjectile[] {
    const at = this.around(tick)
    if (!at) return []
    const { a, b, t } = at
    const next = new Map<number, number>()
    if (b) {
      for (let o = 0; o < b.projectiles.length; o += P_STRIDE) next.set(b.projectiles[o], o)
    }

    const out: CachedProjectile[] = []
    const p = a.projectiles
    for (let o = 0; o < p.length; o += P_STRIDE) {
      let x = p[o + 2]
      let y = p[o + 3]
      let z = p[o + 4]
      const n = next.get(p[o])
      if (b && n !== undefined) {
        const q = b.projectiles
        x = lerp(x, q[n + 2], t)
        y = lerp(y, q[n + 3], t)
        z = lerp(z, q[n + 4], t)
      }
      out.push({
        entityId: p[o],
        type: ['', 'rocket', 'pipebomb', 'stickybomb', 'healingBolt'][p[o + 1]],
        position: { x, y, z },
        rotation: { x: 0, y: 0, z: p[o + 5] },
        teamNumber: p[o + 6],
      })
    }
    return out
  }
}
