import { Vector } from './Types'
import { DataCache } from './DataCache'
import { ANGLE_FIXED_SCALE, decodeFixedAngle, encodeFixedAngle } from './PositionEncoding'

export class ViewAnglesCache extends DataCache {
  scale: number

  constructor(tickCount: number) {
    super(tickCount, 3, 32)
    this.scale = ANGLE_FIXED_SCALE
  }

  getAngles(playerId: number, tick: number): Vector {
    const x = decodeFixedAngle(this.get(playerId, tick, 0), this.scale)
    const y = decodeFixedAngle(this.get(playerId, tick, 1), this.scale)
    const z = decodeFixedAngle(this.get(playerId, tick, 2), this.scale)

    return { x, y, z }
  }

  setAngles(playerId: number, tick: number, angles: Vector) {
    this.set(playerId, tick, encodeFixedAngle(angles.x, this.scale), 0)
    this.set(playerId, tick, encodeFixedAngle(angles.y, this.scale), 1)
    this.set(playerId, tick, encodeFixedAngle(angles.z, this.scale), 2)
  }

  static rehydrate(data: ViewAnglesCache) {
    if (!Number.isFinite(data.scale)) {
      data.scale = ANGLE_FIXED_SCALE
    }
    Object.setPrototypeOf(data, ViewAnglesCache.prototype)
  }
}
