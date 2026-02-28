import init, { parse_demo_cache_with_progress } from '../../../libs/parser2/parser2.js'
import { CachedDemo, ParserPerformanceStats } from './AsyncParser'
import { PlayerCache } from './PlayerCache'
import { BuildingCache } from './BuildingCache'
import { ProjectileCache } from './ProjectileCache'
import { getMapBoundaries } from '../MapBoundaries'
import { PlayerRef } from './Types'
import { POSITION_FIXED_SCALE } from './PositionEncoding'

declare function postMessage(message: any, transfer?: any[]): void

type WasmPlayerCache = {
  position: Uint32Array[]
  viewAngles: Uint32Array[]
  health: Uint16Array[]
  meta: Uint8Array[]
  connected: Uint8Array[]
  uber: Uint16Array[]
  healTarget: Uint16Array[]
}

type WasmProjectileCache = {
  ids: number[]
  position: Uint32Array[]
  rotation: Uint32Array[]
  team: Uint8Array[]
  type: Uint8Array[]
}

type WasmPlayer = {
  id: number
  entityId: number
  userId: number
  steamId: string
  name: string
  team: string
}

type WasmResult = {
  header: CachedDemo['header']
  ticks: number
  intervalPerTick: number
  positionScale?: number
  angleScale?: number
  world: CachedDemo['world']
  players: WasmPlayer[]
  playerCache: WasmPlayerCache
  projectileCache: WasmProjectileCache
  deaths: CachedDemo['deaths']
  rounds: CachedDemo['rounds']
}

let wasmReady: Promise<unknown> | null = null

const ensureWasm = () => {
  if (!wasmReady) {
    wasmReady = init()
  }
  return wasmReady
}

const shiftVectorCache = (
  arrays: Uint32Array[],
  deltaXFixed: number,
  deltaYFixed: number,
  deltaZFixed: number
) => {
  if (deltaXFixed === 0 && deltaYFixed === 0 && deltaZFixed === 0) return

  for (const array of arrays) {
    for (let i = 0; i < array.length; i += 3) {
      const x = array[i]
      const y = array[i + 1]
      const z = array[i + 2]
      if ((x | y | z) === 0) continue
      array[i] = x + deltaXFixed
      array[i + 1] = y + deltaYFixed
      array[i + 2] = z + deltaZFixed
    }
  }
}

const pushBuffers = (target: ArrayBufferLike[], arrays: ArrayBufferView[]) => {
  for (const arr of arrays) {
    target.push(arr.buffer)
  }
}

const sumBytes = (arrays: ArrayBufferView[]) => {
  let total = 0
  for (const arr of arrays) total += arr.byteLength
  return total
}

/**
 * @global postMessage
 * @param event
 */
