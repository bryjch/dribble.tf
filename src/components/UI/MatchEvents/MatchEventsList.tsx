import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { HudTooltip, Segmented } from '@components/UI/Shared/Controls'
import {
  applyFilter,
  drawerFilterCount,
  emptyFilter,
  EventFilter,
  HIGHLIGHTS,
  KIND_GROUPS,
  roleCounts,
} from '@utils/matchEventFilter'
import type { MatchEvent, MatchEvents } from '@utils/matchEvents'

import { clock, EventRow, RoundSummary, teamLabel } from './EventRow'
import { PlayerCard } from './PlayerCard'
import { useCurrentRound, useEventAtPlayhead, useGroupByRound, useSeekToEvent } from './hooks'

//
// ─── MATCH EVENTS LIST ──────────────────────────────────────────────────────────
//
// Every moment of the match, in order and timed as the playback bar is, with a button per round
// up top. Grouping by round is a toggle (off to begin with). Filters sit in a drawer; a name
// picks that player, whose events alone show, as one list, with a chip each for their kills,
// deaths, übers and drops.
//
// The list keeps the event at the playhead in view. Scrolling it yourself stops that, and a
// "Jump to now" button (or picking an event) brings it back.
//

const toggleIn = <T,>(list: T[], value: T) =>
  list.includes(value) ? list.filter(v => v !== value) : [...list, value]

type Where = 'visible' | 'above' | 'below' | 'none'

/** Under the sticky round header counts as out of view. */
const STICKY_HEADER_PX = 36

/**
 * What actually scrolls the list: its own box in the sidebar, or a container around it that
 * scrolls instead (the phone's sheet body, where the list grows to its full height).
 */
function scrollingBox(list: HTMLElement): HTMLElement {
  for (let el: HTMLElement | null = list; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 1)
      return el
  }
  return list
}

const IconToggle = ({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string
  pressed?: boolean
  onClick: () => void
  children: React.ReactNode
}) => (
  <HudTooltip content={label} side="bottom">
    <button
      type="button"
      className="ui-icon-toggle"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  </HudTooltip>
)

