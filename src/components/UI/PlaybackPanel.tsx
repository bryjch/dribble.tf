import React, { useCallback } from 'react'
import { useSelector, useDispatch } from 'react-redux'

import { goToTickAction, togglePlaybackAction, changePlaySpeedAction } from '@redux/actions'

export const PLAYBACK_SPEED_OPTIONS = [
  { label: 'x0.1', value: 0.1 },
  { label: 'x0.5', value: 0.5 },
  { label: 'x1', value: 1 },
  { label: 'x2', value: 2 },
  { label: 'x3', value: 3 },
]

export const PlaybackPanel = () => {
  const playback = useSelector((state: any) => state.playback)
  const { playing, speed, tick, maxTicks } = playback

  const dispatch = useDispatch()
  const goToTick = useCallback(tick => dispatch(goToTickAction(tick)), [dispatch])
  const togglePlayback = useCallback(() => dispatch(togglePlaybackAction()), [dispatch])
  const changePlaySpeed = useCallback(speed => dispatch(changePlaySpeedAction(speed)), [dispatch])

  return (
    <div className="panel">
      <div>Tick #{tick}</div>

      <div className="playback">
        <span className="px-4"></span>
        <button onClick={goToTick.bind(null, 1)}>{'<<'}</button>
        <button onClick={goToTick.bind(null, tick - 50)}>{'<'}</button>
        <button className="play" onClick={togglePlayback}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={goToTick.bind(null, tick + 50)}>{'>'}</button>
        <button onClick={goToTick.bind(null, maxTicks)}>{'>>'}</button>
        <select
          value={speed}
          onChange={({ target }) => changePlaySpeed(Number(target.value))}
          className="ml-2"
        >
          {PLAYBACK_SPEED_OPTIONS.map(({ label, value }) => (
            <option key={`play-speed-option-${label}`} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="timeline">
        <input
          type="range"
          min="1"
          max={maxTicks}
          value={tick}
          onChange={({ target }) => goToTick(Number(target.value))}
        ></input>
      </div>

      <style jsx>{`
        .panel {
          max-width: 100%;
          font-size: 1rem;
          font-family: monospace;
          padding: 1rem;

          .playback {
            button.play {
              width: 70px;
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
