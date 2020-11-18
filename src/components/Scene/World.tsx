import React, { useRef, useState, useEffect } from 'react'
import { useSelector } from 'react-redux'

import * as THREE from 'three'
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'

const { NODE_ENV, REACT_APP_CLOUDFRONT_URL } = process.env

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
  mode?: 'normal' | 'textured' | 'untextured' | 'wireframe'
}

export const World = (props: WorldProps) => {
  const ref = useRef<THREE.Group>()
  const [mapModel, setMapModel] = useState<THREE.Group | null>()
  const [mapOverlay, setMapOverlay] = useState<THREE.Group | null>()
  const { map, mode } = props

  const bounds: any = useSelector((state: any) => state.scene.bounds)

  useEffect(() => {
    try {
      if (mode === 'normal' || mode === 'textured') {
        const texturedFile = getMapFile(`${map}/textured_compressed.glb`)
        const overlayFile = getMapFile(`${map}/overlay_compressed.glb`)

        loadGLTF(texturedFile).then((gltf: any) => {
          if (gltf && gltf.scene) {
            setMapModel(gltf.scene)
          }
        })

        loadGLTF(overlayFile).then((gltf: any) => {
          if (gltf && gltf.scene) {
            setMapOverlay(gltf.scene)
          }
        })
      }

      if (mode === 'untextured' || mode === 'wireframe') {
        const untexturedFile = getMapFile(`${map}/untextured_compressed.glb`)

        loadGLTF(untexturedFile).then((gltf: any) => {
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

    ref.current?.position.copy(bounds.center).add(new THREE.Vector3(x, y, 0))
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

// Conditionally fetch map file from either 1. local assets or 2. Cloudfront
// (becausing serving large static binaries on Netlify is really slow)
// (TODO: ther should be some check if fetching from Cloudfront fails --
// if so, it should always fallback to loading from local assets)

function getMapFile(endpoint: string) {
  if (NODE_ENV === 'production' && !!REACT_APP_CLOUDFRONT_URL) {
    return `${REACT_APP_CLOUDFRONT_URL}/${endpoint}`
  } else {
    return require(`../../assets/maps/${endpoint}`)
  }
}

// Useful resource: https://github.com/donmccurdy/three-gltf-viewer/blob/master/src/viewer.js

function loadGLTF(file: string) {
  return new Promise((resolve, reject) => {
    try {
      const gltfLoader = new GLTFLoader().setCrossOrigin('anonymous')

      const onLoad = (gltf: GLTF) => {
        console.log(gltf)
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
