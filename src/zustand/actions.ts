import { reportError } from '@utils/notice'
import { get, merge, clamp, cloneDeep, sortBy, round } from 'lodash'
import localForage from 'localforage'
import * as THREE from 'three'

import { decodeDemo } from '@components/Analyse/Data/DemoSource'
import type { MatchSource } from '@components/Analyse/Data/MatchSource'
import type { MapBoundaries } from '@components/Analyse/Data/Types'
import {
  getMapBoundaries,
  getMapBoundariesKey,
  blenderModelCorner,
} from '@components/Analyse/MapBoundaries'
import { PLAYBACK_SPEED_OPTIONS } from '@components/UI/PlaybackPanel'

import { getSceneActors, parseMapBoundaries } from '@utils/scene'
import {
  buildSetupShareUrl,
  cloneSetupCamera,
  cloneSetupStickers,
  createSetupId,
  deserializeSetupFromShareToken,
  normalizeStoredSetups,
  parseSetupHash,
  toWorldSetup,
} from '@utils/setups'
import { CLASS_ORDER_MAP } from '@constants/mappings'
import {
  ControlsMode,
  CrosshairStyle,
  Download,
  RAILS_MODES,
  RailsMode,
  DrawingTool,
  SavedSetup,
  SETUP_STORAGE_VERSION,
  SceneMode,
  SettingsTab,
  StickerDefinition,
  StickerAnnotation,
  UIPanelType,
} from '@constants/types'
import { StickerDragKind } from './drawing'

import { dispatch, getState, initialState, StoreState, useInstance } from './store'
import { isMobile } from 'react-device-detect'
import { setClockTick } from '@utils/playback'
import { rememberOpenedDemo, saveDemo, uploadKey } from '@utils/storage'

//
// ─── PARSER ─────────────────────────────────────────────────────────────────────
//

export const onUploadDemoAction = async (files: File[]) => {
  const demoFile: File = files[0]
  const fileBuffer = await demoFile.arrayBuffer()
  // Kept in the browser like a downloaded demo (@utils/storage), so it shows in Recents.
  const url = uploadKey(demoFile)
  saveDemo({ url, name: demoFile.name, upload: true }, fileBuffer).catch(error =>
    console.error('[storage]', error)
  )
  await openDemoBytesAction(fileBuffer, url)
}

/** Reads a demo already in memory (at `tick`, if given), noting what it is on its saved copy. */
export const openDemoBytesAction = async (fileBuffer: ArrayBuffer, savedUrl?: string, tick?: number) => {
  try {
    const match = await parseDemoAction(fileBuffer)
    if (savedUrl) rememberOpenedDemo(savedUrl, match)
    if (tick) goToTickAction(tick)
  } catch {
    // parseDemoAction reports its own failure.
  }
}

export const parseDemoAction = async (fileBuffer: ArrayBuffer) => {
  try {
    dispatch({ type: 'PARSE_DEMO_INIT' })

    let match
    try {
      match = await decodeDemo(fileBuffer, progress => {
        dispatch({ type: 'PARSE_DEMO_PROGRESS', payload: progress })
      })
    } catch (error) {
      reportError("Couldn't read this demo", "Make sure it's a SourceTV .dem file, not a POV demo.")
      throw error
    }

    console.info('[Perf][Decode]', match.stats)

    dispatch({ type: 'PARSE_DEMO_SUCCESS' })

    await loadSceneFromDemoAction(match)

    return match
  } catch (error) {
    dispatch({ type: 'PARSE_DEMO_ERROR', payload: error })
    throw error
  }
}

//
// ─── SCENE ──────────────────────────────────────────────────────────────────────
//

/**
 * Where the RTS camera should orbit on a map, if the viewer saved one: Source world coordinates.
 * Centres saved before 2026-11 (settings.scene.rtsCenters) were relative to the map model's
 * minimum corner and are converted here.
 */
async function savedRtsCenter(map: string) {
  const key = getMapBoundariesKey(map) ?? map
  const { worldRtsCenters, rtsCenters } = getState().settings.scene
  if (worldRtsCenters?.[key]) return worldRtsCenters[key]
  const legacy = rtsCenters?.[key]
  if (!legacy) return undefined
  const reference = blenderModelCorner(map)
  return reference
    ? { x: legacy.x + reference.x, y: legacy.y + reference.y, z: legacy.z + reference.z }
    : undefined
}

export const loadSceneFromDemoAction = async (match: MatchSource) => {
  try {
    toggleUIPanelAction('About', false)
    // The map's own bounds and camera when dribble.tf knows the map, else the demo's bounds.
    const overrides: Partial<MapBoundaries> = getMapBoundaries(match.header.map) ?? {}
    const sceneBoundaries = { ...match.world, ...overrides }
    const rtsCenter = (await savedRtsCenter(match.header.map)) ?? overrides.rtsCenter

    // Remember to update the non-redux instances!
    bookmarksMatchKey = matchBookmarksKey(match)
    useInstance.getState().setMatch(match)
    useInstance.getState().setFocusedObject(undefined)
    useInstance.getState().setLastFocusedPOV(undefined)
    useInstance.getState().setMapCenterPickerActive(false)

    dispatch({
      type: 'LOAD_SCENE_FROM_PARSER',
      payload: {
        scene: {
          map: match.header.map,
          bounds: parseMapBoundaries({
            ...sceneBoundaries,
            ...(rtsCenter ? { rtsCenter } : {}),
          }),
          controls: {
            mode: 'rts',
          },
        },
        playback: {
          playing: true,
          speed: 1,
          tick: 1,
          maxTicks: match.ticks - 1,
          intervalPerTick: match.intervalPerTick,
        },
      },
    })

    await restoreBookmarks(match)
  } catch (error) {
    console.error(error)
  }
}

