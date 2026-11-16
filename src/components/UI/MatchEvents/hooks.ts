import { useCallback, useMemo } from 'react'
import { create } from 'zustand'

import { goToTickAction, jumpToPlayerPOVCamera } from '@zus/actions'
import { useInstance, useStore } from '@zus/store'
import { buildMatchEvents, MatchEvent, MatchEvents } from '@utils/matchEvents'

/**
 * Whether the match events list is grouped by round: shared by the sidebar and the phone sheet,
 * and not saved, so every visit starts with one list.
 */
export const useGroupByRound = create<{ grouped: boolean; setGrouped: (grouped: boolean) => void }>(
  set => ({ grouped: false, setGrouped: grouped => set({ grouped }) })
)

/** The loaded match's events; rebuilt when a live match's revision moves on. */
export function useMatchEvents(): MatchEvents | null {
  const match = useInstance(state => state.match)
  const revision = match?.revision
  return useMemo(() => (match ? buildMatchEvents(match) : null), [match, revision])
}

/** Seeks a little before a moment (the killfeed seek buffer), and watches a player if given. */
export function useSeekToEvent(tickRate: number) {
  const buffer = useStore(state => state.settings.ui.killfeedSeekBuffer)
  return useCallback(
    (tick: number, entityId?: number) => {
      goToTickAction(Math.max(1, tick - Math.round(buffer * tickRate)))
      if (entityId != null) jumpToPlayerPOVCamera(entityId)
    },
    [buffer, tickRate]
  )
}

/** Index of the last event at or before a tick, or -1 (events are in tick order). */
function lastAtOrBefore(events: { tick: number }[], tick: number) {
  let lo = 0
  let hi = events.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].tick <= tick) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/**
 * The last of these events at or before the playhead. A selector, so the list renders when
 * the playhead passes an event rather than at every tick update (20 a second while playing).
 */
export function useEventAtPlayhead(events: MatchEvent[]): MatchEvent | null {
  const index = useStore(state => lastAtOrBefore(events, state.playback.tick))
  return index >= 0 ? events[index] : null
}

/** The round the playhead is in (0 before the first), changing only as it moves on. */
export function useCurrentRound(data: MatchEvents) {
  return useStore(state => data.rounds.filter(r => r.startTick <= state.playback.tick).length)
}
