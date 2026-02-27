import { Vector } from './Types'
import { DataCache } from './DataCache'

export class VectorCache extends DataCache {
  offset: Vector
  scale: number

  constructor(tickCount: number, offset: Vector = { x: 0, y: 0, z: 0 }, scale: number = 1) {
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

  getVector(playerId: number, tick: number): Vector {
    return {
      x: this.decode(this.get(playerId, tick, 0)),
      y: this.decode(this.get(playerId, tick, 1)),
      z: this.decode(this.get(playerId, tick, 2)),
    }
  }

  setVector(playerId: number, tick: number, vector: Vector) {
    this.set(playerId, tick, this.encode(vector.x - this.offset.x), 0)
    this.set(playerId, tick, this.encode(vector.y - this.offset.y), 1)
    this.set(playerId, tick, this.encode(vector.z - this.offset.z), 2)
  }

  static rehydrate(data: VectorCache) {
    if (!Number.isFinite(data.scale)) {
      data.scale = 1
    }
    Object.setPrototypeOf(data, VectorCache.prototype)
  }
}
