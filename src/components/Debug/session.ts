import * as THREE from 'three'
import { create } from 'zustand'

import type { World } from '@components/Analyse/Data/Types'
import { useViewmodelDebug, ViewmodelClip } from '@components/Scene/viewmodelDebug'
import { ControlsMode, SavedSetupCamera } from '@constants/types'
import {
  changeControlsModeAction,
  goToTickAction,
  jumpToPlayerPOVCamera,
  loadEmptySceneMapAction,
  togglePlaybackAction,
} from '@zus/actions'
import { dispatch, getState, useInstance } from '@zus/store'
import { extendBench } from '@utils/bench'
import { builtMapNames } from '@utils/derivedMap'
import { pickMapVersion } from '@utils/mapVersions'
import { getAsset } from '@utils/misc'
import { getSceneActors } from '@utils/scene'

import { createBonesOverlay } from './BonesOverlay'
import { DebugSource } from './DebugSource'
import { PresetId, buildPreset } from './presets'
import {
  DEBUG_TICKS,
  DEFAULT_MAP,
  DebugBuilding,
  DebugPlayer,
  DebugProjectile,
  DebugView,
  INTERVAL_PER_TICK,
  Scenario,
  Vec3,
  decodeScenario,
  normalizeScenario,
  scenarioUrl,
} from './scenario'

//
// ─── DEBUG SESSION ──────────────────────────────────────────────────────────────
//
// The /debug page's state: the scenario being edited, and what puts it in the viewer. Each edit
// makes a new DebugSource and hands it to the viewer the way a demo is (useInstance's setMatch),
// but without loadSceneFromDemoAction, so the camera, tick and POV stay where they are. The URL
// follows the scenario (?s=), so a reload or a copied link opens the same scene.
//
// Nothing here is saved: a debug match is not a demo (no saved copy, no Recents progress, no
// bookmarks: see MatchSource.kind), and settings changed on the page stay in memory (App.tsx).
// A session here is throwaway.
//

export type DebugTab = 'players' | 'viewmodels' | 'objects' | 'scene'
export type Selection = { kind: 'player' | 'projectile' | 'building'; id: number } | null

interface DebugState {
  scenario: Scenario
  selected: Selection
  tab: DebugTab
  /** The panel's explanations show (the ? in a window's title bar). */
  help: boolean
  /** Something is loading (a map), or went wrong. */
  status: string | null
}

export const useDebug = create<DebugState>(() => ({
  scenario: { v: 1, map: DEFAULT_MAP, players: [], projectiles: [], buildings: [], events: [] },
  selected: null,
  tab: 'players',
  help: false,
  status: null,
}))

const frames = (count = 1) =>
  new Promise<void>(resolve => {
    const step = (left: number) =>
      left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1))
    step(count)
  })

// ─── Map ────────────────────────────────────────────────────────────────────────

const anchors = new Map<string, Promise<Vec3>>()

/** Where to put players on a map: where play happens (map.json's focus), else its middle. */
export function mapAnchor(map: string): Promise<Vec3> {
  let anchor = anchors.get(map)
  if (!anchor) {
    anchor = (async () => {
      try {
        const folder = pickMapVersion(map, await builtMapNames())?.map ?? map
        const response = await fetch(getAsset(`/models/maps/${folder}/map.json`))
        const manifest = await response.json()
        if (Array.isArray(manifest.focus)) return manifest.focus as Vec3
        const { mins, maxs } = manifest.worldBounds
        return [(mins[0] + maxs[0]) / 2, (mins[1] + maxs[1]) / 2, mins[2]] as Vec3
      } catch {
        const center = getState().scene.bounds.defaultRtsCenter
        return [center.x, center.y, center.z] as Vec3
      }
    })()
    anchors.set(map, anchor)
  }
  return anchor
}

/** The scene's extent, as a match reports it: the map's, once its manifest has arrived. */
function sceneWorld(): World {
  const { min, max } = getState().scene.bounds
  return {
    boundaryMin: { x: min.x, y: min.y, z: min.z },
    boundaryMax: { x: max.x, y: max.y, z: max.z },
  }
}

const shift = (pos: Vec3, by: Vec3): Vec3 => [pos[0] + by[0], pos[1] + by[1], pos[2] + by[2]]

