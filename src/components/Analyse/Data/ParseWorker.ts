import init, { parse_demo_cache_with_progress } from '../../../libs/parser2/parser2.js'
import { decodeDemo } from '../../../libs/decoder/decoder.js'
import { CachedDeath, CachedDemo, DemoDecoder, ParserPerformanceStats } from './AsyncParser'
import { PlayerCache } from './PlayerCache'
import { BuildingCache } from './BuildingCache'
import { ProjectileCache, tracksFromSlots } from './ProjectileCache'
import { getMapBoundaries } from '../MapBoundaries'
import { ChatEntry, PlayerRef, Round } from './Types'
import { POSITION_FIXED_SCALE } from './PositionEncoding'
import { CONDITION_FLAGS, toChatEntry, toDeath, toRound, toUberPop } from './StreamEvents'
import type { MatchUberEvent } from '@utils/matchEvents'

declare function postMessage(message: any, transfer?: any[]): void

//
// ─── DEMO DECODING ──────────────────────────────────────────────────────────────
//
// Two decoders produce the same thing: stvtf (decoder/, the default), which stv.tf also uses
// for live matches, and parser2 (the tf2jump build), kept as a fallback with ?decoder=parser2.
//

interface DecodedPlayer {
  id: number
  entityId: number
  userId: number
  steamId: string
  name: string
  team: string
}

/** Per player slot, the typed arrays the PlayerCache reads. */
interface PlayerArrays {
  position: Uint32Array[]
  viewAngles: Uint32Array[]
  health: Uint16Array[]
  meta: Uint8Array[]
  connected: Uint8Array[]
  uber: Uint16Array[]
  healTarget: Uint16Array[]
  /** Empty from parser2, which has neither. */
  conditions: Uint32Array[]
  charge: Uint16Array[]
}

const PLAYER_ARRAYS = [
  'position',
  'viewAngles',
  'health',
  'meta',
  'connected',
  'uber',
  'healTarget',
  'conditions',
  'charge',
] as const satisfies readonly (keyof PlayerArrays)[]

/** What either decoder hands over, before it becomes a CachedDemo. */
interface Decoded {
  header: CachedDemo['header']
  ticks: number
  intervalPerTick: number
  positionScale: number
  angleScale: number
  world: CachedDemo['world']
  players: DecodedPlayer[]
  playerArrays: PlayerArrays
  projectiles: { tracks: Uint32Array; positions: Uint32Array; rotations: Uint32Array }
  buildings: { tracks: Uint32Array; samples: Uint32Array; sparse: number }
  chat: ChatEntry[]
  deaths: CachedDemo['deaths']
  rounds: Round[]
  /** When the decoder is told about übers; parser2's demos find them from the charge instead. */
  uberPops?: MatchUberEvent[]
}

type Progress = (progress: number) => void

const finiteOr = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) && value! > 0 ? value! : fallback

const refFor = (p: DecodedPlayer): PlayerRef => ({
  user: {
    name: p.name,
    userId: p.userId,
    steamId: p.steamId,
    entityId: p.entityId,
    team: p.team as PlayerRef['user']['team'],
  },
})

// ─── stvtf ──────────────────────────────────────────────────────────────────────

