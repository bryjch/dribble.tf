import { Vector } from './Types'

//
// ─── OBJECTIVES ─────────────────────────────────────────────────────────────────
//
// Control points, payload carts and flags, and the round state (timers, score, stopwatch), kept
// as keys: the state at a tick, written only where it changes. A clock (a timer, a capture in
// progress) is a value and a rate per second, so it needs no key while it keeps to it; what
// moves (a cart, a dropped flag) has a key per sample while it moves, and is interpolated.
//
// A demo's keys come from the decoder (decoder/src/objectives.rs); a live match's are built
// from its snapshots here, the same way.
//

/** stvtf's team names. */
export type ObjectiveTeam = 'red' | 'blue' | 'spectator' | 'none'

/** TF2's round states, as stvtf names them. */
export type RoundState =
  | 'init'
  | 'pregame'
  | 'start_game'
  | 'preround'
  | 'running'
  | 'team_win'
  | 'restart'
  | 'stalemate'
  | 'game_over'
  | 'bonus'
  | 'between_rounds'

/** A value at a key's tick, and how much it changes per second. */
type Clock = [value: number, rate: number]
type Vec3 = [number, number, number]

interface RoundKey {
  tick: number
  round: RoundState
  score: [number, number]
  captures: [number, number] | null
  points: [number, number, number | null] | null
  winLimit: number | null
  roundTime: Clock | null
  timeLeft: Clock | null
  timers: { team: ObjectiveTeam; setup: boolean; time: Clock }[]
  stopwatch: {
    attackers: ObjectiveTeam
    setting: boolean
    state: 'unset' | 'running' | 'overtime'
    points: number
    inHud: boolean
    time: Clock
  } | null
}

interface PointKey {
  tick: number
  pos: Vec3 | null
  owner: ObjectiveTeam
  capping: ObjectiveTeam
  progress: Clock
  locked: boolean
  blocked: boolean
  red: number
  blue: number
}

interface CartKey {
  tick: number
  pos: Vec3
  team: ObjectiveTeam
  progress: number
  cappers: number
  speed: number
}

interface FlagKey {
  tick: number
  /** None while carried: it is where its carrier is. */
  pos: Vec3 | null
  team: ObjectiveTeam
  status: 'home' | 'carried' | 'dropped'
  /** The carrier's entity id, 0 for none. */
  carrier: number
  points: number | null
  returnsIn: Clock | null
}

type GoneKey = { tick: number; gone: true }
type ObjectiveKind = 'point' | 'cart' | 'flag'

interface ObjectiveTrack {
  kind: ObjectiveKind
  /** A control point's index; a cart's or flag's entity id. */
  id: number
  keys: (PointKey | CartKey | FlagKey | GoneKey)[]
}

/** The decoder's keys, as its metadata carries them. */
export interface ObjectiveData {
  /** Ticks between the samples keys were taken from. */
  step: number
  round: RoundKey[]
  tracks: ObjectiveTrack[]
}

// ─── What the viewer reads ──────────────────────────────────────────────────────

export interface ControlPoint {
  index: number
  position: Vector | null
  owner: ObjectiveTeam
  capping: ObjectiveTeam
  /** Capture progress, 0 to 1. */
  progress: number
  locked: boolean
  blocked: boolean
  /** Players on the point. */
  red: number
  blue: number
}

export interface PayloadCart {
  id: number
  position: Vector
  team: ObjectiveTeam
  /** Along the track, 0 to 1. */
  progress: number
  cappers: number
  /** Negative while rolling back. */
  speed: number
}

export interface Intel {
  id: number
  /** None while carried. */
  position: Vector | null
  team: ObjectiveTeam
  status: 'home' | 'carried' | 'dropped'
  /** The carrier's entity id. */
  carrier: number | null
  /** Seconds until a dropped flag goes home. */
  returnsIn: number | null
  points: number | null
}

export interface RoundTimer {
  team: ObjectiveTeam
  setup: boolean
  remaining: number
  paused: boolean
}

export interface ObjectiveState {
  round: RoundState
  /** Rounds won. */
  score: { red: number; blue: number }
  /** Flags captured this round, on maps with flags. */
  captures: { red: number; blue: number } | null
  winLimit: number | null
  /** Seconds since the round went live. */
  roundTime: number | null
  /** Seconds of mp_timelimit left. */
  timeLeft: number | null
  timers: RoundTimer[]
  stopwatch: {
    attackers: ObjectiveTeam
    setting: boolean
    state: 'unset' | 'running' | 'overtime'
    points: number
    inHud: boolean
    time: number
    paused: boolean
  } | null
  points: ControlPoint[]
  carts: PayloadCart[]
  flags: Intel[]
}

