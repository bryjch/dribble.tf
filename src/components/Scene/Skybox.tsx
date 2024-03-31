import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'

import { getMapSkyboxUrls } from '@utils/game'

export interface SkyboxProps {
  map: string
}

export const Skybox = (props: SkyboxProps) => {
  const { scene } = useThree()

  useEffect(() => {
    try {
      const mapSkyboxFileUrls = getMapSkyboxUrls(props.map)

      if (!mapSkyboxFileUrls) {
        console.warn(`Failed to load skybox for map ${props.map}`)
        return
      }

      const skyboxURLS = [
        mapSkyboxFileUrls.lf,
        mapSkyboxFileUrls.rt,
        mapSkyboxFileUrls.bk,
        mapSkyboxFileUrls.ft,
        mapSkyboxFileUrls.up,
        mapSkyboxFileUrls.dn,
      ]
      const skyboxLoader = new THREE.CubeTextureLoader()
      const skyboxTexture = skyboxLoader.load(skyboxURLS)
      scene.background = skyboxTexture
    } catch (error) {
      console.error(error)
    }

    return () => {
      scene.background = null
    }
  }, [props.map, scene])

  return null
}
