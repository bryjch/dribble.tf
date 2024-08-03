import { useEffect } from 'react'
import { useGLTF } from '@react-three/drei'
import { motion } from 'framer-motion'

import { IoArrowForwardSharpIcon } from '@components/Misc/Icons'
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

  const loadingDownloads = useStore(state =>
    Array.from(state.downloads.values()).filter(({ status }) => status === 'loading')
  )

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

      {/* Downloads overlay */}
      {loadingDownloads.length > 0 && (
        <div className="ui-layer m-4 items-start justify-center">
          <div className="flex flex-col gap-2">
            {loadingDownloads.map(download => (
              <motion.div
                key={download.url}
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="pointer-events-none relative overflow-hidden rounded-lg bg-pp-panel/80 px-4 py-3"
              >
                <div
                  className="absolute inset-0 right-[unset] bg-white/30"
                  style={{ width: `${download.progress.toFixed(1)}%` }}
                />

                <div className="flex items-center">
                  <div className="animate-bounce">
                    <IoArrowForwardSharpIcon className="mr-2 rotate-90" />
                  </div>

                  <div>
                    <div className="text-xs uppercase opacity-50">
                      Downloading {download.type}
                      {download.size && `- ${(download.size / (1024 * 1024)).toFixed(2)}MB`}
                    </div>

                    <div>
                      {download.name} ... {download.progress.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Parsing demo overlay */}
      <div className="ui-layer top-20 items-start justify-center">
        <motion.div
          className="pointer-events-none inline-flex rounded-lg bg-pp-panel/80 px-5 py-2"
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
