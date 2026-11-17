import { useEffect, useState } from 'react'

import type { ConditionFlag, UberedKind } from '@components/Analyse/Data/StreamEvents'
import { HEALTH_MAP } from '@constants/mappings'
import { ControlsMode } from '@constants/types'
import { useInstance, useStore } from '@zus/store'

import { Catalog, CatalogItem, loadCatalog } from './items'
import {
  CLASS_NAMES,
  DebugPlayer,
  MEDIGUN_ITEMS,
  STOCK_WEAPONS,
  Team,
  newPlayer,
  nextPlayerId,
} from './scenario'
import { pointAtViewCenter, select, updatePlayer, updateScenario, useDebug } from './session'

//
// ─── EDITING ────────────────────────────────────────────────────────────────────
//
// What the panel does to the scenario, and what it shows about conditions and charges.
//

/** Where a condition shows in the viewer today, so the panel can say which change nothing. */
export type ConditionShows = 'drawn' | 'pov' | 'badge' | 'none'

export const CONDITIONS: Record<
  ConditionFlag,
  { label: string; color: string; shows: ConditionShows; how: string }
> = {
  burning: {
    label: 'Burning',
    color: '#ff7a1a',
    shows: 'drawn',
    how: 'flickering rim, flames in POV',
  },
  jarate: {
    label: 'Jarate',
    color: '#e8c41c',
    shows: 'drawn',
    how: 'yellow tint, yellow screen in POV',
  },
  milk: {
    label: 'Mad Milk',
    color: '#f2f2f2',
    shows: 'drawn',
    how: 'white tint, white screen in POV',
  },
  bleeding: { label: 'Bleeding', color: '#d4202a', shows: 'pov', how: 'red screen edges in POV' },
  cloaked: { label: 'Cloaked', color: '#8a96a8', shows: 'drawn', how: 'faint model and arms' },
  crits: {
    label: 'Crit boosted',
    color: '#ff2e4a',
    shows: 'drawn',
    how: 'pulsing rim, glowing weapon',
  },
  bonk: { label: 'Bonk', color: '#ffd84a', shows: 'drawn', how: 'half faint model' },
  zoomed: { label: 'Zoomed', color: '#c8e04a', shows: 'drawn', how: 'scope in POV, no weapon' },
  minicrits: { label: 'Mini-crits', color: '#ff8a4a', shows: 'badge', how: 'nameplate badge only' },
  marked: {
    label: 'Marked for death',
    color: '#b0302a',
    shows: 'badge',
    how: 'nameplate badge only',
  },
  stunned: { label: 'Stunned', color: '#c9c9c9', shows: 'badge', how: 'nameplate badge only' },
  defense: { label: 'Battalion’s', color: '#4aa8ff', shows: 'badge', how: 'nameplate badge only' },
  regen: { label: 'Concheror', color: '#57d68d', shows: 'badge', how: 'nameplate badge only' },
  speed: { label: 'Speed boost', color: '#4ad8d8', shows: 'badge', how: 'nameplate badge only' },
  disguised: { label: 'Disguised', color: '#9d7bd8', shows: 'badge', how: 'nameplate badge only' },
  overhealed: {
    label: 'Overhealed',
    color: '#9fe3ff',
    shows: 'none',
    how: 'not shown (health over max is)',
  },
  blastJumping: { label: 'Blast jumping', color: '#ffb84a', shows: 'none', how: 'not shown' },
  taunting: { label: 'Taunting', color: '#e04ac8', shows: 'none', how: 'not shown' },
  ubered: {
    label: 'Übered (condition)',
    color: '#ff3b3b',
    shows: 'none',
    how: 'not shown: the charge glows',
  },
}

export const CONDITION_GROUPS: { shows: ConditionShows; label: string }[] = [
  { shows: 'drawn', label: 'Drawn' },
  { shows: 'pov', label: 'In POV only' },
  { shows: 'badge', label: 'Nameplate badge only' },
  { shows: 'none', label: 'No visual change' },
]

/** Medigun charges, picked from the same list as conditions (one at a time). */
export const UBERS: Record<
  UberedKind,
  { short: string; label: string; color: string; shows: ConditionShows; how: string }
