import init, { parse_demo_cache_with_progress } from '../../../libs/parser2/parser2.js'
import { CachedDemo } from './AsyncParser'
import { PlayerCache } from './PlayerCache'
import { BuildingCache } from './BuildingCache'
import { ProjectileCache } from './ProjectileCache'
import { getMapBoundaries } from '../MapBoundaries'

declare function postMessage(message: any, transfer?: any[]): void

// Fixed-point scale used by the WASM parser for position encoding
const POSITION_FIXED_SCALE = 32

type WasmPlayerCache = {
  position: Uint32Array[]
  viewAngles: Uint32Array[]
  health: Uint16Array[]
  meta: Uint8Array[]
  connected: Uint8Array[]
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

    const parseEnd = performance.now()
    console.log(`parser2 WASM parse: ${(parseEnd - parseStart).toFixed(1)}ms`)

    if (typeof result === 'string' || !result) {
      postMessage({ error: result || 'Failed to parse demo.' })
      return
    }

    const {
      header,
      ticks,
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
    playerCache.viewAnglesCache.data = wasmPlayerCache.viewAngles
    playerCache.healthCache.data = wasmPlayerCache.health as any
    playerCache.metaCache.data = wasmPlayerCache.meta as any
    playerCache.connectedCache.data = wasmPlayerCache.connected as any

    // Empty building cache (WASM parser does not output building data)
    const buildingCache = new BuildingCache(ticks, world.boundaryMin)

    // Hydrate projectile cache with WASM typed arrays
    const projectileCache = new ProjectileCache(ticks, world.boundaryMin)
    projectileCache.positionCache.data = wasmProjectileCache.position as any
    projectileCache.rotationCache.data = wasmProjectileCache.rotation as any
    projectileCache.teamNumberCache.data = wasmProjectileCache.team as any
    projectileCache.typeCache.data = wasmProjectileCache.type as any

    // Apply map boundary override and shift position data
    const boundaryOverride = getMapBoundaries(header.map)
    if (boundaryOverride) {
      const deltaX = Math.trunc(world.boundaryMin.x - boundaryOverride.boundaryMin.x)
      const deltaY = Math.trunc(world.boundaryMin.y - boundaryOverride.boundaryMin.y)
      const deltaZ = Math.trunc(world.boundaryMin.z - boundaryOverride.boundaryMin.z)
      const deltaXFixed = Math.trunc(deltaX * POSITION_FIXED_SCALE)
      const deltaYFixed = Math.trunc(deltaY * POSITION_FIXED_SCALE)
      const deltaZFixed = Math.trunc(deltaZ * POSITION_FIXED_SCALE)

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
    const entityPlayerMap = new Map<number, any>()
    let nextMappedPlayer = 0

    for (const player of players) {
      entityPlayerMap.set(player.id, {
        user: {
          name: player.name,
          userId: player.userId,
          steamId: player.steamId,
          entityId: player.entityId,
          team: player.team,
        },
      })
      if (player.id + 1 > nextMappedPlayer) {
        nextMappedPlayer = player.id + 1
      }
    }

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
    }

    // Collect typed array buffers for zero-copy transfer
    const transfers: ArrayBufferLike[] = []
    pushBuffers(transfers, playerCache.positionCache.data)
    pushBuffers(transfers, playerCache.viewAnglesCache.data)
    pushBuffers(transfers, playerCache.healthCache.data)
    pushBuffers(transfers, playerCache.metaCache.data)
    pushBuffers(transfers, playerCache.connectedCache.data)
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
