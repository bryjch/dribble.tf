import { DataCache } from './DataCache'

export class SparseDataCache extends DataCache {
  sparse: number

  constructor(tickCount: number, valuesPerPlayer: number, bitWidth: number, sparse: number) {
    super(tickCount >> sparse, valuesPerPlayer, bitWidth)
    this.sparse = sparse
  }

  protected getOffset(tick: number, offset: number) {
    return (tick >> this.sparse) * this.valuesPerPlayer + offset
  }

  static rehydrate(data: SparseDataCache) {
    Object.setPrototypeOf(data, SparseDataCache.prototype)
  }
}
