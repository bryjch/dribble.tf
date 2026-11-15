import { useLayoutEffect, useMemo, useRef } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { motion } from 'framer-motion'

import {
  IoArrowForwardSharpIcon,
  AiFillStepForwardIcon,
  AiFillFastForwardIcon,
  IoMdPauseIcon,
  IoMdPlayIcon,
  BsBookmarkIcon,
  BsBookmarkFillIcon,
  StickerToolIcon,
} from '@components/Misc/Icons'
import { EventHistoryText } from './EventHistoryText'
import { HudTooltip } from './Shared/Controls'
import { StickerPalette } from './StickerPalette'

import { useInstance, useStore } from '@zus/store'
import {
  changePlaySpeedAction,
  goToTickAction,
  setStickersPanelOpenAction,
  toggleBookmarkAction,
  togglePlaybackAction,
} from '@zus/actions'
import { focusMainCanvas } from '@utils/misc'
import { cn } from '@utils/styling'
import { getDurationFromTicks } from '@utils/parser'
import { useIsMobile } from '@utils/hooks'

/**
 * A theme that docks the playback bar along the bottom edge (`--ui-dock: docked` on
 * .hud-playback) gets --ui-dock-clearance set to how far the bar reaches up the screen, so
 * chat, camera tips, the FPS counter and panels keep clear of it. Measured, not a constant: the
 * bar's height changes with the theme, the screen width (it wraps on phones) and the strip.
 */
const useDockClearance = (theme: string | undefined) => {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const bar = ref.current
    const root = bar?.closest<HTMLElement>('.ui-root')
    if (!bar || !root) return

    const update = () => {
      const docked = getComputedStyle(bar).getPropertyValue('--ui-dock').trim() === 'docked'
      if (!docked) return root.style.removeProperty('--ui-dock-clearance')
      const reach = Math.max(0, Math.ceil(window.innerHeight - bar.getBoundingClientRect().top))
      root.style.setProperty('--ui-dock-clearance', `${reach}px`)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(bar)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      root.style.removeProperty('--ui-dock-clearance')
    }
  }, [theme])

  return ref
}

export const PLAYBACK_SPEED_OPTIONS = [
  { label: '3×', value: 3 },
  { label: '2×', value: 2 },
  { label: '1×', value: 1 },
  { label: '0.5×', value: 0.5 },
  { label: '0.1×', value: 0.1 },
]

interface PlaybackActionProps {
  content: React.ReactNode
  icon: React.ReactNode
  label: string
  onClick?: () => void
  kind?: string
  active?: boolean
  size?: 'small'
  /** Radix doesn't open tooltips on touch, so let a tap open this one. */
  mobileTooltipBypass?: boolean
}

const PlaybackAction = (props: PlaybackActionProps) => (
  <HudTooltip content={props.content} tapToOpen={props.mobileTooltipBypass}>
    <button
      type="button"
      className="hud-transport-btn"
      data-kind={props.kind}
      data-active={props.active ? 'true' : undefined}
      data-size={props.size}
      aria-label={props.label}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      {props.icon}
    </button>
  </HudTooltip>
)

const KeyRow = ({ label, keys }: { label: string; keys: string[] }) => (
  <div className="flex items-center justify-between gap-4">
    <span>{label}</span>
    <span className="flex gap-1">
      {keys.map(key => (
        <kbd key={key}>{key}</kbd>
      ))}
    </span>
  </div>
)

