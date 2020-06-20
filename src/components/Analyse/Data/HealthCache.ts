import { SparseDataCache } from './SparseDataCache'

export class HealthCache extends SparseDataCache {
  constructor(tickCount: number) {
    super(tickCount, 1, 16, 2)
  }

  static rehydrate(data: HealthCache) {
    Object.setPrototypeOf(data, HealthCache.prototype)
  }
}
