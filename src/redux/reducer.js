import localForage from 'localforage'
import { set, clone, clamp } from 'lodash'

const reducers = (state = {}, action) => {
  switch (action.type) {
    //
    // ─── SCENE ───────────────────────────────────────────────────────
    //

    case 'LOAD_SCENE_FROM_PARSER':
      return {
        ...state,
        // parser: action.payload.parser,
        scene: action.payload.scene,
        playback: action.payload.playback,
      }

    //
    // ─── PLAYBACK ────────────────────────────────────────────────────
    //

    case 'GO_TO_TICK':
      return {
        ...state,
        playback: { ...state.playback, tick: clamp(action.payload, 1, state.playback.maxTicks) },
      }

    case 'PLAYBACK_END_REACHED':
      return { ...state, playback: { ...state.playback, playing: false } }

    case 'TOGGLE_PLAYBACK':
      return { ...state, playback: { ...state.playback, playing: action.payload } }

    case 'CHANGE_PLAY_SPEED':
      return { ...state, playback: { ...state.playback, speed: action.payload } }

    //
    // ─── SETTINGS ────────────────────────────────────────────────────
    //

    case 'LOAD_SETTINGS':
      return { ...state, settings: action.settings }

    case 'UPDATE_SETTINGS_OPTION':
      let updatedSettings = set(clone(state.settings), action.option, action.value)

      localForage.setItem('settings', updatedSettings)

      return {
        ...state,
        settings: updatedSettings,
      }

    default:
      return state
  }
}

export default reducers