export const emptyObjectives = (): ObjectiveData => ({ step: 4, round: [], tracks: [] })

/** The last key at or before a tick, or -1. */
function keyAt(keys: { tick: number }[], tick: number) {
  let lo = 0
  let hi = keys.length - 1
  if (hi < 0 || keys[0].tick > tick) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (keys[mid].tick <= tick) lo = mid
    else hi = mid - 1
  }
  return lo
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Key gaps this many samples long or shorter are movement, interpolated all the way; a longer
 * one is a stop, then a move in its last sample. */
const MOVING_GAP = 8

export class ObjectiveTimeline {
  data: ObjectiveData
  intervalPerTick: number
  /** Added to every position: a map's own bounds replacing the demo's, or a live match's origin. */
  offset: Vector = { x: 0, y: 0, z: 0 }

  // A live match's key builders; not sent from the worker.
  private recorder?: Recorder

  constructor(data: ObjectiveData = emptyObjectives(), intervalPerTick = 0.015) {
    this.data = data
    this.intervalPerTick = intervalPerTick
  }

  get isEmpty() {
    return this.data.round.length === 0
  }

  /** Moves every objective by an offset, in world units. */
  shift(dx: number, dy: number, dz: number) {
    this.offset = { x: this.offset.x + dx, y: this.offset.y + dy, z: this.offset.z + dz }
  }

  private position(p: Vec3 | null): Vector | null {
    return p ? { x: p[0] + this.offset.x, y: p[1] + this.offset.y, z: p[2] + this.offset.z } : null
  }

  /** How far between key `k` and the next one a tick is, as interpolation sees it; 0 to hold. */
  private between(keys: { tick: number }[], k: number, tick: number) {
    const next = keys[k + 1]
    if (!next || 'gone' in next) return 0
    const step = this.data.step
    const gap = next.tick - keys[k].tick
    const from = gap <= MOVING_GAP * step ? keys[k].tick : next.tick - step
    return tick > from ? (tick - from) / (next.tick - from) : 0
  }

  at(tick: number): ObjectiveState | null {
    const rounds = this.data.round
    const r = keyAt(rounds, tick)
    if (r < 0) return null
    const key = rounds[r]
    const secs = (tick - key.tick) * this.intervalPerTick
    const clock = (c: Clock | null, floor = false) => {
      if (!c) return null
      const value = c[0] + c[1] * secs
      return floor ? Math.max(0, value) : value
    }

    const state: ObjectiveState = {
      round: key.round,
      score: { red: key.score[0], blue: key.score[1] },
      captures: key.captures ? { red: key.captures[0], blue: key.captures[1] } : null,
      winLimit: key.winLimit,
      roundTime: clock(key.roundTime),
      timeLeft: clock(key.timeLeft, true),
      timers: key.timers.map(t => ({
        team: t.team,
        setup: t.setup,
        remaining: clock(t.time, true)!,
        paused: t.time[1] === 0,
      })),
      stopwatch: key.stopwatch && {
        attackers: key.stopwatch.attackers,
        setting: key.stopwatch.setting,
        state: key.stopwatch.state,
        points: key.stopwatch.points,
        inHud: key.stopwatch.inHud,
        time: clock(key.stopwatch.time, true)!,
        paused: key.stopwatch.time[1] === 0,
      },
      points: [],
      carts: [],
      flags: [],
    }

    for (const track of this.data.tracks) {
      const k = keyAt(track.keys, tick)
      if (k < 0) continue
      const at = track.keys[k]
      if ('gone' in at) continue
      const secs = (tick - at.tick) * this.intervalPerTick
      if (track.kind === 'point') {
        const p = at as PointKey
        state.points.push({
          index: track.id,
          position: this.position(p.pos),
          owner: p.owner,
          capping: p.capping,
          progress: Math.min(1, Math.max(0, p.progress[0] + p.progress[1] * secs)),
          locked: p.locked,
          blocked: p.blocked,
          red: p.red,
          blue: p.blue,
        })
      } else if (track.kind === 'cart') {
        const c = at as CartKey
        const f = this.between(track.keys, k, tick)
        const n = (f > 0 ? track.keys[k + 1] : c) as CartKey
        state.carts.push({
          id: track.id,
          position: this.position([0, 1, 2].map(i => lerp(c.pos[i], n.pos[i], f)) as Vec3)!,
          team: c.team,
          progress: lerp(c.progress, n.progress, f),
          cappers: c.cappers,
          speed: c.speed,
        })
      } else {
        const g = at as FlagKey
        const f = this.between(track.keys, k, tick)
        const n = (f > 0 ? track.keys[k + 1] : g) as FlagKey
        const pos = g.pos && n.pos ? ([0, 1, 2].map(i => lerp(g.pos![i], n.pos![i], f)) as Vec3) : g.pos
        state.flags.push({
          id: track.id,
          position: this.position(pos),
          team: g.team,
          status: g.status,
          carrier: g.carrier || null,
          returnsIn: g.returnsIn ? Math.max(0, g.returnsIn[0] + g.returnsIn[1] * secs) : null,
          points: g.points,
        })
      }
    }
    state.points.sort((a, b) => a.index - b.index)
    return state
  }

