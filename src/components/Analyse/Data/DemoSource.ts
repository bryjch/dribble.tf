import { CachedPlayer, PlayerArrays, PlayerSampling, PlayerTracks } from './PlayerTracks'
import { BuildingCache, CachedBuilding } from './BuildingCache'
import { ProjectileCache, CachedProjectile } from './ProjectileCache'
import { ObjectiveData, ObjectiveState, ObjectiveTimeline } from './ObjectiveTimeline'
import { ChatEntry, Header, PlayerRef, Round, World } from './Types'
import {
  CachedDeath,
  MatchSource,
  ScoreLine,
  lerpPlayers,
  lerpProjectiles,
  roundStartsFrom,
} from './MatchSource'
import type { MatchUberEvent } from '@utils/matchEvents'

export type { CachedDeath }

export interface DecodeStats {
  /** Decoding in the worker. */
  parseMs: number
  /** Indexing the decoder's arrays here. */
  hydrateMs: number
  /** From the worker answering to the arrays arriving here. */
  transferMs: number
  playerCount: number
  projectileCount: number
  ticks: number
  playerCacheBytes: number
  projectileCacheBytes: number
}

/**
 * What the parse worker sends back for a demo: the decoder's typed arrays as they are, and its
 * events turned into the viewer's. Positions are Source world coordinates, fixed point.
 */
export interface DecodedDemo {
  header: Header
  ticks: number
  intervalPerTick: number
  positionScale: number
  angleScale: number
  world: World
  players: { slot: number; ref: PlayerRef }[]
  /** Per player slot. */
  playerArrays: PlayerArrays[]
  playerSampling: PlayerSampling
  projectiles: { tracks: Uint32Array; positions: Uint32Array; rotations: Uint32Array }
  buildings: { tracks: Uint32Array; samples: Uint32Array; sparse: number }
  objectives: ObjectiveData
  chat: ChatEntry[]
  deaths: { [tick: string]: CachedDeath[] }
  rounds: Round[]
  uberPops: MatchUberEvent[]
  parseMs: number
  /** performance.timeOrigin + now() when the worker posted, comparable across threads. */
  postedAt: number
}

/**
 * Decodes a .dem file in a worker (stvtf, see decoder/) and resolves to its match source. The
 * worker goes as soon as it has answered: its WASM memory grew to hold the whole demo and never
 * shrinks.
 */
export function decodeDemo(
  buffer: ArrayBuffer,
  onProgress: (progress: number) => void
): Promise<DemoSource> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ParseWorker.ts', import.meta.url), { type: 'module' })
    worker.postMessage({ buffer }, [buffer])
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
      if (event.data.progress !== undefined) {
        onProgress(event.data.progress)
        return
      }
      worker.terminate()
      const decoded = event.data as DecodedDemo
      const transferMs = performance.timeOrigin + performance.now() - decoded.postedAt
      resolve(new DemoSource(decoded, transferMs))
    }
  })
}

/** A demo, decoded up front: every tick's state is in typed arrays. */
export class DemoSource implements MatchSource {
  readonly kind = 'demo' as const
  readonly header: Header
  readonly intervalPerTick: number
  readonly world: World
  readonly ticks: number
  readonly revision = 0
  readonly deaths: { [tick: string]: CachedDeath[] }
  readonly chat: ChatEntry[]
  readonly rounds: Round[]
  readonly uberPops: MatchUberEvent[]
  readonly stats: DecodeStats

  private readonly playerTracks: PlayerTracks
  private readonly buildingCache: BuildingCache
  private readonly projectileCache: ProjectileCache
  private readonly objectives: ObjectiveTimeline
  private readonly players: Map<number, PlayerRef>
  private readonly slotCount: number

  constructor(decoded: DecodedDemo, transferMs = 0) {
    const start = performance.now()
    this.header = decoded.header
    this.intervalPerTick = decoded.intervalPerTick
    this.world = decoded.world
    this.ticks = decoded.ticks
    this.deaths = decoded.deaths
    this.chat = decoded.chat
    this.rounds = decoded.rounds
    this.uberPops = decoded.uberPops
    this.players = new Map(decoded.players.map(({ slot, ref }) => [slot, ref]))
    this.slotCount = Math.max(0, ...this.players.keys()) + 1

    const { positionScale, angleScale } = decoded
    this.playerTracks = new PlayerTracks(
      decoded.playerArrays,
      decoded.playerSampling,
      positionScale,
      angleScale
    )
    const { tracks, positions, rotations } = decoded.projectiles
    this.projectileCache = new ProjectileCache(tracks, positions, rotations, positionScale, angleScale)
    const { buildings } = decoded
    this.buildingCache = new BuildingCache(
      buildings.tracks,
      buildings.samples,
      buildings.sparse,
      positionScale,
      angleScale
    )
    this.objectives = new ObjectiveTimeline(decoded.objectives, decoded.intervalPerTick)

    this.stats = {
      parseMs: decoded.parseMs,
      hydrateMs: performance.now() - start,
      transferMs,
      playerCount: decoded.players.length,
      projectileCount: this.projectileCache.projectileCount,
      ticks: decoded.ticks,
      playerCacheBytes: this.playerTracks.byteLength,
      projectileCacheBytes: this.projectileCache.byteLength,
    }
  }

  private playersAtTick(tick: number): CachedPlayer[] {
    const players: CachedPlayer[] = []
    for (let slot = 0; slot < this.slotCount; slot++) {
      const ref = this.players.get(slot)
      if (ref) players.push(this.playerTracks.player(tick, slot, ref.user))
    }

    // Fake teams in a 1v1 free-for-all, so the two can be told apart
    if (players.length === 2 && players[0].teamId === 0 && players[1].teamId === 0) {
      players[0] = { ...players[0], teamId: 2, team: 'red' }
      players[1] = { ...players[1], teamId: 3, team: 'blue' }
    }
    return players
  }

  private clamp(tick: number) {
    return Math.min(Math.max(tick, 1), this.ticks - 1)
  }

  playersAt(tick: number): CachedPlayer[] {
    const t = this.clamp(tick)
    const at = Math.floor(t)
    const players = this.playersAtTick(at)
    if (t === at || at + 1 >= this.ticks) return players
    return lerpPlayers(players, this.playersAtTick(at + 1), t - at)
  }

  projectilesAt(tick: number): CachedProjectile[] {
    const t = this.clamp(tick)
    const at = Math.floor(t)
    const projectiles = this.projectileCache.getProjectiles(at)
    if (t === at || at + 1 >= this.ticks) return projectiles
    return lerpProjectiles(projectiles, this.projectileCache.getProjectiles(at + 1), t - at)
  }

  buildingsAt(tick: number): CachedBuilding[] {
    return this.buildingCache.getBuildings(Math.floor(this.clamp(tick)))
  }

  objectivesAt(tick: number): ObjectiveState | null {
    return this.objectives.at(this.clamp(tick))
  }

  scoresAt(tick: number): Map<number, ScoreLine> {
    const at = Math.floor(this.clamp(tick))
    const scores = new Map<number, ScoreLine>()
    for (const [slot, ref] of this.players) {
      const line = this.playerTracks.score(slot, at)
      if (line) scores.set(ref.user.entityId, line)
    }
    return scores
  }

  slotTeamAt(slot: number, tick: number): number {
    return this.playerTracks.team(slot, Math.floor(this.clamp(tick)))
  }

  roundStarts(): number[] {
    return roundStartsFrom(this.objectives.data.round)
  }
}
