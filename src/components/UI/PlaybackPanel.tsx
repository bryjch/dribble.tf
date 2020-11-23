import React from 'react'
import { Icon, Popup, Dropdown, IconProps, PopupProps } from 'semantic-ui-react'

import { useStore, dispatch } from '@redux/store'
import { goToTickAction, togglePlaybackAction, changePlaySpeedAction } from '@redux/actions'
import { focusMainCanvas } from '@utils/misc'

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
  const playback = useStore((state: any) => state.playback)
  const { playing, speed, tick, maxTicks } = playback

  const togglePlayback = () => {
    dispatch(togglePlaybackAction())
    focusMainCanvas()
  }

  const changePlaySpeed = (speed: number) => {
    dispatch(changePlaySpeedAction(speed))
    focusMainCanvas()
  }

  const goToTick = (tick: number) => {
    dispatch(goToTickAction(tick))
    focusMainCanvas()
  }

  return (
    <div className="panel">
      <div className="no-select">Tick #{tick}</div>

      <div className="playback">
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

      <div className="timeline">
        <input
          type="range"
          min="1"
          max={maxTicks}
          value={tick}
          onChange={({ target }) => goToTick(Number(target.value))}
          tabIndex={-1}
        />
      </div>

      <style jsx>{`
        .panel {
          max-width: 100%;
          font-size: 1rem;
          margin: 1rem;

          .playback {
            display: flex;
            flex-flow: row nowrap;
            justify-content: center;
            align-items: center;

            button.play {
              width: 70px;
            }

            div {
              user-select: none;
            }
          }

          .timeline input[type='range'] {
            width: 400px;
            max-width: 100%;
          }
        }
      `}</style>
    </div>
  )
}
