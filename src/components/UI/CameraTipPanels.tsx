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
      className="ui-tip absolute"
      animate={showing ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      initial={false}
    >
      <div className="ui-tip__title flex">
        <strong>POV Camera</strong>
      </div>

      <motion.div>
        <div className="ui-tip__row">
          <span>Next player</span>
                    <kbd>1</kbd>
        </div>

        <div className="ui-tip__row">
          <span>Previous player</span>
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
      className="ui-tip"
      animate={showing ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      initial={false}
    >
      <div className="ui-tip__title flex">
        <strong>Spectator Camera</strong>
                <div>
          {isPointerLocked ? (
            <motion.div
              key={`on`}
              initial={{ opacity: 0, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="ui-status px-2"
              data-state="on"
            >
              ON
            </motion.div>
          ) : (
            <motion.div
              key={`idle`}
              initial={{ opacity: 0, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="ui-status px-2"
              data-state="idle"
            >
              IDLE
            </motion.div>
          )}
        </div>
      </div>

      {!isPointerLocked && (
        <motion.div>
          <div className="ui-tip__row">
            <span>Activate</span>
                        <kbd>LMB</kbd>
          </div>
        </motion.div>
      )}

      {isPointerLocked && (
        <motion.div>
          <div className="ui-tip__row">
            <span>Deactivate</span>
                        <kbd>ESC</kbd> / <kbd>RMB</kbd>
          </div>

          <div className="ui-tip__row">
            <span>Movement</span>
                        <kbd className="ml-0.5">W</kbd>
            <kbd className="ml-0.5">A</kbd>
            <kbd className="ml-0.5">S</kbd>
            <kbd className="ml-0.5">D</kbd>
          </div>

          <div className="ui-tip__row">
            <span>Elevation</span>
            
            <kbd className="ml-0.5">E</kbd>
            <kbd className="ml-0.5">C</kbd>
          </div>

          <div className="ui-tip__row">
            <span>Boost</span>
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
      className="ui-tip absolute"
      animate={showing ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      initial={false}
    >
      <div className="ui-tip__title flex">
        <strong>RTS Camera</strong>
      </div>

      <motion.div>
        <div className="ui-tip__row">
          <span>Rotate</span>
                    <kbd>LMB</kbd>
        </div>

        <div className="ui-tip__row">
          <span>Pan</span>
                    <kbd>RMB</kbd>
        </div>

        <div className="ui-tip__row">
          <span>Movement</span>
                    <kbd className="ml-0.5">W</kbd>
          <kbd className="ml-0.5">A</kbd>
          <kbd className="ml-0.5">S</kbd>
          <kbd className="ml-0.5">D</kbd>
        </div>

        <div className="ui-tip__row">
          <span>Zoom</span>
                    <kbd>Scroll</kbd>
        </div>
      </motion.div>
    </motion.div>
  )
}
