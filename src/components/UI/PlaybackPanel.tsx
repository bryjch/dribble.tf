import { useMemo, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as Slider from '@radix-ui/react-slider'
import { motion } from 'framer-motion'

import {
  IoArrowForwardSharpIcon,
  AiFillStepForwardIcon,
  AiFillFastForwardIcon,
  IoMdPauseIcon,
  IoMdPlayIcon,
} from '@components/Misc/Icons'
import { EventHistoryText } from './EventHistoryText'

import { useInstance, useStore } from '@zus/store'
import { goToTickAction, togglePlaybackAction, changePlaySpeedAction } from '@zus/actions'
import { focusMainCanvas } from '@utils/misc'
import { cn } from '@utils/styling'
import { getDurationFromTicks } from '@utils/parser'

// Since parser only returns round ends (not round starts) we need to
// account for the humiliation period before it resets
const ROUND_HUMILIATION_BUFFER_TICKS = 300

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
  onClick?: () => void
  /**
   * Radix doesn't display tooltips on mobile, so we need a way to force show it
   * https://github.com/radix-ui/primitives/issues/1573
   */
  mobileTooltipBypass?: boolean
}

const PlaybackAction = (props: PlaybackActionProps) => {
  const [open, setOpen] = useState(false)

  let bypassProps = { root: {}, trigger: {} }

  if (props.mobileTooltipBypass) {
    bypassProps = {
      root: { open, onOpenChange: setOpen },
      trigger: {
        onClick: () => setOpen(prevOpen => !prevOpen),
        onFocus: () => setTimeout(() => setOpen(true), 0),
        onBlur: () => setOpen(false),
      },
    }
  }

  return (
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root {...bypassProps.root}>
        <Tooltip.Trigger asChild {...bypassProps.trigger}>
          <div
            className={cn(
              'cursor-pointer opacity-80',
              'transform transition-all hover:scale-125 hover:opacity-100'
            )}
            onClick={props.onClick}
          >
            {props.icon}
          </div>
        </Tooltip.Trigger>

        <Tooltip.Portal>
          <Tooltip.Content sideOffset={5}>
            <div className="rounded-lg bg-pp-panel/90 px-4 py-3">{props.content}</div>
            <Tooltip.Arrow className="fill-pp-panel/90" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

export const PlaybackPanel = () => {
  const parsedDemo = useInstance(state => state.parsedDemo)
  const playback = useStore(state => state.playback)
  const lastEventHistory = useStore(state => state.eventHistory)?.[0]
  const { playing, speed, tick, maxTicks, forceShowPanel } = playback

  const rounds = useMemo(() => {
    const result = [
      {
        tick: ROUND_HUMILIATION_BUFFER_TICKS,
        winningTeam: parsedDemo?.rounds[0]?.winner || 'none',
        duration: parsedDemo?.rounds[0]?.length,
      },
    ]

    // The last round is always the end of the demo, so we can ignore it
    parsedDemo?.rounds?.slice(0, -1).forEach((round, index) => {
      result.push({
        tick: round.endTick + ROUND_HUMILIATION_BUFFER_TICKS,
        winningTeam: parsedDemo?.rounds[index + 1]?.winner || 'none',
        duration: parsedDemo?.rounds[index + 1]?.length,
      })
    })

    return result
  }, [parsedDemo?.rounds])

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

  return (
    <div className={cn('group relative m-4 max-w-full rounded-2xl px-6 py-2')}>
      {lastEventHistory && (
        <div className={cn('transition-all', playing ? '-mb-16 delay-700 group-hover:mb-0' : '')}>
          <motion.div
            className="pointer-events-none inline-block rounded-3xl bg-black/70 p-2"
            initial={{ opacity: 1, y: 4 }}
            animate={{ opacity: 0, y: 0 }}
            transition={{ duration: 0.6 }}
            key={`${lastEventHistory.type}.${lastEventHistory.timestamp}`}
          >
            <EventHistoryText type={lastEventHistory.type} />
          </motion.div>
        </div>
      )}

      <div
        className={cn(
          'mt-4 flex items-center justify-center gap-6 rounded-full px-5 py-3 transition-all duration-500',
          playing && !forceShowPanel ? 'scale-90 opacity-0 delay-700' : 'bg-black/70 delay-0',
          'group-hover:scale-100 group-hover:bg-black/70 group-hover:opacity-100 group-hover:delay-0'
        )}
      >
        {/* Jump to tick action */}

        <PlaybackAction
          mobileTooltipBypass
          icon={
            <div className="-mr-1 flex min-w-11 select-none flex-col items-center text-center">
              <div className="text-xs leading-none">TICK</div>
              <div className="font-bold leading-none">{tick * 2}</div>
            </div>
          }
          content={
            <div className="text-center">
              <div>Jump to tick</div>
              <form
                className="relative mt-2 text-black"
                onSubmit={(e: React.ChangeEvent<HTMLFormElement>) => {
                  e.preventDefault()
                  const tickEl = e.target.elements.namedItem('tick') as HTMLInputElement
                  const newTick = Number(tickEl.value)
                  if (isNaN(newTick)) return
                  goToTick(newTick / 2)
                }}
              >
                <input
                  type="number"
                  name="tick"
                  className="w-28 rounded bg-white py-1 pl-2 pr-7"
                  placeholder="0"
                />
                <button
                  type="submit"
                  className="absolute bottom-0 right-0 top-0 ml-2 flex aspect-square items-center justify-center"
                >
                  <IoArrowForwardSharpIcon />
                </button>
              </form>

              <div className="mt-2 flex justify-between text-xs opacity-80">
                <div>Total Ticks</div>
                <div className="font-bold">{maxTicks * 2}</div>
              </div>
            </div>
          }
        />

        {/* Jump to start action */}

        <PlaybackAction
          icon={<AiFillFastForwardIcon width="1.75rem" height="1.75rem" className="rotate-180" />}
          content={<div>Jump to start</div>}
          onClick={goToTick.bind(null, 1)}
        />

        {/* Seek back action */}

        <PlaybackAction
          icon={<AiFillStepForwardIcon width="1.75rem" height="1.75rem" className="rotate-180" />}
          content={
            <div className="grid grid-cols-[auto,auto] gap-x-4 gap-y-1">
              <div className="col-span-2 text-center">Seek back</div>
              <div>1 tick</div>
              <kbd>,</kbd>
              <div>50 ticks</div>
              <kbd>←</kbd>
            </div>
          }
          onClick={goToTick.bind(null, tick - 50)}
        />

        {/* Toggle play / pause action */}

        <PlaybackAction
          icon={
            playing ? (
              <IoMdPauseIcon width="1.75rem" height="1.75rem" />
            ) : (
              <IoMdPlayIcon width="1.75rem" height="1.75rem" />
            )
          }
          content={
            <div>
              Play / Pause <kbd className="ml-2">Space</kbd>
            </div>
          }
          onClick={togglePlayback}
        />

        {/* Seek forward action */}

        <PlaybackAction
          icon={<AiFillStepForwardIcon width="1.75rem" height="1.75rem" />}
          content={
            <div className="grid grid-cols-[auto,auto] gap-x-4 gap-y-1">
              <div className="col-span-2 text-center">Seek forward</div>
              <div>1 tick</div>
              <kbd>.</kbd>
              <div>50 ticks</div>
              <kbd>→</kbd>
            </div>
          }
          onClick={goToTick.bind(null, tick + 50)}
        />

        {/* Jump to end action */}

        <PlaybackAction
          icon={<AiFillFastForwardIcon width="1.75rem" height="1.75rem" />}
          content={<div>Jump to end</div>}
          onClick={goToTick.bind(null, maxTicks)}
        />

        {/* Change play speed action */}

        <PlaybackAction
          mobileTooltipBypass
          icon={
            <div className="select-none rounded-3xl bg-white/90 px-2 text-sm text-black">
              {speed}×
            </div>
          }
          content={
            <>
              <div className="text-center">Playback speed</div>

              <div
                className="mt-2 grid gap-1"
                style={{
                  gridTemplateColumns: `repeat(${PLAYBACK_SPEED_OPTIONS.length}, minmax(0, 1fr))`,
                }}
              >
                {[...PLAYBACK_SPEED_OPTIONS].reverse().map(({ label, value }) => (
                  <button
                    key={`play-speed-option-${label}`}
                    className={cn(
                      'flex-1 rounded border border-transparent px-2 py-1 text-center',
                      'hover:border-white',
                      value === speed && 'bg-white text-black'
                    )}
                    onClick={() => changePlaySpeed(Number(value))}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-[auto,auto] gap-x-4 gap-y-1">
                <div className="flex justify-start">
                  Increase <kbd className="ml-2">↑</kbd>
                </div>

                <div className="flex justify-end">
                  Decrease <kbd className="ml-2">↓</kbd>
                </div>
              </div>
            </>
          }
        />
      </div>

      <div className="-ml-[5%] mt-3 w-[110%]">
        {/* Timeline slider */}

        <Slider.Root
          className="relative flex w-full cursor-pointer select-none items-center"
          min={1}
          max={maxTicks}
          value={[tick]}
          step={1}
          onValueChange={([value]) => goToTick(value)}
        >
          <Slider.Track className="relative h-2 grow rounded-full bg-pp-panel/30">
            <Slider.Range className="absolute h-full rounded-full bg-white" />
          </Slider.Track>
        </Slider.Root>

        <div className="mt-2 flex items-center justify-between">
          {/* Rounds (Jump to round) */}

          <div className="flex items-center text-sm">
            <div className="text-outline mr-2">Round</div>

            {rounds.map((round, index) => (
              <div
                key={`jump-to-round-${index}`}
                className={cn(
                  'relative mr-2 flex h-5 w-5 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-pp-panel/40 text-sm hover:opacity-80',
                  round.tick <= tick && 'bg-white text-black'
                )}
                onClick={onClickRound.bind(null, round)}
              >
                <span>{index + 1}</span>

                <div
                  className={cn(
                    'absolute -bottom-2 -right-2 h-4 w-4 rotate-45',
                    round.winningTeam === 'red' && 'bg-pp-killfeed-text-red',
                    round.winningTeam === 'blue' && 'bg-pp-killfeed-text-blue'
                  )}
                />
              </div>
            ))}
          </div>

          {/* Duration (Current Time / Total Time) */}

          <div className="text-outline text-sm">
            {getDurationFromTicks(tick).formatted} / {getDurationFromTicks(maxTicks).formatted}
          </div>
        </div>
      </div>
    </div>
  )
}