async function decodeWithStvtf(buffer: ArrayBuffer, progress: Progress): Promise<Decoded> {
  const { meta, buffers } = await decodeDemo(buffer, fraction => progress(fraction))

  // The decoder's own list of each player's arrays; a mismatch is a decoder from another build.
  const order = meta.playerBuffers
  const flags = CONDITION_FLAGS.map(([flag]) => flag)
  if (PLAYER_ARRAYS.some(name => !order.includes(name)) || meta.conditionFlags.join() !== flags.join()) {
    throw new Error('decoder.wasm does not match this build of dribble.tf; run npm run build:decoder')
  }
  const playerArrays = Object.fromEntries(PLAYER_ARRAYS.map(name => [name, []])) as unknown as PlayerArrays
  meta.players.forEach((_, slot) => {
    for (const name of PLAYER_ARRAYS) {
      ;(playerArrays[name] as ArrayBufferView[]).push(buffers[slot * order.length + order.indexOf(name)])
    }
  })
  const rest = buffers.slice(meta.players.length * order.length) as Uint32Array[]
  const [tracks, positions, rotations, buildingTracks, buildingSamples] = rest

  // Events name players by stvtf's id (their userid).
  const byUserId = new Map(meta.players.map(p => [p.userId, p]))
  const refOf = (id: number | null | undefined) => {
    const p = id != null ? byUserId.get(id) : undefined
    return p ? refFor(p) : null
  }

  const deaths: Record<string, CachedDeath[]> = {}
  const chat: ChatEntry[] = []
  const rounds: Round[] = []
  const uberPops: MatchUberEvent[] = []
  for (const m of meta.events) {
    switch (m.type) {
      case 'kill': {
        const death = toDeath(m.tick, m, refOf)
        if (death) (deaths[m.tick] ??= []).push(death)
        break
      }
      case 'chat':
      case 'server_text': {
        const slot = m.player != null ? (byUserId.get(m.player)?.id ?? null) : null
        const entry = toChatEntry(m.tick, m, slot)
        if (entry) chat.push(entry)
        break
      }
      case 'uber': {
        const pop = toUberPop(m.tick, m, refOf)
        if (pop) uberPops.push(pop)
        break
      }
      case 'round_win':
        rounds.push(toRound(m.tick, m))
        break
    }
  }

  return {
    header: meta.header,
    ticks: meta.ticks,
    intervalPerTick: meta.intervalPerTick,
    positionScale: meta.positionScale,
    angleScale: meta.angleScale,
    world: meta.world,
    players: meta.players,
    playerArrays,
    projectiles: { tracks, positions, rotations },
    buildings: { tracks: buildingTracks, samples: buildingSamples, sparse: meta.buildingSparse },
    chat,
    deaths,
    rounds,
    uberPops,
  }
}

// ─── parser2 ────────────────────────────────────────────────────────────────────

type Parser2Result = {
  header: CachedDemo['header']
  ticks: number
  intervalPerTick: number
  positionScale?: number
  angleScale?: number
  world: CachedDemo['world']
  players: DecodedPlayer[]
  playerCache: PlayerArrays
  projectileCache: {
    ids: number[]
    position: Uint32Array[]
    rotation: Uint32Array[]
    team: Uint8Array[]
    type: Uint8Array[]
  }
  chat: ChatEntry[]
  deaths: CachedDemo['deaths']
  rounds: CachedDemo['rounds']
}

let parser2Ready: Promise<unknown> | null = null

async function decodeWithParser2(buffer: ArrayBuffer, progress: Progress): Promise<Decoded> {
  parser2Ready ??= init()
  await parser2Ready
  const result = parse_demo_cache_with_progress(new Uint8Array(buffer), progress)
  if (typeof result === 'string' || !result) throw new Error(result || 'Failed to parse demo.')
  const r = result as Parser2Result
  const p = r.projectileCache
  return {
    header: r.header,
    ticks: r.ticks,
    intervalPerTick: r.intervalPerTick,
    positionScale: finiteOr(r.positionScale, POSITION_FIXED_SCALE),
    angleScale: finiteOr(r.angleScale, 1),
    world: r.world,
    players: r.players,
    // parser2 also has weapon and duck caches, which the viewer does not read.
    playerArrays: {
      position: r.playerCache.position,
      viewAngles: r.playerCache.viewAngles,
      health: r.playerCache.health,
      meta: r.playerCache.meta,
      connected: r.playerCache.connected,
      uber: r.playerCache.uber,
      healTarget: r.playerCache.healTarget,
      conditions: [],
      charge: [],
    },
    // The projectile caches' team and type keep one value per 64 ticks.
    projectiles: tracksFromSlots(p.ids, p.position, p.rotation, p.team, p.type, 6),
    buildings: { tracks: new Uint32Array(0), samples: new Uint32Array(0), sparse: 2 },
    chat: r.chat ?? [],
    deaths: r.deaths,
    rounds: r.rounds,
  }
}

// ─── Both ───────────────────────────────────────────────────────────────────────

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

const sumBytes = (arrays: ArrayBufferView[]) => {
  let total = 0
  for (const arr of arrays) total += arr.byteLength
  return total
}

