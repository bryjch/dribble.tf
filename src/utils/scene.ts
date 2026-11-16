import * as THREE from 'three'
import { first, last } from 'lodash'

import { PLAYER_DIMENSIONS } from '@constants/mappings'
import { MapBoundaries } from '@components/Analyse/Data/Types'

import { objCoordsToVector3 } from './geometry'

const DEFAULT_RTS_CAMERA_OFFSET = new THREE.Vector3(0, 250, 1000)

/**
 * Get all Actors in the scene
 */
/** Whether an object is drawn: it and every parent are visible. */
export function isObjectShown(object: THREE.Object3D | null) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false
  return true
}

export function getSceneActors(scene: THREE.Scene): THREE.Object3D[] {
  const actors: THREE.Object3D[] = []

  scene.traverse(child => {
    if (child.name === 'actor') actors.push(child)
  })

  return actors
}

/**
 * Get a specific Actor in the scene
 */
export function getSceneActor(
  scene: THREE.Scene,
  position: 'first' | 'last'
): THREE.Object3D | undefined
export function getSceneActor(scene: THREE.Scene, entityId: number): THREE.Object3D | undefined
export function getSceneActor(scene: THREE.Scene, value: any): THREE.Object3D | undefined {
  if (typeof value === 'string') {
    switch (value) {
      case 'first':
        return first(scene.children.filter(child => child.name === 'actor'))

      case 'last':
        return last(scene.children.filter(child => child.name === 'actor'))
    }
  }

  if (typeof value === 'number') {
    scene.traverse(child => {
      if (child.name === 'actor' && child.userData.entityId === value) {
        return child
      }
    })
  }

  return undefined
}

export function getSceneProjectiles(scene: THREE.Scene, name: string): THREE.Object3D[] {
  const projectiles: THREE.Object3D[] = []

  if (!name) return projectiles

  scene.traverse(child => {
    if (child.name === name) projectiles.push(child)
  })

  return projectiles
}

/**
 * The scene's bounds and default camera from a map's boundaries (Source world coordinates, as
 * the scene is drawn in). The centre's height is half a player below the world's zero, which is
 * where the default view has always looked.
 */
export function parseMapBoundaries(boundaries: MapBoundaries) {
  const { boundaryMin: min, boundaryMax: max } = boundaries
  const center = new THREE.Vector3(
    min.x + 0.5 * (max.x - min.x),
    min.y + 0.5 * (max.y - min.y),
    -0.5 * PLAYER_DIMENSIONS.z
  )

  return {
    min: objCoordsToVector3(min),
    max: objCoordsToVector3(max),
    center,
    defaultCameraOffset: boundaries.cameraOffset
      ? objCoordsToVector3(boundaries.cameraOffset)
      : DEFAULT_RTS_CAMERA_OFFSET.clone(),
    defaultRtsCenter: boundaries.rtsCenter ? objCoordsToVector3(boundaries.rtsCenter) : center,
  }
}
