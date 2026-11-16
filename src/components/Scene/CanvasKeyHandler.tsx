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
  toggleBookmarkAction,
  setScoreboardOpenAction,
  toggleSettingWithNoteAction,
  cycleRailsAction,
  setHudHiddenAction,
  toggleLightingAction,
  toggleCrosshairAction,
} from '@zus/actions'

import { useEventListener } from '@utils/hooks'

const onViewKey = (key: string) => {
  switch (key) {
    case 'n':
      return toggleSettingWithNoteAction('ui.nameplate.enabled', 'Nameplates')
    case 'o':
      return toggleSettingWithNoteAction('ui.playerOutlines', 'Outlines')
    case 'p':
      return cycleRailsAction()
    case 'h':
      return setHudHiddenAction()
    case 'l':
      return toggleLightingAction()
    case 'v':
      return toggleSettingWithNoteAction('ui.viewmodel.enabled', 'Weapon in POV', true)
    case 'x':
      return toggleCrosshairAction()
    case 'i':
      return toggleSettingWithNoteAction('ui.matchEvents.open', 'Match events')
    case 't':
      return toggleSettingWithNoteAction('ui.showChat', 'Chat', true)
  }
}

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
            // Space (and the arrows below) would otherwise also scroll the page.
            event.preventDefault()
            togglePlaybackAction()
            break

          case 'left':
            event.preventDefault()
            playbackJumpAction('seekBackward')
            break

          case 'right':
            event.preventDefault()
            playbackJumpAction('seekForward')
            break

          case ',':
            playbackJumpAction('previousTick')
            break

          case '.':
            playbackJumpAction('nextTick')
            break

          case 'up':
            event.preventDefault()
            changePlaySpeedAction('faster')
            break

          case 'down':
            event.preventDefault()
            changePlaySpeedAction('slower')
            break

          case 'm':
            changeSceneModeAction('next')
            break

          // The view keys (listed in @constants/shortcuts). Modified presses are left to the
          // browser (Cmd+L, Ctrl+T ...).
          case 'n':
          case 'o':
          case 'p':
          case 'h':
          case 'l':
          case 'v':
          case 'x':
          case 'i':
          case 't':
            if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) break
            onViewKey(keycode(event))
            break

          case 'b':
            toggleBookmarkAction()
            break

          case 'tab':
            // Held for the scoreboard (let go: GlobalKeyHandler). Tab away from the canvas
            // with Shift+Tab, or from anything that is not the canvas, as usual.
            if (event.shiftKey) break
            event.preventDefault()
            setScoreboardOpenAction(true)
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