export const MatchEventsList = ({
  data,
  scrollsItself = true,
}: {
  data: MatchEvents
  /** False where a container around the list scrolls it (a phone sheet). */
  scrollsItself?: boolean
}) => {
  const seek = useSeekToEvent(data.tickRate)
  const { grouped, setGrouped: saveGrouped } = useGroupByRound()
  const scroller = useRef<HTMLDivElement>(null)

  const [filter, setFilter] = useState<EventFilter>(emptyFilter)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [following, setFollowing] = useState(true)
  const [nowWhere, setNowWhere] = useState<Where>('visible')

  const currentRound = useCurrentRound(data)
  // Every round but the one being watched starts collapsed.
  const [collapsed, setCollapsed] = useState<Set<number>>(
    () => new Set(data.rounds.map(r => r.round).filter(r => r !== currentRound))
  )

  const player =
    filter.player != null ? data.players.find(p => p.entityId === filter.player) : undefined
  const flat = player != null || !grouped

  const shown = useMemo(() => {
    const events = applyFilter(data.events, filter)
    // Round starts are what a grouped list's headers already say.
    return events.filter(e => e.kind !== 'roundStart' || !flat)
  }, [data.events, filter, flat])

  const counts = useMemo(
    () =>
      player
        ? roleCounts(applyFilter(data.events, { ...filter, role: null }), player.entityId)
        : null,
    [data.events, filter, player]
  )

  const byRound = useMemo(() => {
    const map = new Map<number, MatchEvent[]>()
    for (const e of shown) {
      if (e.kind === 'roundStart') continue
      if (!map.has(e.round)) map.set(e.round, [])
      map.get(e.round)!.push(e)
    }
    return map
  }, [shown])

  const nowEvent = useEventAtPlayhead(shown)
  const nowTick = nowEvent?.tick ?? 0

  // ── Keeping the event at the playhead in view ──
  const rowOf = useCallback(
    (id: number | undefined) =>
      id == null ? null : scroller.current?.querySelector(`[data-event-id="${id}"]`),
    []
  )

  const locateNow = useCallback((): Where => {
    const box = scroller.current && scrollingBox(scroller.current)
    const row = rowOf(nowEvent?.id)
    if (!box || !row) return 'none'
    const b = box.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    if (r.bottom < b.top + (flat ? 0 : STICKY_HEADER_PX)) return 'above'
    if (r.top > b.bottom) return 'below'
    return 'visible'
  }, [nowEvent, rowOf, flat])

  // The watched round opens as playback reaches it, while following.
  useEffect(() => {
    if (!following || !currentRound) return
    setCollapsed(c => {
      if (!c.has(currentRound)) return c
      const next = new Set(c)
      next.delete(currentRound)
      return next
    })
  }, [currentRound, following])

  useLayoutEffect(() => {
    if (following) rowOf(nowEvent?.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setNowWhere(locateNow())
  }, [nowEvent, following, collapsed, flat, rowOf, locateNow])

  // Scrolling (whichever box does it) moves "now" in or out of view.
  useEffect(() => {
    if (!scroller.current) return
    const box = scrollingBox(scroller.current)
    const onScroll = () => setNowWhere(locateNow())
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => box.removeEventListener('scroll', onScroll)
  }, [locateNow, shown, collapsed])

  const stopFollowing = () => setFollowing(false)

  const jumpToNow = () => {
    if (nowEvent && nowEvent.round > 0) {
      setCollapsed(c => {
        const next = new Set(c)
        next.delete(nowEvent.round)
        return next
      })
    }
    setFollowing(true)
  }

  // ── Actions ──
  const onSeek = useCallback(
    (tick: number, entityId?: number) => {
      seek(tick, entityId)
      // The picked event is now: follow from there.
      setFollowing(true)
    },
    [seek]
  )

  const onPlayer = useCallback(
    (entityId: number) => setFilter(f => ({ ...f, player: entityId, role: null })),
    []
  )

  const scrollToRound = (round: number) => {
    setCollapsed(c => {
      const next = new Set(c)
      next.delete(round)
      return next
    })
    setFollowing(false)
    requestAnimationFrame(() =>
      scroller.current
        ?.querySelector(`[data-round="${round}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    )
  }

  const toggleRound = (round: number) => {
    setFollowing(false)
    setCollapsed(c => {
      const next = new Set(c)
      next.has(round) ? next.delete(round) : next.add(round)
      return next
    })
  }

  const allCollapsed = data.rounds.every(r => collapsed.has(r.round))
  const toggleAll = () => {
    setFollowing(false)
    setCollapsed(allCollapsed ? new Set() : new Set(data.rounds.map(r => r.round)))
  }

  const setGrouped = (value: boolean) => {
    setFollowing(true)
    saveGrouped(value)
  }

  const narrowed = filter.team != null || filter.highlights.length > 0
  const isCollapsed = (round: number) =>
    collapsed.has(round) ||
    (narrowed && !(byRound.get(round) ?? []).some(e => e.kind === 'kill' || e.kind === 'uber'))

  const filterCount = drawerFilterCount(filter)
  const highlightMode =
    filter.highlights.length === HIGHLIGHTS.length
      ? 'highlights'
      : filter.highlights.length === 0
        ? 'all'
        : 'some'

  const row = (e: MatchEvent) => (
    <EventRow
      key={e.id}
      event={e}
      data={data}
      now={e.id === nowEvent?.id}
      future={e.tick > nowTick}
      onSeek={onSeek}
      onPlayer={onPlayer}
    />
  )

  const jump = !following && nowEvent && nowWhere !== 'visible' && (
    <button type="button" className="ui-jump-now" onClick={jumpToNow}>
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
        <path
          fillRule="evenodd"
          d={
            nowWhere === 'above'
              ? 'M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z'
              : 'M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z'
          }
          clipRule="evenodd"
        />
      </svg>
      Jump to now
      <span className="ui-jump-now__time">{clock(nowEvent.tick, data.tickRate)}</span>
    </button>
  )

  return (
    <>
      {/* Rounds, and how the list is laid out */}
      <div className="flex items-start gap-2 border-b border-ui-line/30 px-3 py-2">
        <div className="flex flex-1 flex-wrap gap-1">
          {data.rounds.map(r => (
            <button
              key={r.round}
              type="button"
              className="ui-round-pill"
              data-team={r.winner ?? undefined}
              data-current={r.round === currentRound}
              title={r.winner ? `Round ${r.round}: ${teamLabel(r.winner)} won` : `Round ${r.round}`}
              onClick={() => scrollToRound(r.round)}
            >
              R{r.round}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!flat && (
            <IconToggle
              label={allCollapsed ? 'Expand all rounds' : 'Collapse all rounds'}
              onClick={toggleAll}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
                {allCollapsed ? (
                  <path
                    fillRule="evenodd"
                    d="M10 3a.75.75 0 01.55.24l3.25 3.5a.75.75 0 11-1.1 1.02L10 4.852 7.3 7.76a.75.75 0 01-1.1-1.02l3.25-3.5A.75.75 0 0110 3zm-3.76 9.2a.75.75 0 011.06.04l2.7 2.908 2.7-2.908a.75.75 0 111.1 1.02l-3.25 3.5a.75.75 0 01-1.1 0l-3.25-3.5a.75.75 0 01.04-1.06z"
                    clipRule="evenodd"
                  />
                ) : (
                  <path
                    fillRule="evenodd"
                    d="M5.22 2.22a.75.75 0 011.06 0L10 5.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 3.28a.75.75 0 010-1.06zm0 15.56a.75.75 0 001.06 0L10 14.06l3.72 3.72a.75.75 0 101.06-1.06l-4.25-4.25a.75.75 0 00-1.06 0l-4.25 4.25a.75.75 0 000 1.06z"
                    clipRule="evenodd"
                  />
                )}
              </svg>
            </IconToggle>
          )}
          {!player && (
            <IconToggle
              label={grouped ? 'Grouped by round' : 'Group by round'}
              pressed={grouped}
              onClick={() => setGrouped(!grouped)}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
                <path d="M3 4.5A1.5 1.5 0 014.5 3h11A1.5 1.5 0 0117 4.5v2A1.5 1.5 0 0115.5 8h-11A1.5 1.5 0 013 6.5v-2z" />
                <path d="M3 12.25a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75zM3 16.25a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75z" />
              </svg>
            </IconToggle>
          )}
        </div>
      </div>

      {/* One quiet row; the rest of the filters live in the drawer */}
      <div className="ui-sidebar__bar">
        <Segmented
          label="Which events"
          value={highlightMode}
          onChange={mode =>
            setFilter(f => ({
              ...f,
              highlights: mode === 'highlights' ? HIGHLIGHTS.map(h => h.key) : [],
            }))
          }
          options={[
            { label: 'All', value: 'all' },
            { label: 'Highlights', value: 'highlights' },
          ]}
        />
        <button
          type="button"
          className="ui-chip"
          aria-pressed={drawerOpen}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(!drawerOpen)}
        >
          Filters
          {filterCount > 0 && <span className="ui-chip__count">{filterCount}</span>}
          <span aria-hidden>{drawerOpen ? '▴' : '▾'}</span>
        </button>
        {(filterCount > 0 || player) && (
          <button
            type="button"
            className="ui-btn ui-btn--ghost ui-btn--small"
            onClick={() => setFilter(emptyFilter())}
          >
            Reset
          </button>
        )}
      </div>

      {drawerOpen && (
        <div className="mx-3 mb-2 grid grid-cols-[4.5rem_1fr] items-center gap-x-2 gap-y-1.5 rounded-control border border-ui-line/30 p-2 text-[0.7rem]">
          <span className="ui-muted font-bold uppercase tracking-wide">Team</span>
          <div className="flex gap-1">
            {(['blue', 'red'] as const).map(team => (
              <button
                key={team}
                type="button"
                className="ui-chip"
                data-team={team}
                aria-pressed={filter.team === team}
                title={`${teamLabel(team)}'s kills and übers`}
                onClick={() => setFilter(f => ({ ...f, team: f.team === team ? null : team }))}
              >
                {teamLabel(team)}
              </button>
            ))}
          </div>
          <span className="ui-muted font-bold uppercase tracking-wide">Show</span>
          <div className="flex flex-wrap gap-1">
            {KIND_GROUPS.map(k => (
              <button
                key={k.key}
                type="button"
                className="ui-chip"
                aria-pressed={filter.kinds.includes(k.key)}
                onClick={() => setFilter(f => ({ ...f, kinds: toggleIn(f.kinds, k.key) }))}
              >
                {k.label}
              </button>
            ))}
          </div>
          <span className="ui-muted font-bold uppercase tracking-wide">Only</span>
          <div className="flex flex-wrap gap-1">
            {HIGHLIGHTS.map(h => (
              <button
                key={h.key}
                type="button"
                className="ui-chip"
                aria-pressed={filter.highlights.includes(h.key)}
                onClick={() =>
                  setFilter(f => ({ ...f, highlights: toggleIn(f.highlights, h.key) }))
                }
              >
                {h.label}
              </button>
            ))}
          </div>
          <span className="ui-muted font-bold uppercase tracking-wide">Player</span>
          <span className="ui-muted">Click a name in the list.</span>
        </div>
      )}

      {player && counts && (
        <div className="px-3 pb-2">
          <PlayerCard
            player={player}
            counts={counts}
            role={filter.role}
            onRole={role => setFilter(f => ({ ...f, role }))}
            onClose={() => setFilter(f => ({ ...f, player: null, role: null }))}
          />
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          className={scrollsItself ? 'ui-scroll h-full overflow-y-auto px-2 pb-24' : 'px-1 pb-6'}
          onWheel={stopFollowing}
          onTouchMove={stopFollowing}
        >
          {flat ? (
            <div className="flex flex-col gap-px py-1">
              {shown.map((e, i) => (
                <div key={e.id} className="contents">
                  {/* Where a round's events begin, for its button to scroll to. */}
                  {e.round > 0 && shown[i - 1]?.round !== e.round && <div data-round={e.round} />}
                  {row(e)}
                </div>
              ))}
              {shown.length === 0 && (
                <div className="ui-empty-note">Nothing matches these filters.</div>
              )}
            </div>
          ) : (
            <>
              {(byRound.get(0)?.length ?? 0) > 0 && (
                <div className="ui-muted px-1 py-1 text-[0.65rem]">
                  {byRound.get(0)!.length} events before round 1
                </div>
              )}
              {data.rounds.map(round => {
                const events = byRound.get(round.round) ?? []
                const closed = isCollapsed(round.round)
                return (
                  <section key={round.round} data-round={round.round} className="mb-1">
                    <button
                      type="button"
                      className="ui-round-header"
                      data-current={round.round === currentRound}
                      aria-expanded={!closed}
                      onClick={() => toggleRound(round.round)}
                    >
                      <span className="ui-muted w-3" aria-hidden>
                        {closed ? '▸' : '▾'}
                      </span>
                      <RoundSummary
                        round={round}
                        events={events}
                        data={data}
                        current={round.round === currentRound}
                      />
                    </button>
                    {!closed && <div className="flex flex-col gap-px py-1">{events.map(row)}</div>}
                  </section>
                )
              })}
            </>
          )}

          {/* In a sheet, pinned to the bottom of the sheet's body, which scrolls the list */}
          {jump && !scrollsItself && <div className="ui-jump-now-dock">{jump}</div>}
        </div>
        {/* In the sidebar, over the bottom of the list's own box */}
        {jump && scrollsItself && <div className="ui-jump-now-overlay">{jump}</div>}
      </div>
    </>
  )
}
