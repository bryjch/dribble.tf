import { useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
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

export const PLAYBACK_SPEED_OPTIONS = [
  { label: 'x3', value: 3 },
  { label: 'x2', value: 2 },
  { label: 'x1', value: 1 },
  { label: 'x0.5', value: 0.5 },
  { label: 'x0.1', value: 0.1 },
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
          <button onClick={props.onClick}>{props.icon}</button>
        </Tooltip.Trigger>

        <Tooltip.Portal>
          <Tooltip.Content sideOffset={5}>
            <div className="rounded-lg bg-pp-panel/90 px-4 py-3">{props.content}</div>
            <Tooltip.Arrow />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

interface PlaybackSpeedDropdownProps {
  speed: number
  onChangeSpeed: (speed: number) => void
}

const PlaybackSpeedDropdown = (props: PlaybackSpeedDropdownProps) => {
  const [dropdownOpen, setDropdownOpen] = useState(false)

  return (
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger className="inline-flex" asChild>
          <button tabIndex={-1} onFocus={e => e.target.blur()}>
            <DropdownMenu.Root onOpenChange={setDropdownOpen}>
              <DropdownMenu.Trigger asChild>
                <button className="flex items-center" tabIndex={-1} onFocus={e => e.target.blur()}>
                  <div className="text-xl font-medium">x {props.speed}</div>
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content sideOffset={5}>
                  {PLAYBACK_SPEED_OPTIONS.map(({ label, value }) => (
                    <DropdownMenu.Item key={`play-speed-option-${label}`}>
                      <button onClick={() => props.onChangeSpeed(Number(value))}>{label}</button>
                    </DropdownMenu.Item>
                  ))}

                  <DropdownMenu.Arrow />
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </button>
        </Tooltip.Trigger>

        {!dropdownOpen && (
          <Tooltip.Portal>
            <Tooltip.Content sideOffset={5}>
              <div className="rounded-lg bg-pp-panel/90 px-4 py-3">
                <div className="grid grid-cols-[auto,auto] gap-x-4 gap-y-1">
                  <div className="col-span-2 text-center">Playback speed</div>
                  <div>Increase</div>
                  <kbd>↑</kbd>
                  <div>Decrease</div>
                  <kbd>↓</kbd>
                </div>
              </div>
              <Tooltip.Arrow />
            </Tooltip.Content>
          </Tooltip.Portal>
        )}
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
        {/* Spacer to match play speed dropdown width */}

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

        {/* Change play speed dropdown */}

        <PlaybackSpeedDropdown speed={speed} onChangeSpeed={changePlaySpeed} />
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
