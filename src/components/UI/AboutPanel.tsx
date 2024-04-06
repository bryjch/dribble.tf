import React from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'

import { TogglePanel, TogglePanelButton } from '@components/UI/Shared/TogglePanel'
import { TiInfoLargeIcon } from '@components/Misc/Icons'

import { useStore } from '@zus/store'
import { toggleUIPanelAction, parseDemoAction } from '@zus/actions'
import { getAsset } from '@utils/misc'
import { MAP_NAME_SEARCH_MAP } from '@constants/mappings'

//
// ─── ABOUT PANEL ────────────────────────────────────────────────────────────────
//

const TFTV_URL = 'https://www.teamfortress.tv/57837/dribble-tf-stv-demo-replay-in-browser'
const GITHUB_URL = `https://www.github.com/bryjch/dribble.tf`

export const AboutPanel = () => {
  const isOpen = useStore(state => state.ui.activePanels.includes('About'))

  const toggleUIPanel = () => {
    toggleUIPanelAction('Settings', false)
    toggleUIPanelAction('About')
  }

  const onClickSampleDemo = async () => {
    let url = getAsset('/samples/i52_snakewater_gc.dem')
    const fileBuffer = await fetch(url).then(res => res.arrayBuffer())
    parseDemoAction(fileBuffer)
  }

  return (
    <div className="flex items-start">
      <TogglePanelButton onClick={toggleUIPanel}>
        <TiInfoLargeIcon />
      </TogglePanelButton>

      <TogglePanel
        className="w-[380px]"
        showCloseButton
        isOpen={isOpen}
        onClickClose={toggleUIPanel}
      >
        <div className="px-8 pb-12 pt-8">
          <div className="flex items-center">
            {/* Logo */}

            <img src="/logo192.png" alt="dribble.tf" className="mr-4 h-16 w-16" />

            <div className="w-full">
              {/* Title */}

              <Tooltip.Provider delayDuration={300}>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <div className="inline-block text-3xl font-bold leading-none tracking-tight">
                      dribble<span>.tf</span>
                    </div>
                  </Tooltip.Trigger>

                  <Tooltip.Portal>
                    <Tooltip.Content side="right" sideOffset={5}>
                      <div className="rounded-lg bg-pp-panel/80 px-4 py-3 text-sm">
                        Demo replay in browser <span className="opacity-30">but less epic</span> 😜
                      </div>
                      <Tooltip.Arrow className="fill-pp-panel/80" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </Tooltip.Provider>

              {/* External URLs */}

              <div className="flex text-xs">
                <a
                  href={TFTV_URL}
                  target="_blank"
                  rel="noopener referrer"
                  className="inline-block text-right underline opacity-60 transition-all hover:underline hover:opacity-100"
                >
                  teamfortress.tv
                </a>
                <div className="mx-1 opacity-60">/</div>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener referrer"
                  className="inline-block text-left underline opacity-60 transition-all hover:underline hover:opacity-100"
                >
                  Github
                </a>
              </div>
            </div>
          </div>

          {/* Description */}

          <div className="mt-5">
            <p>Watch Team Fortress 2 STV demos in your browser.</p>
          </div>

          {/* Main CTAs */}

          <div className="mt-8 flex items-center justify-center text-sm">
            <button className="rounded-full border border-dashed px-3.5 py-1 transition-all hover:border-solid hover:bg-black hover:invert">
              Drop/select <code>.dem</code> file
            </button>

            <div className="mx-2">/</div>

            <button
              className="bg-pp-accent-tertiary hover:text-pp-accent-tertiary flex cursor-pointer items-center rounded-full px-3.5 py-1 font-medium tracking-wide transition-all hover:bg-white"
              onClick={onClickSampleDemo}
            >
              Load sample demo
            </button>
            {/* Spacer to make button look more balanced */}
            <div className="w-4" />
          </div>

          {/* Controls */}

          <p className="mb-2 mt-10 text-xs font-black uppercase opacity-60">Controls</p>

          <div className="grid grid-cols-[auto,1fr] gap-y-1">
            {[
              ['Left Mouse', 'Rotate camera'],
              ['Right Mouse / WASD', 'Pan camera'],
              ['1 / 2 / 3', 'Change camera modes'],
              ['F', 'Drawing tools'],
            ].map(([key, value]) => (
              <React.Fragment key={`controls-${value}`}>
                <div className="flex items-center">
                  <b className="flex-shrink-0">{key}</b>
                  <div className="mx-2 h-px w-full min-w-3 bg-white/10" />
                </div>
                <span>{value}</span>
              </React.Fragment>
            ))}
          </div>

          {/* Supported Maps */}

          <p className="mb-2 mt-10 text-xs font-black uppercase opacity-60">Supported Maps</p>

          <div className="grid grid-cols-2 gap-y-1">
            {Object.keys(MAP_NAME_SEARCH_MAP)
              .sort((a, b) => a.localeCompare(b))
              .map(mapName => (
                <div key={`map-${mapName}`}>
                  <span className="opacity-50">&bull;</span>&nbsp;&nbsp;{mapName}
                </div>
              ))}
          </div>
        </div>
      </TogglePanel>
    </div>
  )
}