export const loadEmptySceneMapAction = async (mapName: string) => {
  try {
    // dribble.tf's camera and bounds for the map, if any; a built map's own bounds follow once
    // its map.json arrives (applyDerivedMapBoundsAction).
    const boundaries = getMapBoundaries(mapName)
    const rtsCenter = await savedRtsCenter(mapName)
    const boundariesWithCenter = rtsCenter && boundaries ? { ...boundaries, rtsCenter } : boundaries

    // A map dribble.tf does not know may still resolve as a Derived Map, whose manifest brings
    // its bounds (applyDerivedMapBoundsAction); until then the scene keeps the default bounds.
    const bounds =
      boundariesWithCenter?.boundaryMin && boundariesWithCenter?.boundaryMax
        ? parseMapBoundaries(boundariesWithCenter)
        : initialState.scene.bounds

    // Remember to update the non-redux instances!
    bookmarksMatchKey = null
    useInstance.getState().setMatch(undefined)
    useInstance.getState().setFocusedObject(undefined)
    useInstance.getState().setLastFocusedPOV(undefined)
    useInstance.getState().setMapCenterPickerActive(false)

    dispatch({
      type: 'LOAD_SCENE_FROM_PARSER',
      payload: {
        scene: {
          ...initialState.scene,
          map: mapName,
          bounds,
        },
        playback: initialState.playback,
      },
    })
  } catch (error) {
    console.error(error)
  }
}

/**
 * Bounds a Derived Map's manifest gives the camera, when the scene shows that map without a
 * match (a match brings the world's bounds from its own data). In Source world coordinates.
 */
export const applyDerivedMapBoundsAction = async (
  mapName: string,
  worldBounds: { mins: [number, number, number]; maxs: [number, number, number] },
  /** Where play happens (map.json's focus): the RTS camera's centre unless one was saved. */
  focus?: [number, number, number] | null
) => {
  try {
    if (getState().scene.map !== mapName || useInstance.getState().match) return
    const [minX, minY, minZ] = worldBounds.mins
    const [maxX, maxY, maxZ] = worldBounds.maxs
    const rtsCenter =
      (await savedRtsCenter(mapName)) ??
      (focus && !getMapBoundaries(mapName)?.rtsCenter
        ? { x: focus[0], y: focus[1], z: focus[2] }
        : undefined)
    if (getState().scene.map !== mapName || useInstance.getState().match) return
    dispatch({
      type: 'SET_SCENE_BOUNDS',
      payload: parseMapBoundaries({
        ...getMapBoundaries(mapName),
        boundaryMin: { x: minX, y: minY, z: minZ },
        boundaryMax: { x: maxX, y: maxY, z: maxZ },
        ...(rtsCenter ? { rtsCenter } : {}),
      }),
    })
  } catch (error) {
    console.error(error)
  }
}

export const changeControlsModeAction = async (
  mode: ControlsMode,
  options: { direction: 'next' | 'prev' } = { direction: 'next' }
) => {
  try {
    if (mode === ControlsMode.POV) {
      // In order to determine which POV we should follow next, we have to figure out the
      // players at the current tick & what classes they currently are. This information isn't
      // available in the THREE.js scene directly, so we need to call getPlayersAtTick() and
      // then "append" that information to each scene Actor. This definitely seems suboptimal,
      // but this action should not be called super frequently so we'll just let it slide.
      const tick = getState().playback.tick
      const demo = useInstance.getState().match
      let playersThisTick = demo!.playersAt(tick)

      let actors = getSceneActors(useInstance.getState().threeScene)

      // Append the current selected class to the Actor
      actors.forEach(actor => {
        const player = playersThisTick.find(
          player => player.user.entityId === actor.userData.entityId
        )
        actor.userData.classId = player?.classId || 0
      })

      // Sort by teams then class order
      actors = sortBy(actors, [o => o.userData.team, o => CLASS_ORDER_MAP[o.userData.classId]])

      const focusedObject = useInstance.getState().focusedObject
      const lastFocusedPOV = useInstance.getState().lastFocusedPOV

      const currentIndex = focusedObject ? actors.findIndex(({ id }) => id === focusedObject.id) : 0
      let nextIndex: number, nextActor: THREE.Object3D

      switch (options.direction) {
        case 'prev':
          nextIndex = (currentIndex + actors.length - 1) % actors.length
          break

        case 'next':
        default:
          nextIndex = (currentIndex + 1) % actors.length
          break
      }

      nextActor = actors[nextIndex]

      // Player transitioned from RTS to POV
      // So we should go back to the POV of the last person they spectated
      if (focusedObject === undefined) {
        const entityId = lastFocusedPOV?.userData?.entityId || actors[0]?.userData?.entityId
        jumpToPlayerPOVCamera(entityId)
        return
      }

      // Player transitioned from POV to POV
      // So we should spectate to the POV of the next person
      if (nextActor) {
        jumpToPlayerPOVCamera(nextActor.userData.entityId)
        return
      }

      // No actors found in the scene
      // Just reset back to RTS camera
      jumpToRtsCamera()
    }

    if (mode === ControlsMode.SPECTATOR) {
      jumpToSpectatorCamera()
    }

    if (mode === ControlsMode.RTS) {
      jumpToRtsCamera()
    }
  } catch (error) {
    console.error(error)
  }
}

