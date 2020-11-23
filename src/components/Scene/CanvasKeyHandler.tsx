import { useRef, useEffect, useCallback } from 'react'
import keycode from 'keycode'

import * as THREE from 'three'
import { useThree, Camera } from 'react-three-fiber'

import { useStore, dispatch } from '@redux/store'
import {
  togglePlaybackAction,
  playbackJumpAction,
  changeControlsModeAction,
  changePlaySpeedAction,
  toggleSettingsOptionAction,
} from '@redux/actions'

import { getSceneActors } from '@utils/scene'
import { useEventListener } from '@utils/hooks'

/**
 * This is just a null object added to Scene to make it easier for us to handle
 * any desired key press behaviour if the user has the Canvas focused
 */
export const CanvasKeyHandler = () => {
  const defaultCamera = useRef<THREE.Camera>() // Keep track of the original camera so we can switch back to it
  const keysHeld = useRef(new Map())
  const { scene, camera, gl, setDefaultCamera } = useThree()

  // Redux states / actions
  const controls: any = useStore((state: any) => state.scene.controls)
  const togglePlayback = useCallback(() => dispatch(togglePlaybackAction()), [dispatch])
  const playbackJump = useCallback(direction => dispatch(playbackJumpAction(direction)), [dispatch])
  const changePlaySpeed = useCallback(speed => dispatch(changePlaySpeedAction(speed)), [dispatch])
  const changeControlsMode = useCallback(
    (mode, opts = undefined) => dispatch(changeControlsModeAction(mode, opts)),
    [dispatch]
  )
  const toggleSettingsOption = useCallback(option => dispatch(toggleSettingsOptionAction(option)), [
    dispatch,
  ])

  const canvasKeyDown = useCallback(
    (event: KeyboardEvent) => {
      let povCamera = scene.getObjectByName('povCamera') as Camera
      let freeCamera = scene.getObjectByName('freeCamera') as Camera

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
            if (keysHeld.current.has('up')) return null // Prevent rapid camera cycling

            // Determine which Actor's POV should be focused next
            let actors = getSceneActors(scene)
            let currentIndex = controls.focusedObject
              ? actors.findIndex(({ id }) => id === controls.focusedObject.id)
              : -1
            let nextIndex = (currentIndex + 1) % actors.length

            let currentActor = actors[currentIndex]
            let nextActor = actors[nextIndex]

            const payload: any = {}

            // Handle situation where there actors in the scene
            if (actors.length === 0 || !nextActor) {
              if (controls.mode !== 'free') {
                alert('No actors found. Resetting to free camera.')
              }

              payload.focusedObject = null
              changeControlsMode('free', payload)
              break
            }

            // If the previous control mode wasn't POV, then we should switch to the
            // POV of the last focused Actor instead of cycling to the next Actor
            if (controls.mode !== 'pov') {
              payload.focusedObject = controls.focusedObject || currentActor || nextActor
            } else {
              payload.focusedObject = nextActor
            }

            changeControlsMode('pov', payload)
            povCamera = payload.focusedObject.getObjectByName('povCamera') as Camera
            if (povCamera) setDefaultCamera(povCamera)

            keysHeld.current.set('up', true)
            break

          case '3':
            if (keysHeld.current.has('down')) return null // Prevent rapid camera cycling

            changeControlsMode('free')
            freeCamera = scene.getObjectByName('freeCamera') as Camera
            setDefaultCamera(freeCamera)

            keysHeld.current.set('down', true)
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

  useEffect(() => {
    try {
      defaultCamera.current = camera
    } catch (error) {
      console.error(error)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEventListener('keydown', canvasKeyDown, gl.domElement)
  useEventListener('keyup', canvasKeyUp, gl.domElement)

  return null
}