onmessage = async (event: MessageEvent) => {
  try {
    await ensureWasm()

    const buffer = event.data.buffer as ArrayBuffer
    const parseStart = performance.now()

    const result = parse_demo_cache_with_progress(
      new Uint8Array(buffer),
      (progress: number) => {
        postMessage({ progress })
      }
    )

    const parseMs = performance.now() - parseStart

    if (typeof result === 'string' || !result) {
      postMessage({ error: result || 'Failed to parse demo.' })
      return
    }

    const hydrateStart = performance.now()

    const {
      header,
      ticks,
      positionScale = POSITION_FIXED_SCALE,
      angleScale = 1,
      intervalPerTick,
      world,
      players,
      playerCache: wasmPlayerCache,
      projectileCache: wasmProjectileCache,
      deaths,
      rounds,
    } = result as WasmResult

    // Hydrate player cache with WASM typed arrays
    const playerCache = new PlayerCache(ticks, world.boundaryMin)
    playerCache.positionCache.data = wasmPlayerCache.position
    playerCache.positionCache.scale =
      Number.isFinite(positionScale) && positionScale > 0
        ? positionScale
        : POSITION_FIXED_SCALE
    playerCache.viewAnglesCache.data = wasmPlayerCache.viewAngles
    playerCache.viewAnglesCache.scale = Number.isFinite(angleScale) ? angleScale : 1
    playerCache.healthCache.data = wasmPlayerCache.health as any
    playerCache.metaCache.data = wasmPlayerCache.meta as any
    playerCache.connectedCache.data = wasmPlayerCache.connected as any
    playerCache.uberCache.data = wasmPlayerCache.uber as any
    playerCache.healTargetCache.data = wasmPlayerCache.healTarget as any

    // Empty building cache (WASM parser does not output building data)
    const buildingCache = new BuildingCache(ticks, world.boundaryMin)

    // Hydrate projectile cache with WASM typed arrays
    const projectileCache = new ProjectileCache(ticks, world.boundaryMin)
    projectileCache.positionCache.data = wasmProjectileCache.position as any
    projectileCache.positionCache.scale =
      Number.isFinite(positionScale) && positionScale > 0
        ? positionScale
        : POSITION_FIXED_SCALE
    projectileCache.rotationCache.data = wasmProjectileCache.rotation as any
    projectileCache.rotationCache.scale = Number.isFinite(angleScale) ? angleScale : 1
    projectileCache.teamNumberCache.data = wasmProjectileCache.team as any
    projectileCache.typeCache.data = wasmProjectileCache.type as any
    projectileCache.setProjectileIds(wasmProjectileCache.ids)

    // Apply map boundary override and shift position data
    const boundaryOverride = getMapBoundaries(header.map)
    if (boundaryOverride) {
      const deltaX = Math.trunc(world.boundaryMin.x - boundaryOverride.boundaryMin.x)
      const deltaY = Math.trunc(world.boundaryMin.y - boundaryOverride.boundaryMin.y)
      const deltaZ = Math.trunc(world.boundaryMin.z - boundaryOverride.boundaryMin.z)
      const posScale = Number.isFinite(positionScale) ? positionScale : POSITION_FIXED_SCALE
      const deltaXFixed = Math.trunc(deltaX * posScale)
      const deltaYFixed = Math.trunc(deltaY * posScale)
      const deltaZFixed = Math.trunc(deltaZ * posScale)

      shiftVectorCache(
        playerCache.positionCache.data as Uint32Array[],
        deltaXFixed,
        deltaYFixed,
        deltaZFixed
      )
      shiftVectorCache(
        projectileCache.positionCache.data as Uint32Array[],
        deltaXFixed,
        deltaYFixed,
        deltaZFixed
      )

      world.boundaryMin = boundaryOverride.boundaryMin
      world.boundaryMax = boundaryOverride.boundaryMax
    }

    // Build entity player map from WASM player list
    const entityPlayerMap = new Map<number, PlayerRef>()
    let nextMappedPlayer = 0

    for (const player of players) {
      entityPlayerMap.set(player.id, {
        user: {
          name: player.name,
          userId: player.userId,
          steamId: player.steamId,
          entityId: player.entityId,
          team: player.team as PlayerRef['user']['team'],
        },
      })
      if (player.id + 1 > nextMappedPlayer) {
        nextMappedPlayer = player.id + 1
      }
    }

    const hydrateMs = performance.now() - hydrateStart
    const workerTotalMs = performance.now() - parseStart

    // Compute memory stats
    const playerCacheBytes =
      sumBytes(playerCache.positionCache.data) +
      sumBytes(playerCache.viewAnglesCache.data) +
      sumBytes(playerCache.healthCache.data) +
      sumBytes(playerCache.metaCache.data) +
      sumBytes(playerCache.connectedCache.data) +
      sumBytes(playerCache.uberCache.data) +
      sumBytes(playerCache.healTargetCache.data)
    const projectileCacheBytes =
      sumBytes(projectileCache.positionCache.data) +
      sumBytes(projectileCache.rotationCache.data) +
      sumBytes(projectileCache.teamNumberCache.data) +
      sumBytes(projectileCache.typeCache.data)
    const transferBytes = playerCacheBytes + projectileCacheBytes

    const perf: ParserPerformanceStats = {
      workerTotalMs,
      parseMs,
      hydrateMs,
      transferMs: 0, // Filled in by AsyncParser after message transfer
      playerCount: players.length,
      projectileCount: wasmProjectileCache.ids.length,
      ticks,
      playerCacheBytes,
      projectileCacheBytes,
      transferBytes,
      totalBytes: playerCacheBytes + projectileCacheBytes,
    }

    console.log(
      `parser2: parse=${parseMs.toFixed(1)}ms hydrate=${hydrateMs.toFixed(1)}ms total=${workerTotalMs.toFixed(1)}ms`
    )

    const cachedDemo: CachedDemo = {
      ticks,
      header,
      playerCache,
      buildingCache,
      projectileCache,
      deaths,
      rounds,
      intervalPerTick,
      world,
      nextMappedPlayer,
      entityPlayerMap,
      now: performance.now(),
      perf,
    }

    // Collect typed array buffers for zero-copy transfer
    const transfers: ArrayBufferLike[] = []
    pushBuffers(transfers, playerCache.positionCache.data)
    pushBuffers(transfers, playerCache.viewAnglesCache.data)
    pushBuffers(transfers, playerCache.healthCache.data)
    pushBuffers(transfers, playerCache.metaCache.data)
    pushBuffers(transfers, playerCache.connectedCache.data)
    pushBuffers(transfers, playerCache.uberCache.data)
    pushBuffers(transfers, playerCache.healTargetCache.data)
    pushBuffers(transfers, projectileCache.positionCache.data)
    pushBuffers(transfers, projectileCache.rotationCache.data)
    pushBuffers(transfers, projectileCache.teamNumberCache.data)
    pushBuffers(transfers, projectileCache.typeCache.data)

    postMessage(cachedDemo, transfers)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(error)
    postMessage({ error: message })
  }
}
