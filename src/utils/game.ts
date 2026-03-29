import { getAsset } from './misc'
import { MAP_NAME_SEARCH_MAP, MAP_SKYBOX_MAP } from '@constants/mappings'
import { MapBoundaries } from '@components/Analyse/Data/PositionCache'

// Handle demos that have different versioned maps. We need a function that
// can parse a given {mapName}, then determine which gltf model to use
// (e.g. cp_process_final and cp_process_f7 can just use the same map model)

export const resolveMapFolderName = (loadedMapName: string): string => {
  let folderName = loadedMapName

  Object.entries(MAP_NAME_SEARCH_MAP).forEach(([shortname, foldername]) => {
    if (loadedMapName.includes(shortname)) {
      folderName = foldername
    }
  })

  return folderName
}

interface MapModelTypes {
  overlay: string
  textured: string
}

export const getMapModelUrls = (loadedMapName: string): MapModelTypes | undefined => {
  let urls: MapModelTypes | undefined

  Object.entries(MAP_NAME_SEARCH_MAP).forEach(([shortname, foldername]) => {
    if (loadedMapName.includes(shortname)) {
      urls = {
        overlay: getAsset(`/models/maps/${foldername}/overlay_compressed.glb`),
        textured: getAsset(`/models/maps/${foldername}/textured_compressed.glb`),
      } as MapModelTypes
    }
  })

  return urls
}

export const getMapConversionUrl = (loadedMapName: string): string | undefined => {
  if (!loadedMapName) return undefined
  const foldername = resolveMapFolderName(loadedMapName)
  return getAsset(`/models/maps/${foldername}/conversion.json`)
}

export const getMapVisibilityUrl = (loadedMapName: string): string | undefined => {
  if (!loadedMapName) return undefined
  const foldername = resolveMapFolderName(loadedMapName)
  return getAsset(`/models/maps/${foldername}/visibility.json`)
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

export const fetchMapWorldBounds = async (
  loadedMapName: string
): Promise<Pick<MapBoundaries, 'boundaryMin' | 'boundaryMax'> | null> => {
  const conversionUrl = getMapConversionUrl(loadedMapName)
  if (!conversionUrl) return null

  try {
    const response = await fetch(conversionUrl)
    if (!response.ok) return null
    const meta = await response.json()
    if (meta?.worldBounds?.boundaryMin && meta?.worldBounds?.boundaryMax) {
      return meta.worldBounds
    }
    return null
  } catch {
    return null
  }
}

export const getMapSkyboxUrls = (loadedMapName: string): MapSkyboxTypes | undefined => {
  let urls: MapSkyboxTypes | undefined

  Object.entries(MAP_SKYBOX_MAP).forEach(([shortname, skyboxname]) => {
    if (loadedMapName.includes(shortname)) {
      urls = {
        lf: getAsset(`/models/skybox/${skyboxname}/${skyboxname}_lf.png`),
        rt: getAsset(`/models/skybox/${skyboxname}/${skyboxname}_rt.png`),
        ft: getAsset(`/models/skybox/${skyboxname}/${skyboxname}_ft.png`),
        bk: getAsset(`/models/skybox/${skyboxname}/${skyboxname}_bk.png`),
        dn: getAsset(`/models/skybox/${skyboxname}/${skyboxname}_dn.png`),
        up: getAsset(`/models/skybox/${skyboxname}/${skyboxname}_up.png`),
      } as MapSkyboxTypes
    }
  })

  return urls
}
