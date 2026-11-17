import type { ConditionFlag, MedigunKind, UberedKind } from '@components/Analyse/Data/StreamEvents'

import {
  ALL_CONDITIONS,
  CLASS_NAMES,
  CLASS_ORDER,
  DebugPlayer,
  MEDIGUN_ITEMS,
  Scenario,
  STOCK_WEAPONS,
  Team,
  UBERED_KINDS,
  Vec3,
  emptyScenario,
  newBuilding,
  newPlayer,
  newProjectile,
} from './scenario'

//
// ─── PRESETS ────────────────────────────────────────────────────────────────────
//
// Ready-made scenarios, laid out around a point on the map (where play happens, map.json's
// focus), so the same preset works on any map. ?preset=<id> opens one.
//

/** Players stand this far apart in a row; the teams' rows face each other this far apart. */
const SPACING = 90
const GAP = 420

const at = (anchor: Vec3, dx: number, dy: number, dz = 0): Vec3 => [
  anchor[0] + dx,
  anchor[1] + dy,
  anchor[2] + dz,
]

/** RED's row faces north (+y), BLU's south, centred on the anchor. */
const row = (
  anchor: Vec3,
  team: Team,
  index: number,
  count: number
): Pick<DebugPlayer, 'pos' | 'ang'> => ({
  pos: at(anchor, (index - (count - 1) / 2) * SPACING, team === 'red' ? -GAP / 2 : GAP / 2),
  ang: [0, team === 'red' ? 90 : -90],
})

const UBER_CONDITION: Partial<Record<UberedKind, ConditionFlag>> = {
  uber: 'ubered',
  kritz: 'crits',
}
const UBER_MEDIGUN: Record<UberedKind, MedigunKind> = {
  uber: 'medigun',
  kritz: 'kritzkrieg',
  quickfix: 'quickfix',
  vaccinator_bullet: 'vaccinator',
  vaccinator_blast: 'vaccinator',
  vaccinator_fire: 'vaccinator',
}

/** The class that shows a condition best (a spy cloaks, a sniper zooms, a scout drinks Bonk). */
const CONDITION_CLASS: Partial<Record<ConditionFlag, number>> = {
  cloaked: 8,
  disguised: 8,
  zoomed: 2,
  bonk: 1,
  speed: 1,
  defense: 3,
  minicrits: 3,
  regen: 3,
  blastJumping: 3,
  stunned: 6,
  overhealed: 6,
  ubered: 6,
  crits: 4,
  taunting: 6,
}

function classes(anchor: Vec3): Scenario {
  const scenario = emptyScenario()
  for (const team of ['red', 'blue'] as Team[]) {
    CLASS_ORDER.forEach((classId, i) => {
      scenario.players.push(
        newPlayer({
          id: scenario.players.length + 1,
          name: `${team === 'red' ? 'RED' : 'BLU'} ${CLASS_NAMES[classId]}`,
          team,
          classId,
          ...row(anchor, team, i, CLASS_ORDER.length),
          weapon: STOCK_WEAPONS[classId][0],
          medigun: classId === 5 ? { kind: 'medigun', releasing: false, resist: null } : null,
        })
      )
    })
  }
  return scenario
}

/** 6v6: two scouts, two soldiers, a demo and a medic a side, the medics on their pocket. */
function sixes(anchor: Vec3): Scenario {
  const scenario = emptyScenario()
  const lineup = [1, 1, 3, 3, 4, 5]
  const names = ['flank scout', 'pocket scout', 'roamer', 'pocket', 'demo', 'medic']
  for (const team of ['red', 'blue'] as Team[]) {
    const first = scenario.players.length + 1
    lineup.forEach((classId, i) => {
      scenario.players.push(
        newPlayer({
          id: first + i,
          name: `${team === 'red' ? 'RED' : 'BLU'} ${names[i]}`,
          team,
          classId,
          ...row(anchor, team, i, lineup.length),
          fireEvery: classId === 5 ? 0 : 50 + i * 7,
          ...(classId === 5
            ? {
                weapon: MEDIGUN_ITEMS.medigun,
                medigun: { kind: 'medigun', releasing: false, resist: null },
                charge: 64,
                healTarget: first + 3,
              }
            : {}),
        })
      )
    })
  }
  return scenario
}

/** Each charge, a medic releasing it on a heavy, side by side. */
function ubers(anchor: Vec3): Scenario {
  const scenario = emptyScenario()
  UBERED_KINDS.forEach((ubered, i) => {
    const team: Team = i % 2 ? 'blue' : 'red'
    const x = (i - (UBERED_KINDS.length - 1) / 2) * SPACING * 2
    const medic = scenario.players.length + 1
    const kind = UBER_MEDIGUN[ubered]
    const resist = ubered.startsWith('vaccinator_')
      ? (ubered.slice('vaccinator_'.length) as 'bullet' | 'blast' | 'fire')
      : null
    const condition = UBER_CONDITION[ubered]
    scenario.players.push(
      newPlayer({
        id: medic,
        name: `${ubered} medic`,
        team,
        classId: 5,
        pos: at(anchor, x, -60),
        ang: [0, 90],
        weapon: MEDIGUN_ITEMS[kind],
        medigun: { kind, releasing: true, resist },
        ubered,
        conditions: condition ? [condition] : [],
        charge: 50,
        healTarget: medic + 1,
      }),
      newPlayer({
        id: medic + 1,
        name: `${ubered} heavy`,
        team,
        classId: 6,
        pos: at(anchor, x, 60),
        ang: [0, 90],
        ubered,
        conditions: condition ? [condition, 'overhealed'] : ['overhealed'],
        health: 450,
        fireEvery: 3,
      })
    )
  })
  return scenario
}

