import { useRef, useState, useEffect } from 'react'

import * as THREE from 'three'
import { GLTF, GLTFLoader } from 'three/examples/jsm/Addons.js'

import { ActorDimensions } from '@components/Scene/Actor'

import { useStore } from '@zus/store'
import { getMapModelUrls } from '@utils/game'

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
  const ref = useRef<THREE.Group>()
  const [mapModel, setMapModel] = useState<THREE.Group | null>()
  const [mapOverlay, setMapOverlay] = useState<THREE.Group | null>()
  const { map, mode } = props

  const bounds = useStore(state => state.scene.bounds)

  useEffect(() => {
    try {
      const mapModelFileUrls = getMapModelUrls(map)

      if (!mapModelFileUrls) {
        alert('Unable to load map model. It may not be available on dribble.tf.')
        return
      }

      if (mode === 'textured') {
        loadGLTF(mapModelFileUrls.textured).then(gltf => {
          if (gltf && gltf.scene) {
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
        loadGLTF(mapModelFileUrls.untextured).then(gltf => {
          if (gltf && gltf.scene) {
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
  }, [map, mode])

  // Update map overlay materials
  useEffect(() => {
    if (mapOverlay) {
      mapOverlay.traverse((child: THREE.Object3D) => {
        traverseMaterials(child, (material: any) => {
          if (material.map) material.map.encoding = THREE.sRGBEncoding
          if (material.emissiveMap) material.emissiveMap.encoding = THREE.sRGBEncoding
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

  // Update map model materials
  useEffect(() => {
    if (mapModel) {
      mapModel.traverse((child: THREE.Object3D) => {
        traverseMaterials(child, (material: any, node: any) => {
          if (material.map) material.map.encoding = THREE.sRGBEncoding
          if (material.emissiveMap) material.emissiveMap.encoding = THREE.sRGBEncoding
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

//
// ─── HELPERS ────────────────────────────────────────────────────────────────────
//

// Useful resource: https://github.com/donmccurdy/three-gltf-viewer/blob/master/src/viewer.js

function loadGLTF(file: string) {
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
        if (xhr.lengthComputable) {
          const percentComplete = (xhr.loaded / xhr.total) * 100
          console.log(`Map load progress: ${Math.round(percentComplete)}%`)
        }
      }

      const onError = (error: ErrorEvent) => {
        throw error
      }

      gltfLoader.load(file, onLoad, onProgress, onError)
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
