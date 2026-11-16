import { useLayoutEffect, useState } from 'react'

import type { MatchSource } from '@components/Analyse/Data/MatchSource'
import { FileIcon } from '@components/Misc/Icons'

import { Sheet, SheetBrand, SheetTabs } from './parts'
import { PANEL_TABS, PanelBody, PanelId } from './panels'
import { Theater } from './Theater'

import './mobile.css'

//
// ─── MOBILE SHELL ───────────────────────────────────────────────────────────────
//
// The phone interface, in place of the desktop HUD, toolbar and playback bar.
//

export const MobileShell = ({ landscape, match }: { landscape: boolean; match?: MatchSource }) => {
  usePhoneRootFont()
  return match ? <Theater match={match} landscape={landscape} /> : <NoDemo />
}

/**
 * index.scss shrinks the root font to 8px on a phone so the desktop HUD fits; this interface
 * isn't the desktop HUD, so give the themes' rem-sized pieces (the score, the killfeed, the
 * roster rows, the scoreboard) a size they read at, and keep their look.
 */
const PHONE_ROOT_FONT = '12px'

const usePhoneRootFont = () => {
  useLayoutEffect(() => {
    const root = document.documentElement
    const before = root.style.fontSize
    root.style.fontSize = PHONE_ROOT_FONT
    window.dispatchEvent(new Event('resize')) // components that measure in rem look again
    return () => {
      root.style.fontSize = before
    }
  }, [])
}

// Events and bookmarks need a match.
const NO_DEMO_TABS: PanelId[] = ['about', 'settings']

/**
 * Before a demo: the sheet opens on About (open a file, paste a link, the sample), with Settings
 * beside it, and a way back to it once dismissed.
 */
const NoDemo = () => {
  const [open, setOpen] = useState(true)
  const [panel, setPanel] = useState<PanelId>('about')
  return (
    <div className="m-shell">
      <div className="m-nodemo">
        <button type="button" className="m-nodemo__btn" onClick={() => setOpen(true)}>
          <FileIcon />
          Open a demo
        </button>
      </div>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="dribble.tf"
        header={
          <>
            <SheetBrand />
            <SheetTabs
              tabs={NO_DEMO_TABS.map(id => PANEL_TABS[id])}
              value={panel}
              onChange={id => setPanel(id as PanelId)}
            />
          </>
        }
      >
        <PanelBody panel={panel} />
      </Sheet>
    </div>
  )
}
