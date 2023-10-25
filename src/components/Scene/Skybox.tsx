import { useEffect } from 'react'

import * as THREE from 'three'
import { useThree } from "react-three-fiber"
import { getMapSkyboxUrls } from '@utils/game'

export interface WorldProps {
  map: string
}

export const Skybox2D = (props: WorldProps) => {
  //const ref = useRef<THREE.Group>()
  //const [mapSkybox2D, setMapSkybox2D] = useState<THREE.Group | null>()
  const { map } = props
  const { scene } = useThree()
  
  useEffect(() => {
    
    
    try {
      const mapSkyboxFileUrls = getMapSkyboxUrls(map)

      if (!mapSkyboxFileUrls) {
        alert('Unable to load map skybox.')
        return
      }
        const skyboxURLS = [
            mapSkyboxFileUrls.lf,
            mapSkyboxFileUrls.rt,
            mapSkyboxFileUrls.bk,
            mapSkyboxFileUrls.ft,
            mapSkyboxFileUrls.up,
            mapSkyboxFileUrls.dn
        ]
        const skyboxLoader = new THREE.CubeTextureLoader()
        const skyboxTexture = skyboxLoader.load(skyboxURLS)
        scene.background = skyboxTexture
        
      
    } catch (error) {
      alert(
        `Unable to load skybox for map: ${map} \nThe project is probably missing the necessary files.`
      )
      console.error(error)
    }

  }, [map])

  return null;
}