  //
  // ─── LIVE ───────────────────────────────────────────────────────────────────────
  //

  /**
   * Adds a live match's snapshot (as stv.tf sends it) at a local tick. `entityOf` gives a
   * player's entity id from their stvtf id. Positions are kept as sent: set `offset` to place
   * them.
   */
  record(tick: number, s: any, entityOf: (id: number) => number) {
    this.recorder ??= new Recorder(this.data, this.intervalPerTick)
    this.recorder.add(tick, s, entityOf)
  }

  static rehydrate(data: ObjectiveTimeline) {
    Object.setPrototypeOf(data, ObjectiveTimeline.prototype)
  }
}

//
// ─── KEY BUILDING ───────────────────────────────────────────────────────────────
//
// The same as decoder/src/objectives.rs, for a live match's snapshots.
//

const CLOCK_SLACK = 0.15
const TIME_LEFT_SLACK = 0.25

/** What is compared between samples: fields that must match, clocks that must keep to their
 * rate (within a slack), and values that must stay within a tolerance. */
interface Sample {
  fixed: string
  clocks: [Clock | null, number][]
  smooth: [number[], number][]
}

function changed(at: number, last: Sample, tick: number, now: Sample, interval: number) {
  if (last.fixed !== now.fixed || last.clocks.length !== now.clocks.length) return true
  const elapsed = (tick - at) * interval
  const clocks = last.clocks.some(([a], i) => {
    const [b, slack] = now.clocks[i]
    if (!a || !b) return a !== b
    return Math.abs(a[1] - b[1]) > 1e-4 || Math.abs(a[0] + a[1] * elapsed - b[0]) > slack
  })
  const smooth = last.smooth.some(([a], i) => {
    const [b, tolerance] = now.smooth[i]
    return a.length !== b.length || a.some((x, j) => Math.abs(x - b[j]) > tolerance)
  })
  return clocks || smooth
}

class KeyBuilder<K> {
  private last: { tick: number; sample: Sample } | null = null
  constructor(private keys: (K | GoneKey)[]) {}

  offer(tick: number, sample: Sample, interval: number, key: () => Omit<K, 'tick'>) {
    if (this.last && !changed(this.last.tick, this.last.sample, tick, sample, interval)) return
    this.keys.push({ ...key(), tick } as K)
    this.last = { tick, sample }
  }

  gone(tick: number) {
    if (!this.last) return
    this.keys.push({ tick, gone: true })
    this.last = null
  }
}

const roundTo = (value: number, scale: number) => Math.round(value * scale) / scale
const vec = (p: number[] | null | undefined): Vec3 | null =>
  p ? [roundTo(p[0], 10), roundTo(p[1], 10), roundTo(p[2], 10)] : null

class Recorder {
  private round: KeyBuilder<RoundKey>
  private tracks = new Map<string, KeyBuilder<PointKey | CartKey | FlagKey>>()
  private timeLeft: [tick: number, value: number, rate: number] | null = null
  private nextTick = 0

  constructor(
    private data: ObjectiveData,
    private interval: number
  ) {
    this.round = new KeyBuilder(data.round)
  }

