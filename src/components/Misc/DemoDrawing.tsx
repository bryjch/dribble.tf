import { useRef, useState, useLayoutEffect, CSSProperties } from 'react'
import CanvasDraw from 'react-canvas-draw'
import { motion } from 'framer-motion'
import * as Tooltip from '@radix-ui/react-tooltip'
import { ReloadIcon, TrashIcon } from '@radix-ui/react-icons'

import { useStore, useInstance } from '@zus/store'
import { cn } from '@utils/styling'

//
// ─── CONSTANTS ──────────────────────────────────────────────────────────────────
//

export const TOOLBAR_WIDTH = '450px'
export const TOOLBAR_HEIGHT = '100px'

export const BRUSH_COLOR_OPTIONS = [
  { color: '#111111' },
  { color: '#ffffff' },
  { color: '#ff0202' },
  { color: '#0374ff' },
  { color: '#f800d7' },
  { color: '#f8a300' },
  { color: '#40db14' },
]
export const BRUSH_RADIUS_OPTIONS = [
  { label: 'Small', size: 2 },
  { label: 'Medium', size: 4 },
  { label: 'Large', size: 9 },
]

//
// ─── COMPONENT ──────────────────────────────────────────────────────────────────
//

export const DemoDrawing = () => {
  const drawingCanvasRef = useRef<CanvasDraw | null>(null)
  const setDrawingCanvas = useInstance(state => state.setDrawingCanvas)
  const enabled = useStore(state => state.drawing.enabled)

  const [brushColor, setBrushColor] = useState<string>(BRUSH_COLOR_OPTIONS[0].color)
  const [brushRadius, setBrushRadius] = useState<number>(BRUSH_RADIUS_OPTIONS[1].size)

  const drawingCanvasStyle: CSSProperties = {
    position: 'absolute',
    width: '100%',
    height: '100%',
    background: 'none',
    pointerEvents: enabled ? 'auto' : 'none',
    cursor: enabled ? 'crosshair' : 'auto',
  }

  // Keep a reference to our drawing canvas in "Instance Store" because we
  // need to be able to call its methods from various places (clear, undo etc.)
  useLayoutEffect(() => {
    if (drawingCanvasRef.current) {
      setDrawingCanvas(drawingCanvasRef.current)
    }
  }, [drawingCanvasRef, setDrawingCanvas])

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
          className="pointer-events-auto flex w-[450px] flex-col justify-between rounded-2xl bg-[rgba(50,50,50,0.95)] px-6 pb-4 pt-6 text-white"
          animate={enabled ? { opacity: 1, y: '-2rem' } : { opacity: 0, y: 100 }}
          transition={{ duration: 0.2 }}
          initial={false}
        >
          {/* Brush colors */}

          <div className="flex items-center justify-center">
            {BRUSH_COLOR_OPTIONS.map(({ color }) => (
              <div
                key={`drawing-brush-color-option-${color}`}
                className={cn(
                  'mx-2 h-10 w-10 cursor-pointer rounded-full [border:3px_solid_transparent] [transition:0.3s_ease_all]',
                  brushColor === color && 'scale-125 [border:3px_solid_white]'
                )}
                style={{ backgroundColor: color }}
                onClick={() => setBrushColor(color)}
              />
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between">
            {/* Undo action */}

            <Tooltip.Provider delayDuration={0}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <div
                    className="inline-block cursor-pointer"
                    onClick={drawingCanvasRef.current?.undo}
                  >
                    <ReloadIcon className="scale-x-[-1]" />
                  </div>
                </Tooltip.Trigger>

                <Tooltip.Portal>
                  <Tooltip.Content sideOffset={5}>
                    <div className="relative rounded-lg bg-pp-panel/90 px-4 py-3">
                      Undo <kbd className="ml-2">Z</kbd>
                    </div>
                    <Tooltip.Arrow />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>

            {/* Brush radiuses */}

            <div className="flex items-center justify-center">
              {BRUSH_RADIUS_OPTIONS.map(({ label, size }) => (
                <div
                  key={`drawing-brush-radius-option-${size}`}
                  className={cn(
                    'cursor-pointer select-none px-2 py-1 text-lg',
                    brushRadius === size && 'font-bold underline',
                    `option ${brushRadius === size ? 'active' : ''}`
                  )}
                  onClick={() => setBrushRadius(size)}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Clear action */}

            <Tooltip.Provider delayDuration={0}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <div
                    className="inline-block cursor-pointer"
                    onClick={drawingCanvasRef.current?.clear}
                  >
                    <TrashIcon className="h-5 w-5" />
                  </div>
                </Tooltip.Trigger>

                <Tooltip.Portal>
                  <Tooltip.Content sideOffset={5}>
                    <div className="relative rounded-lg bg-pp-panel/90 px-4 py-3">
                      Clear <kbd className="ml-2">C</kbd>
                    </div>

                    <Tooltip.Arrow />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          </div>
        </motion.div>
      </div>
    </>
  )
}
