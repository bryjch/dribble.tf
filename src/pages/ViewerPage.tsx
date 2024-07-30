import { useEffect } from 'react'
import { useGLTF } from '@react-three/drei'
import { motion } from 'framer-motion'

import { GlobalKeyHandler } from '@components/Misc/GlobalKeyHandler'
import { DemoDropzone } from '@components/Misc/DemoDropzone'
import { DemoDrawing } from '@components/Misc/DemoDrawing'
import { DemoViewer } from '@components/DemoViewer'
import {
  POVCameraTipPanel,
  SpectatorCameraTipPanel,
  RtsCameraTipPanel,
} from '@components/UI/CameraTipPanels'

import { useStore, useInstance } from '@zus/store'

const ViewerPage = () => {
  const parser = useStore(state => state.parser)
  const parsedDemo = useInstance(state => state.parsedDemo)
  const loadedMap = useStore(state => state.scene.map)

  //
  // ─── LIFECYCLE ──────────────────────────────────────────────────────────────────
  //

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
      <div className="ui-layer pointer-events-none top-20 items-start justify-center">
        <motion.div
          className="inline-flex rounded-lg bg-pp-panel/80 px-5 py-2"
          animate={parser.status === 'loading' ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
          transition={{ duration: 0.2 }}
          initial={false}
        >
          <div>Parsing demo ... {parser.progress}%</div>
        </motion.div>
      </div>

      {/* Camera tip panels overlays */}
      <div className="ui-layer pointer-events-none bottom-0 right-0 items-end justify-end overflow-hidden p-4 [&>div]:pointer-events-none">
        <POVCameraTipPanel />
        <SpectatorCameraTipPanel />
        <RtsCameraTipPanel />
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