export const jumpToPlayerPOVCamera = async (entityId: number) => {
  try {
    const actors = getSceneActors(useInstance.getState().threeScene)

    if (actors.length === 0) return null

    const actor = actors.find(({ userData }) => userData.entityId === entityId)

    if (!actor) return null

    useInstance.getState().setFocusedObject(actor)
    useInstance.getState().setLastFocusedPOV(actor)

    dispatch({ type: 'CHANGE_CONTROLS_MODE', payload: 'pov' })
  } catch (error) {
    console.error(error)
  }
}

export const jumpToSpectatorCamera = async () => {
  try {
    dispatch({ type: 'CHANGE_CONTROLS_MODE', payload: 'spectator' })

    useInstance.getState().setFocusedObject(undefined)
  } catch (error) {
    console.error(error)
  }
}

export const jumpToRtsCamera = async () => {
  try {
    // Asking for the orbit camera while in it (3 again, or Orbit on a phone) resets the view.
    if (getState().scene.controls.mode === ControlsMode.RTS) {
      const scene = useInstance.getState().threeScene as THREE.Scene & {
        controls?: { reset?: () => void }
      }
      scene.controls?.reset?.()
      return
    }

    dispatch({ type: 'CHANGE_CONTROLS_MODE', payload: 'rts' })

    useInstance.getState().setFocusedObject(undefined)
  } catch (error) {
    console.error(error)
  }
}

export const changeSceneModeAction = async (mode: SceneMode | 'next') => {
  if (mode === 'next') {
    const currMode = getState().settings.scene.mode
    const currIndex = Object.values(SceneMode).findIndex(value => value === currMode)
    if (currIndex !== -1) {
      const nextIndex = (currIndex + 1) % Object.values(SceneMode).length
      const nextMode = Object.values(SceneMode)[nextIndex]
      if (nextMode) {
        mode = nextMode
      }
    }
  }

  if (mode) {
    await updateSettingsOptionAction('scene.mode', mode)
    addEventHistoryAction('changeMaterial', mode)
  }
}

//
// ─── PLAYBACK ───────────────────────────────────────────────────────────────────
//

export const goToTickAction = async (tick: number) => {
  try {
    const maxTicks = getState().playback.maxTicks

    setClockTick(Math.min(tick, maxTicks))
    dispatch({ type: 'GO_TO_TICK', payload: tick })

    // Automatically pause playback once it has reached the last tick (a live match keeps
    // going: playback waits at its edge for the next snapshot)
    if (tick >= maxTicks && !isLiveMatch()) {
      dispatch({ type: 'TOGGLE_PLAYBACK', payload: false })
    }
  } catch (error) {
    console.error(error)
  }
}

/** A live match grows: its end moves on with every snapshot. */
export const setMaxTicksAction = (maxTicks: number) => {
  dispatch({ type: 'SET_MAX_TICKS', payload: maxTicks })
}

const isLiveMatch = () => useInstance.getState().match?.kind === 'live'

export const playbackJumpAction = async (direction: string) => {
  try {
    const PLAYBACK_JUMP_TICK_INCREMENT = 50
    const tick = getState().playback.tick

    switch (direction) {
      case 'seekBackward':
        goToTickAction(tick - PLAYBACK_JUMP_TICK_INCREMENT)
        addEventHistoryAction('seekBackward')
        break

      case 'seekForward':
        goToTickAction(tick + PLAYBACK_JUMP_TICK_INCREMENT)
        addEventHistoryAction('seekForward')
        break

      case 'previousTick':
        goToTickAction(tick - 1)
        addEventHistoryAction('previousTick')
        break

      case 'nextTick':
        goToTickAction(tick + 1)
        addEventHistoryAction('nextTick')
        break

      default:
        break
    }
  } catch (error) {
    console.error(error)
  }
}

export const togglePlaybackAction = async (playing = undefined) => {
  try {
    // Use {playing} value if provided - otherwise use the inverse of current value
    const isPlaying = playing !== undefined ? playing : !getState().playback.playing
    const isAtEnd = getState().playback.maxTicks === getState().playback.tick

    // Pressing play when at the end of playback should trigger restart
    if (isAtEnd && !isLiveMatch()) {
      dispatch({ type: 'GO_TO_TICK', payload: 1 })
    }

    dispatch({ type: 'TOGGLE_PLAYBACK', payload: isPlaying })

    addEventHistoryAction(isPlaying ? 'play' : 'pause')
  } catch (error) {
    console.error(error)
  }
}

