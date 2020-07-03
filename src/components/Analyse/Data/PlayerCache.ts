import { Player, UserInfo, Vector } from '@bryjch/demo.js/build'
import { PlayerResource } from '@bryjch/demo.js/build/Data/PlayerResource'
import { CWeaponMedigun } from '@bryjch/demo.js/build/Data/Weapon'

import { PositionCache } from './PositionCache'
import { ViewAnglesCache } from './ViewAnglesCache'
import { PlayerMetaCache } from './PlayerMetaCache'
import { HealthCache } from './HealthCache'
import { SparseDataCache } from './SparseDataCache'
import { LifeState } from './Enums'

export class CachedPlayer {
  position: Vector
  viewAngles: Vector
  user: UserInfo
  health: number
  teamId: number
  classId: number
  team: string
  connected: number
  chargeLevel: number | null
  healTarget: number | null
}

export class PlayerCache {
  tickCount: number
  positionCache: PositionCache
  healthCache: HealthCache
  metaCache: PlayerMetaCache
  viewAnglesCache: ViewAnglesCache
  uberCache: SparseDataCache
  healTargetCache: SparseDataCache
  connectedCache: SparseDataCache

  constructor(tickCount: number, positionOffset: Vector) {
    this.tickCount = tickCount
    this.positionCache = new PositionCache(tickCount, positionOffset)
    this.healthCache = new HealthCache(tickCount)
    this.metaCache = new PlayerMetaCache(tickCount)
    this.viewAnglesCache = new ViewAnglesCache(tickCount)
    this.uberCache = new SparseDataCache(tickCount, 1, 8, 4)
    this.healTargetCache = new SparseDataCache(tickCount, 1, 8, 4)
    this.connectedCache = new SparseDataCache(tickCount, 1, 8, 4)
  }

  setPlayer(tick: number, playerId: number, player: Player, playerResource: PlayerResource) {
    this.positionCache.setPosition(playerId, tick, player.position)
    this.viewAnglesCache.setAngles(playerId, tick, player.viewAngles)
    this.healthCache.set(playerId, tick, player.lifeState === LifeState.ALIVE ? player.health : 0)
    this.metaCache.setMeta(playerId, tick, { classId: player.classId, teamId: player.team })
    this.connectedCache.set(playerId, tick, playerResource.connected ? 1 : 0)

    // additional data for medics
    if (playerResource.chargeLevel > 0) {
      this.uberCache.set(playerId, tick, playerResource.chargeLevel)

      let healTarget
      try {
        healTarget = (player.weapons.find(
          ({ className }) => className === 'CWeaponMedigun'
        ) as CWeaponMedigun).healTarget
      } catch (error) {
        healTarget = 0
      }
      this.healTargetCache.set(playerId, tick, healTarget)
    }
  }

  getPlayer(tick: number, playerId: number, user: UserInfo): CachedPlayer {
    const meta = this.metaCache.getMeta(playerId, tick)
    const team = meta.teamId === 2 ? 'red' : meta.teamId === 3 ? 'blue' : ''
    return {
      position: this.positionCache.getPosition(playerId, tick),
      viewAngles: this.viewAnglesCache.getAngles(playerId, tick),
      user: user,
      health: this.healthCache.get(playerId, tick),
      teamId: meta.teamId,
      classId: meta.classId,
      team: team,
      connected: this.connectedCache.get(playerId, tick),
      chargeLevel: this.uberCache.getOrNull(playerId, tick),
      healTarget: this.healTargetCache.getOrNull(playerId, tick),
    }
  }

  static rehydrate(data: PlayerCache) {
    PositionCache.rehydrate(data.positionCache)
    ViewAnglesCache.rehydrate(data.viewAnglesCache)
    HealthCache.rehydrate(data.healthCache)
    PlayerMetaCache.rehydrate(data.metaCache)
    SparseDataCache.rehydrate(data.uberCache)
    SparseDataCache.rehydrate(data.healTargetCache)
    SparseDataCache.rehydrate(data.connectedCache)

    Object.setPrototypeOf(data, PlayerCache.prototype)
  }
}
