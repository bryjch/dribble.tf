import { get, merge, clamp } from 'lodash'
import localForage from 'localforage'
import * as THREE from 'three'

import { ActorDimensions } from '@components/Scene/Actor'
import { PLAYBACK_SPEED_OPTIONS } from '@components/UI/PlaybackPanel'

import { objCoordsToVector3 } from '@utils/geometry'

//
// ─── SCENE ──────────────────────────────────────────────────────────────────────
//

export const loadSceneFromParserAction = parser => async dispatch => {
  try {
    await dispatch({
      type: 'LOAD_SCENE_FROM_PARSER',
      payload: {
        scene: {
          players: parser.entityPlayerMap,
          map: parser.header.map,
          bounds: {
            min: objCoordsToVector3(parser.world.boundaryMin),
            max: objCoordsToVector3(parser.world.boundaryMax),
            center: new THREE.Vector3(
              0.5 * (parser.world.boundaryMax.x - parser.world.boundaryMin.x),
              0.5 * (parser.world.boundaryMax.y - parser.world.boundaryMin.y),
              -parser.world.boundaryMin.z - 0.5 * ActorDimensions.z
            ),
          },
          controls: {
            mode: 'free',
            focusedObject: null,
          },
        },
        playback: {
          playing: true,
          speed: 1,
          tick: 1,
          maxTicks: parser.ticks - 1,
          intervalPerTick: parser.intervalPerTick,
        },
      },
    })
  } catch (error) {
    console.error(error)
  }
}

export const changeControlsModeAction = (mode, options = {}) => async dispatch => {
  try {
    if (!['free', 'follow', 'pov'].includes(mode)) return null

    const { focusedObject } = options

    const payload = { mode: mode }
    if (focusedObject !== undefined) payload.focusedObject = focusedObject

    await dispatch({ type: 'CHANGE_CONTROLS_MODE', payload: payload })
  } catch (error) {
    console.error(error)
  }
}

//
// ─── PLAYBACK ───────────────────────────────────────────────────────────────────
//

export const goToTickAction = tick => async (dispatch, getState) => {
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

export const playbackJumpAction = direction => async (dispatch, getState) => {
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

export const togglePlaybackAction = (playing = undefined) => async (dispatch, getState) => {
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

export const changePlaySpeedAction = speed => async (dispatch, getState) => {
  try {
    // Provide the option to pass strings "faster" or "slower" as the {speed} param instead
    // which will simply cycle the options as defined in PlaybackPanel
    const currentSpeed = getState().playback.speed
    const currentIndex = PLAYBACK_SPEED_OPTIONS.findIndex(({ value }) => value === currentSpeed)
    const prevIndex = clamp(currentIndex - 1, 0, PLAYBACK_SPEED_OPTIONS.length - 1)
    const nextIndex = clamp(currentIndex + 1, 0, PLAYBACK_SPEED_OPTIONS.length - 1)

    switch (speed) {
      case 'faster':
        dispatch({ type: 'CHANGE_PLAY_SPEED', payload: PLAYBACK_SPEED_OPTIONS[prevIndex].value })
        break

      case 'slower':
        dispatch({ type: 'CHANGE_PLAY_SPEED', payload: PLAYBACK_SPEED_OPTIONS[nextIndex].value })
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

export const loadSettingsAction = () => async (dispatch, getState) => {
  try {
    const defaultSettings = getState().settings
    const settings = await localForage.getItem('settings')

    await dispatch({ type: 'LOAD_SETTINGS', settings: merge(defaultSettings, settings) })
  } catch (error) {
    console.error(error)
  }
}

export const updateSettingsOptionAction = (option, value) => async dispatch => {
  try {
    await dispatch({ type: 'UPDATE_SETTINGS_OPTION', option, value })
  } catch (error) {
    console.error(error)
  }
}

// Provide an action to easily toggle boolean setting options
export const toggleSettingsOptionAction = option => async (dispatch, getState) => {
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

export const toggleUIPanelAction = (name, active = undefined) => async (dispatch, getState) => {
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

export const popUIPanelAction = name => async dispatch => {
  try {
    await dispatch({ type: 'POP_UI_PANEL', payload: { name: name } })
  } catch (error) {
    console.error(error)
  }
}
