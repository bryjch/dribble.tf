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
