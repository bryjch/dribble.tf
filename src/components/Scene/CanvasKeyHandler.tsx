import { useRef, useCallback } from 'react'
import keycode from 'keycode'

import { useThree } from 'react-three-fiber'

import { useStore, dispatch } from '@zus/store'
import {
  togglePlaybackAction,
  playbackJumpAction,
  changeControlsModeAction,
  changePlaySpeedAction,
  changeSceneModeAction,
  toggleSettingsOptionAction,
} from '@zus/actions'

import { useEventListener } from '@utils/hooks'

/**
 * This is just a null object added to Scene to make it easier for us to handle
 * any desired key press behaviour if the user has the Canvas focused
 */
export const CanvasKeyHandler = () => {
  const keysHeld = useRef(new Map())
  const { gl } = useThree()

  const controls: any = useStore((state: any) => state.scene.controls)

  const togglePlayback = () => dispatch(togglePlaybackAction())
  const playbackJump = (direction: any) => dispatch(playbackJumpAction(direction))
  const changePlaySpeed = (speed: any) => dispatch(changePlaySpeedAction(speed))
  const changeSceneMode = (mode: any) => dispatch(changeSceneModeAction(mode))
  const changeControlsMode = (mode: any, options?: any) =>
    dispatch(changeControlsModeAction(mode, options))
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

          case 'm':
            changeSceneMode(null)
            break

          case 'n':
            toggleSettingsOption('ui.nameplate.enabled')
            break

          case 'p':
            toggleSettingsOption('ui.xrayPlayers')
            break

          case '1':
            if (keysHeld.current.has('1')) return null // Prevent rapid camera cycling
            keysHeld.current.set('1', true)
            changeControlsMode('pov', { direction: event.shiftKey ? 'prev' : 'next' })
            break

          case '3':
            if (keysHeld.current.has('3')) return null // Prevent rapid camera cycling
            keysHeld.current.set('3', true)
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
        keysHeld.current.delete('1')
        break

      case '3':
        keysHeld.current.delete('3')
        break
    }
  }, [])

  useEventListener('keydown', canvasKeyDown, gl.domElement)
  useEventListener('keyup', canvasKeyUp, gl.domElement)

  return null
}
