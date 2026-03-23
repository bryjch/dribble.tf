import { useRef, useLayoutEffect, CSSProperties, useEffect } from 'react'
import CanvasDraw from 'react-canvas-draw'
import { motion } from 'framer-motion'

import { FaTrashIcon, FaUndoIcon } from './Icons'

import { useStore, useInstance } from '@zus/store'
import {
  setDrawingBrushColorAction,
  setDrawingBrushRadiusAction,
  setDrawingToolAction,
} from '@zus/actions'
import { DrawingTool } from '@constants/types'
import { BRUSH_COLOR_OPTIONS, BRUSH_RADIUS_OPTIONS } from '@constants/drawing'
import { cn } from '@utils/styling'

export const TOOLBAR_WIDTH = '450px'
export const TOOLBAR_HEIGHT = '100px'

export const DemoDrawing = () => {
  const drawingCanvasRef = useRef<CanvasDraw | null>(null)
  const setDrawingCanvas = useInstance(state => state.setDrawingCanvas)
  const enabled = useStore(state => state.drawing.enabled)
  const drawingTool = useStore(state => state.drawing.tool)
  const brushColor = useStore(state => state.drawing.brushColor)
  const brushRadius = useStore(state => state.drawing.brushRadius)

  useEffect(() => {
    if (drawingTool !== DrawingTool.BRUSH) {
      setDrawingToolAction(DrawingTool.BRUSH)
    }
  }, [drawingTool])

  const drawingCanvasStyle: CSSProperties = {
    position: 'absolute',
    width: '100%',
    height: '100%',
    background: 'none',
    pointerEvents: enabled ? 'auto' : 'none',
    cursor: enabled ? 'crosshair' : 'auto',
  }

  useLayoutEffect(() => {
    if (drawingCanvasRef.current) {
      setDrawingCanvas(drawingCanvasRef.current)
    }
  }, [drawingCanvasRef, setDrawingCanvas])

  const actionButtonClass = () =>
    'inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 transition-all hover:scale-110 hover:bg-white/20'

  return (
    <>
      <CanvasDraw
        ref={drawingCanvasRef}
        style={drawingCanvasStyle}
        brushColor={brushColor}
        brushRadius={brushRadius}
        lazyRadius={6}
        hideInterface
        hideGrid
      />

      <div
        className={cn(
          'pointer-events-none absolute inset-0 flex items-end justify-center overflow-hidden [outline:8px_solid_rgba(0,0,0,0.6)] [transition:0.3s_ease_all]',
          enabled && '-outline-offset-8'
        )}
      >
        <motion.div
          className="pointer-events-auto flex w-[min(420px,calc(100vw-2rem))] flex-col gap-4 rounded-2xl bg-[rgba(50,50,50,0.95)] px-6 pb-4 pt-5 text-white"
          animate={enabled ? { opacity: 1, y: '-2rem' } : { opacity: 0, y: 100 }}
          transition={{ duration: 0.2 }}
          initial={false}
        >
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">Brush</div>

          <div className="flex items-center justify-center">
            {BRUSH_COLOR_OPTIONS.map(({ color }) => (
              <div
                key={`drawing-brush-color-option-${color}`}
                className={cn(
                  'mx-2 h-10 w-10 cursor-pointer rounded-full hover:scale-125',
                  '[border:3px_solid_transparent] [transition:0.3s_ease_all]',
                  brushColor === color && 'scale-125 [border:3px_solid_white]'
                )}
                style={{ backgroundColor: color }}
                onClick={() => setDrawingBrushColorAction(color)}
              />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button
              className={actionButtonClass()}
              onClick={() => drawingCanvasRef.current?.undo()}
              aria-label="Undo brush stroke"
            >
              <FaUndoIcon />
            </button>

            <div className="flex items-center justify-center">
              {BRUSH_RADIUS_OPTIONS.map(({ label, size }) => (
                <div
                  key={`drawing-brush-radius-option-${size}`}
                  className={cn(
                    'cursor-pointer select-none px-2 py-1 text-lg hover:underline',
                    brushRadius === size && 'font-bold underline',
                    `option ${brushRadius === size ? 'active' : ''}`
                  )}
                  onClick={() => setDrawingBrushRadiusAction(size)}
                >
                  {label}
                </div>
              ))}
            </div>

            <button
              className={actionButtonClass()}
              onClick={() => drawingCanvasRef.current?.clear()}
              aria-label="Clear brush strokes"
            >
              <FaTrashIcon className="h-5 w-5" />
            </button>
          </div>
        </motion.div>
      </div>
    </>
  )
}
