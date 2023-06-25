import localForage from 'localforage'
import { set, clone, clamp, uniq, without } from 'lodash'

import { StoreState, StoreAction } from './store'

const reducers = (state: StoreState, action: StoreAction) => {
  switch (action.type) {
    //
    // ─── PARSER ──────────────────────────────────────────────────────
    //

    case 'PARSE_DEMO_INIT':
      return {
        ...state,
        parser: { ...state.parser, status: 'loading', progress: 0, error: null },
      }

    case 'PARSE_DEMO_PROGRESS':
      return {
        ...state,
        parser: { ...state.parser, progress: action.payload },
      }

    case 'PARSE_DEMO_SUCCESS':
      return {
        ...state,
        parser: { ...state.parser, status: 'done', progress: 100 },
      }

    case 'PARSE_DEMO_ERROR':
      return {
        ...state,
        parser: { ...state.parser, status: 'done', error: action.payload },
      }

    //
    // ─── SCENE ───────────────────────────────────────────────────────
    //

    case 'LOAD_SCENE_FROM_PARSER':
      return {
        ...state,
        scene: action.payload.scene,
        playback: action.payload.playback,
      }

    case 'CHANGE_CONTROLS_MODE':
      return {
        ...state,
        scene: {
          ...state.scene,
          controls: { ...state.scene.controls, mode: action.payload },
        },
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
      return { ...state, settings: action.payload.settings }

    case 'UPDATE_SETTINGS_OPTION':
      let updatedSettings = set(clone(state.settings), action.payload.option, action.payload.value)

      localForage.setItem('settings', updatedSettings)

      return {
        ...state,
        settings: updatedSettings,
      }

    //
    // ─── UI ──────────────────────────────────────────────────────────
    //

    case 'SET_UI_PANEL_ACTIVE':
      return {
        ...state,
        ui: { ...state.ui, activePanels: uniq([...state.ui.activePanels, action.payload.name]) },
      }

    case 'SET_UI_PANEL_INACTIVE':
      return {
        ...state,
        ui: { ...state.ui, activePanels: without(state.ui.activePanels, action.payload.name) },
      }

    case 'POP_UI_PANEL':
      return {
        ...state,
        ui: {
          ...state.ui,
          activePanels: state.ui.activePanels.slice(0, state.ui.activePanels.length - 1),
        },
      }

    case 'SET_DRAWING_ACTIVE':
      return {
        ...state,
        drawing: { ...state.drawing, enabled: true },
      }

    case 'SET_DRAWING_INACTIVE':
      return {
        ...state,
        drawing: { ...state.drawing, enabled: false },
      }

    default:
      return state
  }
}

export default reducers
