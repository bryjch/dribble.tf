import { useState, useMemo } from 'react'

import { TogglePanel, TogglePanelButton } from '@components/UI/Shared/TogglePanel'
import { HiListBulletIcon } from '@components/Misc/Icons'

import { useStore, useInstance } from '@zus/store'
import { toggleUIPanelAction, goToTickAction, jumpToPlayerPOVCamera } from '@zus/actions'
import {
  getAllKills,
  getUberPops,
  annotateKillstreaks,
  MatchUberEvent,
  AnnotatedMatchKillEvent,
} from '@utils/matchEvents'
import { getDurationFromTicks } from '@utils/parser'
import { KILL_ICON_ALIASES } from '@constants/killIconAliases'
import { cn } from '@utils/styling'

const teamTextColorMap: { [key: string]: string } = {
  red: 'text-pp-killfeed-text-red',
  blue: 'text-pp-killfeed-text-blue',
}

const teamIdToName = (teamId: number): string => {
  if (teamId === 2) return 'red'
  if (teamId === 3) return 'blue'
  return ''
}

// ─── STREAK HELPERS ──────────────────────────────────────────────────────────────

type PanelEvent = AnnotatedMatchKillEvent | MatchUberEvent

const getStreakBorderColor = (streakCount: number): string => {
  if (streakCount >= 4) return '#ef4444'
  if (streakCount === 3) return '#f97316'
  return '#f59e0b'
}

const getStreakTextColor = (streakCount: number): string => {
  if (streakCount >= 4) return 'text-red-400'
  if (streakCount === 3) return 'text-orange-400'
  return 'text-amber-400'
}

export const MatchKillfeedPanel = () => {
  const isOpen = useStore(state => state.ui.activePanels.includes('MatchKillfeed'))
  const parser = useInstance(state => state.parsedDemo)

  const [filterText, setFilterText] = useState('')

  const tickRate = parser?.intervalPerTick ? 1 / parser.intervalPerTick : 66.67

  const toggleUIPanel = () => {
    toggleUIPanelAction('Settings', false)
    toggleUIPanelAction('About', false)
    toggleUIPanelAction('Bookmarks', false)
    toggleUIPanelAction('MatchKillfeed')
  }

  const events = useMemo(() => {
    if (!parser) return []
    const rawKills = getAllKills(parser)
    const annotatedKills = annotateKillstreaks(rawKills, tickRate)
    const ubers: MatchUberEvent[] = getUberPops(parser)
    return [...annotatedKills, ...ubers].sort((a, b) => a.tick - b.tick)
  }, [parser, tickRate])

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

  return (
    <div className="flex items-start">
      <TogglePanelButton onClick={toggleUIPanel}>
        <HiListBulletIcon />
      </TogglePanelButton>

      <TogglePanel showCloseButton isOpen={isOpen} onClickClose={toggleUIPanel}>
        <div className="w-[min(520px,calc(100vw-2rem))] px-6 pb-6 pt-6">
          <div className="relative mb-3 mr-8">
            <input
              type="text"
              placeholder="Filter by player name..."
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              className="w-full rounded-lg bg-white/10 px-3 py-1.5 pr-8 text-sm outline-none placeholder:text-white/40"
            />
            {filterText && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-white/40 transition-colors hover:text-white"
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

          <div className="max-h-[60vh] overflow-y-auto">
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
        </div>
      </TogglePanel>
    </div>
  )
}

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
    const teamColor = teamTextColorMap[teamIdToName(event.medicTeam)] || ''
    return (
      <div
        className="mb-0.5 flex items-center rounded-lg px-2 py-1 text-xs"
        style={{ borderLeft: '3px solid transparent' }}
      >
        <span className="mr-3 w-12 flex-shrink-0 font-mono text-white/50">{timestamp}</span>
        <FilterButton onClick={() => onFilter(event.medicName)} />
        <ClickableName
          name={event.medicName}
          className={cn('font-bold', teamColor)}
          onClick={() => onSeek(event.tick, event.medicEntityId)}
        />
        <span className="ml-2 italic text-yellow-300">popped uber</span>
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

  const iconName = KILL_ICON_ALIASES[weapon] || weapon
  const [weaponIcon, setWeaponIcon] = useState(
    new URL(`/src/assets/kill_icons/${iconName}.png`, import.meta.url).href
  )

  const onWeaponIconError = () => {
    setWeaponIcon(new URL(`/src/assets/kill_icons/skull.png`, import.meta.url).href)
  }

  const killerTeamColor = killer ? teamTextColorMap[killer.user.team] || '' : ''
  const victimTeamColor = teamTextColorMap[victim.user.team] || ''
  const filterName = killer && killer !== victim ? killer.user.name : victim.user.name

  const streakStyle = streak
    ? { borderLeft: `3px solid ${getStreakBorderColor(streak.streakCount)}` }
    : { borderLeft: '3px solid transparent' }

  return (
    <div className="mb-0.5 flex items-center rounded-lg px-2 py-1 text-xs" style={streakStyle}>
      <span className="mr-3 w-12 flex-shrink-0 font-mono text-white/50">{timestamp}</span>
      <FilterButton onClick={() => onFilter(filterName)} />

      {streak && (
        <span
          className={cn(
            'mr-1.5 flex-shrink-0 text-[0.65rem] font-bold leading-none',
            getStreakTextColor(streak.streakCount)
          )}
        >
          {streak.streakCount}K
        </span>
      )}

      <div className="flex min-w-0 flex-1 items-center">
        {killer && killer !== victim && (
          <ClickableName
            name={killer.user.name}
            className={cn('truncate font-bold', killerTeamColor)}
            onClick={() => onSeek(event.tick, killer.user.entityId)}
          />
        )}

        {assister && (
          <>
            <span className={cn('mx-1', killerTeamColor)}>+</span>
            <ClickableName
              name={assister.user.name}
              className={cn('truncate font-bold', killerTeamColor)}
              onClick={() => onSeek(event.tick, assister.user.entityId)}
            />
          </>
        )}

        <div className="mx-2 inline-flex flex-shrink-0 items-center">
          <img
            src={weaponIcon}
            className="h-[0.9rem] brightness-[600%]"
            alt={weapon}
            onError={onWeaponIconError}
          />
        </div>

        <ClickableName
          name={victim.user.name}
          className={cn('truncate font-bold', victimTeamColor)}
          onClick={() => onSeek(event.tick, victim.user.entityId)}
        />
      </div>
    </div>
  )
}

// ─── CLICKABLE NAME ─────────────────────────────────────────────────────────────

const ClickableName = ({
  name,
  className,
  onClick,
}: {
  name: string
  className?: string
  onClick: () => void
}) => (
  <span
    className={cn('cursor-pointer rounded px-0.5 py-1 hover:bg-white/15 active:bg-white/15 active:underline', className)}
    onClick={onClick}
    title={`Watch ${name}'s POV`}
  >
    {name}
  </span>
)

// ─── FILTER BUTTON ──────────────────────────────────────────────────────────────

const FilterButton = ({ onClick }: { onClick: () => void }) => (
  <button
    className="mr-2 flex-shrink-0 rounded p-0.5 text-white/25 transition-colors hover:text-white"
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
