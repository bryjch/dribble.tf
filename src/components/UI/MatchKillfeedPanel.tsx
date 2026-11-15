import { useState, useMemo } from 'react'

import { TogglePanel, TogglePanelButton } from '@components/UI/Shared/TogglePanel'
import { HiListBulletIcon } from '@components/Misc/Icons'

import { useStore, useInstance } from '@zus/store'
import { toggleOnlyUIPanelAction, goToTickAction, jumpToPlayerPOVCamera } from '@zus/actions'
import {
  getAllKills,
  getUberPops,
  annotateKillstreaks,
  MatchUberEvent,
  AnnotatedMatchKillEvent,
} from '@utils/matchEvents'
import { getDurationFromTicks } from '@utils/parser'
import { killIconUrl } from '@utils/killIcons'

const teamIdToName = (teamId: number): string => {
  if (teamId === 2) return 'red'
  if (teamId === 3) return 'blue'
  return ''
}

// ─── STREAK HELPERS ──────────────────────────────────────────────────────────────

type PanelEvent = AnnotatedMatchKillEvent | MatchUberEvent

/** 2K, 3K, 4K+: how hot a streak row runs (see .ui-event-row[data-streak]). */
const streakLevel = (streakCount: number) => (streakCount >= 4 ? 4 : streakCount)

/** Every kill and über of the match, filtered by a player name, for the events list. */
export const useMatchEvents = () => {
  const parser = useInstance(state => state.match)

  const [filterText, setFilterText] = useState('')

  const tickRate = parser?.intervalPerTick ? 1 / parser.intervalPerTick : 66.67

  const events = useMemo(() => {
    if (!parser) return []
    const rawKills = getAllKills(parser)
    const annotatedKills = annotateKillstreaks(rawKills, tickRate)
    const ubers: MatchUberEvent[] = getUberPops(parser)
    return [...annotatedKills, ...ubers].sort((a, b) => a.tick - b.tick)
  }, [parser, parser?.revision, tickRate])

  const filteredEvents = useMemo(() => {
    if (!filterText) return events
    const query = filterText.toLowerCase()
    return events.filter(event => {
      if (event.type === 'kill') {
        return (
          event.killer?.user.name.toLowerCase().includes(query) ||
          event.victim.user.name.toLowerCase().includes(query) ||
          event.assister?.user.name.toLowerCase().includes(query)
        )
      }
      return event.medicName.toLowerCase().includes(query)
    })
  }, [events, filterText])
  const killfeedSeekBuffer = useStore(state => state.settings.ui.killfeedSeekBuffer)

  const seekToPlayer = (tick: number, entityId: number) => {
    const bufferTicks = Math.round(killfeedSeekBuffer * tickRate)
    goToTickAction(Math.max(1, tick - bufferTicks))
    jumpToPlayerPOVCamera(entityId)
  }

  return { events, filteredEvents, filterText, setFilterText, seekToPlayer, tickRate }
}

export const MatchKillfeedPanel = () => {
  const isOpen = useStore(state => state.ui.activePanels.includes('MatchKillfeed'))
  const matchEvents = useMatchEvents()
  const { events, filteredEvents, filterText } = matchEvents

  const toggleUIPanel = () => toggleOnlyUIPanelAction('MatchKillfeed')

  return (
    <div className="flex items-start">
      <TogglePanelButton onClick={toggleUIPanel} active={isOpen} label="Match events">
        <HiListBulletIcon />
      </TogglePanelButton>

      <TogglePanel
        className="w-[min(520px,calc(100vw-5rem))]"
        title="Match events"
        count={filterText ? `${filteredEvents.length}/${events.length}` : events.length}
        showCloseButton
        isOpen={isOpen}
        onClickClose={toggleUIPanel}
      >
        <MatchEventsList {...matchEvents} />
      </TogglePanel>
    </div>
  )
}

