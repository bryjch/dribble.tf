import { useEffect, useRef } from 'react'

import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'

import type { DamageHit, MatchSource } from '@components/Analyse/Data/MatchSource'
import { sceneFrame } from '@components/Scene/PlaybackDriver'

import { useInstance, useStore } from '@zus/store'
import { PLAYER_DIMENSIONS } from '@constants/mappings'

//
// ─── DAMAGE NUMBERS ─────────────────────────────────────────────────────────────
//
// In POV, the damage the spectated player deals, as TF2 shows it to them: a number over the head
// of whoever they hit, rising and fading. Hits on one victim less than BATCH_SECONDS apart add up
// into one number, so a minigun or a flamethrower reads as a total, not a blur.
//
// Everything is worked out from the tick being drawn, so seeking and scrubbing show the numbers
// that would be up at that moment. They are DOM elements over the canvas, kept in a pool and
// placed directly every frame, so nothing re-renders in React.
//

/** How long a number stays up after the last hit in it. */
const LINGER_SECONDS = 1.5
/** The last part of that, fading out. */
const FADE_SECONDS = 0.4
/** Hits on one victim closer together than this are one number. */
const BATCH_SECONDS = 0.5
/** How far back hits are read: a batch running longer than this counts only its last part. */
const LOOKBACK_SECONDS = 10
/** How far a number rises over its life on screen, starting over the victim's head. */
const RISE_PX = 36
/** Where it starts over the head: clear of the nameplate when nameplates are drawn. */
const START_PX = 8
const START_OVER_NAMEPLATE_PX = 64
/** A new hit on a number pops it this much bigger, easing back over POP_SECONDS. */
const POP_SCALE = 0.35
const POP_SECONDS = 0.15
/** At most this many numbers at once. */
const POOL_SIZE = 12

interface Batch {
  victim: number
  total: number
  /** The tick of the last hit in it, which its age counts from. */
  lastTick: number
  crit: boolean
  minicrit: boolean
}

