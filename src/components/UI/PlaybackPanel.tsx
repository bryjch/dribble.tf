import * as Tooltip from '@radix-ui/react-tooltip'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
  PauseIcon,
  PlayIcon,
} from '@radix-ui/react-icons'

import { useStore } from '@zus/store'
import { goToTickAction, togglePlaybackAction, changePlaySpeedAction } from '@zus/actions'
import { focusMainCanvas } from '@utils/misc'
import { cn } from '@utils/styling'

export const PLAYBACK_SPEED_OPTIONS = [
  { label: '3x', value: 3 },
  { label: '2x', value: 2 },
  { label: '1x', value: 1 },
  { label: '0.5x', value: 0.5 },
  { label: '0.1x', value: 0.1 },
]

interface PlaybackActionProps {
  content: React.ReactNode
  icon: React.ReactNode
  onClick?: () => void
}

const PlaybackAction = (props: PlaybackActionProps) => {
  return (
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div className="cursor-pointer" onClick={props.onClick}>
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
  const playback = useStore(state => state.playback)
  const { playing, speed, tick, maxTicks } = playback

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
    <div className="m-4 max-w-full">
      <div className="pointer-events-none select-none">Tick #{tick * 2}</div>

      <div className="mt-3 flex items-center justify-center gap-4">
        {/* Spacer to match play speed width (looks more balanced) */}

        <span className="w-[32px]" />

        {/* Jump to start action */}

        <PlaybackAction
          icon={<DoubleArrowLeftIcon width="2rem" height="2rem" />}
          content={<div>Jump to start</div>}
          onClick={goToTick.bind(null, 1)}
        />

        {/* Seek back action */}

        <PlaybackAction
          icon={<ChevronLeftIcon width="2rem" height="2rem" />}
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
              <PauseIcon width="2rem" height="2rem" />
            ) : (
              <PlayIcon width="2rem" height="2rem" />
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
          icon={<ChevronRightIcon width="2rem" height="2rem" />}
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
          icon={<DoubleArrowRightIcon width="2rem" height="2rem" />}
          content={<div>Jump to end</div>}
          onClick={goToTick.bind(null, maxTicks)}
        />

        {/* Change play speed */}

        <PlaybackAction
          icon={<div className="select-none text-xl font-medium">{speed}x</div>}
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
          onClick={() => null}
        />
      </div>

      <input
        className="mt-4 w-[400px] max-w-full"
        type="range"
        min="1"
        max={maxTicks}
        value={tick}
        onChange={({ target }) => goToTick(Number(target.value))}
        tabIndex={-1}
      />
    </div>
  )
}
