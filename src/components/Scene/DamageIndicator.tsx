import { useEffect, useRef } from 'react'

import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'

import type { DamageHit, MatchSource } from '@components/Analyse/Data/MatchSource'
import type { Vector } from '@components/Analyse/Data/Types'
import { sceneFrame } from '@components/Scene/PlaybackDriver'

import { useInstance, useStore } from '@zus/store'

//
// ─── DAMAGE INDICATOR ───────────────────────────────────────────────────────────
//
// In POV, the hits the spectated player takes, as TF2 shows them: a red arc round the
// crosshair on the side the hit came from, turning as they turn and fading.
//
// A hit comes from where its source was: the projectile's launch point, the sticky or the
// sentry when the demo's decoder found one (DamageHit.from), otherwise the attacker, where they
// stood at the hit. One arc per attacker, from their latest hit.
//
// Worked out from the tick being drawn, so seeking shows the arcs that would be up then. They are
// DOM elements over the canvas, kept in a pool and placed directly every frame.
//

/** How long an arc stays up after the hit. */
const SHOW_SECONDS = 1.5
/** The last part of that, fading out. */
const FADE_SECONDS = 0.6
/** At most this many arcs at once. */
const POOL_SIZE = 6
/** How far from the middle of the screen the arcs sit, as a share of its smaller side. */
const RADIUS_SHARE = 0.2
/** A source this close to the player, sideways, has no side to show. */
const MIN_DISTANCE = 16

interface Slot {
  root: HTMLDivElement
  shown: boolean
}

function createSlot(container: HTMLElement): Slot {
  const root = document.createElement('div')
  root.className = 'hud-hurt'
  root.style.display = 'none'
  root.innerHTML =
    '<svg viewBox="-50 -12 100 24" aria-hidden="true"><path d="M -44 10 Q 0 -14 44 10" /></svg>'
  container.appendChild(root)
  return { root, shown: false }
}

function hide(slot: Slot) {
  if (!slot.shown) return
  slot.root.style.display = 'none'
  slot.shown = false
}

/** The index of the last hit at or before the tick, or -1. */
function lastHitAtOrBefore(hits: readonly DamageHit[], tick: number) {
  let lo = 0
  let hi = hits.length - 1
  if (hi < 0 || hits[0].tick > tick) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (hits[mid].tick <= tick) lo = mid
    else hi = mid - 1
  }
  return lo
}

export const DamageIndicator = ({ match }: { match?: MatchSource }) => {
  const enabled = useStore(state => state.settings.ui.damageIndicator !== false)
  const controlsMode = useStore(state => state.scene.controls.mode)
  const focusedObject = useInstance(state => state.focusedObject)
  const gl = useThree(state => state.gl)
  const slots = useRef<Slot[]>([])
  // Where each hit with no `from` came from: the attacker at the hit, looked up once.
  const attackerAt = useRef(new WeakMap<DamageHit, Vector | null>())
  const forward = useRef(new THREE.Vector3())
  const eye = useRef(new THREE.Vector3())

  const victim: number | undefined = focusedObject?.userData?.entityId
  const active = enabled && controlsMode === 'pov' && !!match && victim !== undefined

  useEffect(() => {
    const parent = gl.domElement.parentElement
    if (!active || !parent) return
    const container = document.createElement('div')
    container.className = 'hud-hurt-layer'
    parent.appendChild(container)
    slots.current = Array.from({ length: POOL_SIZE }, () => createSlot(container))
    return () => {
      container.remove()
      slots.current = []
    }
  }, [active, gl])

  useEffect(() => {
    attackerAt.current = new WeakMap()
  }, [match])

  const sourceOf = (hit: DamageHit): Vector | null => {
    if (hit.from) return hit.from
    const cache = attackerAt.current
    let at = cache.get(hit)
    if (at === undefined) {
      const attacker = match?.playersAt(hit.tick).find(p => p.user.entityId === hit.attacker)
      at = attacker ? attacker.position : null
      cache.set(hit, at)
    }
    return at
  }

  useFrame(({ camera, size }) => {
    const pool = slots.current
    if (!active || !match || victim === undefined || pool.length === 0) return

    const tick = sceneFrame.tick
    const ticksPerSecond = 1 / match.intervalPerTick
    const player = sceneFrame.playersByEntity.get(victim)
    const hits = match.damageTo(victim)
    let last = player && player.health > 0 ? lastHitAtOrBefore(hits, tick) : -1

    camera.updateWorldMatrix(true, false)
    camera.getWorldPosition(eye.current)
    camera.getWorldDirection(forward.current)
    const fx = forward.current.x
    const fy = forward.current.y
    const radius = Math.min(size.width, size.height) * RADIUS_SHARE

    // Newest first, one per attacker.
    const seen = new Set<number>()
    let used = 0
    const oldest = tick - SHOW_SECONDS * ticksPerSecond
    for (; last >= 0 && hits[last].tick > oldest && used < pool.length; last--) {
      const hit = hits[last]
      if (seen.has(hit.attacker)) continue
      seen.add(hit.attacker)
      const source = sourceOf(hit)
      if (!source) continue
      const dx = source.x - eye.current.x
      const dy = source.y - eye.current.y
      if (Math.hypot(dx, dy) < MIN_DISTANCE || Math.hypot(fx, fy) < 1e-6) continue

      // Source's z is up: the angle from where the camera faces to the source, on the ground,
      // counter-clockwise (to the left) positive; on screen, clockwise from straight up.
      const left = Math.atan2(fx * dy - fy * dx, fx * dx + fy * dy)
      const age = Math.max(0, (tick - hit.tick) / ticksPerSecond)
      const opacity = Math.min(1, (SHOW_SECONDS - age) / FADE_SECONDS)

      const slot = pool[used++]
      slot.root.style.transform = `rotate(${(-left).toFixed(4)}rad) translate(-50%, ${(-radius).toFixed(1)}px) translateY(-100%)`
      slot.root.style.opacity = opacity.toFixed(3)
      if (!slot.shown) {
        slot.root.style.display = ''
        slot.shown = true
      }
    }
    for (let i = used; i < pool.length; i++) hide(pool[i])
  })

  return null
}
