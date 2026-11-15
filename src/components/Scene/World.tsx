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

function isInvisibleEntityNode(nodeName: string): boolean {
  const name = nodeName.toLowerCase()
  return INVISIBLE_NODE_PREFIXES.some(prefix => name.startsWith(prefix))
}

const MAP_WIREFRAME_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#333333',
  opacity: 0.1,
  transparent: true,
  wireframe: true,
})

const MAP_UNTEXTURED_MATERIAL = new THREE.MeshStandardMaterial({
  color: 'white',
})
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
        if (result.kind === 'derived') await applyDerivedPresentation(gltf.scene, result)
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
      mesh.material =
        mode === 'untextured'
          ? MAP_UNTEXTURED_MATERIAL
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

async function textureFromBytes(bytes: Uint8Array, color = true): Promise<THREE.Texture> {
  const bitmap = await createImageBitmap(
    new Blob(
      [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
      { type: 'image/png' }
    )
  )
  const texture = new THREE.Texture(bitmap)
  texture.flipY = false
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function sharedDecodedTexture(
  result: Extract<DerivedMapResult, { kind: 'derived' }>,
  lookupPath: string
): Uint8Array | undefined {
  const source = result.sharedIndex.resources[lookupPath]
  const decoded = source?.dependencies
    .map(path => result.sharedIndex.resources[path])
    .find(descriptor => descriptor?.kind === 'decodedTexture')
  return decoded ? result.sharedAssets.get(decoded.logicalPath) : undefined
}

/**
 * Gives a Derived Map's world model its textures, lightmaps, shared props and decals. Runs after
 * prepareMapModel, on the simplified materials; props are prepared as they are attached.
 */
async function applyDerivedPresentation(scene: THREE.Group, result: DerivedResult) {
  const materials = textComponent(result, 'materials.json') as {
    materials?: {
      materialIndex?: number
      textures?: { parameter?: string; lookupPath?: string; packageSourceIndex?: number }[]
    }[]
  } | null
  const texturePackage = textComponent(result, 'material-textures.json') as {
    sources?: { output?: { fileName?: string } }[]
  } | null
  const loadedTextures = new Map<string, Promise<THREE.Texture>>()
  const textureFor = (texture: { lookupPath?: string; packageSourceIndex?: number }) => {
    const packaged =
      texture.packageSourceIndex === undefined
        ? undefined
        : texturePackage?.sources?.[texture.packageSourceIndex]?.output?.fileName
    const bytes = packaged
      ? result.components.get(`textures/${packaged}`)
      : texture.lookupPath
        ? sharedDecodedTexture(result, texture.lookupPath)
        : undefined
    if (!bytes) return undefined
    const identity = packaged ?? texture.lookupPath!
    let loaded = loadedTextures.get(identity)
    if (!loaded) {
      loaded = textureFromBytes(bytes).then(texture => trackTexture(scene, texture))
      loadedTextures.set(identity, loaded)
    }
    return loaded
  }

  const byIndex = new Map<number, THREE.MeshStandardMaterial[]>()
  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue
      const index = Number(material.userData.sourceMaterialManifestIndex)
      if (Number.isInteger(index)) byIndex.set(index, [...(byIndex.get(index) ?? []), material])
    }
  })
  for (const source of materials?.materials ?? []) {
    const targets = byIndex.get(Number(source.materialIndex)) ?? []
    const base = source.textures?.find(
      texture => texture.parameter?.toLowerCase() === '$basetexture'
    )
    const secondary = source.textures?.find(
      texture => texture.parameter?.toLowerCase() === '$basetexture2'
    )
    const baseTexture = base && (await textureFor(base))
    const secondaryTexture = secondary && (await textureFor(secondary))
    for (const material of targets) {
      if (baseTexture) material.map = baseTexture
      if (secondaryTexture) secondaryTextures.set(material, secondaryTexture)
      material.needsUpdate = true
    }
  }

  const flatBytes = result.components.get('lightmaps/flat.png')
  if (flatBytes) {
    const flat = trackTexture(scene, await textureFromBytes(flatBytes, false))
    const directional = await Promise.all(
      [0, 1, 2].map(index => {
        const bytes = result.components.get(`lightmaps/directional-${index}.png`)
        return bytes
          ? textureFromBytes(bytes, false).then(texture => trackTexture(scene, texture))
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
  }
  await attachSharedProps(scene, result)
  const decals = buildDecalOverlay(scene, result)
  if (decals) {
    scene.add(decals)
    decals.updateMatrixWorld(true)
  }
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
        '#include <common>\nuniform sampler2D bspLightmapFlat; uniform sampler2D bspLightmap0; uniform sampler2D bspLightmap1; uniform sampler2D bspLightmap2; uniform sampler2D bspSecondaryTexture; varying vec2 vBspLightmapUv; varying float vBspDisplacementAlpha; vec3 decodeRgbExp32(vec4 value) { float exponent = value.a * 255.0; exponent -= step(127.5, exponent) * 256.0; return value.rgb * exp2(exponent); }'
      )
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n#ifdef USE_MAP\nvec4 bspSecondary = texture2D(bspSecondaryTexture, vMapUv); diffuseColor.rgb = mix(diffuseColor.rgb, bspSecondary.rgb, clamp(vBspDisplacementAlpha, 0.0, 1.0));\n#endif'
      )
      .replace(
        '#include <opaque_fragment>',
        'vec3 bspFlat = decodeRgbExp32(texture2D(bspLightmapFlat, vBspLightmapUv)); vec3 bspDirectional = (decodeRgbExp32(texture2D(bspLightmap0, vBspLightmapUv)) + decodeRgbExp32(texture2D(bspLightmap1, vBspLightmapUv)) + decodeRgbExp32(texture2D(bspLightmap2, vBspLightmapUv))) / 3.0; outgoingLight *= max(bspFlat, bspDirectional);\n#include <opaque_fragment>'
      )
  }
  material.customProgramCacheKey = () => 'bsp-rgbexp32-directional-displacement-v1'
  material.needsUpdate = true
}