/** One player per condition, named after it. */
function conditions(anchor: Vec3): Scenario {
  const scenario = emptyScenario()
  const perRow = 10
  ALL_CONDITIONS.forEach((condition, i) => {
    const classId = CONDITION_CLASS[condition] ?? 7
    const team: Team = i % 2 ? 'blue' : 'red'
    const rowIndex = Math.floor(i / perRow)
    scenario.players.push(
      newPlayer({
        id: i + 1,
        name: condition,
        team,
        classId,
        pos: at(anchor, ((i % perRow) - (perRow - 1) / 2) * SPACING * 1.4, rowIndex * 220 - 110),
        ang: [0, 90],
        conditions: [condition],
        ...(condition === 'overhealed' ? { health: 260 } : {}),
        weapon: STOCK_WEAPONS[classId][0],
      })
    )
  })
  return scenario
}

/** One player alone, for the viewmodel browser: a scout firing their scattergun. */
function viewmodel(anchor: Vec3): Scenario {
  const scenario = emptyScenario()
  scenario.players.push(
    newPlayer({
      id: 1,
      name: 'viewmodel',
      team: 'red',
      classId: 1,
      pos: anchor,
      ang: [0, 90],
      fireEvery: 60,
    })
  )
  scenario.view = { pov: 1 }
  return scenario
}

/** Each projectile at rest and in flight, and each building, level and state. */
function objects(anchor: Vec3): Scenario {
  const scenario = emptyScenario()
  let id = 100
  const types = ['rocket', 'pipebomb', 'stickybomb', 'healingBolt'] as const
  types.forEach((type, i) => {
    for (const team of ['red', 'blue'] as Team[]) {
      const x = (i - 1.5) * 120 + (team === 'blue' ? 40 : 0)
      // At rest, a little off the ground.
      scenario.projectiles.push(
        newProjectile({ id: id++, type, team, pos: at(anchor, x, -300, 8) })
      )
      // In flight, across the scene.
      const speed = type === 'rocket' ? 1100 : type === 'healingBolt' ? 2400 : 1200
      scenario.projectiles.push(
        newProjectile({
          id: id++,
          type,
          team,
          pos: at(anchor, x, -500, 60),
          vel: [0, speed, type === 'pipebomb' || type === 'stickybomb' ? 400 : 0],
          gravity: type === 'pipebomb' || type === 'stickybomb',
          life: Math.round((1000 / speed) * 66),
        })
      )
    }
  })
  id = 200
  const kinds = ['sentry', 'dispenser', 'teleporter'] as const
  kinds.forEach((kind, k) => {
    for (let level = 1; level <= 3; level++) {
      scenario.buildings.push(
        newBuilding({
          id: id++,
          kind,
          team: 'red',
          level,
          pos: at(anchor, (level - 2) * 160, k * 180),
          yaw: 90,
          sweep: kind === 'sentry',
          entrance: kind === 'teleporter' && level === 1,
        })
      )
    }
  })
  const extras = [
    { kind: 'sentry', mini: true, sweep: true, attacking: true },
    { kind: 'sentry', level: 2, sapped: true },
    { kind: 'sentry', constructing: true, health: 40 },
    { kind: 'dispenser', sapped: true },
    { kind: 'teleporter', constructing: true, health: 30 },
  ] as const
  extras.forEach((extra, i) =>
    scenario.buildings.push(
      newBuilding({
        id: id++,
        team: 'blue',
        pos: at(anchor, (i - 2) * 160, 3 * 180),
        yaw: -90,
        ...extra,
      })
    )
  )
  return scenario
}

export const PRESETS = [
  {
    id: 'classes',
    label: 'Classes',
    description: 'One of each class a team, stock weapons',
    build: classes,
  },
  {
    id: '6v6',
    label: '6v6',
    description: 'A full 6v6 lineup, firing, medics healing',
    build: sixes,
  },
  {
    id: 'ubers',
    label: 'Über kinds',
    description: 'Each medigun charge, released on a heavy',
    build: ubers,
  },
  {
    id: 'conditions',
    label: 'Conditions',
    description: 'One player per condition',
    build: conditions,
  },
  {
    id: 'objects',
    label: 'Objects',
    description: 'Projectiles and every building',
    build: objects,
  },
  { id: 'viewmodel', label: 'Viewmodel', description: 'One player in POV', build: viewmodel },
] as const

export type PresetId = (typeof PRESETS)[number]['id']

export function buildPreset(id: string, anchor: Vec3, map: string): Scenario | null {
  const preset = PRESETS.find(p => p.id === id)
  if (!preset) return null
  return { ...preset.build(anchor), map }
}
