import { useRef, useState, useEffect } from 'react'

import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { GLTF, GLTFLoader } from 'three/examples/jsm/Addons.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

import mapChunkingConfig from '@constants/mapChunking.json'
import { MapVisibilityMetadata } from '@constants/types'
import { addDownloadAction, finishDownloadAction, updateDownloadAction } from '@zus/actions'
import { getState, useInstance } from '@zus/store'
import { useDerivedMap } from '@components/Scene/DerivedMap'
import { DerivedMapResult, textComponent } from '@utils/derivedMap'
import { reportError } from '@utils/notice'
import { isPerfLoggingEnabled } from '@utils/misc'

const INVISIBLE_TOOL_MATERIALS = new Set([
  'toolsnodraw',
  'toolsclip',
  'toolsplayerclip',
  'toolsinvisible',
  'toolsinvisibleladder',
  'toolstrigger',
  'toolsareaportal',
  'toolsblockbullets',
  'toolshint',
  'toolsskip',
  'toolsfog',
  'toolsskybox',
  'toolscapture',
  'toolsnobuild',
  'toolsregenerate',
  'toolsrespawn',
  'toolsnpcclip',
  'toolsoccluder',
])

// Entity prefixes that are game-logic helpers and should never be rendered.
// These may appear in older GLB files that were exported before the VMF filter
// was updated to strip them.
const INVISIBLE_NODE_PREFIXES = ['team_control_point']

function isInvisibleToolMaterial(materialName: string): boolean {
  const name = materialName.toLowerCase()
  const baseName = name.includes('/') ? name.split('/').pop()! : name
  return INVISIBLE_TOOL_MATERIALS.has(baseName)
}

// bsp-to-glb keeps every brush model, named model_<index>_<classname>[_<targetname>]; triggers
// and other game-logic volumes are never drawn in game (respawn room visualizers are).
const INVISIBLE_BRUSH_CLASSES =
  /^model_\d+_(trigger_|func_(respawnroom|nobuild|regenerate|capturezone|nogrenades|upgradestation|areaportal|occluder)(_|$))/

function isInvisibleEntityNode(nodeName: string): boolean {
  const name = nodeName.toLowerCase()
  return (
    INVISIBLE_NODE_PREFIXES.some(prefix => name.startsWith(prefix)) ||
    INVISIBLE_BRUSH_CLASSES.test(name)
  )
}

const MAP_WIREFRAME_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#333333',
  opacity: 0.1,
  transparent: true,
  wireframe: true,
})

//
// The untextured ("Plain") look: each material drawn in one colour, its texture's average, and
// with the map's baked lightmaps when it has them (Derived Maps), so surfaces, rooms and depth
// still read. All-white brushes washed out, worst on phones, which default to this mode. No
// texture is drawn, so none is uploaded to the GPU.
//

/** A Derived Map's lightmaps, kept to light its plain materials too. */
const derivedLightmaps = new WeakMap<
  THREE.Object3D,
  { flat: THREE.Texture; directional: THREE.Texture[] }
>()
/** Each model's plain materials, by the material they stand in for. */
const plainMaterials = new WeakMap<THREE.Object3D, Map<THREE.Material, THREE.Material>>()
const averageColors = new WeakMap<THREE.Texture, THREE.Color | null>()

function plainMaterialFor(model: THREE.Object3D, original: THREE.Material): THREE.Material {
  let byOriginal = plainMaterials.get(model)
  if (!byOriginal) plainMaterials.set(model, (byOriginal = new Map()))
  const known = byOriginal.get(original)
  if (known) return known

  const source = original as THREE.MeshStandardMaterial
  const plain = new THREE.MeshStandardMaterial({
    color: averageTextureColor(source.map) ?? new THREE.Color('white'),
    side: original.side,
    transparent: original.transparent,
    opacity: original.opacity,
  })
  const lightmaps = derivedLightmaps.get(model)
  if (lightmaps && source.userData?.bspLit) {
    installSourceMaterialShader(plain, lightmaps.flat, lightmaps.directional)
  }
  byOriginal.set(original, plain)
  return plain
}

/** A texture's average colour, from a few pixels drawn off its decoded image. */
function averageTextureColor(texture: THREE.Texture | null | undefined): THREE.Color | null {
  if (!texture) return null
  if (averageColors.has(texture)) return averageColors.get(texture)!
  let color: THREE.Color | null = null
  try {
    const image = texture.image as CanvasImageSource & { width?: number; height?: number }
    if (image && image.width && image.height) {
      const size = 8
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context) {
        context.drawImage(image, 0, 0, size, size)
        const { data } = context.getImageData(0, 0, size, size)
        let r = 0
        let g = 0
        let b = 0
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
        }
        const count = data.length / 4
        color = new THREE.Color().setRGB(
          r / count / 255,
          g / count / 255,
          b / count / 255,
          THREE.SRGBColorSpace
        )
      }
    }
  } catch {
    // An image that cannot be drawn (compressed, or cross-origin): plain white.
  }
  averageColors.set(texture, color)
  return color
}
const MAP_CHUNKING_ENABLED = mapChunkingConfig.enabled

