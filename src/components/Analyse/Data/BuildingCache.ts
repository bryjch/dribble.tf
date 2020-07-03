import { Vector } from '@bryjch/demo.js/build'
import { Building } from '@bryjch/demo.js/build/Data/Building'

import { SparseDataCache } from './SparseDataCache'

export interface CachedBuilding {
  type: number
  health: number
  position: Vector
  level: number
  team: number
  angle: number
}

export class BuildingCache {
  positionCache: SparseDataCache
  healthCache: SparseDataCache
  levelCache: SparseDataCache
  engineers: number = 0
  playerIndexMap: { [playerId: string]: number } = {}
  positionOffset: Vector
  angleCache: SparseDataCache

  constructor(tickCount: number, positionOffset: Vector) {
    this.positionCache = new SparseDataCache(tickCount, 2, 16, 6)
    this.healthCache = new SparseDataCache(tickCount, 1, 16, 2)
    this.levelCache = new SparseDataCache(tickCount, 1, 8, 6)
    this.positionOffset = positionOffset
    this.angleCache = new SparseDataCache(tickCount, 1, 16, 1)
  }

  private getBuildingIndex(building: Building, playerId: number): number {
    const base = this.playerIndexMap[playerId] * 4
    switch (building.type) {
      case 'sentry':
        return base
      case 'dispenser':
        return base + 1
      case 'teleporter':
        return base + (building.isEntrance ? 2 : 3)
    }
  }

  setBuilding(tick: number, building: Building, playerId: number, team: number) {
    if (!this.playerIndexMap[playerId]) {
      this.playerIndexMap[playerId] = this.engineers
      this.engineers++
    }
    const index = this.getBuildingIndex(building, playerId)
    this.positionCache.set(index, tick, building.position.x - this.positionOffset.x, 0)
    this.positionCache.set(index, tick, building.position.y - this.positionOffset.y, 1)
    this.healthCache.set(index, tick, building.health)
    this.levelCache.set(index, tick, building.level + (team << 3))
    if (building.type === 'teleporter' && building.yawToExit) {
      this.angleCache.set(index, tick, building.angle - building.yawToExit + 180)
    } else if (building.type === 'sentry') {
      this.angleCache.set(index, tick, building.angle)
    }
  }

  getBuilding(tick: number, index: number): CachedBuilding | null {
    if (this.healthCache.get(index, tick) === 0) {
      return null
    }
    const levelData = this.levelCache.get(index, tick)
    return {
      type: index % 4,
      health: this.healthCache.get(index, tick),
      level: levelData & 0x7,
      position: {
        x: this.positionCache.get(index, tick, 0),
        y: this.positionCache.get(index, tick, 1),
        z: this.positionCache.get(index, tick, 2),
      },
      team: levelData >> 3,
      angle: this.angleCache.get(index, tick),
    }
  }

  getBuildings(tick: number): CachedBuilding[] {
    let buildings: CachedBuilding[] = []
    for (let p = 0; p < this.engineers; p++) {
      for (let i = 0; i < 4; i++) {
        const building = this.getBuilding(tick, p * 4 + i)
        if (building) {
          buildings.push(building)
        }
      }
    }
    return buildings
  }

  static rehydrate(data: BuildingCache) {
    SparseDataCache.rehydrate(data.positionCache)
    SparseDataCache.rehydrate(data.healthCache)
    SparseDataCache.rehydrate(data.levelCache)
    SparseDataCache.rehydrate(data.angleCache)

    Object.setPrototypeOf(data, BuildingCache.prototype)
  }
}
