import { get, merge, clamp, sortBy, round } from 'lodash'
import localForage from 'localforage'
import * as THREE from 'three'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'
import { getMapBoundaries, getMapBoundariesKey } from '@components/Analyse/MapBoundaries'
import { PLAYBACK_SPEED_OPTIONS } from '@components/UI/PlaybackPanel'

import { getSceneActors, parseMapBoundaries } from '@utils/scene'
import { fetchMapWorldBounds } from '@utils/game'
import {
  buildSetupShareUrl,
  cloneSetupCamera,
  cloneSetupStickers,
  createSetupId,
  deserializeSetupFromShareToken,
  normalizeStoredSetups,
  parseSetupHash,
} from '@utils/setups'
import { CLASS_ORDER_MAP } from '@constants/mappings'
import {
  ControlsMode,
  Download,
  DrawingTool,
  SavedSetup,
  SETUP_STORAGE_VERSION,
  SceneMode,
  StickerDefinition,
  StickerAnnotation,
  UIPanelType,
} from '@constants/types'
import { StickerDragKind } from './drawing'

import { dispatch, getState, initialState, StoreState, useInstance } from './store'
import { isMobile } from 'react-device-detect'

//
// ─── PARSER ─────────────────────────────────────────────────────────────────────
//

export const onUploadDemoAction = async (files: File[]) => {
  const demoFile: File = files[0]

  const reader = new FileReader()

  reader.readAsArrayBuffer(demoFile)

  reader.onload = function () {
    const fileBuffer = reader.result as ArrayBuffer
    parseDemoAction(fileBuffer)
  }
}

export const parseDemoAction = async (fileBuffer: ArrayBuffer) => {
  try {
    dispatch({ type: 'PARSE_DEMO_INIT' })

    const parsedDemo = new AsyncParser(fileBuffer, async progress => {
      dispatch({ type: 'PARSE_DEMO_PROGRESS', payload: progress })
    })

    try {
      await parsedDemo.cache()
    } catch (error) {
      alert(`Unable to load demo. Please make sure it's a valid SourceTV .dem file.`)
      throw error
    }

    console.log('%c-------- Demo parsed --------', 'color: blue; font-size: 16px;')
    console.log(parsedDemo)
    console.log('%c-----------------------------', 'color: blue; font-size: 16px;')

    dispatch({ type: 'PARSE_DEMO_SUCCESS' })

    await loadSceneFromDemoAction(parsedDemo)

    return parsedDemo
  } catch (error) {
    dispatch({ type: 'PARSE_DEMO_ERROR', payload: error })
    throw error
  }
}

//
// ─── SCENE ──────────────────────────────────────────────────────────────────────
//

export const loadSceneFromDemoAction = async (parsedDemo: AsyncParser) => {
  try {
    toggleUIPanelAction('About', false)
    const mapKey = getMapBoundariesKey(parsedDemo.header.map) ?? parsedDemo.header.map
    const savedRtsCenter = getState().settings.scene.rtsCenters[mapKey]
    const boundaryOverrides = getMapBoundaries(parsedDemo.header.map) ?? {}

    // Remember to update the non-redux instances!
    useInstance.getState().setParsedDemo(parsedDemo)
    useInstance.getState().setFocusedObject(undefined)
    useInstance.getState().setLastFocusedPOV(undefined)
    useInstance.getState().setMapCenterPickerActive(false)

    dispatch({
      type: 'LOAD_SCENE_FROM_PARSER',
      payload: {
        scene: {
          players: parsedDemo.entityPlayerMap,
          map: parsedDemo.header.map,
          bounds: parseMapBoundaries({
            ...boundaryOverrides, // get camera/control offsets
            ...parsedDemo.world,
            ...(savedRtsCenter ? { rtsCenter: savedRtsCenter } : {}),
          }),
          controls: {
            mode: 'rts',
          },
        },
        playback: {
          playing: true,
          speed: 1,
          tick: 1,
          maxTicks: parsedDemo.ticks - 1,
          intervalPerTick: parsedDemo.intervalPerTick,
        },
      },
    })
  } catch (error) {
    console.error(error)
  }
}

