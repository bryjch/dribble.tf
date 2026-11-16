import type { MatchSource } from '@components/Analyse/Data/MatchSource'
import type { CachedPlayer } from '@components/Analyse/Data/PlayerTracks'
import type { MedigunState } from '@components/Analyse/Data/StreamEvents'
import { isAirshotWeapon } from '@constants/airshotWeapons'

//
// ─── MATCH EVENTS ───────────────────────────────────────────────────────────────
//
// The match as a list of moments for the match events sidebar: kills (with streaks, airshots and
// medic drops), über pops and über ready, captures, and round starts and results, plus each
// round's span and each player's line. Built from what a MatchSource already holds; über ready
// and captures come from sampling its state, so they land within SAMPLE_TICKS of the moment.
//

/** An über pop, as the match sources record it. */
export interface MatchUberEvent {
  type: 'uber'
  tick: number
  medicName: string
  medicTeam: number
  medicEntityId: number
}

export type EventTeam = 'red' | 'blue' | ''

export interface EventPlayer {
  name: string
  entityId: number
  team: EventTeam
  classId: number
}

interface EventBase {
  id: number
  tick: number
  /** 1-based round the event falls in; 0 before the first round starts. */
  round: number
}

export interface KillEvent extends EventBase {
  kind: 'kill'
  /** Null for a suicide or a death to the world. */
  killer: EventPlayer | null
  assister: EventPlayer | null
  victim: EventPlayer
  weapon: string
  /** How many kills the killer's streak this kill belongs to has, when 2 or more. */
  streak: number | null
  /** The victim was blast jumping. */
  airshot: boolean
  /** The victim was a medic with a full charge. */
  medicDrop: boolean
}

export interface UberEvent extends EventBase {
  kind: 'uber'
  medic: EventPlayer
  medigun: string
  /** Who the medic was healing when they popped. */
  target: EventPlayer | null
}

export interface UberReadyEvent extends EventBase {
  kind: 'uberReady'
  medic: EventPlayer
  medigun: string
}

export interface CaptureEvent extends EventBase {
  kind: 'capture'
  team: 'red' | 'blue'
  /** "point 3", or "the intel". */
  label: string
}

export interface RoundStartEvent extends EventBase {
  kind: 'roundStart'
}

export interface RoundWinEvent extends EventBase {
  kind: 'roundWin'
  winner: 'red' | 'blue'
  /** Rounds won after this one. */
  score: { red: number; blue: number }
}

export type MatchEvent =
  | KillEvent
  | UberEvent
  | UberReadyEvent
  | CaptureEvent
  | RoundStartEvent
  | RoundWinEvent
export type MatchEventKind = MatchEvent['kind']

export interface MatchRound {
  round: number
  startTick: number
  endTick: number
  winner: 'red' | 'blue' | null
  lengthSeconds: number | null
}

export interface MatchPlayerLine extends EventPlayer {
  kills: number
  deaths: number
  assists: number
  ubers: number
}

export interface MatchEvents {
  /** In tick order. */
  events: MatchEvent[]
  rounds: MatchRound[]
  /** Players who were on RED or BLU. */
  players: MatchPlayerLine[]
  tickRate: number
}

/** Kills by one player this close together make a streak. */
export const STREAK_SECONDS = 10
/** How often über ready and captures are looked for. */
const SAMPLE_TICKS = 16
/** A medigun's charge reads as a percentage. */
const FULL_CHARGE = 99
const DROP_CHARGE = 95

const MEDIGUN_NAMES: Record<MedigunState['kind'], string> = {
  medigun: 'Medi Gun',
  kritzkrieg: 'Kritzkrieg',
  quickfix: 'Quick-Fix',
  vaccinator: 'Vaccinator',
}

const teamOf = (teamId: number): EventTeam => (teamId === 2 ? 'red' : teamId === 3 ? 'blue' : '')

