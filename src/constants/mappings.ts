export const HEALTH_MAP: { [key: number]: number } = {
  0: 100, //fallback
  1: 125, //scout
  2: 125, //sniper
  3: 200, //soldier,
  4: 175, //demoman,
  5: 150, //medic,
  6: 300, //heavy,
  7: 175, //pyro
  8: 125, //spy
  9: 125, //engineer
}

export const CLASS_MAP: { [key: number]: string } = {
  0: 'empty',
  1: 'scout',
  2: 'sniper',
  3: 'soldier',
  4: 'demoman',
  5: 'medic',
  6: 'heavy',
  7: 'pyro',
  8: 'spy',
  9: 'engineer',
}

export const CLASS_ORDER_MAP: { [key: number]: number } = {
  0: 0,
  1: 1,
  2: 8,
  3: 2,
  4: 4,
  5: 7,
  6: 5,
  7: 3,
  8: 9,
  9: 6,
}

export const TEAM_MAP: { [key: number]: string } = {
  0: 'unassigned',
  1: 'spectator',
  2: 'red',
  3: 'blue',
}

// Default TF2 player dimensions as specified in:
// https://developer.valvesoftware.com/wiki/TF2/Team_Fortress_2_Mapper%27s_Reference
export const PLAYER_DIMENSIONS = { x: 49, y: 49, z: 83 } as const
