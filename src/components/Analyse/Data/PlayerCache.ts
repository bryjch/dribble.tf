import { Player, UserInfo, Vector } from '@libs/demo.js/build'
import { LifeState } from '@libs/demo.js/build/Data/Player'
import { PlayerResource } from '@libs/demo.js/build/Data/PlayerResource'

import { PositionCache } from './PositionCache'
import { ViewAnglesCache } from './ViewAnglesCache'
import { PlayerMetaCache } from './PlayerMetaCache'
import { HealthCache } from './HealthCache'
import { SparseDataCache } from './SparseDataCache'

export class CachedPlayer {
  position: Vector
  viewAngles: Vector
  user: UserInfo
  health: number
  teamId: number
  classId: number
  team: string
  chargeLevel: number | null
}

export class PlayerCache {
  tickCount: number
  positionCache: PositionCache
  healthCache: HealthCache
  metaCache: PlayerMetaCache
  viewAnglesCache: ViewAnglesCache
  uberCache: SparseDataCache

  constructor(tickCount: number, positionOffset: Vector) {
    this.tickCount = tickCount
    this.positionCache = new PositionCache(tickCount, positionOffset)
    this.healthCache = new HealthCache(tickCount)
    this.metaCache = new PlayerMetaCache(tickCount)
    this.viewAnglesCache = new ViewAnglesCache(tickCount)
    this.uberCache = new SparseDataCache(tickCount, 1, 8, 4)
  }

  setPlayer(tick: number, playerId: number, player: Player, playerResource: PlayerResource) {
    this.positionCache.setPosition(playerId, tick, player.position)
    this.viewAnglesCache.setAngles(playerId, tick, player.viewAngles)
    this.healthCache.set(playerId, tick, player.lifeState === LifeState.ALIVE ? player.health : 0)
    this.metaCache.setMeta(playerId, tick, { classId: player.classId, teamId: player.team })
    if (playerResource.chargeLevel > 0) {
      this.uberCache.set(playerId, tick, playerResource.chargeLevel)
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
      chargeLevel: this.uberCache.getOrNull(playerId, tick),
    }
  }

  static rehydrate(data: PlayerCache) {
    PositionCache.rehydrate(data.positionCache)
    ViewAnglesCache.rehydrate(data.viewAnglesCache)
    HealthCache.rehydrate(data.healthCache)
    PlayerMetaCache.rehydrate(data.metaCache)
    SparseDataCache.rehydrate(data.uberCache)

    Object.setPrototypeOf(data, PlayerCache.prototype)
  }
}
