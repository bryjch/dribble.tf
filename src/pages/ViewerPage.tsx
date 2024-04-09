import { useEffect, useMemo, useState } from 'react'
import { useGLTF } from '@react-three/drei'
import { motion } from 'framer-motion'

import { GlobalKeyHandler } from '@components/Misc/GlobalKeyHandler'
import { DemoDropzone } from '@components/Misc/DemoDropzone'
import { DemoDrawing } from '@components/Misc/DemoDrawing'
import { DemoViewer } from '@components/DemoViewer'

import { useStore, useInstance } from '@zus/store'
import { usePointerLock } from '@utils/hooks'

const ViewerPage = () => {
  const parser = useStore(state => state.parser)
  const parsedDemo = useInstance(state => state.parsedDemo)
  const loadedMap = useStore(state => state.scene.map)
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

  // Preload any assets here
  useEffect(() => {
    const preloadAssets: string[] = [
      // Maybe load player models
    ]

    useGLTF.preload(preloadAssets)
  }, [])

  //
  // ─── RENDER ─────────────────────────────────────────────────────────────────────
  //

  return (
    <div className="antialiased">
      <GlobalKeyHandler />

      <DemoViewer demo={parsedDemo} map={loadedMap} />

      {/* Parsing demo overlay */}
      <div className="ui-layer top-20 items-start justify-center">
        <motion.div
          className="inline-flex bg-pp-panel/80 px-4 py-2"
          animate={parser.status === 'loading' ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
          transition={{ duration: 0.2 }}
          initial={false}
        >
          <div>Parsing demo... {parser.progress}%</div>
        </motion.div>
      </div>

      {/* Spectator camera fly tip overlay */}
      <div className="ui-layer bottom-4 right-4 items-end justify-end overflow-hidden">
        <motion.div
          className="w-56 bg-pp-panel/80 px-4 py-2"
          animate={showSpectatorFlyTip ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
          transition={{ duration: 0.2 }}
          initial={false}
        >
          <div className="d-flex mb-1 flex-row">
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
              <div className="d-flex mb-1 flex-row">
                <span>Deactivate</span>
                <div className="flex-fill" />
                <kbd>RMB</kbd>
              </div>

              <div className="d-flex mb-1 flex-row">
                <span>Movement</span>
                <div className="flex-fill" />
                <kbd className="ml-1">W</kbd>
                <kbd className="ml-1">A</kbd>
                <kbd className="ml-1">S</kbd>
                <kbd className="ml-1">D</kbd>
              </div>

              <div className="d-flex mb-1 flex-row">
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

      {/* Drawing overlay */}
      <div className="ui-layer">
        <DemoDrawing />
      </div>

      {/* Dropzone overlay */}
      {parser.status !== 'loading' && (
        <div className="ui-layer">
          <DemoDropzone />
        </div>
      )}
    </div>
  )
}

export { ViewerPage }
