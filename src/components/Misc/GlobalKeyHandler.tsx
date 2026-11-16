import { useRef, useCallback } from 'react'
import keycode from 'keycode'

import { useStore, useInstance, getState } from '@zus/store'
import {
  clearStickersAction,
  deleteSelectedStickerAction,
  popUIPanelAction,
  redoStickersAction,
  setScoreboardOpenAction,
  setHudHiddenAction,
  setStickersPanelOpenAction,
  toggleMapCenterPickerAction,
  toggleShortcutsAction,
  toggleUIDrawingAction,
  undoStickersAction,
} from '@zus/actions'
import { DrawingTool } from '@constants/types'

import { useEventListener } from '@utils/hooks'

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  return (
    target.isContentEditable ||
    !!target.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')
  )
}

/**
 * This is just a null object added to Scene to make it easier for us to handle
 * any global key press behaviour
 */
export const GlobalKeyHandler = () => {
  const keysHeld = useRef(new Map())

  const settings = useStore(state => state.settings)
  const drawing = useStore(state => state.drawing)
  const drawingCanvas = useInstance(state => state.drawingCanvas)
  const activePanels = useStore(state => state.ui.activePanels)
  const mapCenterPickerActive = useInstance(state => state.mapCenterPickerActive)

  const canvasKeyDown = useCallback(
    (event: KeyboardEvent) => {
      try {
        if (isTextEntryTarget(event.target)) return

        // Shift + / on most layouts; read from the character so other layouts work too.
        const isQuestionMark = event.key === '?' || (event.shiftKey && event.code === 'Slash')
        if (isQuestionMark && !event.metaKey && !event.ctrlKey) {
          toggleShortcutsAction()
          return
        }

        switch (keycode(event)) {
          case 'esc':
            // A hidden HUD comes back first: whatever else Esc would close is hidden with it.
            if (getState().ui.hudHidden) {
              setHudHiddenAction(false)
            } else if (getState().ui.scoreboardOpen) {
              setScoreboardOpenAction(false)
            } else if (mapCenterPickerActive) {
              toggleMapCenterPickerAction(false)
            } else if (activePanels.length > 0) {
              popUIPanelAction()
            } else if (drawing.enabled) {
              // Also support dismissing the drawing UI by using Esc key
              toggleUIDrawingAction(false)
            } else if (drawing.stickersPanelOpen) {
              setStickersPanelOpenAction(false)
            }
            break

          case 'f':
            if (keysHeld.current.has('f')) return null
            keysHeld.current.set('f', true)
            popUIPanelAction()
            toggleUIDrawingAction()
            break

          case 'g':
            if (keysHeld.current.has('g')) return null
            keysHeld.current.set('g', true)
            setStickersPanelOpenAction(!drawing.stickersPanelOpen)
            break

          case 'c':
            if (drawing.enabled && drawing.tool === DrawingTool.BRUSH) {
              drawingCanvas?.clear()
            } else if (drawing.stickersPanelOpen) {
              clearStickersAction()
            }
            break

          case 'z':
            if (drawing.enabled && drawing.tool === DrawingTool.BRUSH) {
              drawingCanvas?.undo()
            } else if (event.shiftKey) {
              redoStickersAction()
            } else {
              undoStickersAction()
            }
            break

          case 'backspace':
          case 'delete':
            if (drawing.selectedStickerId) {
              deleteSelectedStickerAction()
            }
            break
        }
      } catch (error) {
        console.error(error)
      }
    },
    [activePanels, drawing, drawingCanvas, mapCenterPickerActive] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const canvasKeyUp = useCallback(
    (event: KeyboardEvent) => {
      const key = keycode(event)

      // The scoreboard is held open with Tab on the canvas; let go anywhere closes it.
      if (key === 'tab') setScoreboardOpenAction(false)

      if (isTextEntryTarget(event.target)) {
        const wasDrawingKeyHeld = keysHeld.current.has('f')

        if (key === 'f') {
          keysHeld.current.delete('f')
          if (wasDrawingKeyHeld && settings.drawing.activation === 'hold') {
            toggleUIDrawingAction(false)
          }
        }

        if (key === 'g') {
          keysHeld.current.delete('g')
        }

        return
      }

      switch (key) {
        case 'f':
          keysHeld.current.delete('f')
          if (settings.drawing.activation === 'hold') {
            toggleUIDrawingAction(false)
          }
          break

        case 'g':
          keysHeld.current.delete('g')
          break
      }
    },
    [settings]
  )

  useEventListener('keydown', canvasKeyDown, window)
  useEventListener('keyup', canvasKeyUp, window)
  // Tab held while the window loses focus never sends its keyup.
  useEventListener('blur', () => setScoreboardOpenAction(false), window)

  return null
}