export const PlaybackPanel = () => {
  const match = useInstance(state => state.match)
  const playback = useStore(state => state.playback)
  const bookmarks = useStore(state => state.bookmarks)
  const lastEventHistory = useStore(state => state.eventHistory)?.[0]
  const stickerDragActive = useStore(state => state.drawing.stickerDrag.active)
  const stickersOpen = useStore(state => state.drawing.stickersPanelOpen)
  const { playing, speed, tick, maxTicks, forceShowPanel } = playback
  const isBookmarked = bookmarks.includes(tick)
  const isMobile = useIsMobile()
  const theme = useStore(state => state.settings.ui.theme)
  const dockRef = useDockClearance(theme)

  // A live match's rounds grow while it is watched: look again every ten seconds or so.
  const liveRefresh = match?.kind === 'live' ? Math.floor(maxTicks / 660) : 0
  const rounds = useMemo(() => {
    if (!match) return []
    // Each round from where play began, with the winner of the first round end after it.
    const starts = match.roundStarts()
    return (starts.length ? starts : [1]).map(start => {
      const end = match.rounds.find(round => round.endTick > start)
      return { tick: start, winningTeam: end?.winner || 'none', duration: end?.length }
    })
  }, [match, match?.revision, liveRefresh])

  // Every kill as a mark on the timeline, in the killer's team colour (themes choose to show it).
  const killMarks = useMemo(() => {
    if (!match || maxTicks <= 1) return []
    const marks: { tick: number; team: string }[] = []
    for (const tickKey in match.deaths) {
      for (const death of match.deaths[tickKey]) {
        const team = death.killer && death.killer !== death.victim ? death.killer.user.team : 'none'
        marks.push({ tick: Number(tickKey), team })
      }
    }
    return marks
  }, [match, match?.revision, liveRefresh, maxTicks])

  const toPercent = (t: number) => `${(Math.max(0, t - 1) / Math.max(1, maxTicks - 1)) * 100}%`

  const onClickRound = async (round: any) => {
    await goToTickAction(round.tick)
    focusMainCanvas()
  }

  const togglePlayback = () => {
    togglePlaybackAction()
    focusMainCanvas()
  }

  const changePlaySpeed = (speed: number) => {
    changePlaySpeedAction(speed)
    focusMainCanvas()
  }

  const goToTick = (tick: number) => {
    goToTickAction(tick)
    focusMainCanvas()
  }

  const toggleStickers = () => {
    setStickersPanelOpenAction(!stickersOpen)
  }

  const dimmed = playing && !forceShowPanel && !stickersOpen

  return (
    <div ref={dockRef} className="hud-playback group" data-playing={playing ? 'true' : undefined}>
      {lastEventHistory && (
        <div className={cn('transition-all', playing ? '-mb-16 delay-700 group-hover:mb-0' : '')}>
          <motion.div
            className="hud-event"
            initial={{ opacity: 1, y: 4 }}
            animate={{ opacity: 0, y: 0 }}
            transition={{ duration: 0.6 }}
            key={`${lastEventHistory.type}.${lastEventHistory.timestamp}`}
          >
            <EventHistoryText {...lastEventHistory} />
          </motion.div>
        </div>
      )}

      <div className="hud-transport-row relative mt-4 flex justify-center">
        {!isMobile && (
          <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-4 -translate-x-1/2">
            <motion.div
              className="pointer-events-auto"
              initial={false}
              animate={stickersOpen ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 12, scale: 0.96 }}
              transition={{ duration: 0.18 }}
            >
              {stickersOpen ? <StickerPalette /> : null}
            </motion.div>
          </div>
        )}

        <div className={cn('hud-transport z-20', isMobile && 'gap-3')} data-dimmed={dimmed ? 'true' : undefined}>
          {!isMobile && (
            <PlaybackAction
              mobileTooltipBypass
              label={`Tick ${tick}. Jump to a tick`}
              kind="tick"
              icon={
                <span className="hud-tick-readout">
                  <span className="hud-tick-readout__label">TICK</span>
                  <span className="hud-tick-readout__value">{tick}</span>
                </span>
              }
              content={
                <div className="text-center">
                  <div>Jump to tick</div>
                  <form
                    className="relative mt-2"
                    onSubmit={(e: React.ChangeEvent<HTMLFormElement>) => {
                      e.preventDefault()
                      const tickEl = e.target.elements.namedItem('tick') as HTMLInputElement
                      const newTick = Number(tickEl.value)
                      if (isNaN(newTick)) return
                      goToTick(newTick)
                    }}
                  >
                    <input type="number" name="tick" aria-label="Tick" className="ui-input w-32 pr-8" placeholder="0" />
                    <button
                      type="submit"
                      aria-label="Go to tick"
                      className="absolute bottom-0 right-0 top-0 flex aspect-square items-center justify-center"
                    >
                      <IoArrowForwardSharpIcon />
                    </button>
                  </form>

                  <div className="ui-muted mt-2 flex justify-between text-xs">
                    <span>Total ticks</span>
                    <span className="font-bold tabular-nums">{maxTicks}</span>
                  </div>
                </div>
              }
            />
          )}

          <PlaybackAction
            label="Jump to start"
            icon={<AiFillFastForwardIcon className="rotate-180" />}
            content="Jump to start"
            onClick={goToTick.bind(null, 1)}
          />

          <PlaybackAction
            label="Seek back"
            icon={<AiFillStepForwardIcon className="rotate-180" />}
            content={
              <div className="flex min-w-36 flex-col gap-1">
                <div className="text-center font-semibold">Seek back</div>
                <KeyRow label="1 tick" keys={[',']} />
                <KeyRow label="50 ticks" keys={['←']} />
              </div>
            }
            onClick={goToTick.bind(null, tick - 50)}
          />

          <PlaybackAction
            label={playing ? 'Pause' : 'Play'}
            kind="play"
            icon={playing ? <IoMdPauseIcon /> : <IoMdPlayIcon />}
            content={<KeyRow label="Play / pause" keys={['Space']} />}
            onClick={togglePlayback}
          />

          <PlaybackAction
            label="Seek forward"
            icon={<AiFillStepForwardIcon />}
            content={
              <div className="flex min-w-36 flex-col gap-1">
                <div className="text-center font-semibold">Seek forward</div>
                <KeyRow label="1 tick" keys={['.']} />
                <KeyRow label="50 ticks" keys={['→']} />
              </div>
            }
            onClick={goToTick.bind(null, tick + 50)}
          />

          <PlaybackAction
            label="Jump to end"
            icon={<AiFillFastForwardIcon />}
            content="Jump to end"
            onClick={goToTick.bind(null, maxTicks)}
          />

          {!isMobile && (
            <PlaybackAction
              mobileTooltipBypass
              label={`Playback speed ${speed}×`}
              kind="speed"
              icon={<span className="hud-speed-chip">{speed}×</span>}
              content={
                <div className="flex flex-col gap-3">
                  <div className="text-center font-semibold">Playback speed</div>
                  <div className="ui-seg" role="radiogroup" aria-label="Playback speed">
                    {[...PLAYBACK_SPEED_OPTIONS].reverse().map(({ label, value }) => (
                      <button
                        key={`play-speed-option-${label}`}
                        type="button"
                        role="radio"
                        aria-checked={value === speed}
                        className="ui-seg__item"
                        data-active={value === speed}
                        onClick={() => changePlaySpeed(Number(value))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between gap-4 text-sm">
                    <KeyRow label="Faster" keys={['↑']} />
                    <KeyRow label="Slower" keys={['↓']} />
                  </div>
                </div>
              }
            />
          )}

          <PlaybackAction
            label={isBookmarked ? 'Remove bookmark' : 'Bookmark this tick'}
            kind="bookmark"
            size="small"
            active={isBookmarked}
            icon={isBookmarked ? <BsBookmarkFillIcon /> : <BsBookmarkIcon />}
            content={<KeyRow label="Toggle bookmark" keys={['B']} />}
            onClick={() => {
              toggleBookmarkAction()
              focusMainCanvas()
            }}
          />

          {!isMobile && (
            <PlaybackAction
              label="Stickers"
              kind="stickers"
              active={stickersOpen || stickerDragActive}
              icon={
                <span>
                  <StickerToolIcon />
                </span>
              }
              content={<KeyRow label="Toggle stickers" keys={['G']} />}
              onClick={toggleStickers}
            />
          )}
        </div>
      </div>

      <div className="hud-timeline">
        <div className="relative">
          <Slider.Root
            className="hud-timeline__slider"
            min={1}
            max={maxTicks}
            value={[tick]}
            step={1}
            aria-label="Timeline"
            onValueChange={([value]) => goToTick(value)}
          >
            <Slider.Track className={cn('hud-timeline__track', isMobile && 'h-3')}>
              <div className="hud-timeline__rounds" aria-hidden>
                {rounds.map((round, index) => (
                  <div
                    key={`round-seg-${index}`}
                    className="hud-timeline__round"
                    data-winner={round.winningTeam}
                    style={{
                      left: toPercent(index === 0 ? 1 : round.tick),
                      width: `calc(${toPercent(rounds[index + 1]?.tick ?? maxTicks)} - ${toPercent(index === 0 ? 1 : round.tick)})`,
                    }}
                  />
                ))}
              </div>
              <Slider.Range className="hud-timeline__range" />
              <div className="hud-timeline__kills" aria-hidden>
                {killMarks.map((mark, index) => (
                  <span
                    key={`kill-${index}`}
                    className="hud-timeline__kill"
                    data-team={mark.team}
                    data-past={mark.tick <= tick ? 'true' : undefined}
                    style={{ left: toPercent(mark.tick) }}
                  />
                ))}
              </div>
            </Slider.Track>
            <Slider.Thumb className="hud-timeline__thumb" aria-label="Playhead" />
          </Slider.Root>

          {bookmarks.map(bookmarkTick => (
            <button
              key={`bookmark-marker-${bookmarkTick}`}
              type="button"
              className="hud-timeline__marker"
              aria-label={`Go to bookmark at tick ${bookmarkTick}`}
              style={{ left: toPercent(bookmarkTick) }}
              onClick={() => goToTick(bookmarkTick)}
            />
          ))}
        </div>

        <div className="hud-timeline__meta">
          <div className="hud-rounds">
            <span className="hud-rounds__label hud-text">Round</span>

            {rounds.map((round, index) => (
              <button
                key={`jump-to-round-${index}`}
                type="button"
                className={cn('hud-round', isMobile && 'h-8 w-8')}
                data-reached={round.tick <= tick}
                data-winner={round.winningTeam}
                aria-label={`Round ${index + 1}${round.winningTeam !== 'none' ? `, won by ${round.winningTeam === 'blue' ? 'BLU' : 'RED'}` : ''}`}
                onClick={onClickRound.bind(null, round)}
              >
                <span className="relative">{index + 1}</span>
              </button>
            ))}
          </div>

          <div className="hud-clock hud-text">
            {match?.kind === 'live' && (
              <LiveBadge
                atEdge={maxTicks - tick < 2 / match.intervalPerTick}
                onClick={() => goToTick(maxTicks)}
              />
            )}
            <span className="hud-clock__now">{getDurationFromTicks(tick).formatted}</span>
            <span className="hud-clock__sep">/</span>
            <span className="hud-clock__total">{getDurationFromTicks(maxTicks).formatted}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// A live match from stv.tf: red while playback is at the edge, otherwise a button back to it.
const LiveBadge = ({ atEdge, onClick }: { atEdge: boolean; onClick: () => void }) => (
  <button
    className="hud-live pointer-events-auto"
    data-at-edge={atEdge ? 'true' : undefined}
    title={atEdge ? 'Watching live' : 'Back to live'}
    onClick={onClick}
  >
    LIVE
  </button>
)
