export interface DecodedPlayer {
  id: number
  entityId: number
  userId: number
  steamId: string
  name: string
  team: string
}

/** One line of stvtf's output, with `tick` made local; see stvtf's README for each type's fields. */
export interface DecodedEvent {
  type: string
  tick: number
  [field: string]: any
}

export interface DecodedMeta {
  header: {
    demo_type: string
    version: number
    protocol: number
    server: string
    nick: string
    map: string
    game: string
    duration: number
    ticks: number
    frames: number
    signon: number
  }
  ticks: number
  intervalPerTick: number
  positionScale: number
  angleScale: number
  world: {
    boundaryMin: { x: number; y: number; z: number }
    boundaryMax: { x: number; y: number; z: number }
  }
  players: DecodedPlayer[]
  /** The names of each player's arrays, in the order they come. */
  playerBuffers: string[]
  /** The condition bits, in order (StreamEvents.ts, CONDITION_FLAGS). */
  conditionFlags: string[]
  /** Ticks per value in the conditions and charge arrays: 1 << statusSparse. */
  statusSparse: number
  projectileCount: number
  buildingCount: number
  /** Ticks per building sample: 1 << buildingSparse. */
  buildingSparse: number
  /** Objectives and the round state, as keys where they change (ObjectiveTimeline.ts reads them). */
  objectives: import('../../components/Analyse/Data/ObjectiveTimeline').ObjectiveData
  events: DecodedEvent[]
}

export interface DecodedDemo {
  meta: DecodedMeta
  /**
   * Per player, in `players` order, the arrays `playerBuffers` names. Then the projectile tracks
   * (5 values each), their positions and their rotations, then the building tracks (6 values
   * each) and their samples (8 values each).
   */
  buffers: (Uint32Array | Uint16Array | Uint8Array)[]
}

export function initDecoder(source?: BufferSource): Promise<WebAssembly.Module>

export function decodeDemo(
  bytes: ArrayBuffer | Uint8Array,
  onProgress?: (fraction: number) => void
): Promise<DecodedDemo>