const playerOf = (p: CachedPlayer): EventPlayer => ({
  name: p.user.name,
  entityId: p.user.entityId,
  team: p.team as EventTeam,
  classId: p.classId,
})

const medigunOf = (p: CachedPlayer | undefined) =>
  p?.medigun ? MEDIGUN_NAMES[p.medigun.kind] : 'Medi Gun'

const KIND_ORDER: Record<MatchEventKind, number> = {
  roundStart: 0,
  kill: 1,
  uber: 2,
  uberReady: 3,
  capture: 4,
  roundWin: 5,
}

export function buildMatchEvents(match: MatchSource): MatchEvents {
  const tickRate = 1 / match.intervalPerTick
  const lastTick = Math.max(1, match.ticks - 1)
  const starts = match.roundStarts()
  const roundAt = (tick: number) => {
    let r = 0
    for (const s of starts) if (s <= tick) r++
    return r
  }
  const playersAt = (tick: number) =>
    new Map(
      match
        .playersAt(Math.max(1, Math.min(lastTick, Math.floor(tick))))
        .map(p => [p.user.entityId, p])
    )

  const events: MatchEvent[] = []
  let nextId = 0
  const id = () => nextId++

  // ── Kills ──
  const deaths = Object.values(match.deaths)
    .flat()
    .sort((a, b) => a.tick - b.tick)
  const streaks = new Map<number, { tick: number; kills: KillEvent[] }>()
  const streakTicks = STREAK_SECONDS * tickRate

  for (const death of deaths) {
    // Just before the kill: classes and charge as they were, not as the death left them.
    const before = playersAt(death.tick - 2)
    const ref = (r: typeof death.killer, teamId: number): EventPlayer | null =>
      r && {
        name: r.user.name,
        entityId: r.user.entityId,
        team: (r.user.team as EventTeam) || teamOf(teamId),
        classId: before.get(r.user.entityId)?.classId ?? 0,
      }
    const victim = ref(death.victim, death.victimTeam)!
    const attacker = ref(death.killer, death.killerTeam)
    const killer = attacker && attacker.entityId !== victim.entityId ? attacker : null
    const victimBefore = before.get(victim.entityId)

    const kill: KillEvent = {
      id: id(),
      kind: 'kill',
      tick: death.tick,
      round: roundAt(death.tick),
      killer,
      assister: ref(death.assister, death.assisterTeam),
      victim,
      weapon: death.weapon,
      streak: null,
      airshot: death.airshot && isAirshotWeapon(death.weapon),
      medicDrop: victim.classId === 5 && (victimBefore?.chargeLevel ?? 0) >= DROP_CHARGE,
    }

    if (killer) {
      const streak = streaks.get(killer.entityId)
      if (streak && death.tick - streak.tick <= streakTicks) {
        streak.kills.push(kill)
        streak.tick = death.tick
        for (const k of streak.kills) k.streak = streak.kills.length
      } else {
        streaks.set(killer.entityId, { tick: death.tick, kills: [kill] })
      }
    }
    events.push(kill)
  }

  // ── Über pops, with who was being healed ──
  for (const pop of match.uberPops) {
    const at = playersAt(pop.tick)
    const medic = at.get(pop.medicEntityId)
    const target = medic?.healTarget != null ? at.get(medic.healTarget) : undefined
    events.push({
      id: id(),
      kind: 'uber',
      tick: pop.tick,
      round: roundAt(pop.tick),
      medic: medic
        ? playerOf(medic)
        : {
            name: pop.medicName,
            entityId: pop.medicEntityId,
            team: teamOf(pop.medicTeam),
            classId: 5,
          },
      medigun: medigunOf(medic),
      target: target ? playerOf(target) : null,
    })
  }

  // ── Über ready and captures, by sampling ──
  const charged = new Map<number, boolean>()
  const owners = new Map<number, string>()
  let flagCaptures = { red: 0, blue: 0 }
  let wasRunning = false
  for (let t = 1; t < lastTick; t += SAMPLE_TICKS) {
    for (const p of match.playersAt(t)) {
      const full = p.classId === 5 && p.health > 0 && (p.chargeLevel ?? 0) >= FULL_CHARGE
      if (full && !charged.get(p.user.entityId) && !p.medigun?.releasing) {
        events.push({
          id: id(),
          kind: 'uberReady',
          tick: t,
          round: roundAt(t),
          medic: playerOf(p),
          medigun: medigunOf(p),
        })
      }
      charged.set(p.user.entityId, full)
    }

    const state = match.objectivesAt(t)
    if (!state) continue
    const running = state.round === 'running'
    // Rounds reset every point's owner: take a fresh baseline outside play.
    const live = running && wasRunning
    for (const point of state.points) {
      const before = owners.get(point.index)
      if (
        live &&
        before !== undefined &&
        before !== point.owner &&
        (point.owner === 'red' || point.owner === 'blue')
      ) {
        events.push({
          id: id(),
          kind: 'capture',
          tick: t,
          round: roundAt(t),
          team: point.owner,
          label: `point ${point.index + 1}`,
        })
      }
      owners.set(point.index, point.owner)
    }
    if (state.captures) {
      for (const team of ['red', 'blue'] as const) {
        if (running && state.captures[team] > flagCaptures[team]) {
          events.push({
            id: id(),
            kind: 'capture',
            tick: t,
            round: roundAt(t),
            team,
            label: 'the intel',
          })
        }
      }
      flagCaptures = { ...state.captures }
    }
    wasRunning = running
  }

  // ── Rounds ──
  const rounds: MatchRound[] = (starts.length ? starts : [1]).map((start, i, all) => {
    const nextStart = all[i + 1] ?? lastTick
    const end = match.rounds.find(r => r.endTick > start && r.endTick <= nextStart + 1)
    return {
      round: i + 1,
      startTick: start,
      endTick: end?.endTick ?? nextStart,
      winner: end?.winner ?? null,
      lengthSeconds: end?.length ?? null,
    }
  })
  for (const start of starts)
    events.push({ id: id(), kind: 'roundStart', tick: start, round: roundAt(start) })
  const score = { red: 0, blue: 0 }
  for (const r of match.rounds) {
    score[r.winner]++
    events.push({
      id: id(),
      kind: 'roundWin',
      tick: r.endTick,
      round: roundAt(r.endTick - 1),
      winner: r.winner,
      score: { ...score },
    })
  }

  events.sort((a, b) => a.tick - b.tick || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])

  // ── Players ──
  const lines = new Map<number, MatchPlayerLine>()
  const lineOf = (p: EventPlayer) => {
    let line = lines.get(p.entityId)
    if (!line) lines.set(p.entityId, (line = { ...p, kills: 0, deaths: 0, assists: 0, ubers: 0 }))
    if (p.classId) line.classId = p.classId
    if (p.team) line.team = p.team
    return line
  }
  for (const e of events) {
    if (e.kind === 'kill') {
      lineOf(e.victim).deaths++
      if (e.killer) lineOf(e.killer).kills++
      if (e.assister) lineOf(e.assister).assists++
    } else if (e.kind === 'uber') {
      lineOf(e.medic).ubers++
    }
  }

  return {
    events,
    rounds,
    players: [...lines.values()].filter(p => p.team === 'red' || p.team === 'blue'),
    tickRate,
  }
}

/** Every player an event names. */
export const eventPlayers = (e: MatchEvent): EventPlayer[] => {
  if (e.kind === 'kill')
    return [e.killer, e.assister, e.victim].filter((p): p is EventPlayer => !!p)
  if (e.kind === 'uber') return [e.medic, ...(e.target ? [e.target] : [])]
  if (e.kind === 'uberReady') return [e.medic]
  return []
}

/** Round results, round starts and captures: the match's shape rather than a player's doing. */
export const isMatchMoment = (e: MatchEvent) =>
  e.kind === 'roundWin' || e.kind === 'roundStart' || e.kind === 'capture'
