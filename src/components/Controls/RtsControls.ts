import * as THREE from 'three'

import { ensureBoundsTrees } from '@utils/bvh'
import { isObjectShown } from '@utils/scene'

/**
 * The RTS ("orbit") camera: a map camera that orbits a point on the ground.
 *
 * - The orbit point stays on the map. After a pan, zoom or key move it is moved to the ground at
 *   the centre of the screen (without moving the camera), so rotating swings around what you are
 *   looking at instead of a point in the air.
 * - Dragging to pan keeps the ground you grabbed under the cursor, and zooming goes toward the
 *   cursor, the way map apps and RTS games do.
 * - Mouse: left drag rotates, right or middle drag pans (Shift, Ctrl or Cmd swaps the two), the
 *   wheel zooms, double-click centres on that spot.
 * - Keys (while the canvas has focus): WASD pan, Q/E turn, Shift goes faster, R resets the view.
 * - Touch: one finger rotates; two fingers pinch to zoom and drag to pan.
 *
 * Input moves a goal; the camera eases toward it at a rate in seconds, so it feels the same at
 * any frame rate (`smoothing` off jumps straight there).
 *
 * The world is Z-up. `phi` is the camera's angle from straight above its target (0 looks
 * straight down) and `theta` its heading around the target.
 */

type OrbitState = {
  target: THREE.Vector3
  radius: number
  theta: number
  phi: number
}

/** Radians turned by dragging across the full height of the view, at rotate speed 1. */
const ROTATE_PER_VIEW_HEIGHT = 0.6 * 2 * Math.PI
/** Zoom per pixel of wheel scroll, and per pixel of trackpad pinch (sent as Ctrl + wheel). */
const WHEEL_ZOOM_PER_PIXEL = 0.002
const PINCH_ZOOM_PER_PIXEL = 0.01
/** Keyboard pan per second, as a share of the camera's distance from its target. */
const KEY_PAN_PER_SECOND = 0.6
/** Keyboard turn per second, in radians. */
const KEY_TURN_PER_SECOND = 1.6
const KEY_BOOST = 2.5
/** How quickly the camera catches up with its goal (per second); higher is snappier. */
const SMOOTHING_RATE = 12
/** How long a wheel gesture keeps zooming toward the point it started on, in ms. */
const WHEEL_PICK_MS = 300

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'])

const cloneState = (state: OrbitState): OrbitState => ({ ...state, target: state.target.clone() })