  add(tick: number, s: any, entityOf: (id: number) => number) {
    if (tick < this.nextTick) return
    this.nextTick = tick + this.data.step
    this.addRound(tick, s)

    const seen = new Set<string>()
    for (const o of (s.objectives ?? []) as any[]) {
      let kind: ObjectiveKind
      let id: number
      let sample: Sample
      let key: () => any
      if (o.kind === 'control_point') {
        kind = 'point'
        id = o.index
        const fixed = {
          owner: o.owner,
          capping: o.capping_team,
          locked: !!o.locked,
          blocked: !!o.blocked,
          red: o.on_point?.red ?? 0,
          blue: o.on_point?.blue ?? 0,
        }
        const pos = vec(o.pos)
        const progress: Clock = [o.cap_progress ?? 0, o.cap_rate ?? 0]
        sample = { fixed: JSON.stringify(fixed), clocks: [[progress, 0.01]], smooth: [[pos ?? [], 1]] }
        key = () => ({ ...fixed, pos, progress: [roundTo(progress[0], 1e4), roundTo(progress[1], 1e4)] })
      } else if (o.kind === 'cart') {
        kind = 'cart'
        id = o.id
        const fixed = { team: o.team, cappers: o.cappers ?? 0, speed: o.speed ?? 0 }
        const pos = vec(o.pos)!
        sample = {
          fixed: JSON.stringify(fixed),
          clocks: [],
          smooth: [
            [pos, 0.25],
            [[o.progress ?? 0], 0.0005],
          ],
        }
        key = () => ({ ...fixed, pos, progress: roundTo(o.progress ?? 0, 1e4) })
      } else if (o.kind === 'flag') {
        kind = 'flag'
        id = o.id
        const carrier = o.carrier != null ? entityOf(o.carrier) : 0
        const fixed = { team: o.team, status: o.status, carrier, points: o.points ?? null }
        const pos = carrier ? null : vec(o.pos)
        const returnsIn: Clock | null = o.returns_in != null ? [o.returns_in, -1] : null
        sample = {
          fixed: JSON.stringify(fixed),
          clocks: [[returnsIn, CLOCK_SLACK]],
          smooth: [[pos ?? [], 0.25]],
        }
        key = () => ({ ...fixed, pos, returnsIn: returnsIn && [roundTo(returnsIn[0], 100), -1] })
      } else {
        continue
      }
      const name = `${kind}:${id}`
      seen.add(name)
      let builder = this.tracks.get(name)
      if (!builder) {
        const track: ObjectiveTrack = { kind, id, keys: [] }
        this.data.tracks.push(track)
        builder = new KeyBuilder(track.keys)
        this.tracks.set(name, builder)
      }
      builder.offer(tick, sample, this.interval, key)
    }
    for (const [name, builder] of this.tracks) if (!seen.has(name)) builder.gone(tick)
  }

  private addRound(tick: number, s: any) {
    const roundTime: Clock | null = s.round_time != null ? [s.round_time, s.round === 'running' ? 1 : 0] : null
    // mp_timelimit has no paused flag, and comes rounded: whether it counts is told by how far
    // it moved since its last key, once it no longer keeps to the rate it had.
    let timeLeft: Clock | null = null
    if (s.time_left != null) {
      const secs: number = s.time_left
      const last = this.timeLeft
      if (last && Math.abs(last[1] + last[2] * (tick - last[0]) * this.interval - secs) <= TIME_LEFT_SLACK) {
        timeLeft = [secs, last[2]]
      } else {
        const moved = last && tick > last[0] ? Math.abs(secs - last[1]) / ((tick - last[0]) * this.interval) : 1
        const rate = moved < 0.5 ? 0 : -1
        this.timeLeft = [tick, secs, rate]
        timeLeft = [secs, rate]
      }
    } else {
      this.timeLeft = null
    }
    const timers = ((s.timers ?? []) as any[]).map(t => ({
      team: t.team as ObjectiveTeam,
      setup: !!t.setup,
      time: [t.remaining, t.paused ? 0 : -1] as Clock,
    }))
    const w = s.stopwatch
    const stopwatch = w
      ? {
          attackers: w.attackers,
          setting: !!w.setting,
          state: w.state,
          points: w.points,
          inHud: !!w.in_hud,
          time: [w.time, w.paused ? 0 : -1] as Clock,
        }
      : null

    const fixed = {
      round: s.round as RoundState,
      score: [s.score?.red ?? 0, s.score?.blue ?? 0] as [number, number],
      captures: s.captures ? ([s.captures.red, s.captures.blue] as [number, number]) : null,
      points: s.points ? ([s.points.red, s.points.blue, s.points.max ?? null] as [number, number, number | null]) : null,
      winLimit: s.win_limit ?? null,
    }
    const sample: Sample = {
      fixed: JSON.stringify([
        fixed,
        timers.map(t => [t.team, t.setup]),
        stopwatch && [stopwatch.attackers, stopwatch.setting, stopwatch.state, stopwatch.points, stopwatch.inHud],
      ]),
      clocks: [
        [roundTime, CLOCK_SLACK],
        [timeLeft, TIME_LEFT_SLACK],
        [stopwatch?.time ?? null, CLOCK_SLACK],
        ...timers.map(t => [t.time, CLOCK_SLACK] as [Clock, number]),
      ],
      smooth: [],
    }
    const clock = (c: Clock | null): Clock | null => c && [roundTo(c[0], 100), c[1]]
    this.round.offer(tick, sample, this.interval, () => ({
      ...fixed,
      roundTime: clock(roundTime),
      timeLeft: clock(timeLeft),
      timers: timers.map(t => ({ ...t, time: clock(t.time)! })),
      stopwatch: stopwatch && { ...stopwatch, time: clock(stopwatch.time)! },
    }))
  }
}
