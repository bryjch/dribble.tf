import { Vector } from './Types'
import { ANGLE_FIXED_SCALE, POSITION_FIXED_SCALE } from './PositionEncoding'
import { BUILDING_KINDS, BuildingKind } from './StreamEvents'

export interface CachedBuilding {
  entityId: number
  kind: BuildingKind
  /** 2 red, 3 blue. */
  team: number
  /** The engineer's entity id, or 0 if unknown. */
  builder: number
  level: number
  health: number
  maxHealth: number
  /** Relative to the world's boundaryMin, like the players'. */
  position: Vector
  yaw: number
  /** Where a sentry's turret points (yaw, degrees). */
  aim: number | null
  /** The entity id of the player a sentry is aiming at. */
  target: number | null
  sapped: boolean
  /** Still being built. */
  constructing: boolean
  mini: boolean
  /** A teleporter entrance (else an exit, or not a teleporter). */
  entrance: boolean
  /** A sentry firing. */
  attacking: boolean
}

/** Values per track in `tracks`: entity id, kind, team, builder entity, first span, spans. */
export const BUILDING_TRACK_STRIDE = 6
/** Values per sample: x, y, z, yaw, aim, health | max << 16, level | flags << 8, target. */
export const BUILDING_SAMPLE_STRIDE = 8

const FLAG_SAPPED = 1 << 0
const FLAG_CONSTRUCTING = 1 << 1
const FLAG_MINI = 1 << 2
const FLAG_ENTRANCE = 1 << 3
const FLAG_AIM = 1 << 4
const FLAG_ATTACKING = 1 << 5

/** Spans per index block: the buildings standing at a tick are looked for in its block only. */
const BLOCK_BITS = 4

const lerpAngle = (a: number, b: number, t: number) =>
  a + (((((b - a) % 360) + 540) % 360) - 180) * t

/**
 * Engineer buildings, each kept from when it is put down to when it goes, one sample per span
 * of `1 << sparse` ticks. A sentry's aim is interpolated between spans.
 */
export class BuildingCache {
  tracks: Uint32Array
  samples: Uint32Array
  sparse: number
  positionScale: number
  angleScale: number

  // Built on first use, on the main thread: not sent from the worker.
  private sampleStarts?: Uint32Array
  private blocks?: number[][]

  constructor(
    tracks: Uint32Array = new Uint32Array(0),
    samples: Uint32Array = new Uint32Array(0),
    sparse: number = 2,
    positionScale: number = POSITION_FIXED_SCALE,
    angleScale: number = ANGLE_FIXED_SCALE
  ) {
    this.tracks = tracks
    this.samples = samples
    this.sparse = sparse
    this.positionScale = positionScale
    this.angleScale = angleScale
  }

  get buildingCount() {
    return this.tracks.length / BUILDING_TRACK_STRIDE
  }

  get byteLength() {
    return this.tracks.byteLength + this.samples.byteLength
  }

  private index() {
    const count = this.buildingCount
    const starts = new Uint32Array(count)
    const blocks: number[][] = []
    let sample = 0
    for (let i = 0; i < count; i++) {
      const first = this.tracks[i * BUILDING_TRACK_STRIDE + 4]
      const spans = this.tracks[i * BUILDING_TRACK_STRIDE + 5]
      starts[i] = sample
      sample += spans
      for (let b = first >> BLOCK_BITS; b <= (first + spans - 1) >> BLOCK_BITS; b++) {
        ;(blocks[b] ??= []).push(i)
      }
    }
    this.sampleStarts = starts
    this.blocks = blocks
  }

  getBuildings(tick: number): CachedBuilding[] {
    if (!this.blocks) this.index()
    const span = tick >> this.sparse
    const candidates = this.blocks![span >> BLOCK_BITS]
    if (!candidates) return []

    const out: CachedBuilding[] = []
    const { tracks, samples, positionScale, angleScale } = this
    const between = (tick & ((1 << this.sparse) - 1)) / (1 << this.sparse)
    for (const i of candidates) {
      const t = i * BUILDING_TRACK_STRIDE
      const first = tracks[t + 4]
      const spans = tracks[t + 5]
      if (span < first || span >= first + spans) continue
      const n = this.sampleStarts![i] + span - first
      const o = n * BUILDING_SAMPLE_STRIDE
      const status = samples[o + 6]
      const flags = status >> 8
      let aim: number | null = null
      if (flags & FLAG_AIM) {
        aim = (samples[o + 4] | 0) / angleScale
        if (span + 1 < first + spans) {
          const next = (samples[o + BUILDING_SAMPLE_STRIDE + 4] | 0) / angleScale
          aim = lerpAngle(aim, next, between)
        }
      }
      out.push({
        entityId: tracks[t],
        kind: BUILDING_KINDS[tracks[t + 1]] || 'sentry',
        team: tracks[t + 2],
        builder: tracks[t + 3],
        level: status & 0xff,
        health: samples[o + 5] & 0xffff,
        maxHealth: samples[o + 5] >>> 16,
        position: {
          x: (samples[o] | 0) / positionScale,
          y: (samples[o + 1] | 0) / positionScale,
          z: (samples[o + 2] | 0) / positionScale,
        },
        yaw: (samples[o + 3] | 0) / angleScale,
        aim,
        target: samples[o + 7] || null,
        sapped: (flags & FLAG_SAPPED) !== 0,
        constructing: (flags & FLAG_CONSTRUCTING) !== 0,
        mini: (flags & FLAG_MINI) !== 0,
        entrance: (flags & FLAG_ENTRANCE) !== 0,
        attacking: (flags & FLAG_ATTACKING) !== 0,
      })
    }
    return out
  }

  /** Moves every building by a fixed-point offset (a map's own bounds replacing the demo's). */
  shift(dx: number, dy: number, dz: number) {
    const s = this.samples
    for (let o = 0; o < s.length; o += BUILDING_SAMPLE_STRIDE) {
      s[o] += dx
      s[o + 1] += dy
      s[o + 2] += dz
    }
  }

  static rehydrate(data: BuildingCache) {
    Object.setPrototypeOf(data, BuildingCache.prototype)
  }
}
