export interface Vector {
  x: number
  y: number
  z: number
}

/** A map's extent, in Source world coordinates. */
export interface World {
  boundaryMin: Vector
  boundaryMax: Vector
}

/** A map's extent, and where the RTS camera starts: Source world coordinates. */
export interface MapBoundaries extends World {
  /** The default camera's offset from the RTS centre. */
  cameraOffset?: Vector
  rtsCenter?: Vector
}

export interface Header {
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

export type TeamName = 'red' | 'blue' | 'spectator' | ''

export interface UserInfo {
  classes?: Record<string, number>
  name: string
  userId: number
  steamId: string
  entityId: number
  team: TeamName
}

export interface PlayerRef {
  user: UserInfo
}

export interface Round {
  winner: 'red' | 'blue'
  length: number
  endTick: number
}

export interface ChatEntry {
  tick: number
  kind: string
  rawText: string
  clientEntityId?: number | null
  clientPlayerId?: number | null
}