interface Slot {
  root: HTMLDivElement
  label: HTMLDivElement
  value: HTMLDivElement
  shown: boolean
  text: string
  kind: string
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

/**
 * The batches still up at the tick, newest first. Hits are walked back from the tick: each one
 * joins its victim's batch if it came within the batch window of that batch's earliest hit, or
 * starts an older batch for them.
 */
function batchesAt(hits: readonly DamageHit[], tick: number, ticksPerSecond: number): Batch[] {
  const last = lastHitAtOrBefore(hits, tick)
  if (last < 0) return []
  const linger = LINGER_SECONDS * ticksPerSecond
  const gap = BATCH_SECONDS * ticksPerSecond
  const oldest = tick - linger - LOOKBACK_SECONDS * ticksPerSecond

  const batches: Batch[] = []
  // Per victim, their oldest batch so far and the tick of its earliest hit.
  const open = new Map<number, { batch: Batch; firstTick: number }>()
  // Victims whose batches still up have all been found: anything older ended too long ago.
  const done = new Set<number>()
  for (let i = last; i >= 0 && hits[i].tick >= oldest; i--) {
    const hit = hits[i]
    if (done.has(hit.victim)) continue
    const current = open.get(hit.victim)
    if (current && current.firstTick - hit.tick <= gap) {
      current.batch.total += hit.amount
      current.batch.crit ||= hit.crit
      current.batch.minicrit ||= hit.minicrit
      current.firstTick = hit.tick
      continue
    }
    // This hit ends an older batch; one that ended longer ago than the linger is gone.
    if (tick - hit.tick > linger) {
      done.add(hit.victim)
      continue
    }
    const batch = {
      victim: hit.victim,
      total: hit.amount,
      lastTick: hit.tick,
      crit: hit.crit,
      minicrit: hit.minicrit,
    }
    batches.push(batch)
    open.set(hit.victim, { batch, firstTick: hit.tick })
  }
  return batches
}

function createSlot(container: HTMLElement): Slot {
  const root = document.createElement('div')
  root.className = 'hud-damage'
  root.style.display = 'none'
  const label = document.createElement('div')
  label.className = 'hud-damage__label'
  const value = document.createElement('div')
  value.className = 'hud-damage__value'
  root.append(label, value)
  container.appendChild(root)
  return { root, label, value, shown: false, text: '', kind: '' }
}

function hide(slot: Slot) {
  if (!slot.shown) return
  slot.root.style.display = 'none'
  slot.shown = false
}

export const DamageNumbers = ({ match }: { match?: MatchSource }) => {
  const enabled = useStore(state => state.settings.ui.damageNumbers !== false)
  const nameplates = useStore(state => state.settings.ui.nameplate.enabled)
  const controlsMode = useStore(state => state.scene.controls.mode)
  const focusedObject = useInstance(state => state.focusedObject)
  const gl = useThree(state => state.gl)
  const slots = useRef<Slot[]>([])
  const projected = useRef(new THREE.Vector3())

  const attacker: number | undefined = focusedObject?.userData?.entityId
  const active = enabled && controlsMode === 'pov' && !!match && attacker !== undefined

  useEffect(() => {
    const parent = gl.domElement.parentElement
    if (!active || !parent) return
    const container = document.createElement('div')
    container.className = 'hud-damage-layer'
    parent.appendChild(container)
    slots.current = Array.from({ length: POOL_SIZE }, () => createSlot(container))
    return () => {
      container.remove()
      slots.current = []
    }
  }, [active, gl])

  useFrame(({ camera, size }) => {
    const pool = slots.current
    if (!active || !match || attacker === undefined || pool.length === 0) return

    const tick = sceneFrame.tick
    const ticksPerSecond = 1 / match.intervalPerTick
    const batches = batchesAt(match.damageBy(attacker), tick, ticksPerSecond)

    camera.updateWorldMatrix(true, false)
    const v = projected.current
    let used = 0
    for (const batch of batches) {
      if (used >= pool.length) break
      const victim = sceneFrame.playersByEntity.get(batch.victim)
      if (!victim) continue
      const age = Math.max(0, (tick - batch.lastTick) / ticksPerSecond)
      const life = age / LINGER_SECONDS

      const { x, y, z } = victim.position
      v.set(x, y, z + PLAYER_DIMENSIONS.z).project(camera)
      // Behind the camera, or off screen.
      if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) continue

      const slot = pool[used++]
      const left = ((v.x + 1) / 2) * size.width
      // The dead have no nameplate to clear.
      const startPx = nameplates && victim.health > 0 ? START_OVER_NAMEPLATE_PX : START_PX
      const top = ((1 - v.y) / 2) * size.height - startPx - RISE_PX * life
      const pop = 1 + POP_SCALE * Math.max(0, 1 - age / POP_SECONDS)
      const opacity = Math.min(1, (LINGER_SECONDS - age) / FADE_SECONDS)
      slot.root.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0) translate(-50%, -100%) scale(${pop.toFixed(3)})`
      slot.root.style.opacity = opacity.toFixed(3)

      const text = `-${batch.total}`
      if (slot.text !== text) {
        slot.value.textContent = text
        slot.text = text
      }
      const kind = batch.crit ? 'crit' : batch.minicrit ? 'minicrit' : ''
      if (slot.kind !== kind) {
        if (kind) slot.root.dataset.kind = kind
        else delete slot.root.dataset.kind
        slot.label.textContent = kind === 'crit' ? 'Critical hit!' : kind === 'minicrit' ? 'Mini-crit!' : ''
        slot.kind = kind
      }
      if (!slot.shown) {
        slot.root.style.display = ''
        slot.shown = true
      }
    }
    for (let i = used; i < pool.length; i++) hide(pool[i])
  })

  return null
}
