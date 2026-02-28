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

export const radianizeVector = (vector: THREE.Vector3Like): THREE.Vector3 => {
  return new THREE.Vector3(
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

// ─── Source Engine Angle Helpers ──────────────────────────────────────────────

export type SourceAnglesDeg = {
  // Source QAngle convention (degrees): pitch=x, yaw=y, roll=z
  pitch: number
  yaw: number
  roll?: number
}

/**
 * AngleVectors basis (pitch/yaw/roll -> forward/right/up) using Source/TF2 conventions.
 */
export function angleVectorsFromSourceAnglesDeg(angles: SourceAnglesDeg): {
  forward: THREE.Vector3
  right: THREE.Vector3
  up: THREE.Vector3
} {
  const pitch = angles.pitch || 0
  const yaw = angles.yaw || 0
  const roll = angles.roll || 0

  const sp = Math.sin(degreesToRadians(pitch))
  const cp = Math.cos(degreesToRadians(pitch))
  const sy = Math.sin(degreesToRadians(yaw))
  const cy = Math.cos(degreesToRadians(yaw))
  const sr = Math.sin(degreesToRadians(roll))
  const cr = Math.cos(degreesToRadians(roll))

  const forward = new THREE.Vector3(cp * cy, cp * sy, -sp)
  const right = new THREE.Vector3(-sr * sp * cy + cr * sy, -sr * sp * sy - cr * cy, -sr * cp)
  const up = new THREE.Vector3(cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp)

  return { forward, right, up }
}

/**
 * Build a Three.js quaternion for a camera such that:
 * - camera world direction (local -Z) matches Source forward
 * - camera +X matches Source right
 * - camera +Y matches Source up
 */
export function cameraQuaternionFromSourceAnglesDeg(angles: SourceAnglesDeg): THREE.Quaternion {
  const { forward, right, up } = angleVectorsFromSourceAnglesDeg(angles)

  // Three cameras look down local -Z, so local +Z maps to -forward.
  const zAxis = forward.clone().multiplyScalar(-1)
  const m = new THREE.Matrix4().makeBasis(right, up, zAxis)
  return new THREE.Quaternion().setFromRotationMatrix(m)
}

/**
 * Yaw-only quaternion for body rotation (rotation around Z axis).
 */
export function yawQuaternionFromDegrees(yawDeg: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), degreesToRadians(yawDeg))
}

/**
 * Frame-rate-independent exponential smoothing alpha.
 * Returns a blend factor for lerp/slerp that behaves consistently regardless of frame rate.
 *
 * @param deltaSeconds - Time elapsed since last frame (from useFrame callback)
 * @param tauSeconds - Time constant controlling smoothing speed (larger = slower)
 * @returns Blend factor in [0, 1]
 */
export const smoothingAlpha = (deltaSeconds: number, tauSeconds: number): number => {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return 1
  }
  return 1 - Math.exp(-deltaSeconds / Math.max(0.0001, tauSeconds))
}

/**
 * State for detecting "stale frames" at tick boundaries where frameProgress
 * has been updated but React hasn't re-rendered with new tick data yet.
 */
export type StaleFrameGuard = {
  prevProgress: number
  posX: number
  posY: number
  posZ: number
  isStale: boolean
}

export function createStaleFrameGuard(pos: { x: number; y: number; z: number }): StaleFrameGuard {
  return { prevProgress: 0, posX: pos.x, posY: pos.y, posZ: pos.z, isStale: false }
}

/**
 * Compute a stable lerp progress that avoids backward jumps at tick boundaries.
 *
 * DemoViewer.animate() updates frameProgress synchronously via requestAnimationFrame,
 * but position data flows through React props which update asynchronously. At tick
 * boundaries, frameProgress resets to near 0 while props still contain old tick data,
 * causing a one-frame backward jump. At slow playback speeds (e.g. 0.1x) this
 * manifests as visible stutter.
 */
export function guardedLerpProgress(
  guard: StaleFrameGuard,
  frameProgress: number,
  position: { x: number; y: number; z: number },
  playing: boolean
): number {
  let lerpProgress = Math.min(Math.max(frameProgress, 0), 0.999)

  const posChanged =
    position.x !== guard.posX ||
    position.y !== guard.posY ||
    position.z !== guard.posZ

  if (posChanged || !playing) {
    guard.isStale = false
  } else if (frameProgress < guard.prevProgress - 0.5) {
    guard.isStale = true
  }

  if (guard.isStale) {
    lerpProgress = 0.999
  }

  guard.prevProgress = frameProgress
  guard.posX = position.x
  guard.posY = position.y
  guard.posZ = position.z

  return lerpProgress
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
