import { MapBoundaries } from './Data/Types'

/**
 * Per-map bounds and default camera, all in Source world coordinates. The demo's own bounds
 * don't say where a good RTS overview is, so this lets each map set its orbit centre and the
 * camera's offset from it. (Until 2026-11 the centres were relative to each map model's
 * minimum corner; they were converted with each map's conversion.json.)
 */
export const OVERWRITE_MAP_BOUNDARIES: { [mapName: string]: MapBoundaries } = {
  cp_granary_pro_rc17a3: {
    boundaryMin: { x: -3232, y: -4640, z: -800 },
    boundaryMax: { x: 3232, y: 4640, z: 1672 },
    rtsCenter: { x: -1546, y: -3, z: -378 },
    cameraOffset: { x: 335, y: 744, z: 687 },
  },
  cp_gullywash_final1: {
    boundaryMin: { x: -4050, y: -2950, z: -14672 },
    boundaryMax: { x: 5432, y: 2260, z: 1312 },
    rtsCenter: { x: -11, y: -5, z: 429 },
    cameraOffset: { x: -625, y: -428, z: 557 },
  },
  cp_gullywash_f6: {
    boundaryMin: { x: -4717, y: -2643, z: -529 },
    boundaryMax: { x: 4765, y: 2567, z: 1311 },
    rtsCenter: { x: -11, y: -5, z: 429 },
    cameraOffset: { x: -625, y: -428, z: 557 },
  },
  cp_metalworks_f5: {
    boundaryMin: { x: -3034, y: -6699, z: -14672 },
    boundaryMax: { x: 3374, y: 4939, z: 1088 },
    rtsCenter: { x: 161, y: -865, z: -218 },
    cameraOffset: { x: -600, y: -633, z: 680 },
  },
  cp_process_final: {
    boundaryMin: { x: -5222, y: -3146, z: -14672 },
    boundaryMax: { x: 5216, y: 3128, z: 1728 },
    rtsCenter: { x: -4, y: -3, z: 486 },
    cameraOffset: { x: -711, y: -837, z: 702 },
  },
  cp_prolands_rc2ta: {
    boundaryMin: { x: -4285, y: -4898, z: -14672 },
    boundaryMax: { x: 2577, y: 4858, z: 1672 },
    rtsCenter: { x: -4, y: 4, z: 303 },
    cameraOffset: { x: 433, y: 769, z: 600 },
  },
  cp_reckoner: {
    boundaryMin: { x: -3232, y: -4640, z: -800 },
    boundaryMax: { x: 3232, y: 4640, z: 1672 },
    rtsCenter: { x: -1, y: 8, z: 54 },
    cameraOffset: { x: -668, y: 1071, z: 1088 },
  },
  cp_snakewater_final1: {
    boundaryMin: { x: -5671, y: -2649, z: -584 },
    boundaryMax: { x: 6687, y: 2961, z: 960 },
    rtsCenter: { x: 526, y: 208, z: 66 },
    cameraOffset: { x: 938, y: -566, z: 593 },
  },
  cp_sultry: {
    boundaryMin: { x: -3704, y: -5200, z: -128 },
    boundaryMax: { x: 3704, y: 5200, z: 1765 },
    rtsCenter: { x: -27, y: -13, z: 675 },
    cameraOffset: { x: -597, y: -568, z: 698 },
  },
  cp_sunshine: {
    boundaryMin: { x: -8798, y: 173, z: -14672 },
    boundaryMax: { x: -2502, y: 10279, z: 1376 },
    rtsCenter: { x: -5640, y: 5244, z: 71 },
    cameraOffset: { x: -710, y: -390, z: 689 },
  },
  cp_villa: {
    boundaryMin: { x: -5504, y: -3777, z: -1120 },
    boundaryMax: { x: 5504, y: 3777, z: 768 },
    rtsCenter: { x: 1, y: -10, z: 6 },
    cameraOffset: { x: -974, y: -604, z: 789 },
  },
  koth_bagel_rc4: {
    boundaryMin: { x: -4286, y: -1234, z: 0 },
    boundaryMax: { x: 4196, y: 1150, z: 1168 },
    rtsCenter: { x: 14, y: -2, z: 461 },
    cameraOffset: { x: 902, y: -372, z: 516 },
  },
  koth_clearcut_b18: {
    boundaryMin: { x: -3232, y: -4640, z: -800 },
    boundaryMax: { x: 3232, y: 4640, z: 1672 },
    rtsCenter: { x: -6, y: 4219, z: -82 },
    cameraOffset: { x: -801, y: -513, z: 595 },
  },
  koth_product_rc8: {
    boundaryMin: { x: -2859, y: -3668, z: -128 },
    boundaryMax: { x: -171, y: 3776, z: 1402 },
    rtsCenter: { x: -1529, y: 0, z: 230 },
    cameraOffset: { x: 488, y: -515, z: 537 },
  },
}

OVERWRITE_MAP_BOUNDARIES['koth_viaduct'] = OVERWRITE_MAP_BOUNDARIES['koth_product_rcx']
OVERWRITE_MAP_BOUNDARIES['koth_viaduct'] = OVERWRITE_MAP_BOUNDARIES['koth_product_rc8']
// OVERWRITE_MAP_BOUNDARIES['cp_prolands'] = OVERWRITE_MAP_BOUNDARIES['cp_badlands']
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

export function getMapBoundariesKey(map: string): string | null {
  const mapAlias = findMapAlias(map)
  if (OVERWRITE_MAP_BOUNDARIES[mapAlias]) {
    return mapAlias
  }

  const baseName = getMapBasename(map)
  if (OVERWRITE_MAP_BOUNDARIES[baseName]) {
    return baseName
  }

  return null
}

export function getMapBoundaries(map: string): MapBoundaries | null {
  const mapAlias = getMapBoundariesKey(map)
  return mapAlias ? OVERWRITE_MAP_BOUNDARIES[mapAlias] : null
}