export interface WorldProps {
  map: string
  mode?: 'textured' | 'untextured' | 'wireframe'
}

type BspVisibilityV2 = {
  version: 2
  clusterCount: number
  clusterWordCount: number
  pvsWords: number[]
  planes: { normal: [number, number, number]; distance: number }[]
  nodes: { planeIndex: number; children: [number, number] }[]
  worldHeadNode: number
  leaves: { cluster: number }[]
  chunks: { index: number; staticPvs: boolean }[]
  chunkClusterWords: number[]
}

type VisibilityMetadata = MapVisibilityMetadata | BspVisibilityV2

type DerivedResult = Extract<DerivedMapResult, { kind: 'derived' }>

const DECAL_OVERLAY_NAME = 'derived_decal_overlays'

export const World = (props: WorldProps) => {
  const ref = useRef<THREE.Group>(null)
  const cameraWorldPositionRef = useRef(new THREE.Vector3())
  const chunkRootsByNameRef = useRef<Map<string, THREE.Object3D>>(new Map())
  const visibilityCullingEnabledRef = useRef(false)
  const currentClusterRef = useRef<number | null>(null)
  const mapLoadRequestIdRef = useRef(0)
  const visibilityRequestIdRef = useRef(0)
  const [mapModel, setMapModel] = useState<THREE.Group | null>()
  const [mapVisibility, setMapVisibility] = useState<VisibilityMetadata | null>(null)
  const { map, mode } = props
  // Which Derived Map (or published GLB) to draw; DerivedMapController resolves it per map.
  const { result } = useDerivedMap()

  // Briefly ensure the map is cleared when the map changes
  // to prevent lingering of the previous map
  useEffect(() => {
    setMapModel(null)
    chunkRootsByNameRef.current = new Map()
    visibilityCullingEnabledRef.current = false
    currentClusterRef.current = null
    useInstance.getState().setRuntimePerf({
      visibleChunkCount: 0,
      currentCluster: null,
    })
    setMapVisibility(null)
  }, [map])

  useEffect(() => {
    if (!MAP_CHUNKING_ENABLED || !result) {
      setMapVisibility(null)
      return
    }

    if (result.kind === 'derived') {
      const metadata = textComponent(result, 'visibility.json')
      setMapVisibility(isBspVisibilityV2(metadata) ? metadata : null)
      return
    }

    const visibilityUrl = result.visibilityUrl
    if (!visibilityUrl) {
      setMapVisibility(null)
      return
    }

    const requestId = ++visibilityRequestIdRef.current

    fetch(visibilityUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to load visibility metadata: ${response.status}`)
        }
        return response.json()
      })
      .then(data => {
        if (requestId !== visibilityRequestIdRef.current) return
        setMapVisibility(isMapVisibilityMetadata(data) ? data : null)
      })
      .catch(() => {
        if (requestId === visibilityRequestIdRef.current) {
          setMapVisibility(null)
        }
      })

    return () => {
      if (visibilityRequestIdRef.current === requestId) {
        visibilityRequestIdRef.current += 1
      }
    }
  }, [map, result])

  // Load the map's model once per resolved map; the scene mode only swaps materials (below).
  useEffect(() => {
    const requestId = ++mapLoadRequestIdRef.current
    if (!result) return

    const load = async () => {
      const gltf =
        result.kind === 'legacy'
          ? await loadGLTF(result.modelUrl, `${map} (textured)`)
          : await loadGLTFBytes(result.components.get('world.glb'))
      try {
        if (requestId !== mapLoadRequestIdRef.current) {
          disposeMapModel(gltf.scene)
          return
        }
        prepareMapModel(gltf.scene)
        // Derived extras (props, decals, lightmaps) hang off the model, so one dispose frees them.
        if (result.kind === 'derived') {
          const started = performance.now()
          await applyDerivedPresentation(gltf.scene, result)
          if (isPerfLoggingEnabled())
            console.info(
              `[Perf][Map] ${map}: presented in ${Math.round(performance.now() - started)} ms`
            )
        }
      } catch (error) {
        disposeMapModel(gltf.scene)
        throw error
      }
      if (requestId !== mapLoadRequestIdRef.current) {
        disposeMapModel(gltf.scene)
        return
      }
      setMapModel(gltf.scene)
    }

    load().catch(error => {
      console.error(error)
      if (requestId === mapLoadRequestIdRef.current) {
        reportError("Couldn't load the map", `${map} failed to load. Try reloading.`)
      }
    })

    return () => {
      if (mapLoadRequestIdRef.current === requestId) {
        mapLoadRequestIdRef.current += 1
      }
    }
  }, [map, result])

  // The model is a <primitive>, which react-three-fiber never disposes, so it is freed here once
  // replaced. This cleanup runs after the commit that took it out of the scene: freed any
  // earlier, it could be drawn once more and uploaded again, and then never freed.
  useEffect(() => {
    if (!mapModel) return
    return () => disposeMapModel(mapModel)
  }, [mapModel])

  useEffect(() => {
    if (!mapModel || !MAP_CHUNKING_ENABLED) {
      chunkRootsByNameRef.current = new Map()
      visibilityCullingEnabledRef.current = false
      currentClusterRef.current = null
      useInstance.getState().setRuntimePerf({
        visibleChunkCount: 0,
        currentCluster: null,
      })
      return
    }

    const chunkRootsByName = collectChunkRoots(mapModel, mapVisibility)
    chunkRootsByNameRef.current = chunkRootsByName
    currentClusterRef.current = null
    setChunkRootVisibility(chunkRootsByName, true)
    useInstance.getState().setRuntimePerf({
      visibleChunkCount: chunkRootsByName.size,
      currentCluster: null,
    })

    if (!mapVisibility) {
      visibilityCullingEnabledRef.current = false
      return
    }

    const missingChunkNames = visibilityChunkNames(mapVisibility).filter(
      chunkName => !chunkRootsByName.has(chunkName)
    )

    if (missingChunkNames.length > 0) {
      visibilityCullingEnabledRef.current = false
      setChunkRootVisibility(chunkRootsByName, true)
      console.warn(
        `Visibility culling disabled for ${map}: missing chunk roots ${missingChunkNames.join(', ')}`
      )
      return
    }

    visibilityCullingEnabledRef.current = true
  }, [map, mapModel, mapVisibility])

  useFrame(state => {
    const chunkRootsByName = chunkRootsByNameRef.current
    if (chunkRootsByName.size === 0) return

    if (!visibilityCullingEnabledRef.current || !mapVisibility || !ref.current) {
      if (currentClusterRef.current !== null) {
        setChunkRootVisibility(chunkRootsByName, true)
        currentClusterRef.current = null
        useInstance.getState().setRuntimePerf({
          visibleChunkCount: chunkRootsByName.size,
          currentCluster: null,
        })
      }
      return
    }

    const cameraWorldPosition = state.camera.getWorldPosition(cameraWorldPositionRef.current)
    const currentCluster = getClusterIndexForWorldPoint(
      cameraWorldPosition,
      ref.current,
      mapVisibility
    )

    if (currentCluster < 0) {
      if (currentClusterRef.current !== -1) {
        setChunkRootVisibility(chunkRootsByName, true)
        currentClusterRef.current = -1
        useInstance.getState().setRuntimePerf({
          visibleChunkCount: chunkRootsByName.size,
          currentCluster: -1,
        })
      }
      return
    }

    if (currentCluster === currentClusterRef.current) {
      return
    }

    const visibleChunkIndices = visibleChunksForCluster(mapVisibility, currentCluster)
    if (!Array.isArray(visibleChunkIndices) || visibleChunkIndices.length === 0) {
      setChunkRootVisibility(chunkRootsByName, true)
      currentClusterRef.current = -1
      useInstance.getState().setRuntimePerf({
        visibleChunkCount: chunkRootsByName.size,
        currentCluster: -1,
      })
      return
    }

    setChunkVisibilityForCluster(
      chunkRootsByName,
      visibilityChunkNames(mapVisibility),
      visibleChunkIndices
    )
    currentClusterRef.current = currentCluster
    useInstance.getState().setRuntimePerf({
      visibleChunkCount: visibleChunkIndices.length,
      currentCluster,
    })
  })

  useEffect(() => {
    if (mapModel) {
      freezeStaticMapSubtree(mapModel)
    }
  }, [mapModel])

  // Swap materials for the scene mode; the model's own are kept in userData to switch back.
  useEffect(() => {
    if (!mapModel) return
    mapModel.traverse(node => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh || !mesh.userData.originalMaterial) return
      const original = mesh.userData.originalMaterial as THREE.Material | THREE.Material[]
      mesh.material =
        mode === 'untextured'
          ? Array.isArray(original)
            ? original.map(material => plainMaterialFor(mapModel, material))
            : plainMaterialFor(mapModel, original)
          : mode === 'wireframe'
            ? MAP_WIREFRAME_MATERIAL
            : mesh.userData.originalMaterial
    })
    // Decals have no untextured or wireframe look of their own; they sit on textured brushes.
    const decals = mapModel.getObjectByName(DECAL_OVERLAY_NAME)
    if (decals) decals.visible = mode !== 'untextured' && mode !== 'wireframe'
  }, [mapModel, mode])

  return (
    // The model is in Source world coordinates, as the scene is, once its glTF y-up axes are
    // turned to Source's z-up
    <group ref={ref} name="world" rotation={[Math.PI / 2, 0, 0]}>
      {mapModel ? <primitive object={mapModel} /> : null}
    </group>
  )
}

function isMapVisibilityMetadata(data: unknown): data is MapVisibilityMetadata {
  if (!data || typeof data !== 'object') return false

  const candidate = data as Record<string, unknown>
  return (
    candidate.version === 2 &&
    candidate.transform === 'gltf-to-source:x,-z,y' &&
    Array.isArray(candidate.chunkNames) &&
    Array.isArray(candidate.chunkBounds) &&
    Array.isArray(candidate.planes) &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.leafClusters) &&
    Array.isArray(candidate.visibleChunksByCluster)
  )
}

function isBspVisibilityV2(data: unknown): data is BspVisibilityV2 {
  if (!data || typeof data !== 'object') return false
  const candidate = data as Partial<BspVisibilityV2>
  return (
    candidate.version === 2 &&
    Number.isInteger(candidate.clusterCount) &&
    Number.isInteger(candidate.clusterWordCount) &&
    Array.isArray(candidate.pvsWords) &&
    Array.isArray(candidate.planes) &&
    Array.isArray(candidate.nodes) &&
    Number.isInteger(candidate.worldHeadNode) &&
    Array.isArray(candidate.leaves) &&
    Array.isArray(candidate.chunks) &&
    Array.isArray(candidate.chunkClusterWords)
  )
}

function collectChunkRoots(
  root: THREE.Object3D,
  metadata: VisibilityMetadata | null
): Map<string, THREE.Object3D> {
  const chunkRootsByName = new Map<string, THREE.Object3D>()

  root.traverse(node => {
    if (isBspVisibilityV2(metadata) && Number.isInteger(node.userData.visibilityChunkIndex)) {
      chunkRootsByName.set(String(node.userData.visibilityChunkIndex), node)
    } else if (/^chunk_\d+_\d+$/.test(node.name)) {
      chunkRootsByName.set(node.name, node)
    }
  })

  return chunkRootsByName
}

function visibilityChunkNames(metadata: VisibilityMetadata): string[] {
  return isMapVisibilityMetadata(metadata)
    ? metadata.chunkNames
    : metadata.chunks.map(chunk => String(chunk.index))
}

function visibleChunksForCluster(metadata: VisibilityMetadata, cluster: number): number[] {
  if (isMapVisibilityMetadata(metadata)) return metadata.visibleChunksByCluster[cluster] ?? []
  if (cluster < 0 || cluster >= metadata.clusterCount) return []
  const row = cluster * metadata.clusterWordCount
  return metadata.chunks.flatMap((chunk, index) => {
    if (!chunk.staticPvs) return [index]
    const chunkRow = index * metadata.clusterWordCount
    for (let word = 0; word < metadata.clusterWordCount; word += 1) {
      if ((metadata.pvsWords[row + word] & metadata.chunkClusterWords[chunkRow + word]) !== 0) {
        return [index]
      }
    }
    return []
  })
}

function setChunkRootVisibility(chunkRootsByName: Map<string, THREE.Object3D>, visible: boolean) {
  chunkRootsByName.forEach(chunkRoot => {
    chunkRoot.visible = visible
  })
}

function setChunkVisibilityForCluster(
  chunkRootsByName: Map<string, THREE.Object3D>,
  chunkNames: string[],
  visibleChunkIndices: number[]
) {
  const visibleChunkIndexSet = new Set(visibleChunkIndices)

  chunkNames.forEach((chunkName, chunkIndex) => {
    const chunkRoot = chunkRootsByName.get(chunkName)
    if (!chunkRoot) return
    chunkRoot.visible = visibleChunkIndexSet.has(chunkIndex)
  })
}

function freezeStaticMapSubtree(root: THREE.Object3D) {
  root.traverse(node => {
    // Its matrix from its position, rotation and scale once, before freezing it: quantized
    // models (meshopt) give nodes a transform that undoes the quantization.
    node.updateMatrix()
    node.matrixAutoUpdate = false

    if (node.type !== 'Mesh') return

    const mesh = node as THREE.Mesh
    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox()
    }
    if (!mesh.geometry.boundingSphere) {
      mesh.geometry.computeBoundingSphere()
    }
    mesh.frustumCulled = true
  })

  root.updateMatrixWorld(true)
}

function getMapLocalPoint(
  worldPoint: THREE.Vector3,
  mapRoot: THREE.Object3D
): THREE.Vector3 | null {
  mapRoot.updateWorldMatrix(true, false)

  const inverseWorldMatrix = new THREE.Matrix4().copy(mapRoot.matrixWorld)
  if (inverseWorldMatrix.determinant() === 0) {
    return null
  }

  return worldPoint.clone().applyMatrix4(inverseWorldMatrix.invert())
}

function convertGltfPointToSource(point: THREE.Vector3): [number, number, number] {
  return [point.x, -point.z, point.y]
}

function getLeafIndexForSourcePoint(
  sourcePoint: [number, number, number],
  metadata: VisibilityMetadata
): number {
  let nodeIndex = isMapVisibilityMetadata(metadata) ? 0 : metadata.worldHeadNode

  while (Number.isInteger(nodeIndex) && nodeIndex >= 0) {
    if (nodeIndex >= metadata.nodes.length) return -1
    if (isMapVisibilityMetadata(metadata)) {
      const [planeIndex, frontChild, backChild] = metadata.nodes[nodeIndex]
      const plane = metadata.planes[planeIndex]
      if (!plane) return -1
      const distance =
        sourcePoint[0] * plane[0] + sourcePoint[1] * plane[1] + sourcePoint[2] * plane[2] - plane[3]
      nodeIndex = distance >= 0 ? frontChild : backChild
    } else {
      const node = metadata.nodes[nodeIndex]
      const plane = metadata.planes[node.planeIndex]
      if (!plane) return -1
      const distance =
        sourcePoint[0] * plane.normal[0] +
        sourcePoint[1] * plane.normal[1] +
        sourcePoint[2] * plane.normal[2] -
        plane.distance
      nodeIndex = node.children[distance >= 0 ? 0 : 1]
    }
  }

  const leafIndex = -nodeIndex - 1
  const leafCount = isMapVisibilityMetadata(metadata)
    ? metadata.leafClusters.length
    : metadata.leaves.length
  return leafIndex >= 0 && leafIndex < leafCount ? leafIndex : -1
}

function getClusterIndexForLeaf(leafIndex: number, metadata: VisibilityMetadata): number {
  const leafCount = isMapVisibilityMetadata(metadata)
    ? metadata.leafClusters.length
    : metadata.leaves.length
  if (leafIndex < 0 || leafIndex >= leafCount) {
    return -1
  }

  const clusterIndex = isMapVisibilityMetadata(metadata)
    ? metadata.leafClusters[leafIndex]
    : metadata.leaves[leafIndex].cluster
  return Number.isInteger(clusterIndex) && clusterIndex >= 0 ? clusterIndex : -1
}

function getClusterIndexForWorldPoint(
  worldPoint: THREE.Vector3,
  mapRoot: THREE.Object3D | null,
  metadata: VisibilityMetadata | null
): number {
  if (!mapRoot || !metadata) {
    return -1
  }

  const mapLocalPoint = getMapLocalPoint(worldPoint, mapRoot)
  if (!mapLocalPoint) {
    return -1
  }

  const leafIndex = getLeafIndexForSourcePoint(convertGltfPointToSource(mapLocalPoint), metadata)
  return getClusterIndexForLeaf(leafIndex, metadata)
}

//
// ─── HELPERS ────────────────────────────────────────────────────────────────────
//

// Useful resource: https://github.com/donmccurdy/three-gltf-viewer/blob/master/src/viewer.js

function loadGLTF(url: string, name?: string) {
  return new Promise<GLTF>((resolve, reject) => {
    try {
      // Map models are meshopt-compressed (EXT_meshopt_compression), see scripts/convert-map.mjs
      const gltfLoader = new GLTFLoader()
        .setCrossOrigin('anonymous')
        .setMeshoptDecoder(MeshoptDecoder)

      const onLoad = (gltf: GLTF) => {
        finishDownloadAction(url, 'success')
        resolve(gltf)
      }

      const onProgress = (xhr: ProgressEvent) => {
        // TODO: The lengthComputable seems to be false after being deployed to
        // Netlify. This may be due to some content headers needing to be set:
        // https://community.netlify.com/t/progressevent-total-is-0-for-asset-on-deployed-site-but-works-in-local-environment/3747

        const fileDownload = getState().downloads.get(url)
        if (!fileDownload) addDownloadAction({ type: 'map', name: name ?? url, url: url })

        if (xhr.lengthComputable) {
          const percentComplete = (xhr.loaded / xhr.total) * 100
          updateDownloadAction(url, { progress: percentComplete, size: xhr.total })
        }
      }

      const onError = (error: unknown) => {
        finishDownloadAction(url, 'error')
        reject(error)
      }

      gltfLoader.load(url, onLoad, onProgress, onError)
    } catch (error) {
      console.error(error)
      reject(error)
    }
  })
}

/** Hides tool brushes and game-logic nodes, and remembers each mesh's own material. */
function prepareMapModel<T extends THREE.Object3D>(model: T): T {
  model.traverse(node => {
    // Hide invisible game-logic entity nodes (e.g. team_control_point brushes)
    if (isInvisibleEntityNode(node.name)) {
      node.visible = false
      return
    }
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(
      simplifyMapMaterial
    )
    for (const material of materials) {
      // Hide invisible tool materials (nodraw, clip, trigger, etc.)
      if (isInvisibleToolMaterial(material.name)) mesh.visible = false
      material.depthWrite = true
      // Additive glows (prop light cones, see scripts/lib/source-models.mjs) add their light.
      if (material.userData.additive) {
        material.transparent = true
        material.depthWrite = false
        material.blending = THREE.AdditiveBlending
      }
      ;(material as THREE.MeshStandardMaterial).vertexColors = false
      material.needsUpdate = true
    }
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0]
    mesh.userData.originalMaterial = mesh.material
  })
  return model
}

const simplified = new WeakMap<THREE.Material, THREE.Material>()

/**
 * The converter marks every map material double-sided and specular (KHR_materials_specular,
 * which makes three use MeshPhysicalMaterial). Solid brushes are seen from one side, and the
 * maps' specular is flat, so opaque materials draw front faces only, as MeshStandardMaterial.
 */
function simplifyMapMaterial(material: THREE.Material): THREE.Material {
  const known = simplified.get(material)
  if (known) return known
  let next = material
  if ((material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    next = new THREE.MeshStandardMaterial().copy(material as THREE.MeshStandardMaterial)
    material.dispose()
  }
  if (!next.transparent && !next.alphaTest) next.side = THREE.FrontSide
  simplified.set(material, next)
  return next
}

/** Frees a map model's geometry, materials and textures on the GPU, derived extras included. */
function disposeMapModel(model: THREE.Object3D) {
  const materials = new Set<THREE.Material>()
  model.traverse(node => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const own = mesh.userData.originalMaterial ?? mesh.material
    for (const material of Array.isArray(own) ? own : [own]) materials.add(material)
  })
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) value.dispose()
    }
    material.dispose()
  }
  // Lightmaps and secondary textures live in shader uniforms, not in material properties.
  for (const texture of derivedTextures.get(model) ?? []) {
    texture.dispose()
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) {
      texture.image.close()
    }
  }
  derivedTextures.delete(model)
  plainMaterials.get(model)?.forEach(material => material.dispose())
  plainMaterials.delete(model)
  derivedLightmaps.delete(model)
}

//
// ─── DERIVED MAPS ───────────────────────────────────────────────────────────────
//

/** Textures a Derived Map's presentation created for a model, freed with it. */
const derivedTextures = new WeakMap<THREE.Object3D, Set<THREE.Texture>>()

/** A material's $basetexture2, blended in by the displacement alpha (outside userData, which
 * three.js copies as JSON when a material is cloned). */
const secondaryTextures = new WeakMap<THREE.Material, THREE.Texture>()

function trackTexture(model: THREE.Object3D, texture: THREE.Texture) {
  let textures = derivedTextures.get(model)
  if (!textures) derivedTextures.set(model, (textures = new Set()))
  textures.add(texture)
  return texture
}

function loadGLTFBytes(bytes: Uint8Array | undefined): Promise<GLTF> {
  if (!bytes) return Promise.reject(new Error('Derived Map has no world.glb component'))
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new Promise((resolve, reject) => {
    new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parse(buffer as ArrayBuffer, '', resolve, reject)
  })
}

async function textureFromBytes(
  bytes: Uint8Array,
  type: string,
  color = true
): Promise<THREE.Texture> {
  // Alpha is data, not coverage: TF2 base textures keep a specular mask there and lightmaps an
  // exponent, so the bitmap must not be premultiplied (or colour-converted, for the data).
  const bitmap = await createImageBitmap(
    new Blob(
      [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
      { type }
    ),
    { premultiplyAlpha: 'none', colorSpaceConversion: color ? 'default' : 'none' }
  )
  const texture = new THREE.Texture(bitmap)
  texture.flipY = false
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
  if (color) {
    // Source materials tile across faces.
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
  } else {
    // RGBExp32 cannot be interpolated as stored; the shader filters it after decoding.
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
  }
  texture.needsUpdate = true
  return texture
}

type MaterialFeatures = {
  translucent?: boolean
  additive?: boolean
  alphaTest?: boolean
  noCull?: boolean
}

/** materials.json, as scripts/maps/build-maps.mjs writes it. */
type MapMaterial = {
  materialIndex: number
  name: string
  features?: MaterialFeatures
  textures?: { parameter?: string; file?: string }[]
}

/** The VMT's blending: glass, grates and decals blend or cut out by the base texture's alpha. */
function applyMaterialFeatures(material: THREE.Material, features: MaterialFeatures | undefined) {
  if (features?.translucent || features?.additive) {
    material.transparent = true
    material.depthWrite = false
    if (features.additive) material.blending = THREE.AdditiveBlending
  } else if (features?.alphaTest) {
    material.alphaTest = 0.5
  }
  if (features?.noCull) material.side = THREE.DoubleSide
  material.needsUpdate = true
}

/**
 * Gives a built map's world model its textures, lightmap, props and decals. Runs after
 * prepareMapModel, on the simplified materials; props are prepared as they are attached.
 */
async function applyDerivedPresentation(scene: THREE.Group, result: DerivedResult) {
  const materials =
    (textComponent(result, 'materials.json') as { materials?: MapMaterial[] } | null)?.materials ??
    []
  const loadedTextures = new Map<string, Promise<THREE.Texture>>()
  const textureFor = (file: string | undefined) => {
    const bytes = file ? result.components.get(file) : undefined
    if (!file || !bytes) return undefined
    let loaded = loadedTextures.get(file)
    if (!loaded) {
      const type = file.endsWith('.webp') ? 'image/webp' : 'image/png'
      loaded = textureFromBytes(bytes, type).then(texture => trackTexture(scene, texture))
      loadedTextures.set(file, loaded)
    }
    return loaded
  }
  const textureOf = (material: MapMaterial, parameter: string) =>
    textureFor(material.textures?.find(texture => texture.parameter === parameter)?.file)

  const byIndex = new Map<number, THREE.MeshStandardMaterial[]>()
  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue
      const index = Number(material.userData.sourceMaterialManifestIndex)
      if (Number.isInteger(index)) byIndex.set(index, [...(byIndex.get(index) ?? []), material])
    }
  })
  const timings: Record<string, number> = {}
  let mark = performance.now()
  const lap = (name: string) => {
    timings[name] = Math.round(performance.now() - mark)
    mark = performance.now()
  }
  // Textures decode in parallel (createImageBitmap runs off the main thread).
  await Promise.all(
    materials.map(async source => {
      const targets = byIndex.get(source.materialIndex) ?? []
      if (!targets.length) return
      const [baseTexture, secondaryTexture] = await Promise.all([
        textureOf(source, '$basetexture'),
        textureOf(source, '$basetexture2'),
      ])
      for (const material of targets) {
        if (baseTexture) material.map = baseTexture
        if (secondaryTexture) secondaryTextures.set(material, secondaryTexture)
        applyMaterialFeatures(material, source.features)
      }
    })
  )
  lap('textures')

  const flatBytes = result.components.get('lightmaps/flat.png')
  if (flatBytes) {
    const flat = trackTexture(scene, await textureFromBytes(flatBytes, 'image/png', false))
    const directional = await Promise.all(
      [0, 1, 2].map(index => {
        const bytes = result.components.get(`lightmaps/directional-${index}.png`)
        return bytes
          ? textureFromBytes(bytes, 'image/png', false).then(texture =>
              trackTexture(scene, texture)
            )
          : Promise.resolve(flat)
      })
    )
    scene.traverse(node => {
      if (!(node instanceof THREE.Mesh) || !node.geometry.getAttribute('uv1')) return
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (material instanceof THREE.MeshStandardMaterial) {
          installSourceMaterialShader(material, flat, directional)
        }
      }
    })
    derivedLightmaps.set(scene, { flat, directional })
  }
  lap('lightmap')
  await attachProps(scene, result)
  lap('props')
  const decals = await buildDecalOverlay(scene, result, materials, textureOf)
  if (decals) {
    scene.add(decals)
    decals.updateMatrixWorld(true)
  }
  lap('decals')
  if (isPerfLoggingEnabled()) console.info('[Perf][Map] presentation ms', timings)
}

function installSourceMaterialShader(
  material: THREE.MeshStandardMaterial,
  flat: THREE.Texture,
  directional: THREE.Texture[]
) {
  material.onBeforeCompile = shader => {
    shader.uniforms.bspLightmapFlat = { value: flat }
    shader.uniforms.bspLightmap0 = { value: directional[0] }
    shader.uniforms.bspLightmap1 = { value: directional[1] }
    shader.uniforms.bspLightmap2 = { value: directional[2] }
    shader.uniforms.bspSecondaryTexture = {
      value: secondaryTextures.get(material) ?? material.map,
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 uv1; attribute float _displacement_alpha; varying vec2 vBspLightmapUv; varying float vBspDisplacementAlpha;'
      )
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvBspLightmapUv = uv1; vBspDisplacementAlpha = _displacement_alpha;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D bspLightmapFlat; uniform sampler2D bspLightmap0; uniform sampler2D bspLightmap1; uniform sampler2D bspLightmap2; uniform sampler2D bspSecondaryTexture; varying vec2 vBspLightmapUv; varying float vBspDisplacementAlpha;
vec3 decodeRgbExp32(vec4 value) { float exponent = value.a * 255.0; exponent -= step(127.5, exponent) * 256.0; return value.rgb * exp2(exponent); }
vec3 bspLightmap(sampler2D map, vec2 uv) {
  ivec2 size = textureSize(map, 0);
  vec2 st = uv * vec2(size) - 0.5;
  vec2 cell = floor(st);
  vec2 f = st - cell;
  ivec2 base = ivec2(cell);
  ivec2 top = size - 1;
  vec3 a = decodeRgbExp32(texelFetch(map, clamp(base, ivec2(0), top), 0));
  vec3 b = decodeRgbExp32(texelFetch(map, clamp(base + ivec2(1, 0), ivec2(0), top), 0));
  vec3 c = decodeRgbExp32(texelFetch(map, clamp(base + ivec2(0, 1), ivec2(0), top), 0));
  vec3 d = decodeRgbExp32(texelFetch(map, clamp(base + ivec2(1, 1), ivec2(0), top), 0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`
      )
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n#ifdef USE_MAP\nvec4 bspSecondary = texture2D(bspSecondaryTexture, vMapUv); diffuseColor.rgb = mix(diffuseColor.rgb, bspSecondary.rgb, clamp(vBspDisplacementAlpha, 0.0, 1.0));\n#endif'
      )
      .replace(
        '#include <opaque_fragment>',
        'vec3 bspFlat = bspLightmap(bspLightmapFlat, vBspLightmapUv); vec3 bspDirectional = (bspLightmap(bspLightmap0, vBspLightmapUv) + bspLightmap(bspLightmap1, vBspLightmapUv) + bspLightmap(bspLightmap2, vBspLightmapUv)) / 3.0; outgoingLight *= max(bspFlat, bspDirectional);\n#include <opaque_fragment>'
      )
  }
  material.userData.bspLit = true
  material.customProgramCacheKey = () => 'bsp-rgbexp32-directional-displacement-v2'
  material.needsUpdate = true
}

