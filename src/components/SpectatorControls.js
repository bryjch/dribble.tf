import * as THREE from 'three'
import { clamp } from 'lodash'
import keycode from 'keycode'

// Custom override of SpectatorControls by isRyven
// https://github.com/isRyven/SpectatorControls

// actions
const FORWARD = 1 << 0
const LEFT = 1 << 1
const RIGHT = 1 << 2
const BACK = 1 << 3
const UP = 1 << 4
const DOWN = 1 << 5
const SPRINT = 1 << 6

// defaults
const MOVESPEED = 20
const FRICTION = 0.8
const LOOKSPEED = 5
const SPRINTMULT = 3
const KEYMAPPING = {
  [keycode('w')]: 'FORWARD',
  [keycode('a')]: 'LEFT',
  [keycode('s')]: 'BACK',
  [keycode('d')]: 'RIGHT',
  [keycode('space')]: 'UP',
  [keycode('ctrl')]: 'DOWN',
  [keycode('e')]: 'UP',
  [keycode('q')]: 'DOWN',
  [keycode('shift')]: 'SPRINT',
}
const MOUSEMAPPING = {
  LEFT: 0,
  MIDDLE: 1,
  RIGHT: 2,
}

export class SpectatorControls {
  constructor(camera, domElement) {
    this.camera = camera
    this.domElement = domElement
    this.lookSpeed = LOOKSPEED
    this.moveSpeed = MOVESPEED
    this.friction = FRICTION
    this.sprintMultiplier = SPRINTMULT
    this.keyMapping = Object.assign({}, KEYMAPPING, KEYMAPPING)
    this.enabled = false
    this._mouseState = { x: 0, y: 0 }
    this._keyState = { press: 0, prevPress: 0 }
    this._moveState = { velocity: new THREE.Vector3(0, 0, 0) }
    this._processMouseMoveEvent = this._processMouseMoveEvent.bind(this)
    this._processMouseDownEvent = this._processMouseDownEvent.bind(this)
    this._processMouseUpEvent = this._processMouseUpEvent.bind(this)
    this._processKeyEvent = this._processKeyEvent.bind(this)
  }
  _processMouseMoveEvent(event) {
    this._processMouseMove(
      event.movementX || event.mozMovementX || event.webkitMovementX,
      event.movementY || event.mozMovementY || event.webkitMovementY
    )
  }
  _processMouseMove(x = 0, y = 0) {
    this._mouseState = { x, y }
  }
  _processMouseDownEvent(event) {
    if ([MOUSEMAPPING.LEFT, MOUSEMAPPING.RIGHT].includes(event.button)) {
      this.enable()
      this.domElement.requestPointerLock()
    }
  }
  _processMouseUpEvent(event) {
    if ([MOUSEMAPPING.LEFT, MOUSEMAPPING.RIGHT].includes(event.button)) {
      this.disable()
      document.exitPointerLock()
    }
  }
  _processKeyEvent(event) {
    this._processKey(event.keyCode, event.type === 'keydown')
  }
  _processKey(key, isPressed) {
    const { press } = this._keyState
    let newPress = press
    switch (this.keyMapping[key]) {
      case 'FORWARD':
        isPressed ? (newPress |= FORWARD) : (newPress &= ~FORWARD)
        break
      case 'BACK':
        isPressed ? (newPress |= BACK) : (newPress &= ~BACK)
        break
      case 'LEFT':
        isPressed ? (newPress |= LEFT) : (newPress &= ~LEFT)
        break
      case 'RIGHT':
        isPressed ? (newPress |= RIGHT) : (newPress &= ~RIGHT)
        break
      case 'UP':
        isPressed ? (newPress |= UP) : (newPress &= ~UP)
        break
      case 'DOWN':
        isPressed ? (newPress |= DOWN) : (newPress &= ~DOWN)
        break
      case 'SPRINT':
        isPressed ? (newPress |= SPRINT) : (newPress &= ~SPRINT)
        break
      default:
        break
    }
    this._keyState.press = newPress
  }
  listen() {
    this.domElement.addEventListener('mousedown', this._processMouseDownEvent)
    this.domElement.addEventListener('mouseup', this._processMouseUpEvent)
  }
  unlisten() {
    this.domElement.removeEventListener('mousedown', this._processMouseDownEvent)
    this.domElement.removeEventListener('mouseup', this._processMouseUpEvent)
  }
  enable() {
    document.addEventListener('mousemove', this._processMouseMoveEvent)
    document.addEventListener('keydown', this._processKeyEvent)
    document.addEventListener('keyup', this._processKeyEvent)
    this.enabled = true
    this.camera.rotation.reorder('ZYX')
  }
  disable() {
    document.removeEventListener('mousemove', this._processMouseMoveEvent)
    document.removeEventListener('keydown', this._processKeyEvent)
    document.removeEventListener('keyup', this._processKeyEvent)
    this.enabled = false
    this._keyState.press = 0
    this._keyState.prevPress = 0
    this._mouseState = { x: 0, y: 0 }
    this.camera.rotation.reorder('XYZ')
  }
  isEnabled() {
    return this.enabled
  }
  dispose() {
    this.unlisten()
    this.disable()
    document.exitPointerLock()
  }
  update(delta = 1) {
    if (!this.enabled) {
      // finish move transition
      if (this._moveState.velocity.length() > 0) {
        this._moveCamera(this._moveState.velocity)
      }
      return
    }

    // view angles
    const scaledSpeed = this.lookSpeed / 1000
    const actualLookSpeed = delta * scaledSpeed
    const lon = 1 * this._mouseState.x * actualLookSpeed
    const lat = 1 * this._mouseState.y * actualLookSpeed

    // keep vertical mouse angles within 180deg
    this.camera.rotation.x = clamp(this.camera.rotation.x - lat, 0, Math.PI)

    // keep horizontal mouse angles within 360deg
    // NOTE: this is rotation.z instead of rotation.y because our DefaultUp is Z axis!
    this.camera.rotation.z = (this.camera.rotation.z - lon) % (Math.PI * 2)

    this._mouseState = { x: 0, y: 0 }

    // movements
    let actualMoveSpeed = delta * this.moveSpeed
    const velocity = this._moveState.velocity.clone()
    const { press } = this._keyState

    if (press & SPRINT) actualMoveSpeed *= this.sprintMultiplier
    if (press & FORWARD) velocity.z = -actualMoveSpeed
    if (press & BACK) velocity.z = actualMoveSpeed
    if (press & LEFT) velocity.x = -actualMoveSpeed
    if (press & RIGHT) velocity.x = actualMoveSpeed

    if (press & UP) {
      velocity.add(this._applyCameraInverse(new THREE.Vector3(0, 0, actualMoveSpeed)))
    }
    if (press & DOWN) {
      velocity.add(this._applyCameraInverse(new THREE.Vector3(0, 0, -actualMoveSpeed)))
    }

    this._moveCamera(velocity)

    this._moveState.velocity = velocity
    this._keyState.prevPress = press
  }
  _applyCameraInverse(vector) {
    const quat = new THREE.Quaternion()
    quat.setFromEuler(this.camera.rotation)
    quat.invert()
    return vector.clone().applyQuaternion(quat)
  }
  _moveCamera(velocity) {
    let maxSpeed = this.moveSpeed
    if (this._keyState.press & SPRINT) {
      maxSpeed *= this.sprintMultiplier
    }

    velocity.multiplyScalar(this.friction)
    velocity.clampLength(0, maxSpeed)
    this.camera.translateZ(velocity.z)
    this.camera.translateX(velocity.x)
    this.camera.translateY(velocity.y)
  }
  mapKey(key, action) {
    this.keyMapping = Object.assign({}, this.keyMapping, { [key]: action })
  }
}

export default SpectatorControls
