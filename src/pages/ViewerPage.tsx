import React from 'react'
import { motion } from 'framer-motion'

import { GlobalKeyHandler } from '@components/GlobalKeyHandler'
import { DemoDropzone } from '@components/DemoDropzone'
import { DemoDrawing } from '@components/DemoDrawing'
import { DemoViewer } from '@components/DemoViewer'

import { parseDemoAction } from '@zus/actions'
import { useStore, dispatch, useInstance } from '@zus/store'
import { usePointerLock } from '@utils/hooks'

const ViewerPage = () => {
  const parser = useStore((state: any) => state.parser)
  const parsedDemo = useInstance((state: any) => state.parsedDemo)
  const controlsMode = useStore((state: any) => state.scene.controls.mode)

  const { isPointerLocked } = usePointerLock()

  //
  // ─── METHODS ────────────────────────────────────────────────────────────────────
  //

  const onDemoDropped = (files: File[]) => {
    const demoFile: File = files[0]

    const reader = new FileReader()

    reader.readAsArrayBuffer(demoFile)

    reader.onload = function () {
      const fileBuffer = reader.result as ArrayBuffer
      dispatch(parseDemoAction(fileBuffer))
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
          animate={
            controlsMode === 'spectator' && !isPointerLocked
              ? { opacity: 1, y: 0 }
              : { opacity: 0, y: -20 }
          }
          transition={{ duration: 0.2 }}
          initial={false}
        >
          <span>
            <strong>Right click</strong> to fly around
          </span>
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
              background-color: rgba(30, 30, 30, 0.75);
              padding: 0.5rem 1rem;
              border-radius: 0.3rem;
            }
          }

          &.spectator-fly-tip {
            justify-content: center;
            align-items: flex-start;
            top: 130px;

            & > :global(.panel) {
              display: inline-flex;
              color: #ffffff;
              background-color: rgba(30, 30, 30, 0.75);
              padding: 0.5rem 1rem;
              border-radius: 0.3rem;
            }
          }
        }
      `}</style>
    </div>
  )
}

export { ViewerPage }
