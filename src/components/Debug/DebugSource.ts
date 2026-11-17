import type {
  CachedDeath,
  DamageHit,
  MatchSource,
  ScoreLine,
} from '@components/Analyse/Data/MatchSource'
import type { CachedPlayer } from '@components/Analyse/Data/PlayerTracks'
import type { CachedProjectile } from '@components/Analyse/Data/ProjectileCache'
import type { CachedBuilding } from '@components/Analyse/Data/BuildingCache'
import type { ObjectiveState } from '@components/Analyse/Data/ObjectiveTimeline'
import type {
  ChatEntry,
  Header,
  PlayerRef,
  Round,
  UserInfo,
  World,
} from '@components/Analyse/Data/Types'
import {
  CONDITION_FLAGS,
  TEAM_IDS,
  chargeBits,
  medigunOf,
  toChatEntry,
  toDeath,
  toUberPop,
} from '@components/Analyse/Data/StreamEvents'
import type { MatchUberEvent } from '@utils/matchEvents'

import {
  BUILDING_MAX_HEALTH,
  DEBUG_TICKS,
  DebugBuilding,
  DebugPlayer,
  DebugProjectile,
  INTERVAL_PER_TICK,
  MINI_SENTRY_HEALTH,
  Scenario,
} from './scenario'

//
// ─── DEBUG SOURCE ───────────────────────────────────────────────────────────────
//
// A match made from a /debug scenario (./scenario.ts), read by the viewer like any other
// (MatchSource). Everything is worked out from the tick, so the same tick always looks the same.
// The page makes a new one for every edit; the viewer keeps its camera and actors (they are
// keyed by entity id).
//

/** A moving projectile is gone this many ticks between flights, so the viewer shows it explode. */
const PROJECTILE_GAP_TICKS = 12
/** Each flight gets its own entity id: the projectile's id plus this times the flight. */
const FLIGHT_ID_STRIDE = 10000
/** Pipes and stickies fall at sv_gravity. */
const GRAVITY = 800
/** A sentry's sweep, degrees either side, and seconds per sweep. */
const SWEEP_DEGREES = 45
const SWEEP_SECONDS = 4

const NO_HITS: readonly DamageHit[] = []
const ZERO_SCORE: ScoreLine = {
  points: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
  damage: 0,
  healing: 0,
  ping: 0,
}

/** Conditions as the bits the viewer reads (CachedPlayer.conditions, one bit per CONDITION_FLAGS). */
const bitsOf = (flags: readonly string[]) =>
  flags.reduce((bits, flag) => {
    const bit = CONDITION_FLAGS.findIndex(([name]) => name === flag)
    return bit < 0 ? bits : bits | (1 << bit)
  }, 0)

/** The last tick at or before `tick` a player fires on: every `every` ticks from that tick on. */
export const lastShotAt = (every: number, tick: number) =>
  every > 0 && tick >= every ? Math.floor(tick / every) * every : null

export class DebugSource implements MatchSource {
  readonly kind = 'debug' as const
  readonly header: Header
  readonly intervalPerTick = INTERVAL_PER_TICK
  readonly ticks = DEBUG_TICKS
  readonly deaths: { [tick: string]: CachedDeath[] } = {}
  readonly chat: ChatEntry[] = []
  readonly rounds: Round[] = []
  readonly uberPops: MatchUberEvent[] = []

  private readonly users: Map<number, UserInfo>
  private readonly conditions: Map<number, number>
  private readonly charges: Map<number, number>

  constructor(
    readonly scenario: Scenario,
    readonly world: World,
    /** Counts the edits: the viewer looks again at deaths, chat and übers when it changes. */
    readonly revision = 0
  ) {
    this.header = {
      demo_type: 'debug',
      version: 0,
      protocol: 0,
      server: 'dribble.tf /debug',
      nick: 'debug',
      map: scenario.map,
      game: 'tf',
      duration: DEBUG_TICKS * INTERVAL_PER_TICK,
      ticks: DEBUG_TICKS,
      frames: DEBUG_TICKS,
      signon: 0,
    }
    this.users = new Map(
      scenario.players.map(p => [
        p.id,
        { name: p.name, userId: p.id, steamId: `debug:${p.id}`, entityId: p.id, team: p.team },
      ])
    )
    this.conditions = new Map(scenario.players.map(p => [p.id, bitsOf(p.conditions)]))
    this.charges = new Map(scenario.players.map(p => [p.id, chargeBits(p.ubered, p.medigun)]))
    this.addEvents()
  }

  private addEvents() {
    const refOf = (id: number | null | undefined): PlayerRef | null => {
      const user = id == null ? undefined : this.users.get(id)
      return user ? { user } : null
    }
    const slotOf = (id: number | null) => this.scenario.players.findIndex(p => p.id === id)
    for (const event of [...this.scenario.events].sort((a, b) => a.tick - b.tick)) {
      if (event.type === 'kill') {
        const death = toDeath(
          event.tick,
          {
            type: 'death',
            victim: event.victim,
            attacker: event.killer,
            assister: event.assister,
            weapon: event.weapon,
            airborne: event.airshot,
          },
          refOf
        )
        if (death) (this.deaths[event.tick] ??= []).push(death)
      } else if (event.type === 'chat') {
        const from = refOf(event.from)
        const entry = toChatEntry(
          event.tick,
          {
            type: 'chat',
            kind: event.team ? 'ChatTeam' : 'ChatAll',
            name: from?.user.name ?? null,
            player: from ? event.from : null,
            text: event.text,
          },
          from ? slotOf(event.from) : null
        )
        if (entry) this.chat.push(entry)
      } else if (event.type === 'uber') {
        const pop = toUberPop(event.tick, { type: 'uber', medic: event.medic }, refOf)
        if (pop) this.uberPops.push(pop)
      }
    }
  }

