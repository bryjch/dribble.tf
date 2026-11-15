import { PlayerCache, CachedPlayer } from './PlayerCache'
import { BuildingCache, CachedBuilding } from './BuildingCache'
import { ProjectileCache, CachedProjectile } from './ProjectileCache'
import { ObjectiveState, ObjectiveTimeline } from './ObjectiveTimeline'
import { ChatEntry, Header, PlayerRef, Round, World } from './Types'
import type { MatchUberEvent } from '@utils/matchEvents'

/** What reads a demo: stvtf (decoder/), or parser2 (the tf2jump build) with ?decoder=parser2. */
export type DemoDecoder = 'stvtf' | 'parser2'

/** The decoder this page asks for: stvtf unless the URL says ?decoder=parser2. */
export const requestedDecoder = (): DemoDecoder =>
  new URLSearchParams(window.location.search).get('decoder') === 'parser2' ? 'parser2' : 'stvtf'

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
  decoder: DemoDecoder
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
  /** Übers as the demo announced them; absent when the decoder does not report them. */
  uberPops?: MatchUberEvent[]
  buildingCache: BuildingCache
  projectileCache: ProjectileCache
  /** Control points, carts, flags and the round state; empty when the decoder has none. */
  objectives: ObjectiveTimeline
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
  uberPops?: MatchUberEvent[]
  buildingCache!: BuildingCache
  projectileCache!: ProjectileCache
  objectives!: ObjectiveTimeline
  intervalPerTick!: number
  world!: World
  progressCallback: (progress: number) => void
  perf?: ParserPerformanceStats
  /** Counts changes to deaths, rounds and ubers; a demo never changes, a live match does. */
  revision = 0

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
      this.objectives = cachedData.objectives
      this.chat = cachedData.chat
      this.deaths = cachedData.deaths
      this.rounds = cachedData.rounds
      this.uberPops = cachedData.uberPops
      this.intervalPerTick = cachedData.intervalPerTick
      this.world = cachedData.world
      this.nextMappedPlayer = cachedData.nextMappedPlayer
      this.entityPlayerMap = cachedData.entityPlayerMap
      this.perf = cachedData.perf

      if (cachedData.perf) {
        const toMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        console.info('[Perf][ParserCache]', {
          decoder: cachedData.perf.decoder,
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
          decoder: requestedDecoder(),
        },
        [this.buffer]
      )
      // The worker's WASM memory grew to hold the whole demo and never shrinks, so the worker
      // goes as soon as it has answered.
      worker.onerror = (event: ErrorEvent) => {
        worker.terminate()
        reject(event.message)
      }
      worker.onmessage = (event: MessageEvent) => {
        if (event.data.error) {
          worker.terminate()
          reject(event.data.error)
          return
        }
        if (event.data.progress) {
          this.progressCallback(event.data.progress)
          return
        }
        worker.terminate()
        const cachedData: CachedDemo = event.data
        PlayerCache.rehydrate(cachedData.playerCache)
        BuildingCache.rehydrate(cachedData.buildingCache)
        ProjectileCache.rehydrate(cachedData.projectileCache)
        ObjectiveTimeline.rehydrate(cachedData.objectives)

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

  /** The objectives and round state at a tick; null when the demo has none (parser2's). */
  getObjectivesAtTick(tick: number): ObjectiveState | null {
    return this.objectives?.at(tick) ?? null
  }
}