const copyState = (into: OrbitState, from: OrbitState) => {
  into.target.copy(from.target)
  into.radius = from.radius
  into.theta = from.theta
  into.phi = from.phi
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export class RtsControls extends THREE.EventDispatcher<{ change: object }> {
  object: THREE.PerspectiveCamera
  domElement: HTMLElement
  scene?: THREE.Object3D

  /** Off while something else owns the pointer (dragging a sticker). */
  enabled = true

  // Settings (multipliers; 1 is the default feel)
  rotateSpeed = 1
  zoomSpeed = 1
  keyPanSpeed = 1
  smoothing = true

  minDistance = 100
  maxDistance = 10000
  minPolarAngle = 0.01
  maxPolarAngle = Math.PI / 2.25

  /** Where the camera is looking now. Read it; move the camera with setLookAt / setOrbit. */
  readonly target = new THREE.Vector3()

  private current: OrbitState
  private goal: OrbitState
  private saved: OrbitState
  private boundsMin: THREE.Vector2 | null = null
  private boundsMax: THREE.Vector2 | null = null

  private drag: {
    mode: 'rotate' | 'pan'
    pointerId: number
    x: number
    y: number
    grab: THREE.Vector3 | null
  } | null = null
  private touches = new Map<number, { x: number; y: number }>()
  private lastTouchAt = -Infinity
  private pinch: { grab: THREE.Vector3; distance: number } | null = null
  private keys = new Set<string>()
  private needsAnchor = false
  private wheelPick: { x: number; y: number; time: number; point: THREE.Vector3 | null } | null =
    null

  private raycaster = new THREE.Raycaster()
  private worldCache?: THREE.Object3D
  /** Picks the map only once its bounds trees are built; until then the flat ground stands in. */
  private treesReady = false
  private scratchCamera = new THREE.PerspectiveCamera()
  private lastPosition = new THREE.Vector3(NaN, NaN, NaN)
  private lastTarget = new THREE.Vector3(NaN, NaN, NaN)

  constructor(object: THREE.PerspectiveCamera, domElement: HTMLElement, scene?: THREE.Object3D) {
    super()
    this.object = object
    this.domElement = domElement
    this.scene = scene

    this.current = { target: new THREE.Vector3(), radius: 1000, theta: 0, phi: 1 }
    this.goal = cloneState(this.current)
    this.saved = cloneState(this.current)
    this.setLookAt(object.position, new THREE.Vector3())

    domElement.style.touchAction = 'none'
    if (domElement.tabIndex === -1) domElement.tabIndex = 0

    domElement.addEventListener('pointerdown', this.onPointerDown)
    domElement.addEventListener('pointermove', this.onPointerMove)
    domElement.addEventListener('pointerup', this.onPointerUp)
    domElement.addEventListener('pointercancel', this.onPointerUp)
    domElement.addEventListener('wheel', this.onWheel, { passive: false })
    domElement.addEventListener('dblclick', this.onDoubleClick)
    domElement.addEventListener('contextmenu', this.onContextMenu)
    domElement.addEventListener('keydown', this.onKeyDown)
    domElement.addEventListener('keyup', this.onKeyUp)
    domElement.addEventListener('blur', this.onBlur)
    window.addEventListener('blur', this.onBlur)
  }

  //
  // ─── PUBLIC ─────────────────────────────────────────────────────────────────────
  //

  /** Puts the camera at `position` looking at `target`; eases there unless `immediate`. */
  setLookAt(position: THREE.Vector3, target: THREE.Vector3, immediate = true) {
    const offset = position.clone().sub(target)
    const radius = Math.max(offset.length(), 1e-3)
    this.setOrbit(
      {
        target,
        radius,
        theta: Math.atan2(offset.y, offset.x),
        phi: Math.acos(clamp(offset.z / radius, -1, 1)),
      },
      immediate
    )
  }

  /** Orbits `target` at `radius`, heading `theta` and angle `phi` from straight above. */
  setOrbit(orbit: OrbitState, immediate = true) {
    copyState(this.goal, orbit)
    this.clampState(this.goal)
    if (immediate) copyState(this.current, this.goal)
    this.needsAnchor = false
    this.apply()
  }

  /** Keeps the orbit point inside these x/y limits (scene coordinates); null lifts them. */
  setBounds(min: THREE.Vector3 | null, max?: THREE.Vector3 | null) {
    this.boundsMin = min && max ? new THREE.Vector2(min.x, min.y) : null
    this.boundsMax = min && max ? new THREE.Vector2(max.x, max.y) : null
  }

  /** Remembers the current view for reset(). */
  saveState() {
    this.saved = cloneState(this.goal)
  }

  /** Goes back to the view saveState() remembered. */
  reset(immediate = false) {
    this.setOrbit(cloneState(this.saved), immediate)
  }

  /** Moves the camera toward its goal; call once a frame with the frame's duration (seconds). */
  update(delta = 1 / 60) {
    const dt = clamp(delta, 0, 0.1)
    this.buildTrees()

    if (this.enabled) this.applyKeys(dt)
    this.clampState(this.goal)

    const t = this.smoothing ? 1 - Math.exp(-SMOOTHING_RATE * dt) : 1
    const { current, goal } = this
    current.target.lerp(goal.target, t)
    current.radius = Math.exp(lerp(Math.log(current.radius), Math.log(goal.radius), t))
    current.theta = lerp(current.theta, goal.theta, t)
    current.phi = lerp(current.phi, goal.phi, t)

    if (this.isSettled()) {
      copyState(current, goal)
      if (this.needsAnchor && !this.isInteracting()) {
        this.anchor(goal)
        copyState(current, goal)
        this.needsAnchor = false
      }
    }

    return this.apply()
  }

  dispose() {
    const { domElement } = this
    domElement.removeEventListener('pointerdown', this.onPointerDown)
    domElement.removeEventListener('pointermove', this.onPointerMove)
    domElement.removeEventListener('pointerup', this.onPointerUp)
    domElement.removeEventListener('pointercancel', this.onPointerUp)
    domElement.removeEventListener('wheel', this.onWheel)
    domElement.removeEventListener('dblclick', this.onDoubleClick)
    domElement.removeEventListener('contextmenu', this.onContextMenu)
    domElement.removeEventListener('keydown', this.onKeyDown)
    domElement.removeEventListener('keyup', this.onKeyUp)
    domElement.removeEventListener('blur', this.onBlur)
    window.removeEventListener('blur', this.onBlur)
  }

  //
  // ─── CAMERA STATE ───────────────────────────────────────────────────────────────
  //

  private positionOf(state: OrbitState, into = new THREE.Vector3()) {
    const { radius, theta, phi } = state
    return into
      .set(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi)
      )
      .add(state.target)
  }

  private clampState(state: OrbitState) {
    state.radius = clamp(state.radius, this.minDistance, this.maxDistance)
    state.phi = clamp(state.phi, this.minPolarAngle, this.maxPolarAngle)
    if (this.boundsMin && this.boundsMax) {
      state.target.x = clamp(state.target.x, this.boundsMin.x, this.boundsMax.x)
      state.target.y = clamp(state.target.y, this.boundsMin.y, this.boundsMax.y)
    }
  }

  private isSettled() {
    const { current, goal } = this
    return (
      current.target.distanceToSquared(goal.target) < 0.25 &&
      Math.abs(Math.log(current.radius / goal.radius)) < 1e-3 &&
      Math.abs(current.theta - goal.theta) < 1e-4 &&
      Math.abs(current.phi - goal.phi) < 1e-4
    )
  }

  private isInteracting() {
    if (this.drag || this.touches.size > 0) return true
    for (const key of this.keys) if (MOVE_KEYS.has(key)) return true
    return false
  }

  /** Points the camera at the current state; true when it moved. */
  private apply() {
    const position = this.positionOf(this.current)
    if (
      position.distanceToSquared(this.lastPosition) < 1e-8 &&
      this.current.target.distanceToSquared(this.lastTarget) < 1e-8
    ) {
      return false
    }

    this.object.up.set(0, 0, 1)
    this.object.position.copy(position)
    this.object.lookAt(this.current.target)
    this.object.updateMatrixWorld()
    this.target.copy(this.current.target)
    this.lastPosition.copy(position)
    this.lastTarget.copy(this.current.target)
    this.dispatchEvent({ type: 'change' })
    return true
  }

  /**
   * Moves the orbit point to the ground at the centre of the view, keeping the camera where it
   * is. Skipped when that ground is out of reach or outside the bounds, which would move it.
   */
  private anchor(state: OrbitState) {
    const position = this.positionOf(state)
    const direction = state.target.clone().sub(position).normalize()
    const hit = this.raycastWorld(position, direction)
    if (!hit) return

    const distance = hit.distanceTo(position)
    if (distance < this.minDistance || distance > this.maxDistance) return
    if (
      this.boundsMin &&
      this.boundsMax &&
      (hit.x < this.boundsMin.x ||
        hit.x > this.boundsMax.x ||
        hit.y < this.boundsMin.y ||
        hit.y > this.boundsMax.y)
    ) {
      return
    }

    state.target.copy(hit)
    state.radius = distance
  }

  /** Anchors both where the camera is and where it is heading, before a rotate. */
  private anchorNow() {
    this.anchor(this.current)
    this.anchor(this.goal)
    this.needsAnchor = false
    this.apply()
  }

  //
  // ─── PICKING ────────────────────────────────────────────────────────────────────
  //

  private findWorld() {
    if (!this.worldCache?.parent) {
      this.worldCache = this.scene?.getObjectByName('world')
      this.treesReady = false
    }
    return this.worldCache
  }

  /** Builds the map's bounds trees a few ms a frame, and again for meshes that load later. */
  private buildTrees() {
    const world = this.findWorld()
    this.treesReady = world ? ensureBoundsTrees(world) : false
  }

  private raycastWorld(origin: THREE.Vector3, direction: THREE.Vector3) {
    const world = this.findWorld()
    if (!world || !this.treesReady) return null

    this.raycaster.set(origin, direction)
    this.raycaster.near = 0
    this.raycaster.far = this.maxDistance * 2
    this.raycaster.firstHitOnly = true
    const hit = this.raycaster
      .intersectObject(world, true)
      .find(({ object }) => isObjectShown(object))
    return hit ? hit.point.clone() : null
  }

  /** The ray under a screen position, from the camera as it would be in `state`. */
  private rayAt(clientX: number, clientY: number, state: OrbitState) {
    const rect = this.domElement.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null

    const camera = this.scratchCamera
    camera.copy(this.object, false)
    this.positionOf(state, camera.position)
    camera.up.set(0, 0, 1)
    camera.lookAt(state.target)
    camera.updateMatrixWorld()

    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(pointer, camera)
    return this.raycaster.ray.clone()
  }

  /**
   * Where a ray from the screen meets the flat ground at `height`, if it does within reach. Rays
   * close to the horizon don't count: there a few pixels span thousands of units.
   */
  private planeAt(clientX: number, clientY: number, state: OrbitState, height: number) {
    const ray = this.rayAt(clientX, clientY, state)
    if (!ray || ray.direction.z > -0.05) return null
    const distance = (height - ray.origin.z) / ray.direction.z
    if (distance <= 0 || distance > this.maxDistance) return null
    return ray.at(distance, new THREE.Vector3())
  }

  /** The map under a screen position, or the flat ground at the target's height. */
  private pickGround(clientX: number, clientY: number, state: OrbitState) {
    const ray = this.rayAt(clientX, clientY, state)
    if (!ray) return null
    return (
      this.raycastWorld(ray.origin, ray.direction) ??
      this.planeAt(clientX, clientY, state, state.target.z)
    )
  }

  //
  // ─── MOVES ──────────────────────────────────────────────────────────────────────
  //

  private rotateBy(dx: number, dy: number) {
    const height = this.domElement.clientHeight || 1
    const speed = (ROTATE_PER_VIEW_HEIGHT * this.rotateSpeed) / height
    this.goal.theta -= dx * speed
    this.goal.phi = clamp(this.goal.phi - dy * speed, this.minPolarAngle, this.maxPolarAngle)
  }

  /** Slides the map so `grab` sits under the screen position; false when it can't. */
  private panTo(grab: THREE.Vector3, clientX: number, clientY: number) {
    const hit = this.planeAt(clientX, clientY, this.goal, grab.z)
    if (!hit) return false
    this.goal.target.x += grab.x - hit.x
    this.goal.target.y += grab.y - hit.y
    this.needsAnchor = true
    return true
  }

  /** Pans by screen pixels at the target's depth, for a drag that started on the sky. */
  private panByPixels(dx: number, dy: number) {
    const height = this.domElement.clientHeight || 1
    const scale =
      (2 * this.goal.radius * Math.tan(THREE.MathUtils.degToRad(this.object.fov / 2))) / height
    const { theta } = this.goal
    // Drag right: the map follows, so the camera goes left. Drag down: the camera goes forward.
    this.goal.target.x += (Math.sin(theta) * dx - Math.cos(theta) * dy) * scale
    this.goal.target.y += (-Math.cos(theta) * dx - Math.sin(theta) * dy) * scale
    this.needsAnchor = true
  }

  /** Scales the distance by `factor`, keeping `point` (if any) where it is on screen. */
  private zoomAt(point: THREE.Vector3 | null, factor: number) {
    const radius = clamp(this.goal.radius * factor, this.minDistance, this.maxDistance)
    const scale = radius / this.goal.radius
    if (scale === 1) return
    if (point) this.goal.target.sub(point).multiplyScalar(scale).add(point)
    this.goal.radius = radius
    this.needsAnchor = true
  }

  private applyKeys(dt: number) {
    if (this.keys.size === 0) return
    const has = (code: string) => (this.keys.has(code) ? 1 : 0)
    const forward = has('KeyW') - has('KeyS')
    const right = has('KeyD') - has('KeyA')
    // Q swings the camera left around the target (the map turns right), as in most RTS games.
    const turn = has('KeyE') - has('KeyQ')
    const boost = this.keys.has('Shift') ? KEY_BOOST : 1

    if (forward || right) {
      const { theta } = this.goal
      const step =
        (KEY_PAN_PER_SECOND * this.goal.radius * this.keyPanSpeed * boost * dt) /
        Math.hypot(forward, right)
      // Facing the target: forward is away from the camera, right is forward × up.
      this.goal.target.x += (-Math.cos(theta) * forward - Math.sin(theta) * right) * step
      this.goal.target.y += (-Math.sin(theta) * forward + Math.cos(theta) * right) * step
      this.needsAnchor = true
    }

    if (turn) this.goal.theta += turn * KEY_TURN_PER_SECOND * this.rotateSpeed * boost * dt
  }

  //
  // ─── EVENTS ─────────────────────────────────────────────────────────────────────
  //

  private onPointerDown = (event: PointerEvent) => {
    if (!this.enabled) return

    if (event.pointerType === 'touch') {
      this.lastTouchAt = performance.now()
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (this.touches.size === 1) this.anchorNow()
      if (this.touches.size === 2) this.startPinch()
      return
    }

    if (this.drag) return
    const swap = event.shiftKey || event.ctrlKey || event.metaKey
    let mode: 'rotate' | 'pan'
    if (event.button === 0) mode = swap ? 'pan' : 'rotate'
    else if (event.button === 1 || event.button === 2) mode = swap ? 'rotate' : 'pan'
    else return

    event.preventDefault()
    this.domElement.focus({ preventScroll: true })
    // Keeps the drag going outside the canvas; it can throw for a pointer that is already gone.
    try {
      this.domElement.setPointerCapture(event.pointerId)
    } catch {}

    if (mode === 'rotate') this.anchorNow()
    this.drag = {
      mode,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      grab: mode === 'pan' ? this.pickGround(event.clientX, event.clientY, this.goal) : null,
    }
  }

  private onPointerMove = (event: PointerEvent) => {
    if (!this.enabled) return

    if (event.pointerType === 'touch') {
      const previous = this.touches.get(event.pointerId)
      if (!previous) return
      const next = { x: event.clientX, y: event.clientY }
      this.touches.set(event.pointerId, next)

      if (this.touches.size === 1) this.rotateBy(next.x - previous.x, next.y - previous.y)
      if (this.touches.size === 2 && this.pinch) {
        const { x, y, distance } = this.pinchPoints()
        if (distance > 0) this.zoomAt(this.pinch.grab, this.pinch.distance / distance)
        this.panTo(this.pinch.grab, x, y)
        this.pinch.distance = distance
      }
      return
    }

    const { drag } = this
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.mode === 'rotate') this.rotateBy(event.clientX - drag.x, event.clientY - drag.y)
    if (
      drag.mode === 'pan' &&
      !(drag.grab && this.panTo(drag.grab, event.clientX, event.clientY))
    ) {
      this.panByPixels(event.clientX - drag.x, event.clientY - drag.y)
    }
    drag.x = event.clientX
    drag.y = event.clientY
  }

  private onPointerUp = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      if (!this.touches.delete(event.pointerId)) return
      this.pinch = null
      if (this.touches.size === 2) this.startPinch()
      if (this.touches.size === 0) this.needsAnchor = true
      return
    }

    if (!this.drag || this.drag.pointerId !== event.pointerId) return
    try {
      this.domElement.releasePointerCapture(event.pointerId)
    } catch {}
    this.drag = null
    this.needsAnchor = true
  }

  private pinchPoints() {
    const [a, b] = [...this.touches.values()]
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    }
  }

  private startPinch() {
    const { x, y, distance } = this.pinchPoints()
    const grab = this.pickGround(x, y, this.goal) ?? this.goal.target.clone()
    this.pinch = { grab, distance }
  }

  private onWheel = (event: WheelEvent) => {
    if (!this.enabled) return
    event.preventDefault()

    const pixels =
      event.deltaY *
      (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.domElement.clientHeight : 1)
    const rate = event.ctrlKey ? PINCH_ZOOM_PER_PIXEL : WHEEL_ZOOM_PER_PIXEL
    const factor = Math.exp(clamp(pixels * rate * this.zoomSpeed, -1, 1))

    // Picking the map is the costly part, so a run of wheel events keeps the first pick: zooming
    // about that point leaves it under the cursor.
    const now = performance.now()
    const cached = this.wheelPick
    if (
      !cached ||
      now - cached.time > WHEEL_PICK_MS ||
      Math.abs(cached.x - event.clientX) > 3 ||
      Math.abs(cached.y - event.clientY) > 3
    ) {
      this.wheelPick = {
        x: event.clientX,
        y: event.clientY,
        time: now,
        point: this.pickGround(event.clientX, event.clientY, this.goal),
      }
    } else {
      cached.time = now
    }

    this.zoomAt(this.wheelPick!.point, factor)
  }

  private onDoubleClick = (event: MouseEvent) => {
    // A double-tap seeks on a phone (Mobile/useSceneTaps); some browsers send dblclick for it too.
    if (!this.enabled || performance.now() - this.lastTouchAt < 1000) return
    const point = this.pickGround(event.clientX, event.clientY, this.goal)
    if (!point) return
    this.goal.target.copy(point)
    this.needsAnchor = true
  }

  private onContextMenu = (event: Event) => event.preventDefault()

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.enabled || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.shiftKey) this.keys.add('Shift')
    else this.keys.delete('Shift')

    if (MOVE_KEYS.has(event.code)) {
      this.keys.add(event.code)
      event.preventDefault()
    } else if (event.code === 'KeyR' && !event.repeat) {
      this.reset()
      event.preventDefault()
    }
  }

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code)
    if (!event.shiftKey) this.keys.delete('Shift')
  }

  private onBlur = () => {
    this.keys.clear()
  }
}
