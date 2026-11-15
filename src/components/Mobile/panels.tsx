import type { MatchSource } from '@components/Analyse/Data/MatchSource'
import { AboutContent } from '@components/UI/AboutPanel'
import { BookmarksContent } from '@components/UI/BookmarksPanel'
import { MatchEventsList, useMatchEvents } from '@components/UI/MatchKillfeedPanel'
import { SettingsContent } from '@components/UI/SettingsPanel'

import { CameraSwitch, RemZoom, SheetTab } from './parts'

//
// ─── PANEL CONTENTS ─────────────────────────────────────────────────────────────
//
// What the phone sheets show. Setups, stickers and drawing are left out on phones: they are
// desktop tools (saving camera setups, annotating a frame) with no good touch equivalent.
//

export type PanelId = 'events' | 'bookmarks' | 'settings' | 'about'

export const PANEL_TABS: Record<PanelId, SheetTab> = {
  events: { id: 'events', label: 'Events' },
  bookmarks: { id: 'bookmarks', label: 'Bookmarks' },
  settings: { id: 'settings', label: 'Settings' },
  about: { id: 'about', label: 'About' },
}

const EventsBody = () => {
  const matchEvents = useMatchEvents()
  return (
    <RemZoom force>
      <MatchEventsList {...matchEvents} />
    </RemZoom>
  )
}

export const PanelBody = ({ panel, match }: { panel: PanelId; match?: MatchSource }) => {
  switch (panel) {
    case 'events':
      return match ? <EventsBody /> : null
    case 'bookmarks':
      return (
        <RemZoom>
          <BookmarksContent />
        </RemZoom>
      )
    case 'settings':
      return (
        <>
          <div className="m-field">
            <span className="m-field__label">Camera</span>
            <CameraSwitch />
          </div>
          <RemZoom>
            <SettingsContent />
          </RemZoom>
        </>
      )
    case 'about':
      return (
        <RemZoom>
          <div className="ui-about-panel ui-about">
            <AboutContent />
          </div>
        </RemZoom>
      )
  }
}
