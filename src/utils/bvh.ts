import * as THREE from 'three'
import { MeshBVH, MeshBVHOptions, acceleratedRaycast } from 'three-mesh-bvh'

/**
 * Bounds trees (three-mesh-bvh) make raycasting the map fast: a ray across a whole map took
 * ~50 ms against three's plain raycast (big map chunks overlap almost every ray) and under 1 ms
 * with trees. Raycasts use a mesh's tree when its geometry has one and three's own otherwise,
 * InstancedMesh included (it raycasts through Mesh).
 */
THREE.Mesh.prototype.raycast = acceleratedRaycast

/** How often to look again for meshes that loaded after the trees were built, in ms. */
const RECHECK_MS = 2000

/**
 * Builds missing bounds trees for the meshes under `root`, stopping once `budgetMs` has passed so
 * a map's worth (~170 ms) spreads over frames. True when every mesh there has one.
 *
 * `indirect` leaves the geometry's index alone, so drawing and material groups are untouched.
 */
export function buildBoundsTrees(root: THREE.Object3D, budgetMs = 4): boolean {
  const start = performance.now()
  const stack: THREE.Object3D[] = [root]

  while (stack.length) {
    const object = stack.pop()!
    const geometry = (object as THREE.Mesh).isMesh ? (object as THREE.Mesh).geometry : undefined

    if (geometry?.attributes.position && !geometry.boundsTree) {
      if (performance.now() - start > budgetMs) return false
      // 0.7.8 supports `indirect` but its types don't list it yet.
      geometry.boundsTree = new MeshBVH(geometry, { indirect: true } as MeshBVHOptions)
    }

    for (const child of object.children) stack.push(child)
  }

  return true
}

const readiness = new WeakMap<THREE.Object3D, { ready: boolean; checkedAt: number }>()

/**
 * Call once a frame from whatever raycasts `root`: builds its trees a few ms at a time and says
 * whether they are all built, so a caller can skip raycasting (and its ~50 ms) until they are.
 * Several callers share the work.
 */
export function ensureBoundsTrees(root: THREE.Object3D): boolean {
  const state = readiness.get(root) ?? { ready: false, checkedAt: -Infinity }
  readiness.set(root, state)
  const now = performance.now()
  if (now - state.checkedAt < (state.ready ? RECHECK_MS : 0)) return state.ready
  state.ready = buildBoundsTrees(root)
  state.checkedAt = now
  return state.ready
}
