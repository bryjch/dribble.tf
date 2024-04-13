import * as THREE from 'three'
import { first, last } from 'lodash'

import { ActorDimensions } from '@components/Scene/Actors'
import { MapBoundaries } from '@components/Analyse/Data/PositionCache'

import { objCoordsToVector3 } from './geometry'

/**
 * Get all Actors in the scene
 */
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

export function parseMapBoundaries(boundaries: MapBoundaries) {
  return {
    min: objCoordsToVector3(boundaries.boundaryMin),
    max: objCoordsToVector3(boundaries.boundaryMax),
    center: new THREE.Vector3(
      0.5 * (boundaries.boundaryMax.x - boundaries.boundaryMin.x),
      0.5 * (boundaries.boundaryMax.y - boundaries.boundaryMin.y),
      -boundaries.boundaryMin.z - 0.5 * ActorDimensions.z
    ),
    defaultCameraOffset: boundaries.cameraOffset
      ? objCoordsToVector3(boundaries.cameraOffset)
      : new THREE.Vector3(0, 0, 0),
    defaultControlOffset: boundaries.controlOffset
      ? objCoordsToVector3(boundaries.controlOffset)
      : new THREE.Vector3(0, 0, 100),
  }
}
