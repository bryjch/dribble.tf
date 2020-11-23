import { useRef, useCallback } from 'react'
import keycode from 'keycode'

import { useThree } from 'react-three-fiber'

import { useStore, dispatch } from '@redux/store'
import {
  togglePlaybackAction,
  playbackJumpAction,
  changeControlsModeAction,
  changePlaySpeedAction,
  toggleSettingsOptionAction,
} from '@redux/actions'

import { useEventListener } from '@utils/hooks'

/**
 * This is just a null object added to Scene to make it easier for us to handle
 * any desired key press behaviour if the user has the Canvas focused
 */
export const CanvasKeyHandler = () => {
  const keysHeld = useRef(new Map())
  const { gl } = useThree()

  // Redux states / actions
  const controls: any = useStore((state: any) => state.scene.controls)

  const togglePlayback = () => dispatch(togglePlaybackAction())
  const playbackJump = (direction: any) => dispatch(playbackJumpAction(direction))
  const changePlaySpeed = (speed: any) => dispatch(changePlaySpeedAction(speed))
  const changeControlsMode = (mode: any) => dispatch(changeControlsModeAction(mode))
  const toggleSettingsOption = (option: any) => dispatch(toggleSettingsOptionAction(option))

  const canvasKeyDown = useCallback(
    (event: KeyboardEvent) => {
      try {
        switch (keycode(event)) {
          case 'space':
            togglePlayback()
            break

          case 'left':
            playbackJump('seekBackward')
            break

          case 'right':
            playbackJump('seekForward')
            break

          case ',':
            playbackJump('previousTick')
            break

          case '.':
            playbackJump('nextTick')
            break

          case 'up':
            changePlaySpeed('faster')
            break

          case 'down':
            changePlaySpeed('slower')
            break

          case 'n':
            toggleSettingsOption('ui.nameplate.enabled')
            break

          case 'm':
            toggleSettingsOption('ui.xrayPlayers')
            break

          case '1':
            changeControlsMode('pov')
            break

          case '3':
            changeControlsMode('free')
            break
        }
      } catch (error) {
        console.error(error)
      }
    },
    [controls] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const canvasKeyUp = useCallback((event: KeyboardEvent) => {
    switch (keycode(event)) {
      case '1':
        keysHeld.current.delete('up')
        break

      case '3':
        keysHeld.current.delete('down')
        break
    }
  }, [])

  useEventListener('keydown', canvasKeyDown, gl.domElement)
  useEventListener('keyup', canvasKeyUp, gl.domElement)

  return null
}
