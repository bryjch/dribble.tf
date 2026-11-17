import type * as THREE from 'three'
import { create } from 'zustand'

//
// ─── VIEWMODEL DEBUG HOOKS ──────────────────────────────────────────────────────
//
// What the /debug page (src/components/Debug) reads from and sets on the viewmodel in POV: a
// clip to play on a loop in place of the one the tick calls for, the rig's bones drawn over it,
// and what the rig on screen is made of. The viewer itself never changes these, and the code
// that draws the bones lives with the page, so the viewer's bundle doesn't carry it.
//

export type ViewmodelClip = 'auto' | 'idle' | 'draw' | 'fire'

export interface ViewmodelRigInfo {
  /** The selection's key: class, team, weapon model and animation slot. */
  key: string
  weaponUrl: string
  /** The clips the manifest names for the slot, and which of them the animations lack. */
  clips: { idle: string[]; draw: string[]; fire: string[] }
  missingClips: string[]
  /** Bones the weapon is skinned to, and those the arms have no bone of that name for. */
  weaponBones: number
  unmatchedBones: string[]
  /**
   * Of those, the ones that don't hang from a bone of the arms either: they stay at the weapon's
   * rest pose while the hand moves (the rest follow the bone they hang from).
   */
  strandedBones: string[]
}

/** Something drawn over the rig's bones, moved each frame once the mixer has posed them. */
export interface BonesOverlay extends THREE.Object3D {
  update(): void
  dispose(): void
}

/** Makes one from the arms' bones and the weapon's bones the arms lack. */
export type BonesOverlayFactory = (arms: THREE.Bone[], unmatched: THREE.Bone[]) => BonesOverlay

interface ViewmodelDebugState {
  clip: ViewmodelClip
  /** Draws the rig's bones when set; the page hands its own (src/components/Debug/BonesOverlay). */
  bones: BonesOverlayFactory | null
  rig: ViewmodelRigInfo | null
}

export const useViewmodelDebug = create<ViewmodelDebugState>(() => ({
  clip: 'auto',
  bones: null,
  rig: null,
}))
