import { Vector } from '@bryjch/demo.js/build'
import { DataCache } from './DataCache'

export interface MapBoundaries {
  boundaryMin: Vector
  boundaryMax: Vector
  cameraOffset?: Vector
  controlOffset?: Vector
}

export class PositionCache extends DataCache {
  offset: Vector

  constructor(tickCount: number, offset: Vector) {
    super(tickCount, 3, 32)
    this.offset = offset
  }

  getPosition(playerId: number, tick: number): Vector {
    return {
      x: this.get(playerId, tick, 0),
      y: this.get(playerId, tick, 1),
      z: this.get(playerId, tick, 2),
    }
  }

  setPosition(playerId: number, tick: number, position: Vector) {
    this.set(playerId, tick, position.x - this.offset.x, 0)
    this.set(playerId, tick, position.y - this.offset.y, 1)
    this.set(playerId, tick, position.z - this.offset.z, 2)
  }

  static rehydrate(data: PositionCache) {
    Object.setPrototypeOf(data, PositionCache.prototype)
  }
}
