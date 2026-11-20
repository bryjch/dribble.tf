import { useLayoutEffect, useState } from 'react'

import type { MatchSource } from '@components/Analyse/Data/MatchSource'

import { StickerPalette } from '@components/UI/StickerPalette'
import { useStore } from '@zus/store'

import {
  BookmarkButton,
  IconButton,
  Scrubber,
  Sheet,
  SheetTabs,
  SpeedButton,
  StickersButton,
  TimeReadout,
} from './parts'
import { PANEL_TABS, PanelBody, PanelId } from './panels'
import { MenuGlyph, Theater } from './Theater'

import './mobile.css'

//
// ─── MOBILE SHELL ───────────────────────────────────────────────────────────────
//
// The phone interface, in place of the desktop HUD, toolbar and playback bar.
//

export const MobileShell = ({ landscape, match }: { landscape: boolean; match?: MatchSource }) => {
  usePhoneRootFont()
  return match ? <Theater match={match} landscape={landscape} /> : <NoDemo landscape={landscape} />
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
 * Before a demo: the map to look around, with the menu button where the match view has it.
 * The sheet opens on About (open a file, paste a link, the sample), with Settings beside it.
 * The match view's bottom bar shows here too, greyed out but for its sticker button, so stickers
 * can be placed on the empty map.
 */
const NoDemo = ({ landscape }: { landscape: boolean }) => {
  const [open, setOpen] = useState(true)
  const [panel, setPanel] = useState<PanelId>('about')
  const stickersOpen = useStore(state => state.drawing.stickersPanelOpen)
  return (
    <div className="m-shell" data-landscape={landscape ? 'true' : undefined}>
      <div className="m-nodemo__top">
        <IconButton label="Menu" size="md" onClick={() => setOpen(true)}>
          <MenuGlyph />
        </IconButton>
      </div>
      <div className="m-theater__bottom">
        <div className="m-theater__bar m-nodemo__bar">
          <div className="m-theater__meta">
            <TimeReadout className="m-nodemo__off" />
            <span className="flex-1" />
            <SpeedButton size="sm" disabled />
            <BookmarkButton size="sm" disabled />
            <StickersButton size="sm" />
          </div>
          <Scrubber disabled />
        </div>
      </div>
      {stickersOpen && (
        <div className="m-stickers m-stickers--nodemo">
          <StickerPalette compact />
        </div>
      )}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="dribble.tf"
        className="m-sheet--menu"
        header={
          <SheetTabs
            tabs={NO_DEMO_TABS.map(id => PANEL_TABS[id])}
            value={panel}
            onChange={id => setPanel(id as PanelId)}
          />
        }
      >
        <PanelBody panel={panel} />
      </Sheet>
    </div>
  )
}
