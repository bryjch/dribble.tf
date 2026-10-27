import { AsyncParser, CachedDeath } from './AsyncParser'
import { CachedPlayer, PlayerCache } from './PlayerCache'
import { CachedProjectile } from './ProjectileCache'
import { PlayerMeta } from './PlayerMetaCache'
import { getMapBoundaries } from '../MapBoundaries'
import { ChatEntry, PlayerRef, TeamName, Vector } from './Types'
import type { MatchUberEvent } from '@utils/matchEvents'

//
// ─── LIVE MATCH SOURCE ──────────────────────────────────────────────────────────
//
// Stands in for AsyncParser when the match comes from an stv.tf event stream instead of a
// .dem file. The viewer only ever asks a parser for the state at a tick, so this keeps every
// snapshot stv.tf sends and answers the same questions from them.
//
// stv.tf sends full snapshots (not deltas) about every 4 server ticks; the viewer asks for
// every tick, so positions are interpolated between the two snapshots around it. Snapshots
// are packed into typed arrays to keep half an hour of match in a few tens of MB.
//
// Ticks here start at 1 at the first snapshot, like a demo's.
//

// Per player, per snapshot: present, x, y, z, pitch, yaw, health, classId, teamId, uber, heal
// target, seconds until respawn
const STRIDE = 12
const [PRESENT, X, Y, Z, PITCH, YAW, HEALTH, CLASS, TEAM, UBER, HEAL, RESPAWN] = Array.from(
  { length: STRIDE },
  (_, i) => i
)

// Per projectile, per snapshot: id, type, x, y, z, yaw, team
const P_STRIDE = 7

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

const CLASS_IDS: Record<string, number> = {
  scout: 1,
  sniper: 2,
  soldier: 3,
  demoman: 4,
  medic: 5,
  heavy: 6,
  pyro: 7,
  spy: 8,
  engineer: 9,
}

const TEAM_IDS: Record<string, number> = { spectator: 1, red: 2, blue: 3 }

// Only what dribble.tf has models for; see ProjectileTypeMap.
const PROJECTILE_TYPES: Record<string, number> = {
  Rocket: 1,
  EnergyBall: 1,
  Pipe: 2,
  LooseCannon: 2,
  Sticky: 3,
  HealingArrow: 4,
}

const CHAT_PREFIXES: Record<string, string> = {
  ChatTeam: '(TEAM) ',
  ChatAllDead: '*DEAD* ',
  ChatTeamDead: '*DEAD*(TEAM) ',
  ChatAllSpec: '*SPEC* ',
}

type Vec3 = [number, number, number]

/** One line of stv.tf's event stream; see the stvtf README for the fields of each type. */
export type StreamMessage = { type: string; tick?: number; history?: boolean; [key: string]: any }

interface Frame {
  tick: number
  players: Float32Array
  projectiles: Float32Array
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpAngle = (a: number, b: number, t: number) =>
  a + (((((b - a) % 360) + 540) % 360) - 180) * t
const teamName = (team: string): TeamName =>
  team === 'red' || team === 'blue' || team === 'spectator' ? team : ''

export class LiveSource extends AsyncParser {
  frames: Frame[] = []
  uberPops: MatchUberEvent[] = []

  // The server tick the first snapshot had, and the latest one seen.
  private baseTick: number | null = null
  private lastServerTick = 0
  // A kill or chat line from the history replayed on a reconnect is skipped up to here.
  private lastEventTick = 0
  private slots = new Map<number, number>()
  private origin: Vector = { x: 0, y: 0, z: 0 }

  /** Called when the server's ticks start over: a restarted server, or a replay looping. */
  onReset: (() => void) | null = null

  constructor(map: string, hostname: string, intervalPerTick: number, world: Vec3[] | null) {
    super(new ArrayBuffer(0), () => {})
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
    this.ticks = 1
    this.chat = []
    this.deaths = {}
    this.rounds = []
    this.entityPlayerMap = new Map()
    this.nextMappedPlayer = 0
    this.playerCache = {
      metaCache: { getMeta: (slot: number, tick: number) => this.getMeta(slot, tick) },
    } as unknown as PlayerCache
    this.buildingCache = { getBuildings: () => [] } as any
    this.projectileCache = { getProjectiles: () => [] } as any
    this.world = { boundaryMin: { x: 0, y: 0, z: 0 }, boundaryMax: { x: 0, y: 0, z: 0 } }
    this.setWorld(world)
  }

