export const HEALTH_MAP: { [key: number]: number } = {
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

export const ACTOR_TEAM_COLORS: any = (team: string) => {
  switch (team) {
    case 'red':
      return {
        actorModel: '#ff0202', //'#de4a50',
        healthBar: '#ac2641',
        healthOverhealed: '#4dd241',
        healthLow: '#ff6262',
        killfeedText: '#ff4a4a',
        focusedBackground: '#ac2641',
        pipebombColor: '#ff2525',
        stickybombColor: '#ff0202',
      }

    case 'blue':
      return {
        actorModel: '#0374ff', //'#559dc1',
        healthBar: '#88aeb8',
        healthOverhealed: '#4dd241',
        healthLow: '#ff6262',
        killfeedText: '#77a9ec',
        focusedBackground: '#88aeb8',
        pipebombColor: '#142bff',
        stickybombColor: '#0037ff',
      }

    default:
      return {
        actorModel: '#f800d7',
        healthBar: '#f800d7',
        healthOverhealed: '#f800d7',
        healthLow: '#f800d7',
        killfeedText: '#ffffff',
        focusedBackground: '#f800d7',
        pipebombColor: '#f800d7',
        stickybombColor: '#f800d7',
      }
  }
}
