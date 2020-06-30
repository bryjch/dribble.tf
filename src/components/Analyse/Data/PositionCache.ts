import { DataCache } from './DataCache'

export interface Point {
  x: number
  y: number
  z: number
}

export interface MapBoundary {
  boundaryMin: Point
  boundaryMax: Point
}

export class PositionCache extends DataCache {
  offset: Point

  constructor(tickCount: number, offset: Point) {
    super(tickCount, 3, 32)
    this.offset = offset
  }

  getPosition(playerId: number, tick: number): Point {
    return {
      x: this.get(playerId, tick, 0),
      y: this.get(playerId, tick, 1),
      z: this.get(playerId, tick, 2),
    }
  }

  setPosition(playerId: number, tick: number, position: Point) {
    this.set(playerId, tick, position.x - this.offset.x, 0)
    this.set(playerId, tick, position.y - this.offset.y, 1)
    this.set(playerId, tick, (position.z || 0) - (this.offset.z || 0), 2)
  }

  static rehydrate(data: PositionCache) {
    Object.setPrototypeOf(data, PositionCache.prototype)
  }
}
