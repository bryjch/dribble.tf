import { Icon, Popup, Dropdown, IconProps, PopupProps } from 'semantic-ui-react'

import { useStore } from '@zus/store'
import { goToTickAction, togglePlaybackAction, changePlaySpeedAction } from '@zus/actions'
import { focusMainCanvas } from '@utils/misc'
import { Menu } from '@headlessui/react'

export const PLAYBACK_SPEED_OPTIONS = [
  { label: 'x3', value: 3 },
  { label: 'x2', value: 2 },
  { label: 'x1', value: 1 },
  { label: 'x0.5', value: 0.5 },
  { label: 'x0.1', value: 0.1 },
]

interface PlaybackActionProps {
  content: string | React.ReactNode
  icon: string | any
  iconProps?: IconProps
  popupProps?: PopupProps
}

const PlaybackAction = (props: PlaybackActionProps) => {
  return (
    <Popup
      inverted
      on="hover"
      position="top center"
      content={props.content}
      trigger={
        <Icon
          name={props.icon}
          className="mx-1"
          style={{
            padding: 6,
            width: 'auto',
            height: 'auto',
            cursor: 'pointer',
          }}
          {...props.iconProps}
        />
      }
      {...props.popupProps}
    />
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

      <div className="flex items-center justify-center">
        {/* Spacer to match play speed dropdown width */}

        <span style={{ width: '40px' }} className="mr-2" />

        {/* Jump to start action */}

        <div onClick={goToTick.bind(null, 1)}>
          <PlaybackAction content={<div>Jump to start</div>} icon="fast backward" />
        </div>

        {/* Seek back action */}

        <div onClick={goToTick.bind(null, tick - 50)}>
          <PlaybackAction
            content={
              <div>
                <div>Seek back</div>
                <div>
                  1 tick<kbd className="ml-2">,</kbd>
                </div>
                <div>
                  50 ticks<kbd className="ml-2">←</kbd>
                </div>
              </div>
            }
            icon="step backward"
          />
        </div>

        {/* Toggle play / pause action */}

        <div className="play" onClick={togglePlayback}>
          <PlaybackAction
            content={
              <div>
                Play / Pause <kbd className="ml-2">Space</kbd>
              </div>
            }
            icon={playing ? 'pause' : 'play'}
          />
        </div>

        {/* Seek forward action */}

        <div onClick={goToTick.bind(null, tick + 50)}>
          <PlaybackAction
            content={
              <div>
                <div>Seek forward</div>
                <div>
                  1 tick<kbd className="ml-2">.</kbd>
                </div>
                <div>
                  50 ticks<kbd className="ml-2">→</kbd>
                </div>
              </div>
            }
            icon="step forward"
          />
        </div>

        {/* Jump to end action */}

        <div onClick={goToTick.bind(null, maxTicks)}>
          <PlaybackAction content={<div>Jump to end</div>} icon="fast forward" />
        </div>

        {/* Change play speed dropdown */}

        <Menu as="div" className="relative inline-block text-left">
          <div>
            <Menu.Button className="inline-flex w-full justify-center gap-x-1.5 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
              Options
            </Menu.Button>
          </div>

          <Menu.Items className="absolute bottom-full left-0 z-10 mt-2 w-56 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
            <div className="py-1">
              {PLAYBACK_SPEED_OPTIONS.map(({ label, value }) => (
                <Menu.Item key={`play-speed-option-${label}`}>
                  <button
                    className="block text-black"
                    onClick={() => changePlaySpeed(Number(value))}
                  >
                    {label}
                  </button>
                </Menu.Item>
              ))}
            </div>
          </Menu.Items>
        </Menu>

        <Popup
          inverted
          on="hover"
          position="top center"
          trigger={
            <Dropdown tabIndex={-1} upward text={`x${speed}`} className="ml-3">
              <Dropdown.Menu>
                {PLAYBACK_SPEED_OPTIONS.map(({ label, value }) => (
                  <Dropdown.Item
                    key={`play-speed-option-${label}`}
                    value={value}
                    onClick={() => changePlaySpeed(Number(value))}
                  >
                    {label}
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>
          }
          content={
            <div>
              <div>Playback speed</div>
              <div>
                Increase <kbd className="ml-2">↑</kbd>
              </div>
              <div>
                Decrease <kbd className="ml-2">↓</kbd>
              </div>
            </div>
          }
        />
      </div>

      <div>
        <input
          className="w-[400px] max-w-full"
          type="range"
          min="1"
          max={maxTicks}
          value={tick}
          onChange={({ target }) => goToTick(Number(target.value))}
          tabIndex={-1}
        />
      </div>
    </div>
  )
}
