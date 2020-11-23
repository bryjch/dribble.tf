import React from 'react'
import { motion } from 'framer-motion'

import { DemoDropzone } from '@components/DemoDropzone'
import { DemoViewer } from '@components/DemoViewer'

import { parseDemoAction } from '@redux/actions'
import { useStore, dispatch, useInstance } from '@redux/store'

const ViewerPage = () => {
  const parser = useStore((state: any) => state.parser)
  const parsedDemo = useInstance((state: any) => state.parsedDemo)

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
              padding: 0.75rem 1rem;
            }
          }
        }
      `}</style>
    </div>
  )
}

export { ViewerPage }
