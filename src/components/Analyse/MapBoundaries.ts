import { MapBoundaries } from './Data/PositionCache'

/**
 * The parser's MapBoundaries doesn't actually have these properties (cameraOffset, controlOffset)
 * but it's useful to have these declarations as it'll let us customize the default camera position
 * and control position for each map - and this is a pretty decent place to do it!
 * (note: control often requires a z-offset, because map makers don't use a consistent ground level)
 */
export const OVERWRITE_MAP_BOUNDARIES: { [mapName: string]: MapBoundaries } = {
  cp_gullywash_final1: {
    boundaryMin: { x: -4050, y: -2950, z: -14672 },
    boundaryMax: { x: 5432, y: 2260, z: 1312 },
    cameraOffset: { x: -570, y: -600, z: 980 },
    controlOffset: { x: 0, y: 0, z: 0 },
  },
  cp_gullywash_f6: {
    boundaryMin: { x: -4717, y: -2643, z: -529 },
    boundaryMax: { x: 4765, y: 2567, z: 1311 },
    cameraOffset: { x: -1020, y: -440, z: 960 },
    controlOffset: { x: 0, y: 0, z: 0 },
  },
  cp_metalworks_f5: {
    boundaryMin: { x: -3034, y: -6699, z: -14672 },
    boundaryMax: { x: 3374, y: 4939, z: 1088 },
    cameraOffset: { x: -860, y: -800, z: 380 },
    controlOffset: { x: 0, y: 0, z: -500 },
  },
  cp_process_final: {
    boundaryMin: { x: -5222, y: -3146, z: -14672 },
    boundaryMax: { x: 5216, y: 3128, z: 1728 },
    cameraOffset: { x: -650, y: -580, z: 720 },
    controlOffset: { x: 0, y: 0, z: 500 },
  },
  cp_reckoner: {
    boundaryMin: { x: -3232, y: -4640, z: -800 },
    boundaryMax: { x: 3232, y: 4640, z: 1672 },
    cameraOffset: { x: -220, y: 1330, z: 980 },
    controlOffset: { x: 0, y: 0, z: 0 },
  },
  cp_snakewater_final1: {
    boundaryMin: { x: -5671, y: -2649, z: -584 },
    boundaryMax: { x: 6687, y: 2961, z: 960 },
    cameraOffset: { x: 900, y: -700, z: 500 },
    controlOffset: { x: 0, y: 0, z: 0 },
  },
  cp_sultry: {
    boundaryMin: { x: -3704, y: -5200, z: -128 },
    boundaryMax: { x: 3704, y: 5200, z: 1765 },
    cameraOffset: { x: 1150, y: 460, z: 1145 },
    controlOffset: { x: 0, y: 0, z: 500 },
  },
  cp_sunshine: {
    boundaryMin: { x: -8798, y: 173, z: -14672 },
    boundaryMax: { x: -2502, y: 10279, z: 1376 },
    cameraOffset: { x: -670, y: 976, z: 605 },
    controlOffset: { x: 0, y: 0, z: 0 },
  },
  cp_villa: {
    boundaryMin: { x: -5504, y: -3777, z: -1120 },
    boundaryMax: { x: 5504, y: 3777, z: 768 },
    cameraOffset: { x: -1182, y: -475, z: 560 },
    controlOffset: { x: 0, y: 0, z: 0 },
  },
  koth_bagel_rc4: {
    boundaryMin: { x: -4286, y: -1234, z: 0 },
    boundaryMax: { x: 4196, y: 1150, z: 1168 },
    cameraOffset: { x: 1210, y: -550, z: 1100 },
    controlOffset: { x: 0, y: 0, z: 100 },
  },
  koth_product_rc8: {
    boundaryMin: { x: -2859, y: -3668, z: -128 },
    boundaryMax: { x: -171, y: 3776, z: 1402 },
    cameraOffset: { x: 570, y: -1360, z: 920 },
    controlOffset: { x: 0, y: 0, z: 0 },
  },
}

OVERWRITE_MAP_BOUNDARIES['koth_viaduct'] = OVERWRITE_MAP_BOUNDARIES['koth_product_rcx']
OVERWRITE_MAP_BOUNDARIES['koth_viaduct'] = OVERWRITE_MAP_BOUNDARIES['koth_product_rc8']
OVERWRITE_MAP_BOUNDARIES['cp_prolands'] = OVERWRITE_MAP_BOUNDARIES['cp_badlands']
OVERWRITE_MAP_BOUNDARIES['cp_gullywash'] = OVERWRITE_MAP_BOUNDARIES['cp_gullywash_f6']

const mapAliases = new Map<string, string>([['cp_prolands', 'cp_badlands']])

function getMapBasename(map: string): string {
  if (OVERWRITE_MAP_BOUNDARIES[map]) {
    return map
  }
  const trimMapName = (map: string) => {
    while (map.lastIndexOf('_') > map.indexOf('_')) {
      map = map.substr(0, map.lastIndexOf('_'))
    }
    return map
  }
  const trimmed = trimMapName(map)
  if (OVERWRITE_MAP_BOUNDARIES[trimmed]) {
    return trimmed
  }
  for (const existingMap of Object.keys(OVERWRITE_MAP_BOUNDARIES)) {
    if (trimMapName(existingMap) === map) {
      return existingMap
    }
  }
  for (const existingMap of Object.keys(OVERWRITE_MAP_BOUNDARIES)) {
    if (trimMapName(existingMap) === trimmed) {
      return existingMap
    }
  }
  return map
}

export function findMapAlias(map: string): string {
  const baseName = getMapBasename(map)
  const alias = mapAliases.get(baseName)
  return alias ? alias : baseName
}

export function getMapBoundaries(map: string): MapBoundaries | null {
  const mapAlias = findMapAlias(map)
  return OVERWRITE_MAP_BOUNDARIES[mapAlias]
}