export const loadEmptySceneMapAction = async (mapName: string) => {
  try {
    // Try to get world bounds from conversion.json (derived from BSP),
    // then merge with any hardcoded camera/control offsets
    const worldBounds = await fetchMapWorldBounds(mapName)
    const overrides = getMapBoundaries(mapName)

    const boundaries = worldBounds
      ? { ...overrides, ...worldBounds }
      : overrides
    const mapKey = getMapBoundariesKey(mapName) ?? mapName
    const savedRtsCenter = getState().settings.scene.rtsCenters[mapKey]
    const boundariesWithCenter = savedRtsCenter && boundaries
      ? { ...boundaries, rtsCenter: savedRtsCenter }
      : boundaries

    if (!boundariesWithCenter?.boundaryMin || !boundariesWithCenter?.boundaryMax) {
      alert('Unable to load map. Could not determine map boundaries.')
      return
    }

    // Remember to update the non-redux instances!
    useInstance.getState().setParsedDemo(undefined)
    useInstance.getState().setFocusedObject(undefined)
    useInstance.getState().setLastFocusedPOV(undefined)
    useInstance.getState().setMapCenterPickerActive(false)

    dispatch({
      type: 'LOAD_SCENE_FROM_PARSER',
      payload: {
        scene: {
          ...initialState.scene,
          map: mapName,
          bounds: parseMapBoundaries(boundariesWithCenter),
        },
        playback: initialState.playback,
      },
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
      const demo = useInstance.getState().parsedDemo
      let playersThisTick = demo!.getPlayersAtTick(tick)

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

    dispatch({ type: 'GO_TO_TICK', payload: tick })

    // Automatically pause playback once it has reached the last tick
    if (tick >= maxTicks) {
      dispatch({ type: 'TOGGLE_PLAYBACK', payload: false })
    }
  } catch (error) {
    console.error(error)
  }
}

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
    if (isAtEnd) {
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

export const forceShowPanelAction = async (forceShowPanel?: boolean) => {
  try {
    if (forceShowPanel === undefined) {
      forceShowPanel = !getState().playback.forceShowPanel
    }

    dispatch({ type: 'FORCE_SHOW_PANEL', payload: forceShowPanel })

    setTimeout(() => dispatch({ type: 'FORCE_SHOW_PANEL', payload: false }), 1500)
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

    dispatch({ type: 'LOAD_SETTINGS', payload: { settings: merge(defaultSettings, settings) } })
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
    const nextActive =
      active !== undefined ? active : !useInstance.getState().mapCenterPickerActive
    useInstance.getState().setMapCenterPickerActive(nextActive)
  } catch (error) {
    console.error(error)
  }
}

export const setSceneRtsCenterAction = async (point: { x: number; y: number; z: number }) => {
  try {
    const nextCenter = new THREE.Vector3(point.x, point.y, point.z)
    const mapName = getState().scene.map
    const mapKey = getMapBoundariesKey(mapName) ?? mapName

    dispatch({ type: 'SET_SCENE_RTS_CENTER', payload: nextCenter })
    useInstance.getState().setMapCenterPickerActive(false)

    await updateSettingsOptionAction(`scene.rtsCenters.${mapKey}`, point)
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
// ─── SETUPS ─────────────────────────────────────────────────────────────────────
//

export const loadSetupsAction = async () => {
  try {
    const setups = await localForage.getItem<SavedSetup[]>('setups')
    dispatch({ type: 'LOAD_SETUPS', payload: normalizeStoredSetups(setups) })
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

    const setup = deserializeSetupFromShareToken(token)
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
    const parsedDemo = useInstance.getState().parsedDemo

    if (parsedDemo || currentMap !== setup.map) {
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
  } catch (error) {
    console.error(error)
  }
}

export const removeBookmarkAction = async (tick: number) => {
  try {
    dispatch({ type: 'REMOVE_BOOKMARK', payload: tick })
  } catch (error) {
    console.error(error)
  }
}

export const clearBookmarksAction = async () => {
  try {
    dispatch({ type: 'CLEAR_BOOKMARKS' })
    addEventHistoryAction('clearBookmarks')
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

export const updateDownloadAction = async (
  url: string,
  { progress, size }: Pick<Download, 'progress' | 'size'>
) => {
  try {
    if (size) {
      dispatch({ type: 'UPDATE_DOWNLOAD', payload: { url, size } })
    }

    if (progress) {
      dispatch({ type: 'UPDATE_DOWNLOAD', payload: { url, progress: round(progress, 1) } })

      if (progress >= 100) {
        dispatch({ type: 'UPDATE_DOWNLOAD', payload: { url, status: 'success' } })
      }
    }
  } catch (error) {
    console.error(error)
  }
}

function getSetupById(id: string): SavedSetup | undefined {
  return getState().setups.items.find(setup => setup.id === id)
}
