import { UserInfo, Vector } from './Types'

import { PositionCache } from './PositionCache'
import { ViewAnglesCache } from './ViewAnglesCache'
import { PlayerMetaCache } from './PlayerMetaCache'
import { HealthCache } from './HealthCache'
import { SparseDataCache } from './SparseDataCache'
import { MedigunState, UberedKind, medigunOf, uberedOf } from './StreamEvents'

export class CachedPlayer {
  position!: Vector
  viewAngles!: Vector
  user!: UserInfo
  health!: number
  teamId!: number
  classId!: number
  team!: string
  connected!: number
  chargeLevel!: number | null
  healTarget!: number | null
  respawnTick!: number | null
  /** Condition bits (burning, cloaked, …); read them with hasCondition. 0 when unknown. */
  conditions!: number
  /** The medigun charge the player is under (theirs, or their medic's). */
  ubered!: UberedKind | null
  /** A medic's medigun: its kind, whether it is releasing, the vaccinator's resistance. */
  medigun!: MedigunState | null
}

/** Ticks per value in the conditions and charge caches: one every 4 ticks. */
export const STATUS_SPARSE = 2

export class PlayerCache {
  tickCount: number
  positionCache: PositionCache
  healthCache: HealthCache
  metaCache: PlayerMetaCache
  viewAnglesCache: ViewAnglesCache
  uberCache: SparseDataCache
  healTargetCache: SparseDataCache
  connectedCache: SparseDataCache
  conditionsCache: SparseDataCache
  chargeCache: SparseDataCache
  respawnTickCache: Map<string, number | null> = new Map()

  constructor(tickCount: number, positionOffset: Vector) {
    this.tickCount = tickCount
    this.positionCache = new PositionCache(tickCount, positionOffset)
    this.healthCache = new HealthCache(tickCount)
    this.metaCache = new PlayerMetaCache(tickCount)
    this.viewAnglesCache = new ViewAnglesCache(tickCount)
    this.uberCache = new SparseDataCache(tickCount, 1, 8, 4)
    this.healTargetCache = new SparseDataCache(tickCount, 1, 8, 4)
    this.connectedCache = new SparseDataCache(tickCount, 1, 8, 4)
    this.conditionsCache = new SparseDataCache(tickCount, 1, 32, STATUS_SPARSE)
    this.chargeCache = new SparseDataCache(tickCount, 1, 16, STATUS_SPARSE)
  }

  getRespawnTick(playerId: number, tick: number): number | null {
    const sparse = this.healthCache.sparse
    const sparseIndex = tick >> sparse
    const cacheKey = `${playerId}-${sparseIndex}`

    if (this.respawnTickCache.has(cacheKey)) {
      return this.respawnTickCache.get(cacheKey)!
    }

    const data = this.healthCache.data[playerId]
    if (!data) {
      this.respawnTickCache.set(cacheKey, null)
      return null
    }

    for (let i = sparseIndex + 1; i < data.length; i++) {
      if (data[i] > 0) {
        const respawnTick = i << sparse
        this.respawnTickCache.set(cacheKey, respawnTick)
        return respawnTick
      }
    }

    this.respawnTickCache.set(cacheKey, null)
    return null
  }

  getPlayer(tick: number, playerId: number, user: UserInfo): CachedPlayer {
    const meta = this.metaCache.getMeta(playerId, tick)
    const team = meta.teamId === 2 ? 'red' : meta.teamId === 3 ? 'blue' : ''
    const health = this.healthCache.get(playerId, tick)
    const charge = this.chargeCache.get(playerId, tick) ?? 0
    return {
      position: this.positionCache.getPosition(playerId, tick),
      viewAngles: this.viewAnglesCache.getAngles(playerId, tick),
      user: user,
      health,
      teamId: meta.teamId,
      classId: meta.classId,
      team: team,
      connected: this.connectedCache.get(playerId, tick),
      chargeLevel: this.uberCache.getOrNull(playerId, tick),
      healTarget: this.healTargetCache.getOrNull(playerId, tick),
      respawnTick: health === 0 ? this.getRespawnTick(playerId, tick) : null,
      conditions: this.conditionsCache.get(playerId, tick) ?? 0,
      ubered: uberedOf(charge),
      medigun: medigunOf(charge),
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
    SparseDataCache.rehydrate(data.conditionsCache)
    SparseDataCache.rehydrate(data.chargeCache)

    data.respawnTickCache = new Map()
    Object.setPrototypeOf(data, PlayerCache.prototype)
  }
}
