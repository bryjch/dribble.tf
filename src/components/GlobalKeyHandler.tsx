import { useRef, useCallback } from 'react'
import keycode from 'keycode'

import { useStore, useInstance } from '@zus/store'
import { popUIPanelAction, toggleUIDrawingAction } from '@zus/actions'

import { useEventListener } from '@utils/hooks'

/**
 * This is just a null object added to Scene to make it easier for us to handle
 * any global key press behaviour
 */
export const GlobalKeyHandler = () => {
  const keysHeld = useRef(new Map())

  const settings: any = useStore((state: any) => state.settings)
  const drawingCanvas: any = useInstance((state: any) => state.drawingCanvas)
  const activePanels: any = useStore((state: any) => state.ui.activePanels)

  const canvasKeyDown = useCallback(
    (event: KeyboardEvent) => {
      try {
        switch (keycode(event)) {
          case 'esc':
            popUIPanelAction()
            if (activePanels.length === 0) {
              // Also support dismissing the drawing UI by using Esc key
              toggleUIDrawingAction(false)
            }
            break

          case 'f':
            if (keysHeld.current.has('f')) return null
            keysHeld.current.set('f', true)
            popUIPanelAction()
            toggleUIDrawingAction()
            break

          case 'c':
            if (drawingCanvas) drawingCanvas.clear()
            break

          case 'z':
            if (drawingCanvas) drawingCanvas.undo()
            break
        }
      } catch (error) {
        console.error(error)
      }
    },
    [drawingCanvas, activePanels] // eslint-disable-line react-hooks/exhaustive-deps
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
      }
    },
    [settings]
  )

  useEventListener('keydown', canvasKeyDown, window)
  useEventListener('keyup', canvasKeyUp, window)

  return null
}