  /** Whether the scene can be placed yet: maps dribble.tf knows carry their own bounds. */
  get hasWorld() {
    return this.world.boundaryMax.x !== this.world.boundaryMin.x
  }

  /** Positions are relative to the map's boundaryMin, as the parser worker stores them. */
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
    this.origin = this.world.boundaryMin
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
        this.rounds = [...this.rounds, { winner: m.team, length: m.round_time ?? 0, endTick: tick }]
        this.revision++
        return
    }
  }

  private localTick(serverTick: number) {
    return serverTick - (this.baseTick ?? serverTick) + 1
  }

  private slotOf(id: number) {
    let slot = this.slots.get(id)
    if (slot === undefined) {
      slot = this.slots.size
      this.slots.set(id, slot)
      this.nextMappedPlayer = this.slots.size
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
      this.entityPlayerMap.set(slot, {
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
    }

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

    this.frames.push({ tick: this.localTick(m.tick), players: data, projectiles })
    if (this.frames.length > MAX_FRAMES + TRIM_FRAMES) this.frames.splice(0, TRIM_FRAMES)
    this.ticks = this.latestTick + 1
  }

  private playerRef(id: number | null, names?: Record<string, { name: string; team: string }>) {
    if (id == null) return null
    const slot = this.slots.get(id)
    const known = slot !== undefined ? this.entityPlayerMap.get(slot) : undefined
    if (known) return { user: { ...known.user } }
    const named = names?.[id]
    if (!named) return null
    return {
      user: { name: named.name, userId: id, steamId: '', entityId: -1, team: teamName(named.team) },
    }
  }

  private addKill(tick: number, m: StreamMessage) {
    const victim = this.playerRef(m.victim, m.names)
    if (!victim) return
    const killer = this.playerRef(m.attacker, m.names)
    const assister = this.playerRef(m.assister, m.names)
    const teamId = (p: PlayerRef | null) => (p ? (TEAM_IDS[p.user.team] ?? 0) : 0)
    const death: CachedDeath = {
      tick,
      victim,
      killer,
      assister,
      weapon: m.weapon ?? '',
      victimTeam: teamId(victim),
      killerTeam: teamId(killer),
      assisterTeam: teamId(assister),
    }
    // A new object, so memos keyed on it see the change.
    this.deaths = { ...this.deaths, [tick]: [...(this.deaths[tick] ?? []), death] }
    this.revision++
  }

  private addChat(tick: number, m: StreamMessage) {
    if (m.kind === 'Empty' || m.kind === 'NameChange' || !m.text) return
    const slot = m.player != null ? this.slots.get(m.player) : undefined
    // In-game chat colour codes: 1 normal, 3 the sender's team colour.
    const rawText =
      m.player == null || m.kind === 'SayText'
        ? `\x01${m.text}`
        : `\x01${CHAT_PREFIXES[m.kind] ?? ''}\x03${m.name}\x01 :  ${m.text}`
    const entry: ChatEntry = { tick, kind: m.kind, rawText, clientPlayerId: slot ?? null }
    this.chat.push(entry)
  }

  private addUber(tick: number, m: StreamMessage) {
    const medic = this.playerRef(m.medic)
    if (!medic) return
    this.uberPops.push({
      type: 'uber',
      tick,
      medicName: medic.user.name,
      medicTeam: TEAM_IDS[medic.user.team] ?? 0,
      medicEntityId: medic.user.entityId,
    })
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

  getMeta(slot: number, tick: number): PlayerMeta {
    const frame = this.frames[this.frameIndexAt(tick)]
    const o = slot * STRIDE
    if (!frame || o >= frame.players.length) return { classId: 0, teamId: 0 }
    return { classId: frame.players[o + CLASS], teamId: frame.players[o + TEAM] }
  }

  getPlayersAtTick(tick: number): CachedPlayer[] {
    const at = this.around(tick)
    const players: CachedPlayer[] = []
    if (!at) return players
    const { a, b, t } = at
    const { origin } = this

    for (let slot = 0; slot < this.nextMappedPlayer; slot++) {
      const ref = this.entityPlayerMap.get(slot)
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
        position: { x: x - origin.x, y: y - origin.y, z: z - origin.z },
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
      })
    }
    return players
  }

  getProjectilesAtTick(tick: number): CachedProjectile[] {
    const at = this.around(tick)
    if (!at) return []
    const { a, b, t } = at
    const { origin } = this
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
        position: { x: x - origin.x, y: y - origin.y, z: z - origin.z },
        rotation: { x: 0, y: 0, z: p[o + 5] },
        teamNumber: p[o + 6],
      })
    }
    return out
  }
}
