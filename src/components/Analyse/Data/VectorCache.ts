import { Vector } from '@bryjch/demo.js/build'
import { DataCache } from './DataCache'

export class VectorCache extends DataCache {
  offset: Vector

  constructor(tickCount: number, offset: Vector = { x: 0, y: 0, z: 0 }) {
    super(tickCount, 3, 32)
    this.offset = offset
  }

  getVector(playerId: number, tick: number): Vector {
    return {
      x: this.get(playerId, tick, 0),
      y: this.get(playerId, tick, 1),
      z: this.get(playerId, tick, 2),
    }
  }

  setVector(playerId: number, tick: number, vector: Vector) {
    this.set(playerId, tick, vector.x - this.offset.x, 0)
    this.set(playerId, tick, vector.y - this.offset.y, 1)
    this.set(playerId, tick, vector.z - this.offset.z, 2)
  }

  static rehydrate(data: VectorCache) {
    Object.setPrototypeOf(data, VectorCache.prototype)
  }
}
