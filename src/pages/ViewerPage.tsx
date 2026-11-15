import { useEffect } from 'react'
import { useGLTF } from '@react-three/drei'
import { motion } from 'framer-motion'

import { IoArrowForwardSharpIcon } from '@components/Misc/Icons'
import { GlobalKeyHandler } from '@components/Misc/GlobalKeyHandler'
import { DemoDropzone } from '@components/Misc/DemoDropzone'
import { UrlDemoNotice } from '@components/Misc/UrlDemoNotice'
import { DemoDrawing } from '@components/Misc/DemoDrawing'
import { DemoViewer } from '@components/DemoViewer'
import {
  POVCameraTipPanel,
  SpectatorCameraTipPanel,
  RtsCameraTipPanel,
} from '@components/UI/CameraTipPanels'

import { useShallow } from 'zustand/react/shallow'

import { useStore, useInstance } from '@zus/store'
import { applySetupAction } from '@zus/actions'
import { useIsMobile } from '@utils/hooks'
import { applyTheme } from '@theme/themes'

const ViewerPage = () => {
  const parser = useStore(state => state.parser)
  const match = useInstance(state => state.match)
  const loadedMap = useStore(state => state.scene.map)
  const setupCameraBridge = useInstance(state => state.setupCameraBridge)
  const pendingSharedSetup = useStore(state => state.setups.pendingSharedSetup)
  const isMobile = useIsMobile()
  const theme = useStore(state => state.settings.ui.theme)

  // Shallow: the selector builds a new array every time, which would re-render on any change.
  const loadingDownloads = useStore(
    useShallow(state =>
      Array.from(state.downloads.values()).filter(({ status }) => status === 'loading')
    )
  )

  //
  // ─── LIFECYCLE ──────────────────────────────────────────────────────────────────
  //

  // The overlays follow the theme setting (see @theme/themes).
  useEffect(() => applyTheme(theme), [theme])

  // Preload any assets here
  useEffect(() => {
    const preloadAssets: string[] = [
      // Maybe load player models
    ]

    useGLTF.preload(preloadAssets)
  }, [])

  useEffect(() => {
    if (!pendingSharedSetup || !setupCameraBridge) return
    applySetupAction(pendingSharedSetup, { fromShared: true })
  }, [pendingSharedSetup, setupCameraBridge])

  //
  // ─── RENDER ─────────────────────────────────────────────────────────────────────
  //

  return (
    <div className="ui-root antialiased">
      <GlobalKeyHandler />

      <DemoViewer demo={match} map={loadedMap} />

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
                className="ui-toast pointer-events-none min-w-64"
                role="status"
              >
                <div className="ui-toast__progress" style={{ width: `${download.progress.toFixed(1)}%` }} />

                <div className="relative flex items-center gap-2.5">
                  <IoArrowForwardSharpIcon className="rotate-90 animate-bounce" />
                  <div>
                    <div className="ui-toast__label">
                      Downloading {download.type}
                      {download.size && ` · ${(download.size / (1024 * 1024)).toFixed(1)} MB`}
                    </div>
                    <div className="tabular-nums">
                      {download.stage ?? `${download.name} · ${download.progress.toFixed(0)}%`}
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
          className="ui-toast pointer-events-none min-w-56"
          role="status"
          animate={parser.status === 'loading' ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
          transition={{ duration: 0.2 }}
          initial={false}
        >
          <div className="ui-toast__progress" style={{ width: `${parser.progress}%` }} />
          <div className="relative">
            <div className="ui-toast__label">Reading demo</div>
            <div className="tabular-nums">{parser.progress}%</div>
          </div>
        </motion.div>
      </div>

      {/* Status for a demo requested via the URL */}
      <UrlDemoNotice />

      {/* Camera tip panels overlays - hidden on mobile (keyboard shortcuts not relevant) */}
      {!isMobile && (
        <div className="ui-layer pointer-events-none bottom-0 right-0 items-end justify-end overflow-hidden p-4 [&>div]:pointer-events-none">
          <POVCameraTipPanel />
          <SpectatorCameraTipPanel />
          <RtsCameraTipPanel />
        </div>
      )}

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
