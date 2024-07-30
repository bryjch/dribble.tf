import { get, merge, clamp, sortBy } from 'lodash'
import localForage from 'localforage'
import * as THREE from 'three'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'
import { getMapBoundaries } from '@components/Analyse/MapBoundaries'
import { PLAYBACK_SPEED_OPTIONS } from '@components/UI/PlaybackPanel'

import { getSceneActors, parseMapBoundaries } from '@utils/scene'
import { CLASS_ORDER_MAP } from '@constants/mappings'
import { ControlsMode, SceneMode, UIPanelType } from '@constants/types'

import { dispatch, getState, initialState, useInstance } from './store'

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

    // Remember to update the non-redux instances!
    useInstance.getState().setParsedDemo(parsedDemo)
    useInstance.getState().setFocusedObject(undefined)

    dispatch({
      type: 'LOAD_SCENE_FROM_PARSER',
      payload: {
        scene: {
          players: parsedDemo.entityPlayerMap,
          map: parsedDemo.header.map,
          bounds: parseMapBoundaries({
            ...getMapBoundaries(parsedDemo.header.map), // get camera/control offsets
            ...parsedDemo.world,
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
    const boundaries = getMapBoundaries(mapName)
    if (!boundaries) {
      alert('Unable to load map. Could not determine map boundaries.')
      return
    }

    // Remember to update the non-redux instances!
    useInstance.getState().setParsedDemo(undefined)
    useInstance.getState().setFocusedObject(undefined)

    dispatch({
      type: 'LOAD_SCENE_FROM_PARSER',
      payload: {
        scene: {
          ...initialState.scene,
          map: mapName,
          bounds: parseMapBoundaries(boundaries),
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

export const jumpToSpectatorCamera = async (options = {}) => {
  try {
    dispatch({ type: 'CHANGE_CONTROLS_MODE', payload: 'spectator' })

    useInstance.getState().setFocusedObject(undefined)
  } catch (error) {
    console.error(error)
  }
}

export const jumpToRtsCamera = async (options = {}) => {
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
        addEventHistoryAction(PLAYBACK_SPEED_OPTIONS[prevIndex].value + '× speed')
        break

      case 'slower':
        dispatch({
          type: 'CHANGE_PLAY_SPEED',
          payload: PLAYBACK_SPEED_OPTIONS[nextIndex].value,
        })
        addEventHistoryAction(PLAYBACK_SPEED_OPTIONS[nextIndex].value + '× speed')

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
    const settings = await localForage.getItem('settings')

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
      if (document.pointerLockElement) {
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

// ─── EVENT HISTORY ───────────────────────────────────────────────────────────

export const addEventHistoryAction = async (type: string, value?: string) => {
  try {
    dispatch({ type: 'ADD_EVENT_HISTORY', payload: { type, value, timestamp: Date.now() } })
  } catch (error) {
    console.error(error)
  }
}
