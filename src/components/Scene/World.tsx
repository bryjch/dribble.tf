import { useRef, useState, useEffect } from 'react'

import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { GLTF, GLTFLoader } from 'three/examples/jsm/Addons.js'

import { ActorDimensions } from '@components/Scene/Actors'

import { MapVisibilityMetadata } from '@constants/types'
import { addDownloadAction, updateDownloadAction } from '@zus/actions'
import { getState, useStore } from '@zus/store'
import { getMapModelUrls, getMapVisibilityUrl } from '@utils/game'

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

function isInvisibleToolMaterial(materialName: string): boolean {
  const name = materialName.toLowerCase()
  const baseName = name.includes('/') ? name.split('/').pop()! : name
  return INVISIBLE_TOOL_MATERIALS.has(baseName)
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

export interface WorldProps {
  map: string
  mode?: 'textured' | 'untextured' | 'wireframe'
}

export const World = (props: WorldProps) => {
  const ref = useRef<THREE.Group>(null)
  const cameraWorldPositionRef = useRef(new THREE.Vector3())
  const chunkRootsByNameRef = useRef<Map<string, THREE.Object3D>>(new Map())
  const visibilityCullingEnabledRef = useRef(false)
  const currentClusterRef = useRef<number | null>(null)
  const mapLoadRequestIdRef = useRef(0)
  const visibilityRequestIdRef = useRef(0)
  const [mapModel, setMapModel] = useState<THREE.Group | null>()
  const [mapOverlay, setMapOverlay] = useState<THREE.Group | null>()
  const [mapVisibility, setMapVisibility] = useState<MapVisibilityMetadata | null>(null)
  const { map, mode } = props

  const bounds = useStore(state => state.scene.bounds)

  // Briefly ensure the map is cleared when the map changes
  // to prevent lingering of the previous map
  useEffect(() => {
    setMapModel(null)
    setMapOverlay(null)
    chunkRootsByNameRef.current = new Map()
    visibilityCullingEnabledRef.current = false
    currentClusterRef.current = null
    setMapVisibility(null)
  }, [map])

  useEffect(() => {
    const visibilityUrl = getMapVisibilityUrl(map)
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
  }, [map])

  useEffect(() => {
    const requestId = ++mapLoadRequestIdRef.current

    try {
      const mapModelFileUrls = getMapModelUrls(map)

      if (!mapModelFileUrls) {
        alert('Unable to load map model. It may not be available on dribble.tf.')
        return
      }

      if (mode === 'textured') {
        loadGLTF(mapModelFileUrls.textured, `${map} (textured)`).then(gltf => {
          if (requestId === mapLoadRequestIdRef.current && gltf && gltf.scene) {
            setMapModel(gltf.scene)
          }
        })

        // Note: map overlays don't currently exist - they were an attempt to have certain
        // textures/models as a separate "layer" so we could toggle them for better performance
        // or visibility (e.g. removing roofs so we can see inside buildings). Instead, we just
        // render everything as singular .gltf models

        // loadGLTF(mapModelFileUrls.overlay).then((gltf: any) => {
        //   if (gltf && gltf.scene) {
        //     setMapOverlay(gltf.scene)
        //   }
        // })
      }

      if (mode === 'untextured' || mode === 'wireframe') {
        loadGLTF(mapModelFileUrls.untextured, `${map} (untextured)`).then(gltf => {
          if (requestId === mapLoadRequestIdRef.current && gltf && gltf.scene) {
            setMapModel(gltf.scene)
            setMapOverlay(null)
          }
        })
      }
    } catch (error) {
      alert(
        `Unable to load map: ${map} (${mode})\nThe project is probably missing the necessary files.`
      )
      console.error(error)
    }

    return () => {
      if (mapLoadRequestIdRef.current === requestId) {
        mapLoadRequestIdRef.current += 1
      }
    }
  }, [map, mode])

  useEffect(() => {
    if (!mapModel) {
      chunkRootsByNameRef.current = new Map()
      visibilityCullingEnabledRef.current = false
      currentClusterRef.current = null
      return
    }

    const chunkRootsByName = collectChunkRoots(mapModel)
    chunkRootsByNameRef.current = chunkRootsByName
    currentClusterRef.current = null
    setChunkRootVisibility(chunkRootsByName, true)

    if (!mapVisibility) {
      visibilityCullingEnabledRef.current = false
      return
    }

    const missingChunkNames = mapVisibility.chunkNames.filter(
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
      }
      return
    }

    if (currentCluster === currentClusterRef.current) {
      return
    }

    const visibleChunkIndices = mapVisibility.visibleChunksByCluster[currentCluster]
    if (!Array.isArray(visibleChunkIndices) || visibleChunkIndices.length === 0) {
      setChunkRootVisibility(chunkRootsByName, true)
      currentClusterRef.current = -1
      return
    }

    setChunkVisibilityForCluster(
      chunkRootsByName,
      mapVisibility.chunkNames,
      visibleChunkIndices
    )
    currentClusterRef.current = currentCluster
  })

  // Update map overlay materials
  useEffect(() => {
    if (mapOverlay) {
      mapOverlay.traverse((child: THREE.Object3D) => {
        traverseMaterials(child, (material: any) => {
          // if (material.map) material.map.encoding = THREE.sRGBEncoding
          // if (material.emissiveMap) material.emissiveMap.encoding = THREE.sRGBEncoding
          material.depthWrite = true
          material.needsUpdate = true

          material.polygonOffset = true
          material.polygonOffsetUnits = 1
          material.polygonOffsetFactor = -10
          material.vertexColors = false
        })
      })
    }
  }, [mapOverlay, mode])

  useEffect(() => {
    if (mapModel) {
      freezeStaticMapSubtree(mapModel)
    }

    if (mapOverlay) {
      freezeStaticMapSubtree(mapOverlay)
    }
  }, [mapModel, mapOverlay])

  // Update map model materials
  useEffect(() => {
    if (mapModel) {
      mapModel.traverse((child: THREE.Object3D) => {
        traverseMaterials(child, (material: any, node: any) => {
          // Hide invisible tool materials (nodraw, clip, trigger, etc.)
          if (isInvisibleToolMaterial(material.name)) {
            node.visible = false
            return
          }

          // if (material.map) material.map.encoding = THREE.sRGBEncoding
          // if (material.emissiveMap) material.emissiveMap.encoding = THREE.sRGBEncoding
          material.depthWrite = true
          material.vertexColors = false
          material.needsUpdate = true

          if (mode === 'untextured') {
            node.material = MAP_UNTEXTURED_MATERIAL
          }

          if (mode === 'wireframe') {
            node.material = MAP_WIREFRAME_MATERIAL
          }
        })
      })
    }
  }, [mapModel, mode])

  // Reposition the world to the center of the scene bounds
  useEffect(() => {
    // Not entirely sure if this logic is correct
    const x = bounds.center.x - bounds.max.x
    const y = -bounds.center.y - bounds.min.y
    const z = ActorDimensions.z * 0.5

    ref.current?.position.copy(bounds.center).add(new THREE.Vector3(x, y, z))
  }, [bounds])

  return (
    // Account for valve maps using different axis system
    <group ref={ref} name="world" rotation={[Math.PI / 2, 0, 0]}>
      {mapModel ? <primitive object={mapModel} /> : null}
      {mapOverlay ? <primitive object={mapOverlay} /> : null}
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

function collectChunkRoots(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const chunkRootsByName = new Map<string, THREE.Object3D>()

  root.traverse(node => {
    if (/^chunk_\d+_\d+$/.test(node.name)) {
      chunkRootsByName.set(node.name, node)
    }
  })

  return chunkRootsByName
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

function getMapLocalPoint(worldPoint: THREE.Vector3, mapRoot: THREE.Object3D): THREE.Vector3 | null {
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
  metadata: MapVisibilityMetadata
): number {
  let nodeIndex = 0

  while (Number.isInteger(nodeIndex) && nodeIndex >= 0) {
    if (nodeIndex >= metadata.nodes.length) return -1

    const [planeIndex, frontChild, backChild] = metadata.nodes[nodeIndex]
    const plane = metadata.planes[planeIndex]
    if (!plane) return -1

    const distance =
      sourcePoint[0] * plane[0] + sourcePoint[1] * plane[1] + sourcePoint[2] * plane[2] - plane[3]
    nodeIndex = distance >= 0 ? frontChild : backChild
  }

  const leafIndex = -nodeIndex - 1
  return leafIndex >= 0 && leafIndex < metadata.leafClusters.length ? leafIndex : -1
}

function getClusterIndexForLeaf(leafIndex: number, metadata: MapVisibilityMetadata): number {
  if (leafIndex < 0 || leafIndex >= metadata.leafClusters.length) {
    return -1
  }

  const clusterIndex = metadata.leafClusters[leafIndex]
  return Number.isInteger(clusterIndex) && clusterIndex >= 0 ? clusterIndex : -1
}

function getClusterIndexForWorldPoint(
  worldPoint: THREE.Vector3,
  mapRoot: THREE.Object3D | null,
  metadata: MapVisibilityMetadata | null
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
      const gltfLoader = new GLTFLoader().setCrossOrigin('anonymous')

      const onLoad = (gltf: GLTF) => {
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
        throw error
      }

      gltfLoader.load(url, onLoad, onProgress, onError)
    } catch (error) {
      console.error(error)
      reject(error)
    }
  })
}

function traverseMaterials(
  object: THREE.Object3D,
  callback: (material: THREE.Material, node: THREE.Object3D) => void
) {
  object.traverse((node: THREE.Object3D) => {
    if (node.type === 'Mesh') {
      const m = node as THREE.Mesh
      const materials = Array.isArray(m.material) ? m.material : [m.material]

      materials.forEach((material: THREE.Material) => callback(material, node))
    }
  })
}