export const changePlaySpeedAction = async (speed: 'faster' | 'slower' | number) => {
  try {
    // Provide the option to pass strings "faster" or "slower" as the {speed} param instead
    // which will simply cycle the options as defined in PlaybackPanel
    const currentSpeed = getState().playback.speed
    const currentIndex = PLAYBACK_SPEED_OPTIONS.findIndex(({ value }) => value === currentSpeed)
    const prevIndex = clamp(currentIndex - 1, 0, PLAYBACK_SPEED_OPTIONS.length - 1)
    const nextIndex = clamp(currentIndex + 1, 0, PLAYBACK_SPEED_OPTIONS.length - 1)

    switch (speed) {
      case 'faster':
        dispatch({
          type: 'CHANGE_PLAY_SPEED',
          payload: PLAYBACK_SPEED_OPTIONS[prevIndex].value,
        })
        addEventHistoryAction(
          'changePlaySpeed',
          PLAYBACK_SPEED_OPTIONS[prevIndex].value + '× speed'
        )
        break

      case 'slower':
        dispatch({
          type: 'CHANGE_PLAY_SPEED',
          payload: PLAYBACK_SPEED_OPTIONS[nextIndex].value,
        })
        addEventHistoryAction(
          'changePlaySpeed',
          PLAYBACK_SPEED_OPTIONS[nextIndex].value + '× speed'
        )

        break

      default:
        dispatch({ type: 'CHANGE_PLAY_SPEED', payload: speed })
        break
    }
  } catch (error) {
    console.error(error)
  }
}

let forceShowPanelTimer: ReturnType<typeof setTimeout> | undefined

export const forceShowPanelAction = async (forceShowPanel?: boolean) => {
  try {
    if (forceShowPanel === undefined) {
      forceShowPanel = !getState().playback.forceShowPanel
    }

    dispatch({ type: 'FORCE_SHOW_PANEL', payload: forceShowPanel })

    // One timer at a time, so an earlier one cannot hide the panel early.
    clearTimeout(forceShowPanelTimer)
    forceShowPanelTimer = setTimeout(
      () => dispatch({ type: 'FORCE_SHOW_PANEL', payload: false }),
      1500
    )
  } catch (error) {
    console.error(error)
  }
}

//
// ─── SETTINGS ───────────────────────────────────────────────────────────────────
//

export const loadSettingsAction = async () => {
  try {
    const defaultSettings = getState().settings
    const settings = await localForage.getItem<StoreState['settings']>('settings')

    // Always default to untextured on mobile devices because textured scene takes up
    // a lot of memory - and risk the device's browser crashing.
    if (settings && isMobile) {
      settings.scene.mode = SceneMode.UNTEXTURED
    }

    // Before 2026-11 the orbit camera's speeds sat at the top of `controls`, on a 1–10 scale
    // that no longer means anything; only the inertia toggle carries over (as smoothing).
    const legacyControls = settings?.controls as Record<string, unknown> | undefined
    if (legacyControls && 'panSpeed' in legacyControls) {
      if (!legacyControls.rts && legacyControls.enableDamping === false) {
        legacyControls.rts = { smoothing: false }
      }
      for (const key of ['panSpeed', 'rotateSpeed', 'zoomSpeed', 'enableDamping']) {
        delete legacyControls[key]
      }
    }

    // merge writes into its first argument, so the defaults are copied first.
    dispatch({
      type: 'LOAD_SETTINGS',
      payload: { settings: merge(cloneDeep(defaultSettings), settings) },
    })
  } catch (error) {
    console.error(error)
  }
}

export const updateSettingsOptionAction = async (option: string, value: any) => {
  try {
    dispatch({ type: 'UPDATE_SETTINGS_OPTION', payload: { option, value } })
  } catch (error) {
    console.error(error)
  }
}

export const toggleMapCenterPickerAction = async (active?: boolean) => {
  try {
    const nextActive = active !== undefined ? active : !useInstance.getState().mapCenterPickerActive
    useInstance.getState().setMapCenterPickerActive(nextActive)
  } catch (error) {
    console.error(error)
  }
}

export const setSceneRtsCenterAction = async (point: { x: number; y: number; z: number }) => {
  try {
    const mapName = getState().scene.map
    const mapKey = getMapBoundariesKey(mapName) ?? mapName

    dispatch({
      type: 'SET_SCENE_RTS_CENTER',
      payload: new THREE.Vector3(point.x, point.y, point.z),
    })
    useInstance.getState().setMapCenterPickerActive(false)

    // The scene is drawn in Source world coordinates, so the picked point is saved as it is.
    await updateSettingsOptionAction(`scene.worldRtsCenters.${mapKey}`, { ...point })
  } catch (error) {
    console.error(error)
  }
}

// Provide an action to easily toggle boolean setting options
export const toggleSettingsOptionAction = async (option: string) => {
  try {
    const settings = getState().settings
    const previousValue = get(settings, option)

    if (previousValue === undefined) return null

    dispatch({ type: 'UPDATE_SETTINGS_OPTION', payload: { option, value: !previousValue } })
  } catch (error) {
    console.error(error)
  }
}

//
// ─── VIEW SHORTCUTS ─────────────────────────────────────────────────────────────
//
// The keys that flip what is shown (CanvasKeyHandler); each says what it did over the
// playback bar, so a stray key press is never a mystery.
//

const onOff = (value: boolean) => (value ? 'on' : 'off')

/** Flips a boolean setting and notes it, e.g. "Outlines on". Unset reads as `fallback`. */
export const toggleSettingWithNoteAction = async (
  option: string,
  label: string,
  fallback = false
) => {
  const next = !(get(getState().settings, option) ?? fallback)
  await updateSettingsOptionAction(option, next)
  addEventHistoryAction('setting', `${label} ${onOff(next)}`)
}

