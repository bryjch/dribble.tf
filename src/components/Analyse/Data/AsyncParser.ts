import { PlayerCache, CachedPlayer } from './PlayerCache'
import { BuildingCache, CachedBuilding } from './BuildingCache'
import { ProjectileCache, CachedProjectile } from './ProjectileCache'
import { ChatEntry, Header, PlayerRef, Round, World } from './Types'

export interface CachedDeath {
  tick: number
  victim: PlayerRef
  assister: PlayerRef | null
  killer: PlayerRef | null
  weapon: string
  victimTeam: number
  assisterTeam: number
  killerTeam: number
}

export interface ParserPerformanceStats {
  workerTotalMs: number
  parseMs: number
  hydrateMs: number
  transferMs: number
  playerCount: number
  projectileCount: number
  ticks: number
  playerCacheBytes: number
  projectileCacheBytes: number
  transferBytes: number
  totalBytes: number
}

export interface CachedDemo {
  header: Header
  playerCache: PlayerCache
  ticks: number
  chat: ChatEntry[]
  deaths: { [tick: string]: CachedDeath[] }
  rounds: Round[]
  buildingCache: BuildingCache
  projectileCache: ProjectileCache
  intervalPerTick: number
  world: World
  nextMappedPlayer: number
  entityPlayerMap: Map<number, PlayerRef>
  now: number
  perf?: ParserPerformanceStats
}

export class AsyncParser {
  buffer: ArrayBuffer
  header!: Header
  playerCache!: PlayerCache
  nextMappedPlayer = 0
  entityPlayerMap: Map<number, PlayerRef> = new Map()
  ticks!: number
  chat: ChatEntry[] = []
  deaths: { [tick: string]: CachedDeath[] } = {}
  rounds!: Round[]
  buildingCache!: BuildingCache
  projectileCache!: ProjectileCache
  intervalPerTick!: number
  world!: World
  progressCallback: (progress: number) => void
  perf?: ParserPerformanceStats

  constructor(buffer: ArrayBuffer, progressCallback: (progress: number) => void) {
    this.buffer = buffer
    this.progressCallback = progressCallback
  }

  cache(): Promise<void> {
    return this.getCachedData().then((cachedData: CachedDemo) => {
      this.ticks = cachedData.ticks
      this.header = cachedData.header
      this.playerCache = cachedData.playerCache
      this.buildingCache = cachedData.buildingCache
      this.projectileCache = cachedData.projectileCache
      this.chat = cachedData.chat
      this.deaths = cachedData.deaths
      this.rounds = cachedData.rounds
      this.intervalPerTick = cachedData.intervalPerTick
      this.world = cachedData.world
      this.nextMappedPlayer = cachedData.nextMappedPlayer
      this.entityPlayerMap = cachedData.entityPlayerMap
      this.perf = cachedData.perf

      if (cachedData.perf) {
        const toMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        console.info('[Perf][ParserCache]', {
          ticks: cachedData.perf.ticks,
          players: cachedData.perf.playerCount,
          projectiles: cachedData.perf.projectileCount,
          memory: {
            total: toMb(cachedData.perf.totalBytes),
            playerCache: toMb(cachedData.perf.playerCacheBytes),
            projectileCache: toMb(cachedData.perf.projectileCacheBytes),
            transfer: toMb(cachedData.perf.transferBytes),
          },
          timings: {
            workerTotalMs: Math.round(cachedData.perf.workerTotalMs),
            parseMs: Math.round(cachedData.perf.parseMs),
            hydrateMs: Math.round(cachedData.perf.hydrateMs),
            transferMs: Math.round(cachedData.perf.transferMs),
          },
        })
      }
    })
  }

  getCachedData(): Promise<CachedDemo> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./ParseWorker.ts', import.meta.url), { type: 'module' })
      worker.postMessage(
        {
          buffer: this.buffer,
        },
        [this.buffer]
      )
      worker.onmessage = (event: MessageEvent) => {
        if (event.data.error) {
          reject(event.data.error)
          return
        }
        if (event.data.progress) {
          this.progressCallback(event.data.progress)
          return
        }
        const cachedData: CachedDemo = event.data
        PlayerCache.rehydrate(cachedData.playerCache)
        BuildingCache.rehydrate(cachedData.buildingCache)
        ProjectileCache.rehydrate(cachedData.projectileCache)

        // Compute transfer time (worker posted at cachedData.now)
        if (cachedData.perf) {
          cachedData.perf.transferMs = performance.now() - cachedData.now
        }

        resolve(event.data)
      }
    })
  }

  getPlayersAtTick(tick: number) {
    const players: CachedPlayer[] = []
    for (let i = 0; i < this.nextMappedPlayer; i++) {
      let entity = this.entityPlayerMap.get(i)
      if (entity) {
        players.push(this.playerCache.getPlayer(tick, i, entity.user as any))
      }
    }

    // fake teams in 1v1 ffa
    if (players.length === 2 && players[0].teamId === 0 && players[0].teamId === 0) {
      players[0].teamId = 2
      players[0].team = 'red'
      players[1].teamId = 3
      players[1].team = 'blue'
    }
    return players
  }

  getBuildingAtTick(tick: number): CachedBuilding[] {
    return this.buildingCache.getBuildings(tick)
  }

  getProjectilesAtTick(tick: number): CachedProjectile[] {
    return this.projectileCache.getProjectiles(tick)
  }
}
