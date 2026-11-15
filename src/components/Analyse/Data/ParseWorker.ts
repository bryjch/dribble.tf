import { decodeDemo as decodeWithStvtf } from '../../../libs/decoder/decoder.js'
import type { CachedDeath, DecodedDemo } from './DemoSource'
import type { PlayerArrays } from './PlayerTracks'
import { ChatEntry, PlayerRef, Round } from './Types'
import { CONDITION_FLAGS, toChatEntry, toDeath, toRound, toUberPop } from './StreamEvents'
import type { MatchUberEvent } from '@utils/matchEvents'

declare function postMessage(message: any, transfer?: any[]): void

//
// ─── DEMO DECODING ──────────────────────────────────────────────────────────────
//
// Decodes a .dem with stvtf (decoder/), the extractor stv.tf also uses for live matches, and
// sends its typed arrays to the main thread as they are (moved, not copied), with the events
// turned into the viewer's. DemoSource reads the arrays there.
//

/** The decoder format this build reads (decoder/src/lib.rs, FORMAT). */
const DECODER_FORMAT = 3

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
  'weapon',
  'shots',
] as const satisfies readonly (keyof PlayerArrays)[]

const mismatch = () =>
  new Error('decoder.wasm does not match this build of dribble.tf; run npm run build:decoder')

onmessage = async (event: MessageEvent) => {
  try {
    const buffer = event.data.buffer as ArrayBuffer
    const parseStart = performance.now()
    const { meta, buffers } = await decodeWithStvtf(buffer, fraction =>
      postMessage({ progress: fraction })
    )
    const parseMs = performance.now() - parseStart

    // The decoder's own list of each player's arrays; a mismatch is a decoder from another build.
    const order = meta.playerBuffers
    const flags = CONDITION_FLAGS.map(([flag]) => flag)
    if (
      meta.format !== DECODER_FORMAT ||
      PLAYER_ARRAYS.some(name => !order.includes(name)) ||
      meta.conditionFlags.join() !== flags.join()
    ) {
      throw mismatch()
    }

    const slots: PlayerArrays[] = meta.players.map(
      (_, slot) =>
        Object.fromEntries(
          PLAYER_ARRAYS.map(name => [name, buffers[slot * order.length + order.indexOf(name)]])
        ) as unknown as PlayerArrays
    )
    const rest = buffers.slice(meta.players.length * order.length) as Uint32Array[]
    const [projectileTracks, projectilePositions, projectileRotations, buildingTracks, buildingSamples] =
      rest

    // Events name players by stvtf's id (their userid).
    const byUserId = new Map(meta.players.map(p => [p.userId, p]))
    const refOf = (id: number | null | undefined): PlayerRef | null => {
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

    const decoded: DecodedDemo = {
      header: meta.header,
      ticks: meta.ticks,
      intervalPerTick: meta.intervalPerTick,
      positionScale: meta.positionScale,
      angleScale: meta.angleScale,
      world: meta.world,
      players: meta.players.map(p => ({ slot: p.id, ref: refFor(p) })),
      playerArrays: slots,
      playerSampling: meta.sampling,
      projectiles: {
        tracks: projectileTracks,
        positions: projectilePositions,
        rotations: projectileRotations,
      },
      buildings: { tracks: buildingTracks, samples: buildingSamples, sparse: meta.buildingSparse },
      objectives: meta.objectives,
      chat,
      deaths,
      rounds,
      uberPops,
      parseMs,
      postedAt: performance.timeOrigin + performance.now(),
    }
    console.log(`stvtf: parse=${parseMs.toFixed(1)}ms`)
    // Zero-copy: the arrays move to the main thread rather than being cloned.
    postMessage(decoded, [...new Set(buffers.map(array => array.buffer))])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(error)
    postMessage({ error: message })
  }
}

function refFor(p: {
  name: string
  userId: number
  steamId: string
  entityId: number
  team: string
}): PlayerRef {
  return {
    user: {
      name: p.name,
      userId: p.userId,
      steamId: p.steamId,
      entityId: p.entityId,
      team: p.team as PlayerRef['user']['team'],
    },
  }
}
