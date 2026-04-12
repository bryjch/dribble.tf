export const SceneMode = {
  WIREFRAME: 'wireframe',
  UNTEXTURED: 'untextured',
  TEXTURED: 'textured',
} as const

export type SceneMode = (typeof SceneMode)[keyof typeof SceneMode]

export const ParserStatus = {
  INIT: 'init',
  LOADING: 'loading',
  DONE: 'done',
} as const

export type ParserStatus = (typeof ParserStatus)[keyof typeof ParserStatus]

export const ControlsMode = {
  RTS: 'rts',
  POV: 'pov',
  SPECTATOR: 'spectator',
} as const

export type ControlsMode = (typeof ControlsMode)[keyof typeof ControlsMode]

export const DrawingActivation = {
  TOGGLE: 'toggle',
  HOLD: 'hold',
} as const

export type DrawingActivation = (typeof DrawingActivation)[keyof typeof DrawingActivation]

export const DrawingTool = {
  BRUSH: 'brush',
  STICKERS: 'stickers',
} as const

export type DrawingTool = (typeof DrawingTool)[keyof typeof DrawingTool]

export type StickerTeam = 'red' | 'blue'

export const StickerSymbol = {
  A: 'a',
  B: 'b',
  C: 'c',
  GREEN_TICK: 'green-tick',
  RED_X: 'red-x',
} as const

export type StickerSymbol = (typeof StickerSymbol)[keyof typeof StickerSymbol]

export type ClassStickerDefinition = {
  kind: 'class'
  classId: number
  team: StickerTeam
}

export type SymbolStickerDefinition = {
  kind: 'symbol'
  symbol: StickerSymbol
}

export type StickerDefinition = ClassStickerDefinition | SymbolStickerDefinition

export type StickerAnnotation = StickerDefinition & {
  id: string
  position: [number, number, number]
}

export const UIPanelType = {
  ABOUT: 'About',
  SETTINGS: 'Settings',
  MATCH_KILLFEED: 'MatchKillfeed',
  BOOKMARKS: 'Bookmarks',
  SETUPS: 'Setups',
} as const

export type UIPanelType = (typeof UIPanelType)[keyof typeof UIPanelType]

export const SETUP_STORAGE_VERSION = 1 as const

export type SetupRtsCamera = {
  mode: 'rts'
  position: [number, number, number]
  target: [number, number, number]
}

export type SetupSpectatorCamera = {
  mode: 'spectator'
  position: [number, number, number]
  quaternion: [number, number, number, number]
}

export type SavedSetupCamera = SetupRtsCamera | SetupSpectatorCamera

export type SavedSetup = {
  id: string
  version: typeof SETUP_STORAGE_VERSION
  name: string
  map: string
  camera: SavedSetupCamera
  stickers: StickerAnnotation[]
  createdAt: number
  updatedAt: number
}

export const CrosshairStyle = {
  NONE: 'none',
  CROSSHAIR: 'crosshair',
  CROSS: 'cross',
  CIRCLE: 'circle',
  DOT: 'dot',
} as const

export type CrosshairStyle = (typeof CrosshairStyle)[keyof typeof CrosshairStyle]

export type Download = {
  type: 'map' | 'demo'
  status: 'loading' | 'success' | 'error'
  name: string
  url: string
  progress: number
  size?: number
}

export type MapVisibilityMetadata = {
  version: 2
  transform: 'gltf-to-source:x,-z,y'
  chunkNames: string[]
  chunkBounds: { min: [number, number, number]; max: [number, number, number] }[]
  planes: [number, number, number, number][]
  nodes: [number, number, number][]
  leafClusters: number[]
  visibleChunksByCluster: number[][]
}
