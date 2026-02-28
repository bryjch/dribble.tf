import { useRef, useCallback } from 'react'
import keycode from 'keycode'
import { isMobile } from 'react-device-detect'

import { useThree } from '@react-three/fiber'

import { useStore } from '@zus/store'
import {
  togglePlaybackAction,
  playbackJumpAction,
  changeControlsModeAction,
  changePlaySpeedAction,
  changeSceneModeAction,
  toggleSettingsOptionAction,
  toggleBookmarkAction,
} from '@zus/actions'

import { useEventListener } from '@utils/hooks'

/**
 * This is just a null object added to Scene to make it easier for us to handle
 * any desired key press behaviour if the user has the Canvas focused
 */
export const CanvasKeyHandler = () => {
  const keysHeld = useRef(new Map())
  const { gl } = useThree()

  const controls = useStore(state => state.scene.controls)

  const canvasKeyDown = useCallback(
    (event: KeyboardEvent) => {
      try {
        switch (keycode(event)) {
          case 'space':
            togglePlaybackAction()
            break

          case 'left':
            playbackJumpAction('seekBackward')
            break

          case 'right':
            playbackJumpAction('seekForward')
            break

          case ',':
            playbackJumpAction('previousTick')
            break

          case '.':
            playbackJumpAction('nextTick')
            break

          case 'up':
            changePlaySpeedAction('faster')
            break

          case 'down':
            changePlaySpeedAction('slower')
            break

          case 'm':
            changeSceneModeAction('next')
            break

          case 'n':
            toggleSettingsOptionAction('ui.nameplate.enabled')
            break

          case 'o':
            toggleSettingsOptionAction('ui.playerOutlines')
            break

          case 'b':
            toggleBookmarkAction()
            break

          case '1':
            if (keysHeld.current.has('1')) return null // Prevent rapid camera cycling
            keysHeld.current.set('1', true)
            changeControlsModeAction('pov', { direction: event.shiftKey ? 'prev' : 'next' })
            break

          case '2':
            if (isMobile) break // Spectator camera not supported on mobile
            if (keysHeld.current.has('2')) return null // Prevent rapid camera cycling
            keysHeld.current.set('2', true)
            changeControlsModeAction('spectator')
            break

          case '3':
            if (keysHeld.current.has('3')) return null // Prevent rapid camera cycling
            keysHeld.current.set('3', true)
            changeControlsModeAction('rts')
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

      case '2':
        keysHeld.current.delete('2')
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
