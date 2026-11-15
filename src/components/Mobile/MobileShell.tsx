import { useLayoutEffect, useState } from 'react'

import type { MatchSource } from '@components/Analyse/Data/MatchSource'
import { FileIcon } from '@components/Misc/Icons'

import { Sheet } from './parts'
import { PanelBody } from './panels'
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

/** Before a demo: the About sheet (open a file, paste a link, the sample), and a way back to it. */
const NoDemo = () => {
  const [open, setOpen] = useState(true)
  return (
    <div className="m-shell">
      <div className="m-nodemo">
        <button type="button" className="m-nodemo__btn" onClick={() => setOpen(true)}>
          <FileIcon />
          Open a demo
        </button>
      </div>
      <Sheet open={open} onOpenChange={setOpen} title="dribble.tf">
        <PanelBody panel="about" />
      </Sheet>
    </div>
  )
}
