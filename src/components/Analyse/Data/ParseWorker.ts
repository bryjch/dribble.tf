import { decodeDemo } from '../../../libs/decoder/decoder.js'
import type { CachedDeath, DecodedDemo, DecodeStats } from './DemoSource'
import { PlayerCache } from './PlayerCache'
import { BuildingCache } from './BuildingCache'
import { ProjectileCache } from './ProjectileCache'
import { ObjectiveData, ObjectiveTimeline } from './ObjectiveTimeline'
import { getMapBoundaries } from '../MapBoundaries'
import { ChatEntry, PlayerRef, Round } from './Types'
import { CONDITION_FLAGS, toChatEntry, toDeath, toRound, toUberPop } from './StreamEvents'
import type { MatchUberEvent } from '@utils/matchEvents'

declare function postMessage(message: any, transfer?: any[]): void

//
// ─── DEMO DECODING ──────────────────────────────────────────────────────────────
//
// Demos are decoded by stvtf (decoder/), the extractor stv.tf also uses for live matches.
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

/** What the decoder hands over, before it becomes a DecodedDemo. */
interface Decoded {
  header: DecodedDemo['header']
  ticks: number
  intervalPerTick: number
  positionScale: number
  angleScale: number
  world: DecodedDemo['world']
  players: DecodedPlayer[]
  playerArrays: PlayerArrays
  projectiles: { tracks: Uint32Array; positions: Uint32Array; rotations: Uint32Array }
  buildings: { tracks: Uint32Array; samples: Uint32Array; sparse: number }
  objectives: ObjectiveData
  chat: ChatEntry[]
  deaths: DecodedDemo['deaths']
  rounds: Round[]
  uberPops: MatchUberEvent[]
}

type Progress = (progress: number) => void

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
    objectives: meta.objectives,
    chat,
    deaths,
    rounds,
    uberPops,
  }
}

// ─── Into the caches ────────────────────────────────────────────────────────────

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

function toDecodedDemo(d: Decoded, parseMs: number) {
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

  const objectives = new ObjectiveTimeline(d.objectives, d.intervalPerTick)

  const { tracks, positions, rotations } = d.projectiles
  const projectileCache = new ProjectileCache(tracks, positions, rotations, positionScale, angleScale)

  // Maps dribble.tf has converted carry their own bounds; positions follow them.
  const boundaryOverride = getMapBoundaries(header.map)
  if (boundaryOverride) {
    const shift = (axis: 'x' | 'y' | 'z') =>
      Math.trunc(Math.trunc(world.boundaryMin[axis] - boundaryOverride.boundaryMin[axis]) * positionScale)
    shiftVectorCache([...a.position, positions], shift('x'), shift('y'), shift('z'))
    buildingCache.shift(shift('x'), shift('y'), shift('z'))
    objectives.shift(shift('x') / positionScale, shift('y') / positionScale, shift('z') / positionScale)
    world.boundaryMin = boundaryOverride.boundaryMin
    world.boundaryMax = boundaryOverride.boundaryMax
  }

  const players = new Map<number, PlayerRef>(d.players.map(p => [p.id, refFor(p)]))

  const playerArrays = PLAYER_ARRAYS.flatMap(name => a[name] as ArrayBufferView[])
  const stats: DecodeStats = {
    parseMs,
    hydrateMs: performance.now() - hydrateStart,
    transferMs: 0, // Filled in on the main thread
    playerCount: d.players.length,
    projectileCount: projectileCache.projectileCount,
    ticks,
    playerCacheBytes: sumBytes(playerArrays),
    projectileCacheBytes: projectileCache.byteLength,
  }

  const decoded: DecodedDemo = {
    ticks,
    header,
    intervalPerTick: d.intervalPerTick,
    world,
    playerCache,
    buildingCache,
    projectileCache,
    objectives,
    chat: d.chat,
    deaths: d.deaths,
    rounds: d.rounds,
    uberPops: d.uberPops,
    players,
    postedAt: performance.timeOrigin + performance.now(),
    stats,
  }
  // Zero-copy: the arrays move to the main thread rather than being cloned.
  const transfers = [
    ...new Set(
      [...playerArrays, tracks, positions, rotations, buildings.tracks, buildings.samples].map(arr => arr.buffer)
    ),
  ]
  return { decoded, transfers }
}

onmessage = async (event: MessageEvent) => {
  try {
    const buffer = event.data.buffer as ArrayBuffer
    const progress: Progress = p => postMessage({ progress: p })

    const parseStart = performance.now()
    const raw = await decodeWithStvtf(buffer, progress)
    const parseMs = performance.now() - parseStart

    const { decoded, transfers } = toDecodedDemo(raw, parseMs)
    console.log(`stvtf: parse=${parseMs.toFixed(1)}ms hydrate=${decoded.stats.hydrateMs.toFixed(1)}ms`)
    postMessage(decoded, transfers)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(error)
    postMessage({ error: message })
  }
}
