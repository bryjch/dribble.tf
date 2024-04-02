import { TogglePanel } from '@components/UI/Shared/TogglePanel'

import { useStore } from '@zus/store'
import { toggleUIPanelAction, parseDemoAction } from '@zus/actions'
import { getAsset } from '@utils/misc'

//
// ─── ABOUT PANEL ────────────────────────────────────────────────────────────────
//

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
      <button
        className="mr-2 flex h-9 w-9 items-center justify-center bg-pp-panel/75"
        onClick={toggleUIPanel}
      >
        ABT
      </button>

      <TogglePanel className="w-[360px] max-w-full bg-pp-panel/80" isOpen={isOpen}>
        <div className="flex flex-row items-center justify-between bg-black/30 px-3 py-2 tracking-widest">
          <div>ABOUT</div>

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md"
            onClick={toggleUIPanel}
          >
            <svg
              className="h-6 w-6"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="px-6 pb-8 pt-3">
          <div className="text-3xl font-medium leading-tight">dribble.tf</div>

          <div className="text-sm">
            Demo replay in browser <span className="opacity-30">but less epic</span>
          </div>

          <div className="mt-3">
            <p>Watch Team Fortress 2 STV demos in your browser.</p>

            <p className="mt-3">
              Drop your STV <code>.dem</code> file anywhere to start viewing!
            </p>

            <p className="mt-3">
              Or try loading a{' '}
              <span className="cursor-pointer text-pp-accent-secondary" onClick={onClickSampleDemo}>
                sample demo
              </span>
              .
            </p>

            <p className="mt-6">
              Currently only supports:
              <br />
              - cp_gullywash
              <br />
              - cp_metalworks
              <br />
              - cp_process
              <br />
              - cp_snakewater
              <br />
              - cp_sunshine
              <br />- cp_reckoner
              <br />- cp_sultry
              <br />- cp_villa
              <br />- koth_bagel
              <br />- koth_product
            </p>

            <p className="mt-6">
              Controls:
              <br />
              <b>LMB</b> ... rotate camera
              <br />
              <b>RMB / WASD</b> ... pan camera
              <br />
              <b>F</b> ... drawing tools
            </p>
          </div>
        </div>

        <div className="bg-pp-accent-secondary/50 px-6 py-1 text-center text-xs">
          <a href={GITHUB_URL}>View this project on Github</a>
        </div>
      </TogglePanel>
    </div>
  )
}
