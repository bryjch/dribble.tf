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

export const UIPanelType = {
  ABOUT: 'About',
  SETTINGS: 'Settings',
} as const

export type UIPanelType = (typeof UIPanelType)[keyof typeof UIPanelType]
