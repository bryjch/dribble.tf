import { useEffect } from 'react'

import type { MatchSource } from '@components/Analyse/Data/MatchSource'
import { HiListBulletIcon } from '@components/Misc/Icons'
import { Killfeed } from '@components/UI/Killfeed'
import { HudTooltip } from '@components/UI/Shared/Controls'
import { TogglePanel, TogglePanelButton } from '@components/UI/Shared/TogglePanel'
import { UIPanelType } from '@constants/types'
import { toggleOnlyUIPanelAction, updateSettingsOptionAction } from '@zus/actions'
import { useStore } from '@zus/store'
import { useIsMobile } from '@utils/hooks'

import { MatchEventsList } from './MatchEventsList'
import { useMatchEvents } from './hooks'

//
// ─── MATCH EVENTS SIDEBAR ───────────────────────────────────────────────────────
//
// On desktop, docked right of the viewer, which shrinks beside it, so seeking from an event
// never hides the scene; shown from a button above the HUD killfeed and hidden from its own
// header. On phones, a sheet from the toolbar like the other panels.
//

export const SIDEBAR_WIDTH = 380

const setOpen = (open: boolean) => updateSettingsOptionAction('ui.matchEvents.open', open)

const Chevron = ({ pointsRight }: { pointsRight: boolean }) => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
    {pointsRight ? (
      <path
        fillRule="evenodd"
        d="M7.21 14.77a.75.75 0 01.02-1.06L11.17 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
        clipRule="evenodd"
      />
    ) : (
      <path
        fillRule="evenodd"
        d="M12.79 5.23a.75.75 0 01-.02 1.06L8.83 10l3.94 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
        clipRule="evenodd"
      />
    )}
  </svg>
)

/** Whether the docked sidebar is taking space beside the viewer. */
export const useSidebarDocked = () => {
  const open = useStore(state => state.settings.ui.matchEvents.open)
  const isMobile = useIsMobile()
  return open && !isMobile
}

/** The docked sidebar; renders nothing on phones or while hidden. */
export const MatchEventsSidebar = () => {
  const docked = useSidebarDocked()
  const data = useMatchEvents()

  // For the overlays sized to the window (playback bar, panels, chat, camera tips, drawing,
  // FPS counter) to stay beside it.
  useEffect(() => {
    if (!docked) return
    const root = document.documentElement
    root.style.setProperty('--ui-sidebar-width', `${SIDEBAR_WIDTH}px`)
    return () => {
      root.style.removeProperty('--ui-sidebar-width')
    }
  }, [docked])

  if (!docked) return null

  return (
    <aside className="ui-sidebar" style={{ width: SIDEBAR_WIDTH }} aria-label="Match events">
      <div className="ui-sidebar__header">
        <span className="ui-sidebar__title">Match events</span>
        <span className="ui-muted text-xs">{data?.events.length}</span>
        <HudTooltip content="Hide match events" side="left">
          <button
            type="button"
            className="ui-icon-btn ml-auto"
            onClick={() => setOpen(false)}
            aria-label="Hide match events"
          >
            <Chevron pointsRight />
          </button>
        </HudTooltip>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{data && <MatchEventsList data={data} />}</div>
    </aside>
  )
}

/**
 * The HUD killfeed, with the button that shows the sidebar above it on desktop. While the sidebar
 * is open its own header button hides it, so this one steps aside.
 */
export const KillfeedWithEventsToggle = ({ match, tick }: { match: MatchSource; tick: number }) => {
  const open = useStore(state => state.settings.ui.matchEvents.open)
  const isMobile = useIsMobile()
  return (
    <>
      {!isMobile && !open && (
        <TogglePanelButton
          label="Show match events"
          tooltipSide="left"
          onClick={() => setOpen(true)}
        >
          <HiListBulletIcon />
        </TogglePanelButton>
      )}
      <Killfeed parser={match} tick={tick} />
    </>
  )
}

/** On phones: the same list in a sheet, opened from the toolbar. */
export const MatchEventsSheet = () => {
  const isMobile = useIsMobile()
  const isOpen = useStore(state => state.ui.activePanels.includes(UIPanelType.MATCH_EVENTS))
  const data = useMatchEvents()
  if (!isMobile) return null

  const toggle = () => toggleOnlyUIPanelAction(UIPanelType.MATCH_EVENTS)
  return (
    <div className="flex items-start">
      <TogglePanelButton onClick={toggle} active={isOpen} label="Match events">
        <HiListBulletIcon />
      </TogglePanelButton>
      <TogglePanel
        title="Match events"
        count={data?.events.length}
        showCloseButton
        isOpen={isOpen}
        onClickClose={toggle}
        bodyClassName="flex h-[70vh] flex-col p-0"
      >
        {isOpen && data && <MatchEventsList data={data} />}
      </TogglePanel>
    </div>
  )
}
