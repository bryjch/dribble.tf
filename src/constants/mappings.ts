export const HEALTH_MAP: any = {
  0: 100, //fallback
  1: 125, //scout
  2: 150, //sniper
  3: 200, //soldier,
  4: 175, //demoman,
  5: 150, //medic,
  6: 300, //heavy,
  7: 175, //pyro
  8: 125, //spy
  9: 125, //engineer
}

export const CLASS_MAP: any = {
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

export const ACTOR_TEAM_COLORS: any = (team: string) => {
  switch (team) {
    case 'red':
      return {
        actorModel: '#de4a50',
        healthBar: '#ac2641',
        healthBuffed: '#6ed6ff',
        healthLow: '#ff6262',
      }

    case 'blue':
      return {
        actorModel: '#559dc1',
        healthBar: '#88aeb8',
        healthBuffed: '#6ed6ff',
        healthLow: '#ff6262',
      }

    default:
      return {
        actorModel: '#f800d7',
        healthBar: '#f800d7',
        healthBuffed: '#f800d7',
        healthLow: '#f800d7',
      }
  }
}