  private player(p: DebugPlayer, tick: number): CachedPlayer {
    const teamId = TEAM_IDS[p.team]
    const yaw = p.ang[1] + p.spin * tick * INTERVAL_PER_TICK
    const charge = this.charges.get(p.id) ?? 0
    return {
      position: { x: p.pos[0], y: p.pos[1], z: p.pos[2] },
      viewAngles: { x: p.ang[0], y: (((yaw % 360) + 540) % 360) - 180, z: 0 },
      user: this.users.get(p.id)!,
      health: Math.max(0, Math.round(p.health)),
      teamId,
      classId: p.classId,
      team: p.team,
      connected: 1,
      chargeLevel: p.classId === 5 ? p.charge : 0,
      healTarget: p.healTarget,
      respawnTick: null,
      conditions: this.conditions.get(p.id) ?? 0,
      ubered: p.ubered,
      medigun: medigunOf(charge),
      weapon: p.weapon,
      lastShotTick: lastShotAt(p.fireEvery, Math.floor(tick)),
    }
  }

  private projectile(p: DebugProjectile, tick: number): CachedProjectile | null {
    const moving = p.vel.some(v => v !== 0)
    const base = { type: p.type, teamNumber: TEAM_IDS[p.team] }
    if (!moving) {
      return {
        ...base,
        entityId: p.id,
        position: { x: p.pos[0], y: p.pos[1], z: p.pos[2] },
        rotation: { x: 0, y: 0, z: p.yaw },
      }
    }
    const period = p.life + PROJECTILE_GAP_TICKS
    const flight = Math.floor(tick / period)
    const local = tick - flight * period
    if (local >= p.life) return null
    const t = local * INTERVAL_PER_TICK
    const fall = p.gravity ? 0.5 * GRAVITY * t * t : 0
    const vz = p.vel[2] - (p.gravity ? GRAVITY * t : 0)
    return {
      ...base,
      entityId: p.id + flight * FLIGHT_ID_STRIDE,
      position: {
        x: p.pos[0] + p.vel[0] * t,
        y: p.pos[1] + p.vel[1] * t,
        z: p.pos[2] + p.vel[2] * t - fall,
      },
      rotation: {
        x: (Math.atan2(vz, Math.hypot(p.vel[0], p.vel[1])) * 180) / Math.PI,
        y: 0,
        z: (Math.atan2(p.vel[1], p.vel[0]) * 180) / Math.PI,
      },
    }
  }

  private building(b: DebugBuilding, tick: number): CachedBuilding {
    const maxHealth = b.mini ? MINI_SENTRY_HEALTH : BUILDING_MAX_HEALTH[b.kind][b.level - 1]
    const sweep = Math.sin((2 * Math.PI * tick * INTERVAL_PER_TICK) / SWEEP_SECONDS)
    return {
      entityId: b.id,
      kind: b.kind,
      team: TEAM_IDS[b.team],
      builder: b.builder,
      level: b.mini ? 1 : b.level,
      health: Math.round((maxHealth * Math.min(100, Math.max(1, b.health))) / 100),
      maxHealth,
      position: { x: b.pos[0], y: b.pos[1], z: b.pos[2] },
      yaw: b.yaw,
      aim: b.kind === 'sentry' ? b.yaw + (b.sweep ? sweep * SWEEP_DEGREES : 0) : null,
      target: null,
      sapped: b.sapped,
      constructing: b.constructing,
      mini: b.mini,
      entrance: b.entrance,
      attacking: b.attacking,
    }
  }

  private clamp(tick: number) {
    return Math.min(Math.max(tick, 1), this.ticks - 1)
  }

  playersAt(tick: number): CachedPlayer[] {
    const t = this.clamp(tick)
    return this.scenario.players.map(p => this.player(p, t))
  }

  projectilesAt(tick: number): CachedProjectile[] {
    const t = this.clamp(tick)
    const out: CachedProjectile[] = []
    for (const p of this.scenario.projectiles) {
      const projectile = this.projectile(p, t)
      if (projectile) out.push(projectile)
    }
    return out
  }

  buildingsAt(tick: number): CachedBuilding[] {
    const t = this.clamp(tick)
    return this.scenario.buildings.map(b => this.building(b, t))
  }

  objectivesAt(): ObjectiveState | null {
    return null
  }

  damageBy(): readonly DamageHit[] {
    return NO_HITS
  }

  damageTo(): readonly DamageHit[] {
    return NO_HITS
  }

  scoresAt(tick: number): Map<number, ScoreLine> {
    const scores = new Map(this.scenario.players.map(p => [p.id, { ...ZERO_SCORE }]))
    for (const [at, deaths] of Object.entries(this.deaths)) {
      if (Number(at) > tick) continue
      for (const death of deaths) {
        const victim = scores.get(death.victim.user.entityId)
        if (victim) victim.deaths++
        const killer = death.killer && scores.get(death.killer.user.entityId)
        if (killer && death.killer!.user.entityId !== death.victim.user.entityId) {
          killer.kills++
          killer.points += 2
        }
        const assister = death.assister && scores.get(death.assister.user.entityId)
        if (assister) {
          assister.assists++
          assister.points += 1
        }
      }
    }
    return scores
  }

  slotTeamAt(slot: number): number {
    const player = this.scenario.players[slot]
    return player ? TEAM_IDS[player.team] : 0
  }

  roundStarts(): number[] {
    return []
  }
}