/** The filter box and the rows; the state lives in useMatchEvents so a header can show the count. */
export const MatchEventsList = ({
  filteredEvents,
  filterText,
  setFilterText,
  seekToPlayer,
  tickRate,
}: ReturnType<typeof useMatchEvents>) => (
  <>
    <div className="relative mb-3">
      <input
        type="text"
        placeholder="Filter by player name"
        aria-label="Filter by player name"
        value={filterText}
        onChange={e => setFilterText(e.target.value)}
        className="ui-input w-full pr-8"
      />
      {filterText && (
        <button
          className="ui-icon-btn absolute right-1.5 top-1/2 -translate-y-1/2"
          aria-label="Clear filter"
          onClick={() => setFilterText('')}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      )}
    </div>

    {filteredEvents.length === 0 && (
      <div className="ui-empty-note">
        {filterText ? `No kills or ubers involve “${filterText}”.` : 'No kills or ubers yet.'}
      </div>
    )}

    <div className="flex flex-col gap-px">
      {filteredEvents.map((event, index) => (
        <MatchEventRow
          key={`${event.type}-${event.tick}-${index}`}
          event={event}
          tickRate={tickRate}
          onSeek={seekToPlayer}
          onFilter={setFilterText}
        />
      ))}
    </div>
  </>
)

// ─── EVENT ROW ──────────────────────────────────────────────────────────────────

interface MatchEventRowProps {
  event: PanelEvent
  tickRate: number
  onSeek: (tick: number, entityId: number) => void
  onFilter: (name: string) => void
}

const MatchEventRow = ({ event, tickRate, onSeek, onFilter }: MatchEventRowProps) => {
  const timestamp = getDurationFromTicks(event.tick, tickRate).formatted

  if (event.type === 'uber') {
    return (
      <div className="ui-event-row" data-kind="uber">
        <span className="ui-time w-12">{timestamp}</span>
        <FilterButton onClick={() => onFilter(event.medicName)} />
        <ClickableName
          name={event.medicName}
          team={teamIdToName(event.medicTeam)}
          onClick={() => onSeek(event.tick, event.medicEntityId)}
        />
        <span className="ui-event-row__note">popped über</span>
      </div>
    )
  }

  return <KillRow event={event} timestamp={timestamp} onSeek={onSeek} onFilter={onFilter} />
}

// ─── KILL ROW ───────────────────────────────────────────────────────────────────

interface KillRowProps {
  event: AnnotatedMatchKillEvent
  timestamp: string
  onSeek: (tick: number, entityId: number) => void
  onFilter: (name: string) => void
}

const KillRow = ({ event, timestamp, onSeek, onFilter }: KillRowProps) => {
  const { killer, victim, assister, weapon, streak } = event

  const weaponIcon = killIconUrl(weapon)

  const filterName = killer && killer !== victim ? killer.user.name : victim.user.name

  return (
    <div
      className="ui-event-row"
      data-kind="kill"
      data-streak={streak ? streakLevel(streak.streakCount) : undefined}
    >
      <span className="ui-time w-12">{timestamp}</span>
      <FilterButton onClick={() => onFilter(filterName)} />

      {streak && <span className="ui-event-row__streak">{streak.streakCount}K</span>}

      <div className="flex min-w-0 flex-1 items-center">
        {killer && killer !== victim && (
          <ClickableName
            name={killer.user.name}
            team={killer.user.team}
            onClick={() => onSeek(event.tick, killer.user.entityId)}
          />
        )}

        {assister && (
          <>
            <span className="hud-team-ink mx-1" data-team={killer?.user.team}>
              +
            </span>
            <ClickableName
              name={assister.user.name}
              team={killer?.user.team}
              onClick={() => onSeek(event.tick, assister.user.entityId)}
            />
          </>
        )}

        <span className="ui-event-row__weapon">
          <img src={weaponIcon} alt={weapon} />
        </span>

        <ClickableName
          name={victim.user.name}
          team={victim.user.team}
          onClick={() => onSeek(event.tick, victim.user.entityId)}
        />
      </div>
    </div>
  )
}

// ─── CLICKABLE NAME ─────────────────────────────────────────────────────────────

const ClickableName = ({
  name,
  team,
  onClick,
}: {
  name: string
  team?: string
  onClick: () => void
}) => (
  <button
    type="button"
    className="ui-event-row__name"
    data-team={team || undefined}
    onClick={onClick}
    title={`Watch ${name}'s POV`}
  >
    {name}
  </button>
)

// ─── FILTER BUTTON ──────────────────────────────────────────────────────────────

const FilterButton = ({ onClick }: { onClick: () => void }) => (
  <button
    className="ui-icon-btn ui-event-row__filter"
    aria-label="Filter by this player"
    onClick={e => {
      e.stopPropagation()
      onClick()
    }}
    title="Filter by this player"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-3 w-3"
    >
      <path
        fillRule="evenodd"
        d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z"
        clipRule="evenodd"
      />
    </svg>
  </button>
)
