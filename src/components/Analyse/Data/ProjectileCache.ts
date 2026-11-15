import { Vector } from './Types'
import { ANGLE_FIXED_SCALE, POSITION_FIXED_SCALE } from './PositionEncoding'

export interface CachedProjectile {
  entityId: number
  type: string
  position: Vector
  rotation: Vector
  teamNumber: number
}

const ProjectileTypeMap: Record<number, string> = {
  1: 'rocket',
  2: 'pipebomb',
  3: 'stickybomb',
  4: 'healingBolt',
}

/** Values per track in `tracks`: entity id, type, team, first tick, ticks. */
export const TRACK_STRIDE = 5

/** Ticks per index block: the tracks alive at a tick are looked for in its block only. */
const BLOCK_BITS = 6

/**
 * Projectiles, each kept only from when it appears to when it goes: a rocket lives a second or
 * two, so a whole match's worth of ticks for each would be mostly empty.
 *
 * `tracks` holds TRACK_STRIDE values per projectile, sorted by first tick. `positions` and
 * `rotations` hold 3 fixed-point values per tick of each track, track after track; positions
 * are relative to the world's boundaryMin, like the players'.
 */
export class ProjectileCache {
  tracks: Uint32Array
  positions: Uint32Array
  rotations: Uint32Array
  positionScale: number
  angleScale: number

  // Built on first use, on the main thread: not sent from the worker.
  private sampleStarts?: Uint32Array
  private blocks?: number[][]

  constructor(
    tracks: Uint32Array = new Uint32Array(0),
    positions: Uint32Array = new Uint32Array(0),
    rotations: Uint32Array = new Uint32Array(0),
    positionScale: number = POSITION_FIXED_SCALE,
    angleScale: number = ANGLE_FIXED_SCALE
  ) {
    this.tracks = tracks
    this.positions = positions
    this.rotations = rotations
    this.positionScale = positionScale
    this.angleScale = angleScale
  }

  get projectileCount() {
    return this.tracks.length / TRACK_STRIDE
  }

  get byteLength() {
    return this.tracks.byteLength + this.positions.byteLength + this.rotations.byteLength
  }

  private index() {
    const count = this.projectileCount
    const starts = new Uint32Array(count)
    const blocks: number[][] = []
    let sample = 0
    for (let i = 0; i < count; i++) {
      const first = this.tracks[i * TRACK_STRIDE + 3]
      const length = this.tracks[i * TRACK_STRIDE + 4]
      starts[i] = sample
      sample += length
      for (let b = first >> BLOCK_BITS; b <= (first + length - 1) >> BLOCK_BITS; b++) {
        ;(blocks[b] ??= []).push(i)
      }
    }
    this.sampleStarts = starts
    this.blocks = blocks
  }

  getProjectiles(tick: number): CachedProjectile[] {
    if (!this.blocks) this.index()
    const candidates = this.blocks![tick >> BLOCK_BITS]
    if (!candidates) return []

    const out: CachedProjectile[] = []
    const { tracks, positions, rotations, positionScale, angleScale } = this
    for (const i of candidates) {
      const t = i * TRACK_STRIDE
      const first = tracks[t + 3]
      if (tick < first || tick >= first + tracks[t + 4]) continue
      const type = ProjectileTypeMap[tracks[t + 1]]
      if (!type) continue
      const o = (this.sampleStarts![i] + tick - first) * 3
      out.push({
        entityId: tracks[t],
        type,
        position: {
          x: (positions[o] | 0) / positionScale,
          y: (positions[o + 1] | 0) / positionScale,
          z: (positions[o + 2] | 0) / positionScale,
        },
        rotation: {
          x: (rotations[o] | 0) / angleScale,
          y: (rotations[o + 1] | 0) / angleScale,
          z: (rotations[o + 2] | 0) / angleScale,
        },
        teamNumber: tracks[t + 2],
      })
    }
    return out
  }

  static rehydrate(data: ProjectileCache) {
    Object.setPrototypeOf(data, ProjectileCache.prototype)
  }
}

/**
 * Turns parser2's projectile caches (a whole-match array per entity slot, zero while empty)
 * into tracks. A slot's projectile ends where its position goes empty or its type changes.
 */
export function tracksFromSlots(
  ids: number[],
  position: Uint32Array[],
  rotation: Uint32Array[],
  team: ArrayLike<number>[],
  type: ArrayLike<number>[],
  sparse: number
) {
  const tracks: number[] = []
  let samples = 0
  const runs: { slot: number; first: number; length: number }[] = []

  for (let slot = 0; slot < ids.length; slot++) {
    const pos = position[slot]
    if (!pos) continue
    const ticks = pos.length / 3
    let first = -1
    let runType = 0
    const close = (end: number) => {
      if (first < 0) return
      runs.push({ slot, first, length: end - first })
      tracks.push(ids[slot], runType, team[slot]?.[first >> sparse] ?? 0, first, end - first)
      samples += end - first
      first = -1
    }
    for (let tick = 0; tick < ticks; tick++) {
      const o = tick * 3
      const kind = type[slot]?.[tick >> sparse] ?? 0
      const present = (pos[o] | pos[o + 1] | pos[o + 2]) !== 0 && kind > 0
      if (!present || kind !== runType) close(tick)
      if (present && first < 0) {
        first = tick
        runType = kind
      }
    }
    close(ticks)
  }

  // Sorted by first tick, as ProjectileCache expects.
  const order = runs.map((_, i) => i).sort((a, b) => runs[a].first - runs[b].first)
  const sortedTracks = new Uint32Array(tracks.length)
  const positions = new Uint32Array(samples * 3)
  const rotations = new Uint32Array(samples * 3)
  let at = 0
  order.forEach((r, n) => {
    sortedTracks.set(tracks.slice(r * TRACK_STRIDE, (r + 1) * TRACK_STRIDE), n * TRACK_STRIDE)
    const { slot, first, length } = runs[r]
    positions.set(position[slot].subarray(first * 3, (first + length) * 3), at * 3)
    if (rotation[slot]) rotations.set(rotation[slot].subarray(first * 3, (first + length) * 3), at * 3)
    at += length
  })
  return { tracks: sortedTracks, positions, rotations }
}
