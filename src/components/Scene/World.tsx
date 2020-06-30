import React, { useRef, useState, useEffect } from 'react'
import humanizeDuration from 'humanize-duration'

import * as THREE from 'three'
import 'react-three-fiber'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'

const MAP_WIREFRAME_MATERIAL = new THREE.MeshBasicMaterial({
  color: 'green',
  opacity: 0.2,
  transparent: true,
  wireframe: true,
})

const MAP_DEFAULT_MATERIAL = new THREE.MeshLambertMaterial({
  color: 'white',
})

export interface WorldProps {
  map: string
  mode?: 'normal' | 'wireframe'
}

export const World = (props: WorldProps) => {
  const ref = useRef()
  const [mapModel, setMapModel] = useState<THREE.Group>()
  const { map, mode } = props

  useEffect(() => {
    try {
      const loadStartTime = window.performance.now()

      // TODO: check prop {map} value against some mapping to
      // determine which .obj file should be loaded
      const objLoader = new OBJLoader()
      const mapFile = require('../../assets/process.obj')
      const mapMat = MAP_DEFAULT_MATERIAL

      const onLoad = (mapObj: THREE.Group) => {
        const downloadDoneTime = window.performance.now()
        console.log(
          `Map loaded. Took ${humanizeDuration(downloadDoneTime - loadStartTime, {
            maxDecimalPoints: 5,
          })}.`
        )

        mapObj.traverse((child: THREE.Object3D) => {
          if (child.type === 'Mesh') {
            const m = child as THREE.Mesh
            m.material = mapMat
            m.geometry.computeVertexNormals()
          }
        })

        const normalsDoneTime = window.performance.now()
        console.log(
          `Map normals generated. Took ${humanizeDuration(normalsDoneTime - downloadDoneTime, {
            maxDecimalPoints: 5,
          })}.`
        )

        setMapModel(mapObj)
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

      objLoader.load(mapFile, onLoad, onProgress, onError)
    } catch (error) {
      console.error(error)
    }
  }, [map])

  useEffect(() => {
    if (mapModel) {
      mapModel.traverse((child: THREE.Object3D) => {
        if (child.type === 'Mesh') {
          const m = child as THREE.Mesh
          m.material = mode === 'wireframe' ? MAP_WIREFRAME_MATERIAL : MAP_DEFAULT_MATERIAL
          m.geometry.computeVertexNormals()
        }
      })
    }
  }, [mapModel, mode])

  return (
    <group ref={ref} name="world">
      {mapModel ? <primitive object={mapModel} /> : null}
    </group>
  )
}
