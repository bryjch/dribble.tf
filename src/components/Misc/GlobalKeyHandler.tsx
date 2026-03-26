import { useRef, useCallback } from 'react'
import keycode from 'keycode'

import { useStore, useInstance } from '@zus/store'
import {
  clearStickersAction,
  deleteSelectedStickerAction,
  popUIPanelAction,
  redoStickersAction,
  setStickersPanelOpenAction,
  toggleMapCenterPickerAction,
  toggleUIDrawingAction,
  undoStickersAction,
} from '@zus/actions'
import { DrawingTool } from '@constants/types'

import { useEventListener } from '@utils/hooks'

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
        switch (keycode(event)) {
          case 'esc':
            if (mapCenterPickerActive) {
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
            } else if (drawing.stickersPanelOpen && event.shiftKey) {
              redoStickersAction()
            } else if (drawing.stickersPanelOpen) {
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
      switch (keycode(event)) {
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

  return null
}
