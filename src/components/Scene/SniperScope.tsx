import { useEffect, useRef } from 'react'

import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'

import { hasCondition } from '@components/Analyse/Data/StreamEvents'
import { sceneFrame } from '@components/Scene/PlaybackDriver'

import { getState, useInstance, useStore } from '@zus/store'
import { sourceVerticalFov } from '@utils/fov'

//
// ─── SNIPER SCOPE ───────────────────────────────────────────────────────────────
//
// In POV, a sniper looking down their scope is seen as TF2 shows it to them: zoomed in to the
// scope's field of view, the world through a round lens with a black crosshair, and no rifle
// (Viewmodel hides it). The demo has the zoomed condition for every player, every 4 ticks.
//
// The overlay is a DOM element over the canvas, shown and hidden directly every frame; the
// crosshair setting's own crosshair goes while it is up (`povScoped`).
//

/** TF2's zoomed field of view (the rifle's default zoom), horizontal on a 4:3 screen. */
const SCOPE_FOV = 20

export const SniperScope = () => {
  const controlsMode = useStore(state => state.scene.controls.mode)
  const fov = useStore(state => state.settings.camera.fov)
  const focusedObject = useInstance(state => state.focusedObject)
  const gl = useThree(state => state.gl)
  const overlay = useRef<HTMLDivElement | null>(null)
  const scoped = useRef(false)
  const scopedCamera = useRef<THREE.PerspectiveCamera | null>(null)

  const entityId: number | undefined = focusedObject?.userData?.entityId
  const active = controlsMode === 'pov' && entityId !== undefined

  useEffect(() => {
    const parent = gl.domElement.parentElement
    if (!active || !parent) return
    const element = document.createElement('div')
    element.className = 'hud-scope'
    element.style.display = 'none'
    parent.appendChild(element)
    overlay.current = element
    return () => {
      element.remove()
      overlay.current = null
      // Leaving POV, or another player: whatever camera was zoomed goes back.
      const camera = scopedCamera.current
      if (camera) {
        camera.fov = getState().settings.camera.fov
        camera.updateProjectionMatrix()
        scopedCamera.current = null
      }
      scoped.current = false
      useInstance.getState().setPovScoped(false)
    }
  }, [active, gl])

  useFrame(({ camera }) => {
    if (!active || entityId === undefined) return
    const player = sceneFrame.playersByEntity.get(entityId)
    const now = !!player && player.health > 0 && hasCondition(player.conditions, 'zoomed')

    // Only the POV camera zooms: the free and orbit cameras keep their own field of view.
    const pov = camera as THREE.PerspectiveCamera
    if (pov.isPerspectiveCamera && pov.name === 'povCamera') {
      const want = now ? sourceVerticalFov(SCOPE_FOV) : fov
      if (pov.fov !== want) {
        pov.fov = want
        pov.updateProjectionMatrix()
      }
      scopedCamera.current = now ? pov : null
    }

    if (now === scoped.current) return
    scoped.current = now
    if (overlay.current) overlay.current.style.display = now ? '' : 'none'
    useInstance.getState().setPovScoped(now)
  })

  return null
}