async function attachSharedProps(scene: THREE.Group, result: DerivedResult) {
  const props = textComponent(result, 'props.json') as {
    modelAssets?: { modelAssetIndex: number; sourcePath: string }[]
    staticProps?: { staticPropIndex: number; modelAssetIndex: number }[]
    dynamicProps?: { entityIndex: number; modelAssetIndex?: number }[]
  } | null
  const models = new Map<number, THREE.Group>()
  for (const asset of props?.modelAssets ?? []) {
    const path = asset.sourcePath.replace(/\\/g, '/').toLowerCase()
    const logicalPath = path.startsWith('models/') ? path : `models/${path}`
    const descriptor = result.sharedIndex.resources[logicalPath]
    const glb = descriptor?.dependencies
      .map(dependency => result.sharedIndex.resources[dependency])
      .find(dependency => dependency?.kind === 'studioModel')
    const bytes = glb && result.sharedAssets.get(glb.logicalPath)
    if (bytes) models.set(asset.modelAssetIndex, (await loadGLTFBytes(bytes)).scene)
  }
  for (const prop of props?.staticProps ?? []) {
    const target = scene.getObjectByName(`static_prop_${prop.staticPropIndex}`)
    const model = models.get(prop.modelAssetIndex)
    if (target && model) target.add(prepareMapModel(model.clone(true)))
  }
  for (const prop of props?.dynamicProps ?? []) {
    let target = scene.getObjectByName(`dynamic_prop_${prop.entityIndex}`)
    if (!target) {
      scene.traverse(object => {
        if (!target && object.name.startsWith(`dynamic_prop_${prop.entityIndex}_`)) target = object
      })
    }
    const model = prop.modelAssetIndex === undefined ? undefined : models.get(prop.modelAssetIndex)
    if (target && model) target.add(prepareMapModel(model.clone(true)))
  }
}

function buildDecalOverlay(scene: THREE.Group, result: DerivedResult): THREE.Group | null {
  const sidecar = textComponent(result, 'decal-overlays.json') as {
    records?: {
      status?: string
      materialIndex?: number
      fragments?: {
        positions?: [number, number, number][]
        uvs?: [number, number][]
        indices?: number[]
      }[]
    }[]
  } | null
  if (!sidecar?.records) return null
  const materials = new Map<number, THREE.Material>()
  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      const index = Number(material.userData.sourceMaterialManifestIndex)
      if (Number.isInteger(index) && !materials.has(index)) materials.set(index, material)
    }
  })
  const group = new THREE.Group()
  group.name = DECAL_OVERLAY_NAME
  for (const record of sidecar.records) {
    if (record.status !== 'handled') continue
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
      const source = materials.get(Number(record.materialIndex))
      const material = source?.clone() ?? new THREE.MeshStandardMaterial({ color: 0xffffff })
      material.depthWrite = true
      material.polygonOffset = true
      material.polygonOffsetFactor = -10
      material.polygonOffsetUnits = 1
      group.add(new THREE.Mesh(geometry, material))
    }
  }
  return group.children.length ? group : null
}
