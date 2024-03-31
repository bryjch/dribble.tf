import { useRef, useState, useLayoutEffect, CSSProperties } from 'react'
import CanvasDraw from 'react-canvas-draw'
import { Icon, Popup } from 'semantic-ui-react'
import { motion } from 'framer-motion'

import { useStore, useInstance } from '@zus/store'

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

      <div className={`toolbar-container ${enabled ? 'enabled' : ''}`}>
        <motion.div
          className="toolbar"
          animate={enabled ? { opacity: 1, y: -25 } : { opacity: 0, y: TOOLBAR_HEIGHT }}
          transition={{ duration: 0.2 }}
          initial={false}
        >
          {/* Brush colors */}

          <div className="brush-colors">
            {BRUSH_COLOR_OPTIONS.map(({ color }) => (
              <div
                key={`drawing-brush-color-option-${color}`}
                className={`option ${brushColor === color ? 'active' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => setBrushColor(color)}
              />
            ))}
          </div>

          <div className="d-flex flex-row justify-content-between">
            {/* Undo action */}

            <div className="action" onClick={drawingCanvasRef.current?.undo}>
              <Popup
                inverted
                on="hover"
                position="top center"
                content={
                  <div>
                    Undo <kbd className="ml-2">Z</kbd>
                  </div>
                }
                trigger={
                  <Icon
                    name="undo"
                    className="mx-1"
                    style={{ padding: 6, width: 'auto', height: 'auto', cursor: 'pointer' }}
                  />
                }
                style={{ zIndex: 9999999999 }}
              />
            </div>

            {/* Brush radiuses */}

            <div className="brush-radiuses">
              {BRUSH_RADIUS_OPTIONS.map(({ label, size }) => (
                <div
                  key={`drawing-brush-radius-option-${size}`}
                  className={`option ${brushRadius === size ? 'active' : ''}`}
                  onClick={() => setBrushRadius(size)}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Undo action */}

            <div className="action" onClick={drawingCanvasRef.current?.clear}>
              <Popup
                inverted
                on="hover"
                position="top center"
                content={
                  <div>
                    Clear <kbd className="ml-2">C</kbd>
                  </div>
                }
                trigger={
                  <Icon
                    name="trash alternate outline"
                    style={{ padding: 6, width: 'auto', height: 'auto', cursor: 'pointer' }}
                  />
                }
                style={{ zIndex: 9999999999 }}
              />
            </div>
          </div>
        </motion.div>
      </div>

      <style jsx>{`
        .toolbar-container {
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          left: 0;
          display: flex;
          justify-content: center;
          align-items: flex-end;
          pointer-events: none;
          overflow: hidden;
          outline: 8px solid rgba(0, 0, 0, 0.6);
          transition: 0.3s ease all;

          &.enabled {
            outline-offset: -8px;
          }

          & > :global(.toolbar) {
            display: flex;
            flex-flow: column nowrap;
            justify-content: space-between;
            width: ${TOOLBAR_WIDTH};
            height: ${TOOLBAR_HEIGHT};
            color: #ffffff;
            background-color: rgba(50, 50, 50, 0.95);
            padding: 1rem 1rem 0.5rem 1rem;
            pointer-events: auto;
            z-index: 999; // render above CanvasDraw

            .brush-colors {
              display: flex;
              flex-flow: row nowrap;
              justify-content: center;
              align-items: center;

              .option {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                cursor: pointer;
                margin: 0 0.5rem;
                border: 3px solid transparent;
                transition: 0.3s ease all;

                &.active {
                  border: 3px solid #ffffff;
                  transform: scale(1.2);
                }
              }
            }

            .brush-radiuses {
              display: flex;
              flex-flow: row nowrap;
              align-items: center;
              justify-content: center;
              align-items: center;

              .option {
                padding: 0.25rem 0.5rem;
                font-size: 1.2rem;
                cursor: pointer;
                user-select: none;

                &.active {
                  font-weight: bold;
                  text-decoration: underline;
                }
              }
            }
          }
        }
      `}</style>
    </>
  )
}