/**
 * Places the map's props. Static props (most of them, often hundreds of copies of a few dozen
 * models) are drawn instanced: one InstancedMesh per mesh of each model and skin. Dynamic props
 * are copied onto their nodes, which entities may move or hide.
 */
async function attachProps(scene: THREE.Group, result: DerivedResult) {
  const props = textComponent(result, 'props.json') as {
    staticProps?: { staticPropIndex: number; modelAssetIndex: number; skin?: number }[]
    dynamicProps?: { entityIndex: number; modelAssetIndex: number; skin?: number }[]
  } | null
  if (!props) return
  const models = new Map<string, Promise<THREE.Group | null>>()
  const modelFor = (key: string) => {
    let model = models.get(key)
    if (!model) {
      const bytes = result.components.get(key)
      model = bytes
        ? loadGLTFBytes(bytes).then(gltf => prepareMapModel(gltf.scene))
        : Promise.resolve(null)
      models.set(key, model)
    }
    return model
  }
  const propKey = (asset: number, skin = 0) => `props/${asset}_${skin}.glb`

  const nodes = new Map<string, THREE.Object3D>()
  scene.traverse(node => {
    if (node.name.startsWith('static_prop_') || node.name.startsWith('dynamic_prop_'))
      nodes.set(node.name, node)
  })
  scene.updateMatrixWorld(true)
  const toScene = scene.matrixWorld.clone().invert()

  const placements = new Map<string, THREE.Matrix4[]>()
  for (const prop of props.staticProps ?? []) {
    const target = nodes.get(`static_prop_${prop.staticPropIndex}`)
    if (!target) continue
    const key = propKey(prop.modelAssetIndex, prop.skin)
    if (!placements.has(key)) placements.set(key, [])
    placements.get(key)!.push(toScene.clone().multiply(target.matrixWorld))
  }
  const placed = new THREE.Matrix4()
  // Every model parses at once; meshopt decoding and their textures overlap.
  const keys = [
    ...new Set([
      ...placements.keys(),
      ...(props.dynamicProps ?? []).map(prop => propKey(prop.modelAssetIndex, prop.skin)),
    ]),
  ]
  await Promise.all(keys.map(modelFor))
  for (const [key, matrices] of placements) {
    const model = await modelFor(key)
    if (!model) continue
    model.updateMatrixWorld(true)
    model.traverse(node => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh || !mesh.visible) return
      const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, matrices.length)
      instanced.name = `props:${key}`
      instanced.userData.originalMaterial = mesh.userData.originalMaterial
      matrices.forEach((matrix, i) =>
        instanced.setMatrixAt(i, placed.multiplyMatrices(matrix, mesh.matrixWorld))
      )
      instanced.instanceMatrix.needsUpdate = true
      instanced.computeBoundingSphere()
      scene.add(instanced)
    })
  }

  for (const prop of props.dynamicProps ?? []) {
    let target = nodes.get(`dynamic_prop_${prop.entityIndex}`)
    if (!target) {
      for (const [name, node] of nodes)
        if (name.startsWith(`dynamic_prop_${prop.entityIndex}_`)) target = node
    }
    const model = await modelFor(propKey(prop.modelAssetIndex, prop.skin))
    // clone() copies userData as JSON, so the copy's own materials are recorded again.
    if (target && model) target.add(prepareMapModel(model.clone(true)))
  }
}