/** The same scenario on another map, everything moved by the difference in where play happens. */
export async function moveToMap(scenario: Scenario, map: string): Promise<Scenario> {
  const [from, to] = await Promise.all([mapAnchor(scenario.map), mapAnchor(map)])
  const by: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
  return {
    ...scenario,
    map,
    players: scenario.players.map(p => ({ ...p, pos: shift(p.pos, by) })),
    projectiles: scenario.projectiles.map(p => ({ ...p, pos: shift(p.pos, by) })),
    buildings: scenario.buildings.map(b => ({ ...b, pos: shift(b.pos, by) })),
  }
}

// ─── Into the viewer ────────────────────────────────────────────────────────────

let revision = 0
let shownMap: string | null = null
let urlTimer: number | undefined

/** Puts the scenario in the viewer: a new match each time, on the same camera and tick. */
async function show(scenario: Scenario) {
  if (shownMap !== scenario.map) {
    // The first map plays from the start; another keeps the tick and whether it was playing.
    const first = shownMap === null
    const tick = first ? 1 : getState().playback.tick
    const playing = first || getState().playback.playing
    shownMap = scenario.map
    useDebug.setState({ status: `Loading ${scenario.map} …` })
    await loadEmptySceneMapAction(scenario.map)
    // A newer edit (another map) took over meanwhile.
    if (useDebug.getState().scenario.map !== scenario.map) return
    useInstance.getState().setMatch(new DebugSource(scenario, sceneWorld(), ++revision))
    dispatch({
      type: 'LOAD_SCENE_FROM_PARSER',
      payload: {
        scene: getState().scene,
        playback: {
          ...getState().playback,
          playing,
          tick: Math.max(1, tick),
          maxTicks: DEBUG_TICKS - 1,
          intervalPerTick: INTERVAL_PER_TICK,
        },
      },
    })
    useDebug.setState({ status: null })
    return
  }
  useInstance.getState().setMatch(new DebugSource(scenario, sceneWorld(), ++revision))
}

/** Replaces the scenario: shown at once, the URL updated a moment later. */
export function setScenario(next: Scenario): Promise<void> {
  const { view: _, ...scenario } = next
  useDebug.setState({ scenario })
  const shown = show(scenario)
  window.clearTimeout(urlTimer)
  urlTimer = window.setTimeout(() => {
    window.history.replaceState(window.history.state, '', scenarioUrl(useDebug.getState().scenario))
  }, 250)
  return shown
}

export const updateScenario = (change: (scenario: Scenario) => Scenario) =>
  void setScenario(change(useDebug.getState().scenario))

export const updatePlayer = (id: number, patch: Partial<DebugPlayer>) =>
  updateScenario(s => ({
    ...s,
    players: s.players.map(p => (p.id === id ? { ...p, ...patch } : p)),
  }))

export const updateProjectile = (id: number, patch: Partial<DebugProjectile>) =>
  updateScenario(s => ({
    ...s,
    projectiles: s.projectiles.map(p => (p.id === id ? { ...p, ...patch } : p)),
  }))

export const updateBuilding = (id: number, patch: Partial<DebugBuilding>) =>
  updateScenario(s => ({
    ...s,
    buildings: s.buildings.map(b => (b.id === id ? { ...b, ...patch } : b)),
  }))

export const select = (selected: Selection) => useDebug.setState({ selected })

// ─── Views and links ────────────────────────────────────────────────────────────

/** Where the viewer is now: the tick, paused or not, whose POV, the camera. */
export function captureView(): DebugView {
  const { tick, playing } = getState().playback
  const mode = getState().scene.controls.mode
  const pov =
    mode === ControlsMode.POV ? useInstance.getState().focusedObject?.userData?.entityId : undefined
  const camera = useInstance.getState().setupCameraBridge?.capture() ?? undefined
  return {
    tick: Math.floor(tick),
    paused: !playing,
    ...(pov != null ? { pov } : camera ? { camera } : {}),
  }
}

/** A link to the scene as it is now, view included. */
export const shareUrl = () => scenarioUrl({ ...useDebug.getState().scenario, view: captureView() })

/** Waits (up to a few seconds) until the viewer has drawn a player, by entity id. */
async function waitForActor(entityId: number) {
  for (let i = 0; i < 300; i++) {
    const actors = getSceneActors(useInstance.getState().threeScene)
    if (actors.some(actor => actor.userData.entityId === entityId)) return true
    await frames()
  }
  return false
}

/** Opens the viewer at a view: its tick, paused or playing, then a POV or a camera. */
export async function applyView(view: DebugView | undefined) {
  if (!view) return
  if (view.tick != null) await goToTickAction(view.tick)
  if (view.paused != null) await togglePlaybackAction(!view.paused as any)
  if (view.pov != null) {
    if (await waitForActor(view.pov)) await jumpToPlayerPOVCamera(view.pov)
  } else if (view.camera) {
    await applyCamera(view.camera)
  }
}

