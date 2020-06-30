import { merge } from 'lodash'
import localForage from 'localforage'

import { ActorDimensions } from '@components/Scene/Actor'

//
// ─── SCENE ──────────────────────────────────────────────────────────────────────
//

export const loadSceneFromParserAction = parser => async dispatch => {
  try {
    await dispatch({
      type: 'LOAD_SCENE_FROM_PARSER',
      payload: {
        scene: {
          map: parser.header.map,
          bounds: {
            min: parser.world.boundaryMin,
            max: parser.world.boundaryMax,
            center: {
              x: 0.5 * (parser.world.boundaryMax.x - parser.world.boundaryMin.x),
              y: 0.5 * (parser.world.boundaryMax.y - parser.world.boundaryMin.y),
              z: -parser.world.boundaryMin.z - 0.5 * ActorDimensions.z,
            },
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

export const togglePlaybackAction = (playing = undefined) => async (dispatch, getState) => {
  try {
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

export const changePlaySpeedAction = speed => async dispatch => {
  try {
    await dispatch({ type: 'CHANGE_PLAY_SPEED', payload: speed })
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
