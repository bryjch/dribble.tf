import { Demo, Header, Player, Match } from '@bryjch/demo.js/build'
import { Building } from '@bryjch/demo.js/build/Data/Building'
import { PlayerResource } from '@bryjch/demo.js/build/Data/PlayerResource'

import { getMapBoundaries } from '../MapBoundries'
import { PlayerCache, CachedPlayer } from './PlayerCache'
import { BuildingCache, CachedBuilding } from './BuildingCache'

export { CachedPlayer } from './PlayerCache'

export interface CachedDeath {
  tick: number
  victim: Player
  assister: Player | null
  killer: Player | null
  weapon: string
  victimTeam: number
  assisterTeam: number
  killerTeam: number
}

export class Parser {
  buffer: ArrayBuffer
  demo: Demo
  header: Header
  playerCache: PlayerCache
  entityPlayerReverseMap: Map<string, number> = new Map()
  nextMappedPlayer = 0
  entityPlayerMap: Map<number, Player> = new Map()
  ticks: number
  match: Match
  startTick = 0
  deaths: { [tick: string]: CachedDeath[] } = {}
  buildingCache: BuildingCache

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer
    this.demo = new Demo(buffer)
  }

  scaleTick(matchTick: number): number {
    return Math.ceil((matchTick - this.startTick) / 2)
  }

  setTick(
    tick: number,
    players: Player[],
    buildings: Map<number, Building>,
    playerResources: PlayerResource[]
  ) {
    for (const player of players) {
      if (player.user.steamId !== 'BOT') {
        const playerId = this.getPlayerId(player)
        this.playerCache.setPlayer(tick, playerId, player, playerResources[player.user.entityId])
      }
    }
    for (const building of buildings.values()) {
      if (building.health > 0) {
        this.buildingCache.setBuilding(tick, building, building.builder, building.team)
      }
    }
  }

  cacheData(progressCallback: (progress: number) => void) {
    const parser = this.demo.getParser()
    const analyser = this.demo.getAnalyser()
    const packets = analyser.getPackets()
    this.header = parser.getHeader()
    this.match = analyser.match
    while (this.match.world.boundaryMin.x === 0) {
      packets.next()
    }
    const boundaryOverWrite = getMapBoundaries(this.header.map)
    if (boundaryOverWrite) {
      this.match.world.boundaryMax.x = boundaryOverWrite.boundaryMax.x
      this.match.world.boundaryMax.y = boundaryOverWrite.boundaryMax.y
      this.match.world.boundaryMin.x = boundaryOverWrite.boundaryMin.x
      this.match.world.boundaryMin.y = boundaryOverWrite.boundaryMin.y
    } else {
      throw new Error(`Map not supported "${this.header.map}".`)
    }

    // skip to >1sec after the first player joined
    while (this.match.playerEntityMap.size < 1) {
      packets.next()
    }
    for (let i = 0; i < 100; i++) {
      packets.next()
    }
    this.startTick = this.match.tick
    this.ticks = Math.ceil(this.header.ticks / 2) // scale down to 30fps
    this.playerCache = new PlayerCache(this.ticks, this.match.world.boundaryMin)
    this.buildingCache = new BuildingCache(this.ticks, this.match.world.boundaryMin)

    let lastTick = 0

    let lastProgress = 0
    for (const packet of packets) {
      const tick = Math.floor((this.match.tick - this.startTick) / 2)
      const progress = Math.round((tick / this.ticks) * 100)
      if (progress > lastProgress) {
        lastProgress = progress
        progressCallback(progress)
      }
      if (tick > lastTick) {
        this.setTick(
          tick,
          Array.from(this.match.playerEntityMap.values()),
          this.match.buildings,
          this.match.playerResources
        )
        if (tick > lastTick + 1) {
          // demo skipped ticks, copy/interpolote
          for (let i = lastTick; i < tick; i++) {
            this.setTick(
              i,
              Array.from(this.match.playerEntityMap.values()),
              this.match.buildings,
              this.match.playerResources
            )
          }
        }
        lastTick = tick
      }
    }
    for (const death of this.match.deaths) {
      const deathTick = this.scaleTick(death.tick)
      if (!this.deaths[deathTick]) {
        this.deaths[deathTick] = []
      }
      let killer: Player | null
      try {
        killer = this.match.getPlayerByUserId(death.killer)
      } catch (e) {
        killer = null
      }
      let victim: Player | null = null
      let assister: Player | null = null
      try {
        victim = this.match.getPlayerByUserId(death.victim)
        if (!victim) {
          continue
        }
      } catch (e) {
        continue
      }
      try {
        assister = death.assister ? this.match.getPlayerByUserId(death.assister) : null
      } catch (e) {}

      const killerId = killer
        ? (this.entityPlayerReverseMap.get(killer.user.steamId) as number)
        : null
      const assisterId = assister
        ? (this.entityPlayerReverseMap.get(assister.user.steamId) as number)
        : null
      const victimId = this.entityPlayerReverseMap.get(victim.user.steamId) as number

      this.deaths[deathTick].push({
        tick: deathTick,
        victim: victim,
        killer: killer,
        assister: assister,
        weapon: death.weapon,
        victimTeam: this.playerCache.metaCache.getMeta(victimId, deathTick).teamId,
        assisterTeam: assisterId
          ? this.playerCache.metaCache.getMeta(assisterId, deathTick).teamId
          : 0,
        killerTeam: killerId ? this.playerCache.metaCache.getMeta(killerId, deathTick).teamId : 0,
      })
    }
  }

  private getPlayerId(player: Player): number {
    if (!this.entityPlayerReverseMap.has(player.user.steamId)) {
      this.entityPlayerMap.set(this.nextMappedPlayer, player)
      this.entityPlayerReverseMap.set(player.user.steamId, this.nextMappedPlayer)
      this.nextMappedPlayer++
    }
    return this.entityPlayerReverseMap.get(player.user.steamId) as number
  }

  getPlayersAtTick(tick: number) {
    const players: CachedPlayer[] = []
    for (let i = 0; i < this.nextMappedPlayer; i++) {
      let entity = this.entityPlayerMap.get(i)
      if (entity) {
        players.push(this.playerCache.getPlayer(tick, i, entity.user))
      }
    }
    return players
  }

  getBuildingAtTick(tick: number): CachedBuilding[] {
    return this.buildingCache.getBuildings(tick)
  }
}
