import { DataCache } from './DataCache'

export class ViewAngleCache extends DataCache {
  constructor(tickCount: number) {
    super(tickCount, 1, 16)
  }

  static rehydrate(data: ViewAngleCache) {
    Object.setPrototypeOf(data, ViewAngleCache.prototype)
  }
}
