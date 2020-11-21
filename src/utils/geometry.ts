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

/**
 * Apply degreesToRadians for x, y, z values of a given Vector3
 */

export const radianizeVector = (vector: THREE.Vector3): THREE.Vector3 => {
  return vector.set(
    degreesToRadians(vector.x),
    degreesToRadians(vector.y),
    degreesToRadians(vector.z)
  )
}

export function eulerizeVector(
  vector: { x: number; y: number; z: number },
  type: 'degrees' | 'radians' = 'degrees'
): THREE.Euler {
  if (type === 'degrees') {
    return new THREE.Euler(
      degreesToRadians(vector.x),
      degreesToRadians(vector.y),
      degreesToRadians(vector.z)
    )
  }

  if (type === 'radians') {
    return new THREE.Euler(vector.x, vector.y, vector.z, 'XYZ')
    // return new THREE.Euler(vector.x, vector.y, vector.z, 'YZX')
    // return new THREE.Euler(vector.x, vector.y, vector.z, 'ZXY') // hmm
    // return new THREE.Euler(vector.x, vector.y, vector.z, 'XZY') // HMMM
    // return new THREE.Euler(vector.x, vector.y, vector.z, 'YXZ')
    // return new THREE.Euler(vector.x, vector.y, vector.z, 'ZYX')
  }

  return new THREE.Euler()
}

/**
 * Find all meshes in an Object3D array (can specify specific mesh name)
 */
export const getMeshes = (sceneObjects: THREE.Object3D[], meshName: string = ''): THREE.Mesh[] => {
  const meshes: THREE.Mesh[] = []

  sceneObjects.forEach(object => {
    object.traverse(child => {
      if (child.type === 'Mesh') {
        if (meshName) {
          if (child.name === meshName) {
            meshes.push(child as THREE.Mesh)
          }
        } else {
          meshes.push(child as THREE.Mesh)
        }
      }
    })
  })

  return meshes
}

/**
 * Find all skinned meshes in an Object3D array (can specify specific mesh name)
 */
export const getSkinnedMeshes = (
  sceneObjects: THREE.Object3D[],
  meshName: string = ''
): THREE.SkinnedMesh[] => {
  const meshes: THREE.SkinnedMesh[] = []

  sceneObjects.forEach(object => {
    object.traverse(child => {
      if (child.type === 'SkinnedMesh') {
        if (meshName) {
          if (child.name === meshName) {
            meshes.push(child as THREE.SkinnedMesh)
          }
        } else {
          meshes.push(child as THREE.SkinnedMesh)
        }
      }
    })
  })

  return meshes
}
