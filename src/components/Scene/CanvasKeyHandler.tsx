import { useRef, useEffect, useCallback } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import keycode from 'keycode'

import * as THREE from 'three'
import { useThree, Camera } from 'react-three-fiber'

import { togglePlaybackAction, playbackJumpAction, changeControlsModeAction } from '@redux/actions'
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

  const controls: any = useSelector((state: any) => state.scene.controls)
  const dispatch = useDispatch()
  const togglePlayback = useCallback(() => dispatch(togglePlaybackAction()), [dispatch])
  const playbackJump = useCallback(direction => dispatch(playbackJumpAction(direction)), [dispatch])
  const changeControlsMode = useCallback(
    (mode, options = undefined) => {
      dispatch(changeControlsModeAction(mode, options))
    },
    [dispatch]
  )

  const canvasKeyDown = useCallback(
    (event: KeyboardEvent) => {
      let povCamera = scene.getObjectByName('povCamera') as Camera
      let freeCamera = scene.getObjectByName('freeCamera') as Camera
      // let controls = (scene as any).controls

      try {
        switch (keycode(event)) {
          case 'space':
            togglePlayback()
            break

          case 'left':
            playbackJump('backward')
            break

          case 'right':
            playbackJump('forward')
            break

          case 'up':
            if (keysHeld.current.has('up')) return null // Prevent rapid camera cycling

            // If the previous control mode wasn't POV, then we should switch to the
            // POV of the last focused Actor instead of cycling to the next Actor
            if (controls.mode !== 'pov' && controls.focusedObject) {
              changeControlsMode('pov')
              povCamera = controls.focusedObject.getObjectByName('povCamera') as Camera
              setDefaultCamera(povCamera)

              keysHeld.current.set('up', true)
              break
            }

            // Determine which Actor's POV should be focused next
            let actors = getSceneActors(scene)
            let currentIndex = controls.focusedObject
              ? actors.findIndex(({ id }) => id === controls.focusedObject.id)
              : -1
            let nextIndex = (currentIndex + 1) % actors.length
            let nextActor = actors[nextIndex]

            changeControlsMode('pov', { focusedObject: nextActor })
            povCamera = nextActor.getObjectByName('povCamera') as Camera
            setDefaultCamera(povCamera)

            keysHeld.current.set('up', true)
            break

          case 'down':
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
      case 'up':
        keysHeld.current.delete('up')
        break

      case 'down':
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
