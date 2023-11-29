import { getAsset } from './misc'
import { MAP_NAME_SEARCH_MAP, MAP_SKYBOX_SEARCH } from '@constants/mappings'

// Handle demos that have different versioned maps. We need a function that
// can parse a given {mapName}, then determine which gltf model to use
// (e.g. cp_process_final and cp_process_f7 can just use the same map model)

interface MapModelTypes {
  overlay: string
  textured: string
  untextured: string
}

export const getMapModelUrls = (loadedMapName: string): MapModelTypes | undefined => {
  let urls: MapModelTypes | undefined

  Object.entries(MAP_NAME_SEARCH_MAP).forEach(([shortname, foldername]) => {
    if (loadedMapName.includes(shortname)) {
      urls = {
        overlay: getAsset(`/models/maps/${foldername}/overlay_compressed.glb`),
        textured: getAsset(`/models/maps/${foldername}/textured_compressed.glb`),
        untextured: getAsset(`/models/maps/${foldername}/untextured_compressed.glb`),
      } as MapModelTypes
    }
  })

  return urls
}

interface MapSkyboxTypes {
  bk: string
  dn: string
  ft: string
  lf: string
  rt: string
  up: string
  side: string
}

export const getMapSkyboxUrls = (loadedMapName: string): MapSkyboxTypes | undefined => {
  let urls: MapSkyboxTypes | undefined
  Object.entries(MAP_SKYBOX_SEARCH).forEach(([shortname, skyboxname]) => {
    if (loadedMapName.includes(shortname)) {
      urls = {
        lf: getAsset(`/models/skybox/${skyboxname}/${skyboxname}lf.png`),
        rt: getAsset(`/models/skybox/${skyboxname}/${skyboxname}rt.png`),
        ft: getAsset(`/models/skybox/${skyboxname}/${skyboxname}ft.png`),
        bk: getAsset(`/models/skybox/${skyboxname}/${skyboxname}bk.png`),
        dn: getAsset(`/models/skybox/${skyboxname}/${skyboxname}dn.png`),
        up: getAsset(`/models/skybox/${skyboxname}/${skyboxname}up.png`),
      } as MapSkyboxTypes
    }
  })
  return urls
}