import * as THREE from 'three'

import { type UberedKind, hasCondition } from '@components/Analyse/Data/StreamEvents'

//
// ─── MODEL EFFECTS ──────────────────────────────────────────────────────────────
//
// How a player's conditions show on their models, in the world and (some of them) on their arms
// and weapon in POV:
//
//   über (stock)   glows in the team's colour
//   Jarate, Milk   tinted yellow, white
//   crit boosted   a pulsing team-coloured rim (Kritzkrieg, crit buffs)
//   burning        a flickering orange rim
//   cloaked        drawn faintly; Bonk's phase, half faint
//
// A model gets its own materials (cloneMaterials), which carry a rim term in their shader; its
// look is then set on them by applyModelEffects whenever it changes. The rim animates on
// effectTime, which Actors advances every frame, so nothing per model runs per frame.
//

export type RimMode = 'pulse' | 'flicker'

export interface ModelLook {
  /** 1 opaque; less for a cloak or Bonk. */
  opacity: number
  /** A glow over the whole model. */
  tint: { color: string; intensity: number } | null
  /** A glow on the model's edges. */
  rim: { color: string; mode: RimMode } | null
}

export const PLAIN_LOOK: ModelLook = { opacity: 1, tint: null, rim: null }

const CLOAKED_OPACITY = 0.2
const BONK_OPACITY = 0.5
const UBER_TINT = { red: '#ff3b3b', blue: '#3b8bff' }
const CRIT_RIM = { red: '#ff2e4a', blue: '#4aa8ff' }
const JARATE_TINT = { color: '#e8c41c', intensity: 0.45 }
const MILK_TINT = { color: '#f2f2f2', intensity: 0.4 }
const BURNING_RIM = '#ff7a1a'

interface LookSource {
  team: string
  conditions: number
  ubered: UberedKind | null
}

const teamOf = (team: string) => (team === 'blue' ? 'blue' : 'red')

/** A player's look on their model in the world. */
export function playerLook(player: LookSource): ModelLook {
  const team = teamOf(player.team)
  const { conditions, ubered } = player
  // Only a stock über is invulnerability; Kritz, Quick-Fix and Vaccinator pops look otherwise.
  const tint =
    ubered === 'uber'
      ? { color: UBER_TINT[team], intensity: 0.55 }
      : hasCondition(conditions, 'jarate')
        ? JARATE_TINT
        : hasCondition(conditions, 'milk')
          ? MILK_TINT
          : null
  const rim =
    hasCondition(conditions, 'crits') || ubered === 'kritz'
      ? { color: CRIT_RIM[team], mode: 'pulse' as const }
      : hasCondition(conditions, 'burning')
        ? { color: BURNING_RIM, mode: 'flicker' as const }
        : null
  const opacity = hasCondition(conditions, 'cloaked')
    ? CLOAKED_OPACITY
    : hasCondition(conditions, 'bonk')
      ? BONK_OPACITY
      : 1
  return { opacity, tint, rim }
}

/**
 * A player's look on their own arms and weapon in POV, as TF2 draws them: faint when cloaked,
 * glowing when übered, the weapon's edges glowing when crit boosted. Jarate, Milk, bleeding and
 * burning are on the screen instead (PovEffects).
 */
export function viewmodelLook(player: LookSource, weapon: boolean): ModelLook {
  const look = playerLook(player)
  return {
    opacity: hasCondition(player.conditions, 'cloaked') ? CLOAKED_OPACITY : 1,
    tint: player.ubered === 'uber' ? look.tint : null,
    rim: weapon && look.rim?.mode === 'pulse' ? look.rim : null,
  }
}

export const lookKey = (look: ModelLook) =>
  `${look.opacity}|${look.tint?.color}:${look.tint?.intensity}|${look.rim?.color}:${look.rim?.mode}`

/** Seconds, for the rims' pulse and flicker; Actors advances it every frame. */
export const effectTime = { value: 0 }

type EffectMaterial = THREE.Material & { emissive?: THREE.Color; emissiveIntensity?: number }

interface RimUniforms {
  rimColor: { value: THREE.Color }
  rimStrength: { value: number }
  rimMode: { value: number }
}

const materialsOf = (object: THREE.Object3D) => {
  const material = (object as THREE.Mesh).material
  return (Array.isArray(material) ? material : material ? [material] : []) as EffectMaterial[]
}

/** Adds the rim term to a lit material's shader. */
function addRim(material: THREE.Material) {
  const rim: RimUniforms = {
    rimColor: { value: new THREE.Color() },
    rimStrength: { value: 0 },
    rimMode: { value: 0 },
  }
  material.userData.rim = rim
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, rim, { effectTime })
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 rimColor;
uniform float rimStrength;
uniform float rimMode;
uniform float effectTime;`
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
if (rimStrength > 0.0) {
  float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
  float edge = 0.12 + pow(1.0 - facing, 1.5);
  float wave = rimMode < 1.5
    ? 0.7 + 0.3 * sin(effectTime * 5.0)
    : 0.65 + 0.35 * sin(effectTime * 23.0) * sin(effectTime * 7.3 + 1.7);
  gl_FragColor.rgb += rimColor * edge * rimStrength * wave;
}`
      )
  }
  material.customProgramCacheKey = () => 'player-effects'
}

/** Gives every mesh under `root` its own materials, with the rim term, for its effects. */
export function cloneMaterials(root: THREE.Object3D) {
  root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const own = (m: THREE.Material) => {
      const material = m.clone()
      if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) addRim(material)
      return material
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material)
  })
}

/** Disposes the materials cloneMaterials gave `root`. */
export function disposeMaterials(root: THREE.Object3D) {
  root.traverse(object => {
    for (const material of materialsOf(object)) material.dispose()
  })
}

/** Sets a model's own materials (see cloneMaterials) to a look, keeping the originals. */
export function applyModelEffects(root: THREE.Object3D, look: ModelLook) {
  const faded = look.opacity < 1
  root.traverse(object => {
    for (const material of materialsOf(object)) {
      const original = (material.userData.original ??= {
        transparent: material.transparent,
        opacity: material.opacity,
        depthWrite: material.depthWrite,
        emissive: material.emissive?.clone(),
        emissiveIntensity: material.emissiveIntensity,
      })
      const transparent = faded || original.transparent
      // A change of transparency needs a recompile; the rest are uniforms.
      if (material.transparent !== transparent) material.needsUpdate = true
      material.transparent = transparent
      material.opacity = faded ? look.opacity : original.opacity
      material.depthWrite = faded ? false : original.depthWrite
      if (material.emissive && original.emissive) {
        if (look.tint) material.emissive.set(look.tint.color)
        else material.emissive.copy(original.emissive)
        material.emissiveIntensity = look.tint ? look.tint.intensity : original.emissiveIntensity
      }
      const rim = material.userData.rim as RimUniforms | undefined
      if (rim) {
        rim.rimStrength.value = look.rim ? 2 : 0
        rim.rimMode.value = look.rim?.mode === 'flicker' ? 2 : 1
        if (look.rim) rim.rimColor.value.set(look.rim.color)
      }
    }
  })
}
