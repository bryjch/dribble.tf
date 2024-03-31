import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'

import { GlobalKeyHandler } from '@components/Misc/GlobalKeyHandler'
import { DemoDropzone } from '@components/Misc/DemoDropzone'
import { DemoDrawing } from '@components/Misc/DemoDrawing'
import { DemoViewer } from '@components/DemoViewer'

import { parseDemoAction } from '@zus/actions'
import { useStore, useInstance } from '@zus/store'
import { usePointerLock } from '@utils/hooks'

const ViewerPage = () => {
  const parser = useStore(state => state.parser)
  const parsedDemo = useInstance(state => state.parsedDemo)
  const controlsMode = useStore(state => state.scene.controls.mode)

  const { isPointerLocked } = usePointerLock()

  //
  // ─── LIFECYCLE ──────────────────────────────────────────────────────────────────
  //

  // Little timer to force spectator tip to always display for at least a bit
  // Would be cool to show a similar tip panel for all camera modes!
  // TODO: maybe this can be a hook?
  const [forceShow, setForceShow] = useState(false)

  useEffect(() => {
    let timeout: NodeJS.Timeout
    if (controlsMode === 'spectator') {
      setForceShow(true)
      timeout = setTimeout(() => setForceShow(false), 2000)
    }
    return () => timeout && clearTimeout(timeout)
  }, [controlsMode, isPointerLocked])

  const showSpectatorFlyTip = useMemo(() => {
    return controlsMode === 'spectator' && (forceShow || !isPointerLocked)
  }, [forceShow, controlsMode, isPointerLocked])

  //
  // ─── METHODS ────────────────────────────────────────────────────────────────────
  //

  const onDemoDropped = (files: File[]) => {
    const demoFile: File = files[0]

    const reader = new FileReader()

    reader.readAsArrayBuffer(demoFile)

    reader.onload = function () {
      const fileBuffer = reader.result as ArrayBuffer
      parseDemoAction(fileBuffer)
    }
  }

  //
  // ─── RENDER ─────────────────────────────────────────────────────────────────────
  //

  return (
    <div>
      <GlobalKeyHandler />

      <DemoViewer demo={parsedDemo} />

      <div className="ui-layer loading-demo">
        <motion.div
          className="panel"
          animate={parser.status === 'loading' ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
          transition={{ duration: 0.2 }}
          initial={false}
        >
          <div>Parsing demo... {parser.progress}%</div>
        </motion.div>
      </div>

      <div className="ui-layer spectator-fly-tip">
        <motion.div
          className="panel"
          animate={showSpectatorFlyTip ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
          transition={{ duration: 0.2 }}
          initial={false}
        >
          <div className="d-flex flex-row mb-1">
            <strong>Spectator Camera</strong>
            <div className="flex-fill" />
            <div>
              {isPointerLocked ? (
                <motion.div
                  key={`on`}
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  style={{ color: '#4dd241' }}
                >
                  ON
                </motion.div>
              ) : (
                <motion.div
                  key={`idle`}
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  style={{ color: '#fa9e21' }}
                >
                  IDLE
                </motion.div>
              )}
            </div>
          </div>

          {!isPointerLocked && (
            <motion.div>
              <div className="d-flex flex-row">
                <span>Activate</span>
                <div className="flex-fill" />
                <kbd>LMB</kbd>
              </div>
            </motion.div>
          )}

          {isPointerLocked && (
            <motion.div>
              <div className="d-flex flex-row mb-1">
                <span>Deactivate</span>
                <div className="flex-fill" />
                <kbd>RMB</kbd>
              </div>

              <div className="d-flex flex-row mb-1">
                <span>Movement</span>
                <div className="flex-fill" />
                <kbd className="ml-1">W</kbd>
                <kbd className="ml-1">A</kbd>
                <kbd className="ml-1">S</kbd>
                <kbd className="ml-1">D</kbd>
              </div>

              <div className="d-flex flex-row mb-1">
                <span>Elevation</span>
                <div className="flex-fill" />

                <kbd className="ml-1">E</kbd>
                <kbd className="ml-1">C</kbd>
              </div>

              <div className="d-flex flex-row">
                <span>Boost</span>
                <div className="flex-fill" />
                <kbd>Shift</kbd>
              </div>
            </motion.div>
          )}
        </motion.div>
      </div>

      <div className="ui-layer canvas-draw">
        <DemoDrawing />
      </div>

      {parser.status !== 'loading' && (
        <div className="ui-layer">
          <DemoDropzone onDrop={onDemoDropped} />
        </div>
      )}

      <style jsx>{`
        .ui-layer {
          &.loading-demo {
            justify-content: center;
            align-items: flex-start;
            top: 80px;

            & > :global(.panel) {
              display: inline-flex;
              color: #ffffff;
              background-color: rgba(0, 0, 0, 0.8);
              padding: 0.5rem 1rem;
            }
          }

          &.spectator-fly-tip {
            justify-content: flex-end;
            align-items: flex-end;
            bottom: 1rem;
            right: 1rem;

            & > :global(.panel) {
              color: #ffffff;
              background-color: rgba(0, 0, 0, 0.8);
              padding: 0.5rem 1rem;
              width: 220px;
            }
          }
        }
      `}</style>
    </div>
  )
}

export { ViewerPage }