async function buildDecalOverlay(
  scene: THREE.Group,
  result: DerivedResult,
  materials: MapMaterial[],
  textureOf: (material: MapMaterial, parameter: string) => Promise<THREE.Texture> | undefined
): Promise<THREE.Group | null> {
  const sidecar = textComponent(result, 'decal-overlays.json') as {
    records?: {
      materialIndex?: number
      fragments?: {
        positions?: [number, number, number][]
        uvs?: [number, number][]
        indices?: number[]
      }[]
    }[]
  } | null
  if (!sidecar?.records?.length) return null
  // A decal's material: the world's own copy of it, or (decal-only materials) one made here.
  const fromScene = new Map<number, THREE.Material>()
  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      const index = Number(material.userData.sourceMaterialManifestIndex)
      if (Number.isInteger(index) && !fromScene.has(index)) fromScene.set(index, material)
    }
  })
  const byIndex = new Map(materials.map(material => [material.materialIndex, material]))
  const made = new Map<number, Promise<THREE.Material>>()
  const decalMaterial = (index: number) => {
    let material = made.get(index)
    if (!material) {
      const scenes = fromScene.get(index)
      const source = byIndex.get(index)
      material = scenes
        ? Promise.resolve(scenes.clone())
        : Promise.resolve(source ? textureOf(source, '$basetexture') : undefined).then(map => {
            const material = new THREE.MeshStandardMaterial({ map: map ?? null, roughness: 1 })
            applyMaterialFeatures(material, source?.features ?? { translucent: true })
            return material
          })
      made.set(index, material)
    }
    return material
  }

  const group = new THREE.Group()
  group.name = DECAL_OVERLAY_NAME
  for (const record of sidecar.records) {
    for (const fragment of record.fragments ?? []) {
      if (!fragment.positions?.length || !fragment.indices?.length) continue
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          fragment.positions.flatMap(([x, y, z]) => [x, z, -y]),
          3
        )
      )
      if (fragment.uvs?.length === fragment.positions.length) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(fragment.uvs.flat(), 2))
      }
      geometry.setIndex(fragment.indices)
      const material = await decalMaterial(Number(record.materialIndex))
      material.depthWrite = false
      material.polygonOffset = true
      material.polygonOffsetFactor = -10
      material.polygonOffsetUnits = 1
      group.add(new THREE.Mesh(geometry, material))
    }
  }
  return group.children.length ? group : null
}