async function applyCamera(camera: SavedSetupCamera) {
  for (let i = 0; i < 300 && !useInstance.getState().setupCameraBridge; i++) await frames()
  useInstance.getState().setupCameraBridge?.apply(camera)
  await frames(4)
  // Applying may switch the controls mode first; apply again once it has.
  useInstance.getState().setupCameraBridge?.apply(camera)
}

/** The orbit camera looking at a point from a little way off (for a projectile or building). */
export const lookAt = (pos: Vec3) =>
  applyCamera({
    mode: 'rts',
    target: pos,
    position: [pos[0] - 260, pos[1] - 420, pos[2] + 300],
  })

export async function viewPlayer(id: number | null) {
  if (id == null) {
    await changeControlsModeAction(ControlsMode.RTS)
    return
  }
  if (await waitForActor(id)) await jumpToPlayerPOVCamera(id)
}

// ─── Placing things ─────────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster()

/** The map under the middle of the screen, or null if the camera looks at nothing. */
export function pointAtViewCenter(): Vec3 | null {
  const scene = useInstance.getState().threeScene as THREE.Scene & { camera?: THREE.Camera }
  const world = scene.getObjectByName('world')
  if (!scene.camera || !world) return null
  raycaster.setFromCamera(new THREE.Vector2(0, 0), scene.camera)
  const hit = raycaster.intersectObject(world, true).find(i => i.object.visible)
  return hit ? [Math.round(hit.point.x), Math.round(hit.point.y), Math.round(hit.point.z)] : null
}

/** The floor under a point (from a little above it), or null if there is none below. */
export function floorUnder(pos: Vec3): Vec3 | null {
  const world = useInstance.getState().threeScene.getObjectByName('world')
  if (!world) return null
  raycaster.set(new THREE.Vector3(pos[0], pos[1], pos[2] + 64), new THREE.Vector3(0, 0, -1))
  const hit = raycaster.intersectObject(world, true).find(i => i.object.visible)
  return hit ? [pos[0], pos[1], Math.round(hit.point.z)] : null
}

// ─── Boot ───────────────────────────────────────────────────────────────────────

/** Keeps search engines off the page (the host also sends X-Robots-Tag; see vercel.json). */
function noindex() {
  const meta = document.createElement('meta')
  meta.name = 'robots'
  meta.content = 'noindex, nofollow'
  document.head.appendChild(meta)
  document.title = 'Debug | dribble.tf'
}

/**
 * Called by App on /debug in place of the viewer's own boot: no demo or live match from the URL,
 * no shared setup, no saved-demo tracking. Opens ?s= (a scenario), else ?preset= (classes by
 * default) on ?map=.
 */
export async function bootDebug(): Promise<DebugView | undefined> {
  noindex()
  const params = new URLSearchParams(window.location.search)
  const token = params.get('s')
  let scenario = token ? decodeScenario(token) : null
  if (!scenario) {
    const map = params.get('map') ?? DEFAULT_MAP
    scenario = buildPreset(params.get('preset') ?? 'classes', await mapAnchor(map), map)
  }
  const view = scenario?.view
  await setScenario(scenario ?? normalizeScenario({}))
  installDebugBench()
  return view
}

/** window.__dribble.debug, with ?bench: what scripts (scripts/render-check.mjs) drive. */
function installDebugBench() {
  extendBench('debug', {
    scenario: () => useDebug.getState().scenario,
    /** Replaces the scenario (anything normalizeScenario takes), then waits for a few frames. */
    setScenario: async (raw: unknown) => {
      await setScenario(normalizeScenario(raw))
      await frames(4)
    },
    preset: async (id: PresetId) => {
      const { map } = useDebug.getState().scenario
      const scenario = buildPreset(id, await mapAnchor(map), map)
      if (scenario) await setScenario(scenario)
      await frames(4)
    },
    player: async (id: number, patch: Partial<DebugPlayer>) => {
      updatePlayer(id, patch)
      await frames(4)
    },
    view: async (view: DebugView) => {
      await applyView(view)
      await frames(4)
    },
    captureView,
    url: shareUrl,
    viewmodel: {
      clip: (clip: ViewmodelClip) => useViewmodelDebug.setState({ clip }),
      bones: (on: boolean) => useViewmodelDebug.setState({ bones: on ? createBonesOverlay : null }),
      rig: () => useViewmodelDebug.getState().rig,
    },
  })
}
