import { Vector } from '@bryjch/demo.js/build'
import { Projectile, ProjectileTypeMap } from '@bryjch/demo.js/build/Data/Projectile'

import { SparseDataCache } from './SparseDataCache'
import { VectorCache } from './VectorCache'

export interface CachedProjectile {
  entityId: number
  type: string
  position: Vector
  rotation: Vector
  teamNumber: number
}

export class ProjectileCache {
  positionCache: VectorCache
  rotationCache: VectorCache
  teamNumberCache: SparseDataCache
  typeCache: SparseDataCache
  projectileCount: number = 0
  projectileEntityMap: Map<number, Projectile>

  constructor(tickCount: number, positionOffset: Vector) {
    this.positionCache = new VectorCache(tickCount, positionOffset)
    this.rotationCache = new VectorCache(tickCount)
    this.teamNumberCache = new SparseDataCache(tickCount, 1, 8, 6)
    this.typeCache = new SparseDataCache(tickCount, 1, 8, 6)
    this.projectileEntityMap = new Map<number, Projectile>()
  }

  setProjectile(tick: number, projectile: Projectile, entityId: number) {
    if (!this.projectileEntityMap.get(entityId)) {
      this.projectileEntityMap.set(entityId, projectile)
    }
    this.positionCache.setVector(entityId, tick, projectile.position)
    this.rotationCache.setVector(entityId, tick, projectile.rotation)
    this.teamNumberCache.set(entityId, tick, projectile.teamNumber)
    this.typeCache.set(entityId, tick, projectile.type)
  }

  getProjectile(tick: number, entityId: number): CachedProjectile | null {
    if (this.positionCache.get(entityId, tick, 0) === 0) {
      return null
    }
    const type = ProjectileTypeMap[this.typeCache.get(entityId, tick)]

    if (!type) {
      return null
    }

    return {
      entityId: entityId,
      position: this.positionCache.getVector(entityId, tick),
      rotation: this.rotationCache.getVector(entityId, tick),
      teamNumber: this.teamNumberCache.get(entityId, tick),
      type: type,
    }
  }

  getProjectiles(tick: number) {
    let projectiles: CachedProjectile[] = []

    for (const [entityId] of this.projectileEntityMap.entries()) {
      const projectile = this.getProjectile(tick, entityId)
      if (projectile) {
        projectiles.push(projectile)
      }
    }

    return projectiles
  }

  static rehydrate(data: ProjectileCache) {
    VectorCache.rehydrate(data.positionCache)
    VectorCache.rehydrate(data.rotationCache)
    SparseDataCache.rehydrate(data.teamNumberCache)
    SparseDataCache.rehydrate(data.typeCache)

    Object.setPrototypeOf(data, ProjectileCache.prototype)
  }
}
