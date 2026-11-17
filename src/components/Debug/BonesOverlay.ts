import * as THREE from 'three'

import type { BonesOverlay, BonesOverlayFactory } from '@components/Scene/viewmodelDebug'

const ARMS_COLOR = new THREE.Color('#37ff5f')
const HUNG_COLOR = new THREE.Color('#ffc53b')
const STRANDED_COLOR = new THREE.Color('#ff3b6b')
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()

/**
 * Lines from each bone to its parent bone, drawn over everything: the arms' bones (which the
 * weapon's matched bones are) in green; the weapon's bones the arms lack in amber where they hang
 * from an arm bone (they follow it), red where they don't (they stay at the weapon's rest pose).
 * Positions are world space, so it belongs at the root of the viewmodel's scene.
 */
export class BonesLines extends THREE.LineSegments implements BonesOverlay {
  private readonly bones: THREE.Bone[]

  constructor(arms: THREE.Bone[], unmatched: THREE.Bone[]) {
    const bones = [...arms, ...unmatched].filter(bone => (bone.parent as THREE.Bone)?.isBone)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bones.length * 6, 3))
    const armSet = new Set<THREE.Object3D>(arms)
    const hung = (bone: THREE.Object3D) => {
      for (let parent = bone.parent; parent; parent = parent.parent)
        if (armSet.has(parent)) return true
      return false
    }
    const colors: number[] = []
    for (const bone of bones) {
      const color = armSet.has(bone) ? ARMS_COLOR : hung(bone) ? HUNG_COLOR : STRANDED_COLOR
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    super(
      geometry,
      new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true })
    )
    this.bones = bones
    this.renderOrder = 999
    this.frustumCulled = false
  }

  /** Moves the lines to where the bones are now (after the mixer has posed them). */
  update() {
    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute
    this.bones.forEach((bone, i) => {
      bone.getWorldPosition(_a)
      ;(bone.parent as THREE.Bone).getWorldPosition(_b)
      position.setXYZ(i * 2, _a.x, _a.y, _a.z)
      position.setXYZ(i * 2 + 1, _b.x, _b.y, _b.z)
    })
    position.needsUpdate = true
  }

  dispose() {
    this.geometry.dispose()
    ;(this.material as THREE.Material).dispose()
  }
}

export const createBonesOverlay: BonesOverlayFactory = (arms, unmatched) =>
  new BonesLines(arms, unmatched)
