import * as THREE from 'three'
import { first, last } from 'lodash'

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
