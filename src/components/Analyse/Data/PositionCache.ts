import { Vector } from './Types'
import { DataCache } from './DataCache'
import { POSITION_FIXED_SCALE } from './PositionEncoding'

export interface MapBoundaries {
  boundaryMin: Vector
  boundaryMax: Vector
  cameraOffset?: Vector
  controlOffset?: Vector
}

export class PositionCache extends DataCache {
  offset: Vector
  scale: number

  constructor(tickCount: number, offset: Vector, scale: number = POSITION_FIXED_SCALE) {
    super(tickCount, 3, 32)
    this.offset = offset
    this.scale = scale
  }

  private decode(raw: number): number {
    return (raw | 0) / this.scale
  }

  private encode(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.round(value * this.scale)
  }

  getPosition(playerId: number, tick: number): Vector {
    return {
      x: this.decode(this.get(playerId, tick, 0)),
      y: this.decode(this.get(playerId, tick, 1)),
      z: this.decode(this.get(playerId, tick, 2)),
    }
  }

  setPosition(playerId: number, tick: number, position: Vector) {
    this.set(playerId, tick, this.encode(position.x - this.offset.x), 0)
    this.set(playerId, tick, this.encode(position.y - this.offset.y), 1)
    this.set(playerId, tick, this.encode(position.z - this.offset.z), 2)
  }

  static rehydrate(data: PositionCache) {
    if (!Number.isFinite(data.scale)) {
      data.scale = POSITION_FIXED_SCALE
    }
    Object.setPrototypeOf(data, PositionCache.prototype)
  }
}