> = {
  uber: {
    short: 'Über',
    label: 'Über',
    color: '#ff3b3b',
    shows: 'drawn',
    how: 'team-colour glow, glowing arms in POV',
  },
  kritz: {
    short: 'Kritz',
    label: 'Kritzkrieg',
    color: '#ff2e4a',
    shows: 'drawn',
    how: 'pulsing rim, glowing weapon',
  },
  quickfix: {
    short: 'QF',
    label: 'Quick-Fix',
    color: '#57d68d',
    shows: 'badge',
    how: 'nameplate badge only',
  },
  vaccinator_bullet: {
    short: 'Vac B',
    label: 'Vaccinator, bullet',
    color: '#c9c9c9',
    shows: 'drawn',
    how: 'bubble around them, shield in POV',
  },
  vaccinator_blast: {
    short: 'Vac X',
    label: 'Vaccinator, blast',
    color: '#ffb84a',
    shows: 'drawn',
    how: 'bubble around them, shield in POV',
  },
  vaccinator_fire: {
    short: 'Vac F',
    label: 'Vaccinator, fire',
    color: '#ff7a1a',
    shows: 'drawn',
    how: 'bubble around them, shield in POV',
  },
}

export const teamHex = (team: string) => (team === 'blue' ? '#5b8fd6' : '#c8344f')
export const teamLabel = (team: Team) => (team === 'red' ? 'RED' : 'BLU')
export const className = (classId: number) => CLASS_NAMES[classId] ?? '?'

/** The patch that makes a player another class: its stock weapon and health, a medic's medigun. */
export const classPatch = (player: DebugPlayer, classId: number): Partial<DebugPlayer> => ({
  classId,
  health: HEALTH_MAP[classId] ?? 125,
  weapon: STOCK_WEAPONS[classId]?.[0] ?? null,
  medigun:
    classId === 5 ? (player.medigun ?? { kind: 'medigun', releasing: false, resist: null }) : null,
})

/** The charge a player is under; a medic's medigun follows it, releasing. */
export function setUber(player: DebugPlayer, ubered: UberedKind | null) {
  const patch: Partial<DebugPlayer> = { ubered }
  if (player.classId === 5 && ubered) {
    const kind = ubered.startsWith('vaccinator')
      ? 'vaccinator'
      : ubered === 'kritz'
        ? 'kritzkrieg'
        : ubered === 'quickfix'
          ? 'quickfix'
          : 'medigun'
    const resist = ubered.startsWith('vaccinator_')
      ? (ubered.slice('vaccinator_'.length) as 'bullet' | 'blast' | 'fire')
      : null
    patch.medigun = { kind, releasing: true, resist }
    patch.weapon = MEDIGUN_ITEMS[kind]
  }
  updatePlayer(player.id, patch)
}

/** Puts a weapon in hand, firing on a timer so the fire animation shows. */
export const holdWeapon = (player: DebugPlayer, item: CatalogItem) =>
  updatePlayer(player.id, { weapon: item.id, fireEvery: player.fireEvery || 66 })

/** Adds a player where the middle of the screen meets the map, and selects them. */
export function addPlayer(team: Team, classId: number) {
  const { scenario, selected } = useDebug.getState()
  const id = nextPlayerId(scenario)
  if (id == null) return
  const near = scenario.players.find(p => p.id === selected?.id) ?? scenario.players.slice(-1)[0]
  const pos =
    pointAtViewCenter() ?? (near ? ([near.pos[0] + 90, near.pos[1], near.pos[2]] as const) : null)
  const player = newPlayer({
    id,
    team,
    classId,
    name: `${teamLabel(team)} ${CLASS_NAMES[classId]} ${id}`,
    pos: pos ? [pos[0], pos[1], pos[2]] : [0, 0, 0],
    ang: [0, team === 'red' ? 90 : -90],
    medigun: classId === 5 ? { kind: 'medigun', releasing: false, resist: null } : null,
  })
  updateScenario(s => ({ ...s, players: [...s.players, player] }))
  select({ kind: 'player', id })
}

export function removePlayer(id: number) {
  updateScenario(s => ({
    ...s,
    // Medics healing them stop.
    players: s.players
      .filter(p => p.id !== id)
      .map(p => (p.healTarget === id ? { ...p, healTarget: null } : p)),
  }))
  if (useDebug.getState().selected?.id === id) select(null)
}

/** The entity id the viewer is in the POV of, if any. */
export const usePovId = () => {
  const mode = useStore(state => state.scene.controls.mode)
  const focused = useInstance(state => state.focusedObject)
  return mode === ControlsMode.POV ? (focused?.userData?.entityId as number | undefined) : undefined
}

export const useCatalog = () => {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  useEffect(() => {
    loadCatalog().then(setCatalog)
  }, [])
  return catalog
}
