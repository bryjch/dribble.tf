export const SceneMode = {
  WIREFRAME: 'wireframe',
  UNTEXTURED: 'untextured',
  TEXTURED: 'textured',
} as const

export type SceneMode = (typeof SceneMode)[keyof typeof SceneMode]
