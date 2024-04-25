import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

import { useStore } from '@zus/store'
import { usePointerLock } from '@utils/hooks'
import { ControlsMode } from '@constants/types'

export const useShowTimeout = (
  controlsMode: ControlsMode,
  { forceShow }: { forceShow?: boolean } = {}
) => {
  const activeControlsMode = useStore(state => state.scene.controls.mode)
  const [showing, setShowing] = useState(false)

  useEffect(() => {
    let timeout: NodeJS.Timeout
    if (activeControlsMode === controlsMode) {
      setShowing(true)
      timeout = setTimeout(() => setShowing(false), 2000)
    }
    return () => timeout && clearTimeout(timeout)
  }, [activeControlsMode, forceShow])

  return { showing: activeControlsMode === controlsMode && (showing || forceShow) }
}

export const POVCameraTipPanel = () => {
  const { showing } = useShowTimeout('pov')

  return (
    <motion.div
      className="absolute w-72 rounded-3xl bg-pp-panel/80 p-6"
      animate={showing ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      initial={false}
    >
      <div className="mb-1 flex">
        <strong>POV Camera</strong>
      </div>

      <motion.div>
        <div className="mb-1 flex">
          <span>Next player</span>
          <div className="flex-1" />
          <kbd>1</kbd>
        </div>

        <div className="flex">
          <span>Previous player</span>
          <div className="flex-1" />
          <kbd>Shift + 1</kbd>
        </div>
      </motion.div>
    </motion.div>
  )
}

export const SpectatorCameraTipPanel = () => {
  const { isPointerLocked } = usePointerLock()
  const { showing } = useShowTimeout('spectator', { forceShow: !isPointerLocked })

  return (
    <motion.div
      className="w-72 rounded-3xl bg-pp-panel/80 p-6"
      animate={showing ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      initial={false}
    >
      <div className="mb-1 flex">
        <strong>Spectator Camera</strong>
        <div className="flex-1" />
        <div>
          {isPointerLocked ? (
            <motion.div
              key={`on`}
              initial={{ opacity: 0, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              style={{ color: '#4dd241' }}
              className="px-2"
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
              className="px-2"
            >
              IDLE
            </motion.div>
          )}
        </div>
      </div>

      {!isPointerLocked && (
        <motion.div>
          <div className="flex">
            <span>Activate</span>
            <div className="flex-1" />
            <kbd>LMB</kbd>
          </div>
        </motion.div>
      )}

      {isPointerLocked && (
        <motion.div>
          <div className="mb-1 flex">
            <span>Deactivate</span>
            <div className="flex-1" />
            <kbd>ESC</kbd> / <kbd>RMB</kbd>
          </div>

          <div className="mb-1 flex">
            <span>Movement</span>
            <div className="flex-1" />
            <kbd className="ml-1">W</kbd>
            <kbd className="ml-1">A</kbd>
            <kbd className="ml-1">S</kbd>
            <kbd className="ml-1">D</kbd>
          </div>

          <div className="mb-1 flex">
            <span>Elevation</span>
            <div className="flex-1" />

            <kbd className="ml-1">E</kbd>
            <kbd className="ml-1">C</kbd>
          </div>

          <div className="flex">
            <span>Boost</span>
            <div className="flex-1" />
            <kbd>Shift</kbd>
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}

export const RtsCameraTipPanel = () => {
  const { showing } = useShowTimeout('rts')

  return (
    <motion.div
      className="absolute w-72 rounded-3xl bg-pp-panel/80 p-6"
      animate={showing ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      initial={false}
    >
      <div className="mb-1 flex">
        <strong>RTS Camera</strong>
      </div>

      <motion.div>
        <div className="mb-1 flex">
          <span>Rotate</span>
          <div className="flex-1" />
          <kbd>LMB</kbd>
        </div>

        <div className="mb-1 flex">
          <span>Pan</span>
          <div className="flex-1" />
          <kbd>RMB</kbd>
        </div>

        <div className="mb-1 flex">
          <span>Movement</span>
          <div className="flex-1" />
          <kbd className="ml-1">W</kbd>
          <kbd className="ml-1">A</kbd>
          <kbd className="ml-1">S</kbd>
          <kbd className="ml-1">D</kbd>
        </div>

        <div className="flex">
          <span>Zoom</span>
          <div className="flex-1" />
          <kbd>Scroll</kbd>
        </div>
      </motion.div>
    </motion.div>
  )
}
