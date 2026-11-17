import { useEffect, useRef } from 'react'

import { useFrame, useThree } from '@react-three/fiber'

import { hasCondition } from '@components/Analyse/Data/StreamEvents'
import type { CachedPlayer } from '@components/Analyse/Data/PlayerTracks'
import { sceneFrame } from '@components/Scene/PlaybackDriver'

import { useInstance, useStore } from '@zus/store'

//
// ─── POV EFFECTS ────────────────────────────────────────────────────────────────
//
// In POV, what TF2 puts over the spectated player's screen: Jarate's yellow, Mad Milk's white,
// bleeding's red, burning's flames at the edges, and a Vaccinator über's shield. A DOM element
// over the canvas, like the sniper scope's, with a layer per effect switched on and off when the
// player's conditions change (see .hud-pov-effect in base.css).
//

const EFFECTS = {
  jarate: (p: CachedPlayer) => hasCondition(p.conditions, 'jarate'),
  milk: (p: CachedPlayer) => hasCondition(p.conditions, 'milk'),
  bleeding: (p: CachedPlayer) => hasCondition(p.conditions, 'bleeding'),
  burning: (p: CachedPlayer) => hasCondition(p.conditions, 'burning'),
  shield: (p: CachedPlayer) => !!p.ubered?.startsWith('vaccinator'),
}
type Effect = keyof typeof EFFECTS
const NAMES = Object.keys(EFFECTS) as Effect[]
// Spelled out: Tailwind keeps only the classes it finds written in the source.
const CLASSES: Record<Effect, string> = {
  jarate: 'hud-pov-effect hud-pov-effect--jarate',
  milk: 'hud-pov-effect hud-pov-effect--milk',
  bleeding: 'hud-pov-effect hud-pov-effect--bleeding',
  burning: 'hud-pov-effect hud-pov-effect--burning',
  shield: 'hud-pov-effect hud-pov-effect--shield',
}

export const PovEffects = () => {
  const controlsMode = useStore(state => state.scene.controls.mode)
  const focusedObject = useInstance(state => state.focusedObject)
  const gl = useThree(state => state.gl)
  const root = useRef<HTMLDivElement | null>(null)
  const layers = useRef<Partial<Record<Effect, HTMLDivElement>>>({})
  const shown = useRef('')

  const entityId: number | undefined = focusedObject?.userData?.entityId
  const active = controlsMode === 'pov' && entityId !== undefined

  useEffect(() => {
    const parent = gl.domElement.parentElement
    if (!active || !parent) return
    const element = document.createElement('div')
    element.className = 'hud-pov-effects'
    for (const name of NAMES) {
      const layer = document.createElement('div')
      layer.className = CLASSES[name]
      layer.hidden = true
      element.appendChild(layer)
      layers.current[name] = layer
    }
    parent.appendChild(element)
    root.current = element
    return () => {
      element.remove()
      root.current = null
      layers.current = {}
      shown.current = ''
    }
  }, [active, gl])

  useFrame(() => {
    if (!active || entityId === undefined) return
    const player = sceneFrame.playersByEntity.get(entityId)
    const on = player && player.health > 0 ? NAMES.filter(name => EFFECTS[name](player)) : []
    const team = player?.team === 'blue' ? 'blue' : 'red'
    const key = `${team} ${on.join(' ')}`
    if (key === shown.current) return
    shown.current = key
    // The shield is in the team's colour.
    if (root.current) root.current.dataset.team = team
    for (const name of NAMES) {
      const layer = layers.current[name]
      if (layer) layer.hidden = !on.includes(name)
    }
  })

  return null
}