const RAILS_LABELS: Record<RailsMode, string> = {
  full: 'Full',
  compact: 'Compact',
  hidden: 'Hidden',
}

/** Full → compact → hidden → full. */
export const cycleRailsAction = async () => {
  const current = getState().settings.ui.rails ?? 'full'
  const next = RAILS_MODES[(RAILS_MODES.indexOf(current) + 1) % RAILS_MODES.length]
  await updateSettingsOptionAction('ui.rails', next)
  addEventHistoryAction('setting', `Player rails: ${RAILS_LABELS[next]}`)
}

export const toggleLightingAction = async () => {
  const next = (getState().settings.scene.lighting ?? 'baked') === 'baked' ? 'flat' : 'baked'
  await updateSettingsOptionAction('scene.lighting', next)
  addEventHistoryAction('setting', `Lighting: ${next === 'baked' ? 'Baked' : 'Flat'}`)
}

/** Off, or back to the style it had before. */
export const toggleCrosshairAction = async () => {
  const { style, lastStyle } = getState().settings.ui.crosshair
  if (style !== CrosshairStyle.NONE) {
    await updateSettingsOptionAction('ui.crosshair.lastStyle', style)
    await updateSettingsOptionAction('ui.crosshair.style', CrosshairStyle.NONE)
  } else {
    await updateSettingsOptionAction('ui.crosshair.style', lastStyle ?? CrosshairStyle.CROSSHAIR)
  }
  addEventHistoryAction('setting', `Crosshair ${onOff(style === CrosshairStyle.NONE)}`)
}

export const setHudHiddenAction = (hidden?: boolean) => {
  dispatch({ type: 'SET_HUD_HIDDEN', payload: hidden ?? !getState().ui.hudHidden })
}

export const setSettingsTabAction = (tab: SettingsTab) => {
  dispatch({ type: 'SET_SETTINGS_TAB', payload: tab })
}

/** Settings at the Keys tab (?); closes it if that is what is showing. */
export const toggleShortcutsAction = async () => {
  const { activePanels, settingsTab, hudHidden } = getState().ui
  const showing = activePanels.includes(UIPanelType.SETTINGS) && settingsTab === 'keys'
  if (hudHidden) setHudHiddenAction(false)
  setSettingsTabAction('keys')
  if (showing || !activePanels.includes(UIPanelType.SETTINGS)) {
    await toggleOnlyUIPanelAction(UIPanelType.SETTINGS)
  }
}

//
// ─── SETUPS ─────────────────────────────────────────────────────────────────────
//

export const loadSetupsAction = async () => {
  try {
    const stored = await localForage.getItem<SavedSetup[]>('setups')
    // Older setups are converted to world coordinates once, and saved so.
    const setups = await Promise.all(normalizeStoredSetups(stored).map(toWorldSetup))
    dispatch({ type: 'LOAD_SETUPS', payload: setups })
  } catch (error) {
    console.error(error)
  }
}

export const setSetupDraftNameAction = async (name: string) => {
  try {
    dispatch({ type: 'SET_SETUP_DRAFT_NAME', payload: name })
  } catch (error) {
    console.error(error)
  }
}

export const bootstrapSharedSetupFromHashAction = async () => {
  try {
    const token = parseSetupHash(window.location.hash)
    if (!token) return null

    const decoded = deserializeSetupFromShareToken(token)
    const setup = decoded && (await toWorldSetup(decoded))
    if (!setup) {
      console.warn('Ignoring invalid or unsupported shared setup URL.')
      return null
    }

    dispatch({ type: 'SET_PENDING_SHARED_SETUP', payload: setup })
    dispatch({ type: 'SET_SETUP_DRAFT_NAME', payload: setup.name })
    dispatch({ type: 'SET_UI_PANEL_INACTIVE', payload: { name: UIPanelType.ABOUT } })
    dispatch({ type: 'SET_UI_PANEL_ACTIVE', payload: { name: UIPanelType.SETUPS } })
    return setup
  } catch (error) {
    console.error(error)
    return null
  }
}

export const clearPendingSharedSetupAction = async () => {
  try {
    dispatch({ type: 'CLEAR_PENDING_SHARED_SETUP' })
  } catch (error) {
    console.error(error)
  }
}

