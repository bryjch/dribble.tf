import { MapBoundary } from './Data/PositionCache'

const overWriteMapBoundaries: { [mapName: string]: MapBoundary } = {
  cp_gullywash_final1: {
    boundaryMin: {
      x: -4050,
      y: -2950,
      z: -14672,
    },
    boundaryMax: {
      x: 5432,
      y: 2260,
      z: 1312,
    },
  },
  cp_gullywash_f6: {
    boundaryMin: {
      x: -4717,
      y: -2643,
      z: -529,
    },
    boundaryMax: {
      x: 4765,
      y: 2567,
      z: 1311,
    },
  },
  cp_process_final: {
    boundaryMin: {
      x: -5222,
      y: -3146,
      z: -14672,
    },
    boundaryMax: {
      x: 5216,
      y: 3128,
      z: 1728,
    },
  },
  koth_product_rc8: {
    boundaryMin: {
      x: -2859,
      y: -3668,
      z: -128,
    },
    boundaryMax: {
      x: -171,
      y: 3776,
      z: 1402,
    },
  },
  cp_snakewater_final1: {
    boundaryMin: {
      x: -5671,
      y: -2649,
      z: -584,
    },
    boundaryMax: {
      x: 6687,
      y: 2961,
      z: 960,
    },
  },
  cp_sunshine: {
    boundaryMin: {
      x: -8798,
      y: 173,
      z: -14672,
    },
    boundaryMax: {
      x: -2502,
      y: 10279,
      z: 1376,
    },
  },
  cp_metalworks_f5: {
    boundaryMin: {
      x: -3034,
      y: -6699,
      z: -14672,
    },
    boundaryMax: {
      x: 3374,
      y: 4939,
      z: 1088,
    },
  },
  koth_bagel_rc4: {
    boundaryMin: {
      x: -4286,
      y: -1234,
      z: 0,
    },
    boundaryMax: {
      x: 4196,
      y: 1150,
      z: 1168,
    },
  },
  cp_villa: {
    boundaryMin: {
      x: -5504,
      y: -3777,
      z: -1120,
    },
    boundaryMax: {
      x: 5504,
      y: 3777,
      z: 768,
    },
  },
  cp_sultry: {
    boundaryMin: {
      x: -3704,
      y: -5200,
      z: -128,
    },
    boundaryMax: {
      x: 3704,
      y: 5200,
      z: 1765,
    },
  },
  cp_reckoner: {
    boundaryMin: {
      x: -3232,
      y: -4640,
      z: -800,
    },
    boundaryMax: {
      x: 3232,
      y: 4640,
      z: 1672,
    },
  },
}

overWriteMapBoundaries['koth_viaduct'] = overWriteMapBoundaries['koth_product_rcx']
overWriteMapBoundaries['koth_viaduct'] = overWriteMapBoundaries['koth_product_rc8']
overWriteMapBoundaries['cp_prolands'] = overWriteMapBoundaries['cp_badlands']
overWriteMapBoundaries['cp_gullywash'] = overWriteMapBoundaries['cp_gullywash_f6']

const mapAliases = new Map<string, string>([['cp_prolands', 'cp_badlands']])

function getMapBasename(map: string): string {
  if (overWriteMapBoundaries[map]) {
    return map
  }
  const trimMapName = (map: string) => {
    while (map.lastIndexOf('_') > map.indexOf('_')) {
      map = map.substr(0, map.lastIndexOf('_'))
    }
    return map
  }
  const trimmed = trimMapName(map)
  if (overWriteMapBoundaries[trimmed]) {
    return trimmed
  }
  for (const existingMap of Object.keys(overWriteMapBoundaries)) {
    if (trimMapName(existingMap) === map) {
      return existingMap
    }
  }
  for (const existingMap of Object.keys(overWriteMapBoundaries)) {
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

export function getMapBoundaries(map: string): MapBoundary | null {
  const mapAlias = findMapAlias(map)
  return overWriteMapBoundaries[mapAlias]
}
