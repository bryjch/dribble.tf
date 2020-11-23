import { get, merge, clamp } from 'lodash'
import localForage from 'localforage'
import * as THREE from 'three'

import { ActorDimensions } from '@components/Scene/Actor'
import { AsyncParser } from '@components/Analyse/Data/AsyncParser'
import { PLAYBACK_SPEED_OPTIONS } from '@components/UI/PlaybackPanel'

import { getSceneActors } from '@utils/scene'
import { objCoordsToVector3 } from '@utils/geometry'

import { dispatch, getState, useInstance } from './store'

//
// ─── PARSER ─────────────────────────────────────────────────────────────────────
//

export const parseDemoAction = async fileBuffer => {
  try {
    await dispatch({ type: 'PARSE_DEMO_INIT' })

    const parsedDemo = new AsyncParser(fileBuffer, async progress => {
      await dispatch({ type: 'PARSE_DEMO_PROGRESS', payload: progress })
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

    await dispatch({ type: 'PARSE_DEMO_SUCCESS' })

    await dispatch(loadSceneFromDemoAction(parsedDemo))

    return parsedDemo
  } catch (error) {
    await dispatch({ type: 'PARSE_DEMO_ERROR', payload: error })
    throw error
  }
}

//
// ─── SCENE ──────────────────────────────────────────────────────────────────────
//

export const loadSceneFromDemoAction = async parsedDemo => {
  try {
    await dispatch(toggleUIPanelAction('AboutPanel', false))

    // Remember to update the non-redux instances!
    await useInstance.getState().setParsedDemo(parsedDemo)
    await useInstance.getState().setFocusedObject(null)

    await dispatch({
      type: 'LOAD_SCENE_FROM_PARSER',
      payload: {
        scene: {
          players: parsedDemo.entityPlayerMap,
          map: parsedDemo.header.map,
          bounds: {
            min: objCoordsToVector3(parsedDemo.world.boundaryMin),
            max: objCoordsToVector3(parsedDemo.world.boundaryMax),
            center: new THREE.Vector3(
              0.5 * (parsedDemo.world.boundaryMax.x - parsedDemo.world.boundaryMin.x),
              0.5 * (parsedDemo.world.boundaryMax.y - parsedDemo.world.boundaryMin.y),
              -parsedDemo.world.boundaryMin.z - 0.5 * ActorDimensions.z
            ),
          },
          controls: {
            mode: 'free',
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

export const changeControlsModeAction = async (mode, options = {}) => {
  try {
    if (!['free', 'follow', 'pov'].includes(mode)) return null

    if (mode === 'pov') {
      const actors = getSceneActors(useInstance.getState().threeScene)
      const focusedObject = useInstance.getState().focusedObject

      let currentIndex = focusedObject ? actors.findIndex(({ id }) => id === focusedObject.id) : -1
      let nextIndex = (currentIndex + 1) % actors.length
      let nextActor = actors[nextIndex]

      if (nextActor) {
        await dispatch(jumpToPlayerPOVCamera(nextActor.userData.entityId))
      } else {
        await dispatch(jumpToFreeCamera())
      }
    }

    if (mode === 'free') {
      await dispatch(jumpToFreeCamera())
    }
  } catch (error) {
    console.error(error)
  }
}

export const jumpToPlayerPOVCamera = async entityId => {
  try {
    const actors = getSceneActors(useInstance.getState().threeScene)

    if (actors.length === 0) return null

    const actor = actors.find(({ userData }) => userData.entityId === entityId)

    if (!actor) return null

    await useInstance.getState().setFocusedObject(actor)

    await dispatch({ type: 'CHANGE_CONTROLS_MODE', payload: 'pov' })
  } catch (error) {
    console.error(error)
  }
}

export const jumpToFreeCamera = async (options = {}) => {
  try {
    await dispatch({ type: 'CHANGE_CONTROLS_MODE', payload: 'free' })

    await useInstance.getState().setFocusedObject(null)
  } catch (error) {
    console.error(error)
  }
}

//
// ─── PLAYBACK ───────────────────────────────────────────────────────────────────
//

export const goToTickAction = async tick => {
  try {
    const maxTicks = getState().playback.maxTicks

    await dispatch({ type: 'GO_TO_TICK', payload: tick })

    // Automatically pause playback once it has reached the last tick
    if (tick >= maxTicks) {
      await dispatch({ type: 'TOGGLE_PLAYBACK', payload: false })
    }
  } catch (error) {
    console.error(error)
  }
}

export const playbackJumpAction = async direction => {
  try {
    const PLAYBACK_JUMP_TICK_INCREMENT = 50
    const tick = getState().playback.tick

    switch (direction) {
      case 'seekBackward':
        dispatch(goToTickAction(tick - PLAYBACK_JUMP_TICK_INCREMENT))
        break

      case 'seekForward':
        dispatch(goToTickAction(tick + PLAYBACK_JUMP_TICK_INCREMENT))
        break

      case 'previousTick':
        dispatch(goToTickAction(tick - 1))
        break

      case 'nextTick':
        dispatch(goToTickAction(tick + 1))
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
      await dispatch({ type: 'GO_TO_TICK', payload: 1 })
    }

    await dispatch({ type: 'TOGGLE_PLAYBACK', payload: isPlaying })
  } catch (error) {
    console.error(error)
  }
}

export const changePlaySpeedAction = async speed => {
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
        break

      case 'slower':
        dispatch({
          type: 'CHANGE_PLAY_SPEED',
          payload: PLAYBACK_SPEED_OPTIONS[nextIndex].value,
        })
        break

      default:
        dispatch({ type: 'CHANGE_PLAY_SPEED', payload: speed })
        break
    }
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

    await dispatch({ type: 'LOAD_SETTINGS', settings: merge(defaultSettings, settings) })
  } catch (error) {
    console.error(error)
  }
}

export const updateSettingsOptionAction = async (option, value) => {
  try {
    await dispatch({ type: 'UPDATE_SETTINGS_OPTION', option, value })
  } catch (error) {
    console.error(error)
  }
}

// Provide an action to easily toggle boolean setting options
export const toggleSettingsOptionAction = async option => {
  try {
    const settings = getState().settings
    const previousValue = get(settings, option)

    if (previousValue === undefined) return null

    await dispatch({ type: 'UPDATE_SETTINGS_OPTION', option, value: !previousValue })
  } catch (error) {
    console.error(error)
  }
}

//
// ─── UI ─────────────────────────────────────────────────────────────────────────
//

export const toggleUIPanelAction = async (name, active = undefined) => {
  try {
    // Use {active} value if provided - otherwise use the inverse of current value
    const isActive = active !== undefined ? active : !getState().ui.activePanels.includes(name)

    if (isActive) {
      await dispatch({ type: 'SET_UI_PANEL_ACTIVE', payload: { name: name } })
    } else {
      await dispatch({ type: 'SET_UI_PANEL_INACTIVE', payload: { name: name } })
    }
  } catch (error) {
    console.error(error)
  }
}

export const popUIPanelAction = async name => {
  try {
    await dispatch({ type: 'POP_UI_PANEL', payload: { name: name } })
  } catch (error) {
    console.error(error)
  }
}