export const captureCurrentSetupAction = async (name: string): Promise<SavedSetup | null> => {
  try {
    const trimmedName = name.trim()
    if (!trimmedName) return null

    const camera = useInstance.getState().setupCameraBridge?.capture()
    if (!camera) {
      console.warn('Unable to capture setup camera because the viewer camera bridge is missing.')
      return null
    }

    const timestamp = Date.now()

    return {
      id: createSetupId(),
      version: SETUP_STORAGE_VERSION,
      name: trimmedName,
      map: getState().scene.map,
      camera: cloneSetupCamera(camera),
      stickers: cloneSetupStickers(getState().drawing.stickerHistory.present),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  } catch (error) {
    console.error(error)
    return null
  }
}

export const saveCurrentSetupAction = async (name = getState().setups.draftName) => {
  try {
    const setup = await captureCurrentSetupAction(name)
    if (!setup) return null

    dispatch({ type: 'SAVE_SETUP', payload: setup })
    addEventHistoryAction('saveSetup', setup.name)
    return setup
  } catch (error) {
    console.error(error)
    return null
  }
}

export const renameSetupAction = async (id: string, name: string) => {
  try {
    const trimmedName = name.trim()
    if (!trimmedName) return null

    const existingSetup = getSetupById(id)
    if (!existingSetup) return null

    dispatch({
      type: 'RENAME_SETUP',
      payload: {
        id,
        name: trimmedName,
        previousName: existingSetup.name,
        updatedAt: Date.now(),
      },
    })

    addEventHistoryAction('renameSetup', trimmedName)
    return trimmedName
  } catch (error) {
    console.error(error)
    return null
  }
}

export const updateSetupFromCurrentAction = async (id: string) => {
  try {
    const existingSetup = getSetupById(id)
    if (!existingSetup) return null

    const camera = useInstance.getState().setupCameraBridge?.capture()
    if (!camera) return null

    const nextSetup: SavedSetup & { previousName: string } = {
      ...existingSetup,
      previousName: existingSetup.name,
      map: getState().scene.map,
      camera: cloneSetupCamera(camera),
      stickers: cloneSetupStickers(getState().drawing.stickerHistory.present),
      updatedAt: Date.now(),
    }

    dispatch({ type: 'UPDATE_SETUP', payload: nextSetup })
    addEventHistoryAction('updateSetup', existingSetup.name)
    return nextSetup
  } catch (error) {
    console.error(error)
    return null
  }
}

export const deleteSetupAction = async (id: string) => {
  try {
    const existingSetup = getSetupById(id)
    if (!existingSetup) return

    dispatch({ type: 'DELETE_SETUP', payload: id })
    addEventHistoryAction('deleteSetup', existingSetup.name)
  } catch (error) {
    console.error(error)
  }
}

export const applySetupAction = async (
  setup: SavedSetup,
  options: { fromShared?: boolean } = {}
) => {
  try {
    const setupCameraBridge = useInstance.getState().setupCameraBridge
    if (!setupCameraBridge) {
      console.warn('Unable to apply setup because the viewer camera bridge is missing.')
      return false
    }

    const currentMap = getState().scene.map
    const match = useInstance.getState().match

    if (match || currentMap !== setup.map) {
      await loadEmptySceneMapAction(setup.map)
    }

    dispatch({
      type: 'APPLY_SETUP_STICKERS',
      payload: {
        stickers: cloneSetupStickers(setup.stickers),
        name: setup.name,
      },
    })
    setupCameraBridge.apply(cloneSetupCamera(setup.camera))
    dispatch({ type: 'CLEAR_PENDING_SHARED_SETUP' })

    addEventHistoryAction(options.fromShared ? 'loadSharedSetup' : 'loadSetup', setup.name)
    return true
  } catch (error) {
    console.error(error)
    return false
  }
}

export const applySetupByIdAction = async (id: string, options: { fromShared?: boolean } = {}) => {
  try {
    const setup = getSetupById(id)
    if (!setup) return false
    return applySetupAction(setup, options)
  } catch (error) {
    console.error(error)
    return false
  }
}

export const copySetupShareUrlAction = async (setupOrId: SavedSetup | string) => {
  try {
    const setup = typeof setupOrId === 'string' ? getSetupById(setupOrId) : setupOrId
    if (!setup || !navigator.clipboard) return null

    const shareUrl = buildSetupShareUrl(setup)
    await navigator.clipboard.writeText(shareUrl)
    addEventHistoryAction('copySetupLink', setup.name)
    return shareUrl
  } catch (error) {
    console.error(error)
    return null
  }
}

//
// ─── UI ─────────────────────────────────────────────────────────────────────────
//

export const toggleUIPanelAction = async (name: UIPanelType, active?: boolean) => {
  try {
    // Use {active} value if provided - otherwise use the inverse of current value
    const isActive = active !== undefined ? active : !getState().ui.activePanels.includes(name)

    if (isActive) {
      dispatch({ type: 'SET_UI_PANEL_ACTIVE', payload: { name: name } })
    } else {
      dispatch({ type: 'SET_UI_PANEL_INACTIVE', payload: { name: name } })
    }
  } catch (error) {
    console.error(error)
  }
}

export const setScoreboardOpenAction = (open?: boolean) => {
  const next = open ?? !getState().ui.scoreboardOpen
  if (next !== getState().ui.scoreboardOpen)
    dispatch({ type: 'SET_SCOREBOARD_OPEN', payload: next })
}

/** Opens a toolbar panel and closes the others, or closes it if it is open. */
export const toggleOnlyUIPanelAction = async (name: UIPanelType) => {
  try {
    const wasOpen = getState().ui.activePanels.includes(name)
    for (const other of Object.values(UIPanelType)) {
      if (other !== name) dispatch({ type: 'SET_UI_PANEL_INACTIVE', payload: { name: other } })
    }
    dispatch({ type: wasOpen ? 'SET_UI_PANEL_INACTIVE' : 'SET_UI_PANEL_ACTIVE', payload: { name } })
  } catch (error) {
    console.error(error)
  }
}

export const popUIPanelAction = async () => {
  try {
    dispatch({ type: 'POP_UI_PANEL' })
  } catch (error) {
    console.error(error)
  }
}

//
// ─── DRAWING ────────────────────────────────────────────────────────────────────
//

export const toggleUIDrawingAction = async (active?: boolean) => {
  try {
    // Use {active} value if provided - otherwise use the inverse of current value
    const isActive = active !== undefined ? active : !getState().drawing.enabled

    if (isActive) {
      if (document.pointerLockElement && getState().drawing.tool === DrawingTool.STICKERS) {
        document.exitPointerLock()
      }

      dispatch({ type: 'SET_DRAWING_ACTIVE' })
    } else {
      dispatch({ type: 'SET_DRAWING_INACTIVE' })

      const shouldAutoClear = getState().settings.drawing.autoClear
      const drawingCanvas = useInstance.getState().drawingCanvas

      if (shouldAutoClear) {
        drawingCanvas?.clear()
      }
    }
  } catch (error) {
    console.error(error)
  }
}

export const setDrawingToolAction = async (tool: DrawingTool) => {
  try {
    if (tool === DrawingTool.STICKERS && document.pointerLockElement) {
      document.exitPointerLock()
    }

    dispatch({ type: 'SET_DRAWING_TOOL', payload: tool })
  } catch (error) {
    console.error(error)
  }
}

export const setDrawingBrushColorAction = async (color: string) => {
  try {
    dispatch({ type: 'SET_DRAWING_BRUSH_COLOR', payload: color })
  } catch (error) {
    console.error(error)
  }
}

export const setDrawingBrushRadiusAction = async (radius: number) => {
  try {
    dispatch({ type: 'SET_DRAWING_BRUSH_RADIUS', payload: radius })
  } catch (error) {
    console.error(error)
  }
}

export const setStickersPanelOpenAction = async (open: boolean) => {
  try {
    if (open && document.pointerLockElement) {
      document.exitPointerLock()
    }

    dispatch({ type: 'SET_STICKERS_PANEL_OPEN', payload: open })
  } catch (error) {
    console.error(error)
  }
}

export const selectStickerAction = async (stickerId?: string) => {
  try {
    dispatch({ type: 'SET_SELECTED_STICKER', payload: stickerId })
  } catch (error) {
    console.error(error)
  }
}

export const startStickerDragAction = async (payload: {
  kind: StickerDragKind
  stickerId?: string
  sticker?: StickerDefinition
  screenX: number
  screenY: number
}) => {
  try {
    dispatch({ type: 'START_STICKER_DRAG', payload })
  } catch (error) {
    console.error(error)
  }
}

export const cancelStickerDragAction = async () => {
  try {
    dispatch({ type: 'CANCEL_STICKER_DRAG' })
  } catch (error) {
    console.error(error)
  }
}

export const addStickerAction = async (sticker: StickerAnnotation) => {
  try {
    dispatch({ type: 'ADD_STICKER', payload: sticker })
  } catch (error) {
    console.error(error)
  }
}

export const moveStickerAction = async (id: string, position: [number, number, number]) => {
  try {
    dispatch({ type: 'MOVE_STICKER', payload: { id, position } })
  } catch (error) {
    console.error(error)
  }
}

export const deleteStickerAction = async (id: string) => {
  try {
    dispatch({ type: 'DELETE_STICKER', payload: id })
  } catch (error) {
    console.error(error)
  }
}

export const deleteSelectedStickerAction = async () => {
  try {
    const selectedStickerId = getState().drawing.selectedStickerId
    if (!selectedStickerId) return
    dispatch({ type: 'DELETE_STICKER', payload: selectedStickerId })
  } catch (error) {
    console.error(error)
  }
}

export const clearStickersAction = async () => {
  try {
    if (getState().drawing.stickerHistory.present.length === 0) return
    dispatch({ type: 'CLEAR_STICKERS' })
  } catch (error) {
    console.error(error)
  }
}

export const undoStickersAction = async () => {
  try {
    if (getState().drawing.stickerHistory.past.length === 0) return
    dispatch({ type: 'UNDO_STICKERS' })
  } catch (error) {
    console.error(error)
  }
}

export const redoStickersAction = async () => {
  try {
    if (getState().drawing.stickerHistory.future.length === 0) return
    dispatch({ type: 'REDO_STICKERS' })
  } catch (error) {
    console.error(error)
  }
}

//
// ─── BOOKMARKS ──────────────────────────────────────────────────────────────────
//
// Kept per demo in localForage ('bookmarks'), so they are there again when the same demo is
// opened later. A demo is known by its header; a live match has no lasting identity, so its
// bookmarks last as long as it is watched.
//

interface SavedBookmarks {
  [matchKey: string]: { ticks: number[]; map: string; savedAt: number }
}

const SAVED_BOOKMARKS_KEY = 'bookmarks'
/** Demos whose bookmarks are kept; the least recently changed go first. */
const SAVED_BOOKMARKS_LIMIT = 100

/** The demo being watched, as SavedBookmarks knows it; null for none or a live match. */
let bookmarksMatchKey: string | null = null
/** Saves one after another, so two quick changes cannot write over each other. */
let bookmarksWrite: Promise<unknown> = Promise.resolve()

export function matchBookmarksKey(match: MatchSource): string | null {
  if (match.kind !== 'demo') return null
  const { map, server, nick, ticks, duration } = match.header
  return [map, server, nick, ticks, duration].join('|')
}

async function restoreBookmarks(match: MatchSource) {
  const key = matchBookmarksKey(match)
  if (!key) return
  try {
    const saved = await localForage.getItem<SavedBookmarks>(SAVED_BOOKMARKS_KEY)
    const ticks = saved?.[key]?.ticks
    // Unless another match was opened meanwhile.
    if (ticks?.length && bookmarksMatchKey === key) {
      dispatch({ type: 'SET_BOOKMARKS', payload: ticks })
    }
  } catch (error) {
    console.error(error)
  }
}

function saveBookmarks() {
  const key = bookmarksMatchKey
  if (!key) return
  const ticks = getState().bookmarks
  const map = getState().scene.map
  bookmarksWrite = bookmarksWrite
    .then(async () => {
      const saved = (await localForage.getItem<SavedBookmarks>(SAVED_BOOKMARKS_KEY)) ?? {}
      if (ticks.length) saved[key] = { ticks, map, savedAt: Date.now() }
      else delete saved[key]
      const kept = Object.entries(saved)
        .sort(([, a], [, b]) => b.savedAt - a.savedAt)
        .slice(0, SAVED_BOOKMARKS_LIMIT)
      await localForage.setItem(SAVED_BOOKMARKS_KEY, Object.fromEntries(kept))
    })
    .catch(error => console.error(error))
}

export const toggleBookmarkAction = async (tick?: number) => {
  try {
    const currentTick = tick ?? getState().playback.tick
    const bookmarks = getState().bookmarks

    if (bookmarks.includes(currentTick)) {
      dispatch({ type: 'REMOVE_BOOKMARK', payload: currentTick })
      addEventHistoryAction('removeBookmark', `Tick ${currentTick}`)
    } else {
      dispatch({ type: 'ADD_BOOKMARK', payload: currentTick })
      addEventHistoryAction('addBookmark', `Tick ${currentTick}`)
    }
    saveBookmarks()
  } catch (error) {
    console.error(error)
  }
}

export const removeBookmarkAction = async (tick: number) => {
  try {
    dispatch({ type: 'REMOVE_BOOKMARK', payload: tick })
    saveBookmarks()
  } catch (error) {
    console.error(error)
  }
}

export const clearBookmarksAction = async () => {
  try {
    dispatch({ type: 'CLEAR_BOOKMARKS' })
    addEventHistoryAction('clearBookmarks')
    saveBookmarks()
  } catch (error) {
    console.error(error)
  }
}

// ─── EVENT HISTORY ───────────────────────────────────────────────────────────

export const addEventHistoryAction = async (type: string, value?: string) => {
  try {
    dispatch({ type: 'ADD_EVENT_HISTORY', payload: { type, value, timestamp: Date.now() } })
  } catch (error) {
    console.error(error)
  }
}

// ─── DOWNLOADS ────────────────────────────────────────────────────────────────

export const addDownloadAction = async ({
  type,
  name,
  url,
}: Pick<Download, 'type' | 'name' | 'url'>) => {
  try {
    dispatch({
      type: 'ADD_DOWNLOAD',
      payload: { type, name, url, status: 'loading', progress: 0 },
    })
  } catch (error) {
    console.error(error)
  }
}

/** Updates a download's progress, size or stage. Only finishDownloadAction ends it. */
export const updateDownloadAction = async (
  url: string,
  update: Partial<Pick<Download, 'progress' | 'size' | 'stage' | 'name'>>
) => {
  try {
    // Fields left out (or undefined) keep their current value.
    const payload: Partial<Download> & { url: string } = { url }
    if (update.progress !== undefined) payload.progress = round(update.progress, 1)
    if (update.size !== undefined) payload.size = update.size
    if (update.stage !== undefined) payload.stage = update.stage
    if (update.name !== undefined) payload.name = update.name
    dispatch({ type: 'UPDATE_DOWNLOAD', payload })
  } catch (error) {
    console.error(error)
  }
}

/** Marks a download as finished, whether or not its progress ever reached 100%. */
export const finishDownloadAction = (url: string, status: 'success' | 'error' = 'success') => {
  dispatch({
    type: 'UPDATE_DOWNLOAD',
    payload: { url, status, ...(status === 'success' ? { progress: 100 } : {}) },
  })
}

/** Fetches a file into an ArrayBuffer, showing it in the downloads overlay. */
export const downloadFileAction = async (
  download: Pick<Download, 'type' | 'name' | 'url'>
): Promise<ArrayBuffer> => {
  await addDownloadAction(download)
  try {
    const response = await fetch(download.url)
    if (!response.ok) throw new Error(`${download.url}: ${response.status}`)
    // content-length is the encoded size, so with compression progress is approximate.
    const total = Number(response.headers.get('content-length')) || 0
    if (!response.body) {
      const buffer = await response.arrayBuffer()
      finishDownloadAction(download.url)
      return buffer
    }
    const chunks: Uint8Array[] = []
    let received = 0
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      if (total) {
        updateDownloadAction(download.url, {
          progress: Math.min(99, (received / total) * 100),
          size: total,
        })
      }
    }
    const bytes = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    finishDownloadAction(download.url)
    return bytes.buffer
  } catch (error) {
    finishDownloadAction(download.url, 'error')
    throw error
  }
}

function getSetupById(id: string): SavedSetup | undefined {
  return getState().setups.items.find(setup => setup.id === id)
}