function toCachedDemo(d: Decoded, decoder: DemoDecoder, parseMs: number, parseStart: number) {
  const hydrateStart = performance.now()
  const { header, ticks, positionScale, angleScale, world, playerArrays: a } = d

  const playerCache = new PlayerCache(ticks, world.boundaryMin)
  playerCache.positionCache.data = a.position
  playerCache.positionCache.scale = positionScale
  playerCache.viewAnglesCache.data = a.viewAngles
  playerCache.viewAnglesCache.scale = angleScale
  playerCache.healthCache.data = a.health as any
  playerCache.metaCache.data = a.meta as any
  playerCache.connectedCache.data = a.connected as any
  playerCache.uberCache.data = a.uber as any
  playerCache.healTargetCache.data = a.healTarget as any
  playerCache.conditionsCache.data = a.conditions as any
  playerCache.chargeCache.data = a.charge as any

  const { buildings } = d
  const buildingCache = new BuildingCache(
    buildings.tracks,
    buildings.samples,
    buildings.sparse,
    positionScale,
    angleScale
  )

  const { tracks, positions, rotations } = d.projectiles
  const projectileCache = new ProjectileCache(tracks, positions, rotations, positionScale, angleScale)

  // Maps dribble.tf has converted carry their own bounds; positions follow them.
  const boundaryOverride = getMapBoundaries(header.map)
  if (boundaryOverride) {
    const shift = (axis: 'x' | 'y' | 'z') =>
      Math.trunc(Math.trunc(world.boundaryMin[axis] - boundaryOverride.boundaryMin[axis]) * positionScale)
    shiftVectorCache([...a.position, positions], shift('x'), shift('y'), shift('z'))
    buildingCache.shift(shift('x'), shift('y'), shift('z'))
    world.boundaryMin = boundaryOverride.boundaryMin
    world.boundaryMax = boundaryOverride.boundaryMax
  }

  const entityPlayerMap = new Map<number, PlayerRef>()
  let nextMappedPlayer = 0
  for (const player of d.players) {
    entityPlayerMap.set(player.id, refFor(player))
    nextMappedPlayer = Math.max(nextMappedPlayer, player.id + 1)
  }

  const playerArrays = PLAYER_ARRAYS.flatMap(name => a[name] as ArrayBufferView[])
  const playerCacheBytes = sumBytes(playerArrays)
  const projectileCacheBytes = projectileCache.byteLength
  const perf: ParserPerformanceStats = {
    decoder,
    workerTotalMs: performance.now() - parseStart,
    parseMs,
    hydrateMs: performance.now() - hydrateStart,
    transferMs: 0, // Filled in by AsyncParser after message transfer
    playerCount: d.players.length,
    projectileCount: projectileCache.projectileCount,
    ticks,
    playerCacheBytes,
    projectileCacheBytes,
    transferBytes: playerCacheBytes + projectileCacheBytes,
    totalBytes: playerCacheBytes + projectileCacheBytes,
  }

  const cachedDemo: CachedDemo = {
    ticks,
    header,
    playerCache,
    buildingCache,
    projectileCache,
    chat: d.chat,
    deaths: d.deaths,
    rounds: d.rounds,
    uberPops: d.uberPops,
    intervalPerTick: d.intervalPerTick,
    world,
    nextMappedPlayer,
    entityPlayerMap,
    now: performance.now(),
    perf,
  }
  // Zero-copy: the arrays move to the main thread rather than being cloned.
  const transfers = [
    ...new Set(
      [...playerArrays, tracks, positions, rotations, buildings.tracks, buildings.samples].map(arr => arr.buffer)
    ),
  ]
  return { cachedDemo, transfers }
}

/**
 * @global postMessage
 * @param event
 */
onmessage = async (event: MessageEvent) => {
  try {
    const buffer = event.data.buffer as ArrayBuffer
    const decoder: DemoDecoder = event.data.decoder === 'parser2' ? 'parser2' : 'stvtf'
    const progress: Progress = p => postMessage({ progress: p })

    const parseStart = performance.now()
    const decoded =
      decoder === 'parser2'
        ? await decodeWithParser2(buffer, progress)
        : await decodeWithStvtf(buffer, progress)
    const parseMs = performance.now() - parseStart

    const { cachedDemo, transfers } = toCachedDemo(decoded, decoder, parseMs, parseStart)
    console.log(
      `${decoder}: parse=${parseMs.toFixed(1)}ms hydrate=${cachedDemo.perf!.hydrateMs.toFixed(1)}ms total=${cachedDemo.perf!.workerTotalMs.toFixed(1)}ms`
    )
    postMessage(cachedDemo, transfers)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(error)
    postMessage({ error: message })
  }
}
