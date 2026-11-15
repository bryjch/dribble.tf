import { dispatch, getState, useInstance, useStore } from '@zus/store'

//
// ─── PLAYBACK CLOCK ─────────────────────────────────────────────────────────────
//
// The tick being drawn, fractional, moved on every frame inside the render loop (see
// PlaybackDriver). The store's playback.tick is its whole-tick shadow for the interface,
// updated at most every HUD_INTERVAL_MS while playing, so React renders the HUD a few times a
// second instead of the whole viewer every tick.
//

/** How often, at most, the store's tick follows the clock while playing. */
export const HUD_INTERVAL_MS = 50
/** A longer frame (a hidden tab, a stall) moves playback on by this much at most. */
const MAX_FRAME_SECONDS = 0.25

let clockTick = 1
let lastSync = 0

/** The tick being drawn; fractional while playing. */
export const getClockTick = () => clockTick

/** Puts the clock at a tick (a seek). */
export const setClockTick = (tick: number) => {
  followStore()
  const { maxTicks } = getState().playback
  clockTick = Math.min(Math.max(tick, 1), Math.max(1, maxTicks))
}

// Anything that moves the store's tick (a seek, a new match) moves the clock with it; the
// clock's own updates match it already. Subscribed on first use, as the store may still be
// loading when this module is.
let following = false
const followStore = () => {
  if (following) return
  following = true
  useStore.subscribe((state, previous) => {
    const { tick } = state.playback
    if (tick !== previous.playback.tick && tick !== Math.floor(clockTick)) clockTick = tick
  })
}

/** Moves the clock on by a frame and returns the tick to draw. */
export function advanceClock(deltaSeconds: number): number {
  followStore()
  const { playing, speed, maxTicks, intervalPerTick, tick } = getState().playback
  const end = Math.max(1, maxTicks)

  if (playing) {
    const seconds = Math.min(Math.max(deltaSeconds, 0), MAX_FRAME_SECONDS)
    clockTick += (seconds * speed) / (intervalPerTick || 0.015)
    if (clockTick >= end) {
      clockTick = end
      // A demo stops at its end; a live match waits at its edge for the next snapshot.
      if (useInstance.getState().match?.kind !== 'live') {
        dispatch({ type: 'TOGGLE_PLAYBACK', payload: false })
      }
    }
  }
  clockTick = Math.min(Math.max(clockTick, 1), end)

  const whole = Math.floor(clockTick)
  const now = performance.now()
  if (whole !== tick && (!playing || now - lastSync >= HUD_INTERVAL_MS)) {
    lastSync = now
    dispatch({ type: 'GO_TO_TICK', payload: whole })
  }
  return clockTick
}
