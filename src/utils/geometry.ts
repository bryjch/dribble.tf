import * as THREE from 'three'

/**
 * Extract {x, y, z} values from an object into a new three.js Vector3
 */

export const objCoordsToVector3 = (obj: { x: number; y: number; z: number }): THREE.Vector3 => {
  return new THREE.Vector3(obj.x, obj.y, obj.z)
}

/**
 * Extract {x, y, z} values from an object into an array where [x, y, z]
 */

export const objCoordsToArray = (obj: { x: number; y: number; z: number }): Array<number> => {
  return [obj.x, obj.y, obj.z]
}

/**
 * Convert an array where [x, y, z] into a new three.js Vector3
 */

export const arrayToVector3 = ([x, y, z]: [number, number, number]): THREE.Vector3 => {
  return new THREE.Vector3(x, y, z)
}

/**
 * Convert an array where [x, y, z] into an object with {x, y, z}
 */

export const arrayToObjCoords = ([x, y, z]: [number, number, number]): Object => {
  return { x, y, z }
}

/**
 * Convert degrees to radians
 */

export const degreesToRadians = (degrees: number): number => {
  return degrees * (Math.PI / 180)
}
