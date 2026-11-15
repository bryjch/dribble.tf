import { UserInfo, Vector } from './Types'
import { MedigunState, UberedKind, medigunOf, uberedOf } from './StreamEvents'

export interface CachedPlayer {
  /** Source world coordinates. */
  position: Vector
  /** Pitch (x), yaw (y) and roll (z), in degrees. */
  viewAngles: Vector
  user: UserInfo
  health: number
  teamId: number
  classId: number
  team: string
  connected: number
  chargeLevel: number | null
  healTarget: number | null
  respawnTick: number | null
  /** Condition bits (burning, cloaked, …); read them with hasCondition. 0 when unknown. */
  conditions: number
  /** The medigun charge the player is under (theirs, or their medic's). */
  ubered: UberedKind | null
  /** A medic's medigun: its kind, whether it is releasing, the vaccinator's resistance. */
  medigun: MedigunState | null
  /** The item definition index of the weapon in hand; null when unknown. */
  weapon: number | null
  /** The last tick at or before this one that they fired on; null if none. */
  lastShotTick: number | null
}

/** Each player's arrays, as the decoder sends them (see decoder/src/lib.rs, format 3). */
export interface PlayerArrays {
  /** x, y, z per tick, fixed point. */
  position: Uint32Array
  /** Pitch, yaw per tick, fixed point. */
  viewAngles: Uint32Array
  health: Uint16Array
  /** Class in the low four bits, team in the high four. */
  meta: Uint8Array
  connected: Uint8Array
  uber: Uint16Array
  healTarget: Uint16Array
  conditions: Uint32Array
  charge: Uint16Array
  /** The item definition index in hand plus one; 0 for none. */
  weapon: Uint16Array
  /** The ticks the player fired on, sorted (not one per tick). */
  shots: Uint32Array
}

/** The arrays kept one value per `1 << n` ticks, and their n; the decoder's metadata says. */
export type PlayerSampling = Record<
  'health' | 'meta' | 'connected' | 'uber' | 'healTarget' | 'conditions' | 'charge' | 'weapon',
  number
>

/**
 * Every player's state for every tick of a demo, read straight from the decoder's typed arrays
 * (one set per player slot).
 */
export class PlayerTracks {
  private respawnTicks = new Map<number, number | null>()

  constructor(
    private readonly slots: (PlayerArrays | undefined)[],
    private readonly sampling: PlayerSampling,
    private readonly positionScale: number,
    private readonly angleScale: number
  ) {}

  private sampled(slot: PlayerArrays, name: keyof PlayerSampling, tick: number) {
    return slot[name][tick >> this.sampling[name]] ?? 0
  }

  team(slot: number, tick: number): number {
    const arrays = this.slots[slot]
    return arrays ? this.sampled(arrays, 'meta', tick) >> 4 : 0
  }

  /** The first tick after `tick` the player has health again, while they are dead. */
  private respawnTick(slot: number, arrays: PlayerArrays, tick: number): number | null {
    const shift = this.sampling.health
    const from = tick >> shift
    const key = slot * 0x1000000 + from
    const known = this.respawnTicks.get(key)
    if (known !== undefined) return known
    let respawn: number | null = null
    for (let i = from + 1; i < arrays.health.length; i++) {
      if (arrays.health[i] > 0) {
        respawn = i << shift
        break
      }
    }
    this.respawnTicks.set(key, respawn)
    return respawn
  }

  player(tick: number, slot: number, user: UserInfo): CachedPlayer {
    const arrays = this.slots[slot]
    const p = this.positionScale
    const a = this.angleScale
    const at = (array: Uint32Array, i: number, scale: number) => ((array[i] ?? 0) | 0) / scale
    const meta = arrays ? this.sampled(arrays, 'meta', tick) : 0
    const teamId = meta >> 4
    const health = arrays ? this.sampled(arrays, 'health', tick) : 0
    const charge = arrays ? this.sampled(arrays, 'charge', tick) : 0
    const uber = arrays ? this.sampled(arrays, 'uber', tick) : 0
    const healTarget = arrays ? this.sampled(arrays, 'healTarget', tick) : 0
    const weapon = arrays ? this.sampled(arrays, 'weapon', tick) : 0
    return {
      position: arrays
        ? {
            x: at(arrays.position, tick * 3, p),
            y: at(arrays.position, tick * 3 + 1, p),
            z: at(arrays.position, tick * 3 + 2, p),
          }
        : { x: 0, y: 0, z: 0 },
      viewAngles: arrays
        ? { x: at(arrays.viewAngles, tick * 2, a), y: at(arrays.viewAngles, tick * 2 + 1, a), z: 0 }
        : { x: 0, y: 0, z: 0 },
      user,
      health,
      teamId,
      classId: meta & 0x0f,
      team: teamId === 2 ? 'red' : teamId === 3 ? 'blue' : '',
      connected: arrays ? this.sampled(arrays, 'connected', tick) : 0,
      chargeLevel: arrays ? uber : null,
      healTarget: arrays ? healTarget : null,
      respawnTick: arrays && health === 0 ? this.respawnTick(slot, arrays, tick) : null,
      conditions: arrays ? this.sampled(arrays, 'conditions', tick) : 0,
      ubered: uberedOf(charge),
      medigun: medigunOf(charge),
      weapon: weapon > 0 ? weapon - 1 : null,
      lastShotTick: lastAtOrBefore(arrays?.shots, tick),
    }
  }

  get byteLength() {
    let total = 0
    for (const arrays of this.slots) {
      if (!arrays) continue
      for (const array of Object.values(arrays)) total += (array as ArrayBufferView).byteLength
    }
    return total
  }
}

/** The last value at or before `tick` in a sorted list of ticks. */
export function lastAtOrBefore(ticks: ArrayLike<number> | undefined, tick: number): number | null {
  if (!ticks || ticks.length === 0 || ticks[0] > tick) return null
  let lo = 0
  let hi = ticks.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ticks[mid] <= tick) lo = mid
    else hi = mid - 1
  }
  return ticks[lo]
}
