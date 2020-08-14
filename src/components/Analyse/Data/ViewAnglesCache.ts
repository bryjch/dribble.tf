import { Vector } from '@bryjch/demo.js/build'
import { DataCache } from './DataCache'

export class ViewAnglesCache extends DataCache {
  constructor(tickCount: number) {
    super(tickCount, 3, 32)
  }

  getAngles(playerId: number, tick: number): Vector {
    return {
      x: this.get(playerId, tick, 0) << 32, // bitshift to handle negative values
      y: this.get(playerId, tick, 1) << 32, // bitshift to handle negative values
      z: this.get(playerId, tick, 2),
    }
  }

  setAngles(playerId: number, tick: number, angles: Vector) {
    this.set(playerId, tick, angles.x, 0)
    this.set(playerId, tick, angles.y, 1)
    this.set(playerId, tick, angles.z, 2)
  }

  static rehydrate(data: ViewAnglesCache) {
    Object.setPrototypeOf(data, ViewAnglesCache.prototype)
  }
}
