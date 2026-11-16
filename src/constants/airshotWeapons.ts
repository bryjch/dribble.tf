// What makes a kill on a blast jumper an airshot: a projectile, or a sniper rifle. Hitscan spread
// (scattergun, shotgun, minigun, pistol, SMG), melee, flames, sentries and the world don't count.
// Names are the kill's weapon (player_death's `weapon`, the kill icon name).

const PREFIXES = [
  'tf_projectile_', // stock rockets, pipes, stickies, arrows, crossbow bolts, the Mangler's ball
  'deflect_', // a pyro's reflected rocket, pipe, sticky, flare or arrow
  'rocketlauncher', // stock and the Direct Hit
  'sniperrifle',
  'huntsman',
  'loose_cannon',
  'dragons_fury',
]

const NAMES = new Set([
  // Soldier
  'quake_rl', // Original
  'liberty_launcher',
  'blackbox',
  'dumpster_device', // Beggar's Bazooka
  'airstrike',
  'cow_mangler',
  'righteous_bison',
  // Demoman
  'loch_n_load',
  'iron_bomber',
  'sticky_resistance', // Scottish Resistance
  'quickiebomb_launcher',
  // Pyro
  'flaregun',
  'detonator',
  'scorch_shot',
  'manmelter',
  // Medic
  'crusaders_crossbow',
  // Scout
  'ball', // Sandman
  'wrap_assassin',
  'guillotine', // Flying Guillotine
  // Engineer
  'rescue_ranger',
  'pomson',
  // Sniper
  'compound_bow', // Fortified Compound
  'the_classic',
  'awper_hand',
  'machina',
  'player_penetration', // Machina through a player
  'bazaar_bargain',
  'sydney_sleeper',
  'pro_rifle', // Hitman's Heatmaker
  'shooting_star',
])

/** Whether a kill with this weapon on a blast jumper is an airshot. */
export const isAirshotWeapon = (weapon: string) =>
  !weapon.includes('sentry') && (NAMES.has(weapon) || PREFIXES.some(p => weapon.startsWith(p)))
