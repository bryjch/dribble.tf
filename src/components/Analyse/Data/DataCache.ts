export type DataArray = Uint32Array | Uint8Array | Uint16Array

export class DataCache {
  data: DataArray[] = []
  bitWidth: number
  tickCount: number
  valuesPerPlayer: number

  constructor(tickCount: number, valuesPerPlayer: number, bitWidth: number) {
    this.tickCount = tickCount
    this.valuesPerPlayer = valuesPerPlayer
    this.bitWidth = bitWidth
  }

  protected makeArray(): DataArray {
    switch (this.bitWidth) {
      case 8:
        return new Uint16Array(this.length)
      case 16:
        return new Uint16Array(this.length)
      case 32:
        return new Uint32Array(this.length)
      default:
        throw new Error('invalid bit width for cache')
    }
  }

  protected getPlayerData(playerId: number, make: boolean = true) {
    if (!this.data[playerId]) {
      if (!make) {
        return null
      }
      this.data[playerId] = this.makeArray()
    }
    return this.data[playerId]
  }

  get length() {
    return this.valuesPerPlayer * this.tickCount
  }

  protected getOffset(tick: number, offset: number) {
    return tick * this.valuesPerPlayer + offset
  }

  get(playerId: number, tick: number, offset: number = 0): number {
    const data = this.getPlayerData(playerId, false)
    if (!data) {
      return 0
    }
    return data[this.getOffset(tick, offset)]
  }

  getOrNull(playerId: number, tick: number, offset: number = 0): number | null {
    const data = this.getPlayerData(playerId, false)
    if (!data) {
      return null
    }
    return data[this.getOffset(tick, offset)]
  }

  set(playerId: number, tick: number, value: number, offset: number = 0) {
    const data = this.getPlayerData(playerId) as DataArray
    data[this.getOffset(tick, offset)] = value
  }

  static rehydrate(data: DataCache) {
    Object.setPrototypeOf(data, DataCache.prototype)
  }
}
