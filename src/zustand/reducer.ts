import localForage from 'localforage'
import { set, clone, clamp, uniq, without, sortedUniq, sortBy } from 'lodash'

import { StoreState, StoreAction, useInstance } from './store'
import { StickerAnnotation } from '@constants/types'
import { redoHistoryState, pushHistoryState, undoHistoryState } from '@utils/history'
import { createInitialStickerDragState } from './drawing'

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
        drawing: resetDrawingStickers(state.drawing),
        bookmarks: [],
      }

    case 'CHANGE_CONTROLS_MODE':
      /**
       * There is a severe problem with @react-three/postprocessing Selection and Select
       * components that cause our custom Controls to never dispose properly when switching
       * modes. Even though they are no longer on the scene, they never seem to "unmount"
       *
       * To workaround this, we manually call dispose() on these controls before switching
       * to the next one. Not sure if the issue is with our custom controls or the postprocessing
       * implementation of Selection/Select - but those components seem straightforward, so
       * really not sure where the issue lies.
       */
      const currentControls = (useInstance.getState().threeScene as any).controls
      if (currentControls && action.payload !== currentControls.name) {
        currentControls.dispose?.()
      }

      return {
        ...state,
        scene: {
          ...state.scene,
          controls: { ...state.scene.controls, mode: action.payload },
        },
      }

    case 'SET_SCENE_RTS_CENTER':
      return {
        ...state,
        scene: {
          ...state.scene,
          bounds: {
            ...state.scene.bounds,
            defaultRtsCenter: action.payload.clone(),
          },
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

    case 'FORCE_SHOW_PANEL':
      return { ...state, playback: { ...state.playback, forceShowPanel: action.payload } }

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
        drawing: {
          ...state.drawing,
          enabled: false,
          stickerDrag: createInitialStickerDragState(),
        },
      }

    case 'SET_DRAWING_TOOL':
      return {
        ...state,
        drawing: {
          ...state.drawing,
          tool: action.payload,
          stickerDrag: createInitialStickerDragState(),
        },
      }

    case 'SET_DRAWING_BRUSH_COLOR':
      return {
        ...state,
        drawing: { ...state.drawing, brushColor: action.payload },
      }

    case 'SET_DRAWING_BRUSH_RADIUS':
      return {
        ...state,
        drawing: { ...state.drawing, brushRadius: action.payload },
      }

    case 'SET_STICKERS_PANEL_OPEN':
      return {
        ...state,
        drawing: {
          ...state.drawing,
          stickersPanelOpen: action.payload,
        },
      }

    case 'SET_SELECTED_STICKER':
      return {
        ...state,
        drawing: {
          ...state.drawing,
          selectedStickerId: action.payload,
        },
      }

    case 'START_STICKER_DRAG':
      return {
        ...state,
        drawing: {
          ...state.drawing,
          selectedStickerId:
            action.payload.kind === 'create'
              ? undefined
              : action.payload.stickerId ?? state.drawing.selectedStickerId,
          stickerDrag: {
            active: true,
            kind: action.payload.kind,
            stickerId: action.payload.stickerId,
            sticker: action.payload.sticker,
            screenX: action.payload.screenX,
            screenY: action.payload.screenY,
          },
        },
      }

    case 'CANCEL_STICKER_DRAG':
      return {
        ...state,
        drawing: {
          ...state.drawing,
          stickerDrag: createInitialStickerDragState(),
        },
      }

    case 'ADD_STICKER': {
      const nextStickers = [...state.drawing.stickerHistory.present, action.payload]

      return {
        ...state,
        drawing: {
          ...state.drawing,
          selectedStickerId: action.payload.id,
          stickerDrag: createInitialStickerDragState(),
          stickerHistory: pushHistoryState(state.drawing.stickerHistory, nextStickers),
        },
      }
    }

    case 'MOVE_STICKER': {
      let changed = false
      const nextStickers = state.drawing.stickerHistory.present.map(sticker => {
        if (sticker.id !== action.payload.id) return sticker
        if (sameStickerPosition(sticker.position, action.payload.position)) return sticker
        changed = true
        return {
          ...sticker,
          position: action.payload.position,
        }
      })

      if (!changed) {
        return {
          ...state,
          drawing: {
            ...state.drawing,
            stickerDrag: createInitialStickerDragState(),
          },
        }
      }

      return {
        ...state,
        drawing: {
          ...state.drawing,
          selectedStickerId: action.payload.id,
          stickerDrag: createInitialStickerDragState(),
          stickerHistory: pushHistoryState(state.drawing.stickerHistory, nextStickers),
        },
      }
    }

    case 'DELETE_STICKER': {
      const nextStickers = state.drawing.stickerHistory.present.filter(
        sticker => sticker.id !== action.payload
      )

      if (nextStickers.length === state.drawing.stickerHistory.present.length) return state

      return {
        ...state,
        drawing: {
          ...state.drawing,
          selectedStickerId:
            state.drawing.selectedStickerId === action.payload
              ? undefined
              : state.drawing.selectedStickerId,
          stickerHistory: pushHistoryState(state.drawing.stickerHistory, nextStickers),
        },
      }
    }

    case 'CLEAR_STICKERS':
      if (state.drawing.stickerHistory.present.length === 0) return state

      return {
        ...state,
        drawing: {
          ...state.drawing,
          selectedStickerId: undefined,
          stickerHistory: pushHistoryState(state.drawing.stickerHistory, []),
        },
      }

    case 'UNDO_STICKERS': {
      const stickerHistory = undoHistoryState(state.drawing.stickerHistory)

      return {
        ...state,
        drawing: {
          ...state.drawing,
          stickerHistory,
          selectedStickerId: resolveSelectedStickerId(
            stickerHistory.present,
            state.drawing.selectedStickerId
          ),
        },
      }
    }

    case 'REDO_STICKERS': {
      const stickerHistory = redoHistoryState(state.drawing.stickerHistory)

      return {
        ...state,
        drawing: {
          ...state.drawing,
          stickerHistory,
          selectedStickerId: resolveSelectedStickerId(
            stickerHistory.present,
            state.drawing.selectedStickerId
          ),
        },
      }
    }

    //
    // ─── EVENT HISTORY ───────────────────────────────────────────────
    //

    case 'ADD_EVENT_HISTORY':
      return {
        ...state,
        eventHistory: [action.payload, ...state.eventHistory].slice(0, 10),
      }

    //
    // ─── DOWNLOADS ───────────────────────────────────────────────────
    //

    case 'ADD_DOWNLOAD': {
      const downloads = new Map(state.downloads)
      downloads.set(action.payload.url, action.payload)
      return { ...state, downloads }
    }

    case 'REMOVE_DOWNLOAD': {
      const downloads = new Map(state.downloads)
      downloads.delete(action.payload.url)
      return { ...state, downloads }
    }

    case 'UPDATE_DOWNLOAD': {
      const downloads = new Map(state.downloads)
      const download = downloads.get(action.payload.url)

      if (download) {
        downloads.set(action.payload.url, { ...download, ...action.payload })
      }

      return { ...state, downloads }
    }

    //
    // ─── BOOKMARKS ────────────────────────────────────────────────────
    //

    case 'ADD_BOOKMARK':
      return {
        ...state,
        bookmarks: sortedUniq(sortBy([...state.bookmarks, action.payload])),
      }

    case 'REMOVE_BOOKMARK':
      return {
        ...state,
        bookmarks: state.bookmarks.filter(t => t !== action.payload),
      }

    case 'CLEAR_BOOKMARKS':
      return {
        ...state,
        bookmarks: [],
      }

    //
    // ─── DEFAULT ─────────────────────────────────────────────────────
    //

    default:
      return state
  }
}

function resetDrawingStickers(drawing: StoreState['drawing']): StoreState['drawing'] {
  return {
    ...drawing,
    stickersPanelOpen: false,
    selectedStickerId: undefined,
    stickerHistory: {
      past: [],
      present: [],
      future: [],
    },
    stickerDrag: createInitialStickerDragState(),
  }
}

function sameStickerPosition(
  left: [number, number, number],
  right: [number, number, number]
): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2]
}

function resolveSelectedStickerId(
  stickers: StickerAnnotation[],
  selectedStickerId?: string
): string | undefined {
  if (!selectedStickerId) return undefined
  return stickers.some(sticker => sticker.id === selectedStickerId) ? selectedStickerId : undefined
}

export default reducers
