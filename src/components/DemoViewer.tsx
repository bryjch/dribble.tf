import { Component, createRef, useRef, useEffect, useState, useCallback, Suspense } from 'react'

// THREE related imports
import * as THREE from 'three'
import { Canvas, useFrame, useThree, extend } from '@react-three/fiber'
import { PerspectiveCamera } from '@react-three/drei'
import { EffectComposer, Outline, Selection } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'

// Scene items
// @ts-ignore
import { RtsControls } from '@components/Controls/RtsControls'
// @ts-ignore
import { SpectatorControls } from '@components/Controls/SpectatorControls'
import { CanvasKeyHandler } from '@components/Scene/CanvasKeyHandler'
import { Lights } from '@components/Scene/Lights'
import { Actors } from '@components/Scene/Actors'
import { Projectiles } from '@components/Scene/Projectiles'
import { World } from '@components/Scene/World'
import { Skybox } from '@components/Scene/Skybox'
import { Stickers } from '@components/Scene/Stickers'
import { AsyncParser } from './Analyse/Data/AsyncParser'
import { CachedPlayer } from './Analyse/Data/PlayerCache'
import { InterpolatedProjectile } from './Scene/Projectiles'

// UI Panels
import { AboutPanel } from '@components/UI/AboutPanel'
import { SettingsPanel } from '@components/UI/SettingsPanel'
import { PlaybackPanel } from '@components/UI/PlaybackPanel'
import { Killfeed } from '@components/UI/Killfeed'
import { ChatHud } from '@components/UI/ChatHud'
import { PlayerStatuses } from '@components/UI/PlayerStatuses'
import { FocusedPlayer } from '@components/UI/FocusedPlayer'
import { MatchKillfeedPanel } from '@components/UI/MatchKillfeedPanel'
import { BookmarksPanel } from '@components/UI/BookmarksPanel'
import { SetupsPanel } from '@components/UI/SetupsPanel'
import { FpsCounter } from '@components/UI/FpsCounter'
import { Crosshair } from '@components/UI/Crosshair'
import { MapOffsetDebugPanel } from '@components/UI/MapOffsetDebugPanel'

import { motion } from 'framer-motion'
import { AiFillFastForwardIcon } from '@components/Misc/Icons'

// Actions & utils
import { useStore, getState, useInstance } from '@zus/store'
import {
  changeControlsModeAction,
  forceShowPanelAction,
  goToTickAction,
  playbackJumpAction,
  setSceneRtsCenterAction,
} from '@zus/actions'
import { ActorProps } from './Scene/Actors'
import { isPerfLoggingEnabled, readJsHeapMemoryMb } from '@utils/misc'
import { useIsMobile } from '@utils/hooks'
import { cn } from '@utils/styling'
import { ControlsMode, DrawingTool, SavedSetupCamera } from '@constants/types'
import { getWorldIntersectionFromScreen } from '@utils/raycast'

//
// ─── THREE SETTINGS & ELEMENTS ──────────────────────────────────────────────────
//

// Modify default UP axis to be consistent with game coordinates
THREE.Object3D.DEFAULT_UP.set(0, 0, 1)
THREE.Cache.enabled = true

// Basic controls for our scene
extend({ RtsControls, SpectatorControls })

const SPECTATOR_CAMERA_OFFSET = new THREE.Vector3(0, 45, 150)
const RTS_CAMERA_OFFSET = new THREE.Vector3(0, 250, 1000)
const RTS_TARGET_DISTANCE = 1500
const ENABLE_DEBUG_MAP_OFFSET = false
const MARKER_COLOR = '#37ff5f'

const roundOffset = (x: number, y: number, z: number) => ({
  x: Math.round(x),
  y: Math.round(y),
  z: Math.round(z),
})

const getFocusedViewTransform = (focusedObject?: THREE.Object3D) => {
  if (!focusedObject) return null

  const focusAnchor =
    focusedObject.getObjectByName('povCamera') ?? focusedObject.getObjectByName('playerAim')

  if (!focusAnchor) return null

  focusAnchor.updateWorldMatrix(true, false)

  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const direction = new THREE.Vector3()

  focusAnchor.getWorldPosition(position)
  focusAnchor.getWorldQuaternion(quaternion)
  direction.set(0, 0, -1).applyQuaternion(quaternion).normalize()

  return { position, quaternion, direction }
}

// This component is messy af but whatever yolo
const Controls = () => {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null)
  const controlsRef = useRef<any>()
  const spectatorRef = useRef<any>()
  const pendingSetupCameraRef = useRef<SavedSetupCamera | null>(null)
  const skipSpectatorAutoEnableRef = useRef(false)
  // const [spectatorRef, setSpectatorRef] = useState()
  const { gl, scene, set } = useThree()

  const settings = useStore(state => state.settings)
  const controlsMode = useStore(state => state.scene.controls.mode)
  const bounds = useStore(state => state.scene.bounds)
  const drawingEnabled = useStore(state => state.drawing.enabled)
  const drawingTool = useStore(state => state.drawing.tool)
  const stickerDragActive = useStore(state => state.drawing.stickerDrag.active)
  const focusedObject = useInstance(state => state.focusedObject)
  const lastFocusedPOV = useInstance(state => state.lastFocusedPOV)
  const isStickersToolActive = drawingEnabled && drawingTool === DrawingTool.STICKERS

  // Keep a reference of our scene in the store's instances for easy access
  useEffect(() => {
    useInstance.getState().setThreeScene(scene)
  }, [scene])

  // Update the default camera when necessary
  useEffect(() => {
    let nextCamera = focusedObject?.getObjectByName('povCamera') ?? (scene as any)?.camera

    if (nextCamera) {
      set({ camera: nextCamera as THREE.PerspectiveCamera })
    }
  }, [focusedObject]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update controls & camera position when necessary
  useEffect(() => {
    if (!cameraRef.current) return

    // Depending on whether there was a previous focused object, we either:
    // - reposition our Controls where that object was
    // - reposition our Controls to the center of the scene
    const focusedView = getFocusedViewTransform(lastFocusedPOV)
    const newPos = focusedView?.position ?? bounds.defaultRtsCenter
    let cameraOffset = bounds.defaultCameraOffset

    if (focusedView) {
      if (controlsMode === 'rts') {
        cameraOffset = RTS_CAMERA_OFFSET.clone().applyQuaternion(focusedView.quaternion)
      }

      if (controlsMode === 'spectator') {
        cameraOffset = SPECTATOR_CAMERA_OFFSET.clone().applyQuaternion(focusedView.quaternion)
      }
    }

    cameraRef.current.position.copy(newPos).add(cameraOffset)
    cameraRef.current.near = 10
    cameraRef.current.far = settings.ui.viewDistance || 15000

    if (controlsMode === 'rts' && controlsRef.current) {
      const nextTarget = focusedView
        ? cameraRef.current.position
            .clone()
            .add(focusedView.direction.clone().multiplyScalar(RTS_TARGET_DISTANCE))
        : bounds.defaultRtsCenter.clone()

      controlsRef.current.target.copy(nextTarget)
      cameraRef.current.lookAt(nextTarget)
      controlsRef.current.update()
      controlsRef.current.saveState()
    }

    if (controlsMode === 'spectator' && spectatorRef.current) {
      if (focusedView) {
        cameraRef.current.quaternion.copy(focusedView.quaternion)
      } else {
        cameraRef.current.lookAt(bounds.defaultRtsCenter)
      }

      spectatorRef.current.listen()
      if (skipSpectatorAutoEnableRef.current) {
        spectatorRef.current.disable()
        skipSpectatorAutoEnableRef.current = false
      } else {
        spectatorRef.current.enable()
      }
    }
  }, [cameraRef.current, lastFocusedPOV, bounds, controlsMode])

  useEffect(() => {
    if (!cameraRef.current) return
    cameraRef.current.far = settings.ui.viewDistance || 15000
    cameraRef.current.updateProjectionMatrix()
  }, [settings.ui.viewDistance])

  useEffect(() => {
    if (!controlsRef.current) return
    controlsRef.current.enabled = !stickerDragActive
  }, [stickerDragActive, controlsMode])

  useEffect(() => {
    if (!spectatorRef.current) return

    spectatorRef.current.allowPointerLock = !isStickersToolActive

    if (isStickersToolActive && spectatorRef.current.isEnabled()) {
      spectatorRef.current.disable()
    }
  }, [controlsMode, isStickersToolActive])

  const captureSetupCamera = useCallback((): SavedSetupCamera | null => {
    if (!cameraRef.current) return null

    if (controlsMode === ControlsMode.RTS && controlsRef.current) {
      return {
        mode: 'rts',
        position: vector3ToTuple(cameraRef.current.position),
        target: vector3ToTuple(controlsRef.current.target),
      }
    }

    if (controlsMode === ControlsMode.SPECTATOR) {
      return {
        mode: 'spectator',
        position: vector3ToTuple(cameraRef.current.position),
        quaternion: quaternionToTuple(cameraRef.current.quaternion),
      }
    }

    const focusedView = getFocusedViewTransform(focusedObject)
    if (!focusedView) {
      return {
        mode: 'spectator',
        position: vector3ToTuple(cameraRef.current.position),
        quaternion: quaternionToTuple(cameraRef.current.quaternion),
      }
    }

    return {
      mode: 'spectator',
      position: vector3ToTuple(focusedView.position),
      quaternion: quaternionToTuple(focusedView.quaternion),
    }
  }, [controlsMode, focusedObject])

  const tryApplyPendingSetupCamera = useCallback(() => {
    if (!pendingSetupCameraRef.current || !cameraRef.current) return false

    const pendingCamera = pendingSetupCameraRef.current

    if (pendingCamera.mode === 'rts') {
      if (controlsMode !== ControlsMode.RTS || !controlsRef.current) return false

      cameraRef.current.position.set(...pendingCamera.position)
      controlsRef.current.target.set(...pendingCamera.target)
      cameraRef.current.lookAt(controlsRef.current.target)
      controlsRef.current.update()
      controlsRef.current.saveState()
      pendingSetupCameraRef.current = null
      return true
    }

    if (controlsMode !== ControlsMode.SPECTATOR) return false

    spectatorRef.current?.disable()
    cameraRef.current.position.set(...pendingCamera.position)
    cameraRef.current.quaternion.set(...pendingCamera.quaternion)
    cameraRef.current.updateMatrixWorld()
    pendingSetupCameraRef.current = null
    return true
  }, [controlsMode])

  const applySetupCamera = useCallback(
    (camera: SavedSetupCamera) => {
      pendingSetupCameraRef.current = camera

      if (camera.mode === 'spectator') {
        skipSpectatorAutoEnableRef.current = true
      }

      if (camera.mode === 'rts' && controlsMode !== ControlsMode.RTS) {
        changeControlsModeAction(ControlsMode.RTS)
        return
      }

      if (camera.mode === 'spectator' && controlsMode !== ControlsMode.SPECTATOR) {
        changeControlsModeAction(ControlsMode.SPECTATOR)
        return
      }

      tryApplyPendingSetupCamera()
    },
    [controlsMode, tryApplyPendingSetupCamera]
  )

  useEffect(() => {
    useInstance.getState().setSetupCameraBridge({
      capture: captureSetupCamera,
      apply: applySetupCamera,
    })

    return () => {
      useInstance.getState().setSetupCameraBridge(undefined)
    }
  }, [applySetupCamera, captureSetupCamera])

  useEffect(() => {
    tryApplyPendingSetupCamera()
  }, [bounds, controlsMode, tryApplyPendingSetupCamera])

  useFrame(() => {
    if (controlsRef.current) controlsRef.current.update()
    if (spectatorRef.current) spectatorRef.current.update()

    if (
      ENABLE_DEBUG_MAP_OFFSET &&
      controlsMode === 'rts' &&
      controlsRef.current &&
      cameraRef.current
    ) {
      useInstance.getState().setMapOffsetDebug({
        cameraOffset: roundOffset(
          cameraRef.current.position.x - bounds.defaultRtsCenter.x,
          cameraRef.current.position.y - bounds.defaultRtsCenter.y,
          cameraRef.current.position.z - bounds.defaultRtsCenter.z
        ),
      })
    }
  })

  return (
    <>
      <PerspectiveCamera
        ref={cameraRef}
        name="freeCamera"
        attach="camera"
        makeDefault
        {...settings.camera}
      />

      {controlsMode === 'rts' && cameraRef.current && (
        // @ts-ignore
        <rtsControls
          ref={controlsRef}
          name="rts"
          attach="controls"
          args={[cameraRef.current, gl.domElement]}
          {...settings.controls}
        />
      )}

      {controlsMode === 'spectator' && cameraRef.current && (
        // @ts-ignore
        <spectatorControls
          ref={spectatorRef}
          name="spectator"
          attach="controls"
          args={[cameraRef.current, gl.domElement]}
          {...settings.controls}
        />
      )}
    </>
  )
}

const PerfProbe = ({ enabled }: { enabled: boolean }) => {
  const { gl } = useThree()

  useFrame(() => {
    if (!enabled) return

    useInstance.getState().setRuntimePerf({
      renderCalls: gl.info.render.calls,
      renderTriangles: gl.info.render.triangles,
    })
  })

  return null
}

const MapCenterMarker = () => {
  const center = useStore(state => state.scene.bounds.defaultRtsCenter)
  const pickerActive = useInstance(state => state.mapCenterPickerActive)

  return (
    <group position={[center.x, center.y, center.z + 3]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={20}>
        <torusGeometry args={[44, 5, 16, 64]} />
        <meshBasicMaterial
          color={MARKER_COLOR}
          transparent
          opacity={pickerActive ? 1 : 0.85}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      <mesh renderOrder={20}>
        <boxGeometry args={[54, 8, 4]} />
        <meshBasicMaterial
          color={MARKER_COLOR}
          transparent
          opacity={pickerActive ? 1 : 0.85}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      <mesh rotation={[0, 0, Math.PI / 2]} renderOrder={20}>
        <boxGeometry args={[54, 8, 4]} />
        <meshBasicMaterial
          color={MARKER_COLOR}
          transparent
          opacity={pickerActive ? 1 : 0.85}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

// Double-tap seek overlay for mobile (YouTube-style)
const DOUBLE_TAP_SEEK_TICKS = 50
const DOUBLE_TAP_TIMEOUT = 300

const DoubleTapSeek = () => {
  const isMobile = useIsMobile()
  const lastTapRef = useRef<{ time: number; side: 'left' | 'right' } | null>(null)
  const [ripple, setRipple] = useState<{ side: 'left' | 'right'; key: number } | null>(null)

  const handleTap = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    // Only respond to single-finger taps
    if (e.touches.length > 1) return

    const touch = e.changedTouches[0]
    const side = touch.clientX < window.innerWidth / 2 ? 'left' : 'right'
    const now = Date.now()

    if (
      lastTapRef.current &&
      lastTapRef.current.side === side &&
      now - lastTapRef.current.time < DOUBLE_TAP_TIMEOUT
    ) {
      // Double tap detected
      e.preventDefault()
      if (side === 'right') {
        playbackJumpAction('seekForward')
      } else {
        playbackJumpAction('seekBackward')
      }
      setRipple({ side, key: now })
      lastTapRef.current = null
    } else {
      lastTapRef.current = { time: now, side }
    }
  }, [])

  if (!isMobile) return null

  return (
    <div
      className="ui-layer pointer-events-auto z-10"
      onTouchEnd={handleTap}
      style={{ touchAction: 'manipulation' }}
    >
      {/* Ripple feedback */}
      {ripple && (
        <div
          className={cn(
            'absolute inset-y-0 flex items-center justify-center',
            ripple.side === 'left' ? 'left-0 w-1/2' : 'right-0 w-1/2'
          )}
        >
          <motion.div
            key={ripple.key}
            className="flex flex-col items-center gap-1 rounded-full bg-black/30 px-6 py-4"
            initial={{ opacity: 0.9, scale: 0.8 }}
            animate={{ opacity: 0, scale: 1.1 }}
            transition={{ duration: 0.6 }}
          >
            <AiFillFastForwardIcon
              width="2rem"
              height="2rem"
              className={ripple.side === 'left' ? 'rotate-180' : ''}
            />
            <span className="text-sm font-bold">
              {ripple.side === 'left' ? '-' : '+'}
              {DOUBLE_TAP_SEEK_TICKS} ticks
            </span>
          </motion.div>
        </div>
      )}
    </div>
  )
}

// FocusedPlayer wrapper - adjusts positioning for mobile
const FocusedPlayerLayer = (props: {
  players: CachedPlayer[]
  tick: number
  intervalPerTick: number
}) => {
  const isMobile = useIsMobile()
  return (
    <div
      className={cn(
        'ui-layer items-end justify-center',
        isMobile ? 'bottom-[12vh]' : 'bottom-[20vh]'
      )}
    >
      <FocusedPlayer {...props} />
    </div>
  )
}

// Panel toolbar - functional component so we can use useIsMobile hook
const PanelToolbar = ({ hasDemoLoaded }: { hasDemoLoaded: boolean }) => {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <div className="ui-layer m-3 items-start justify-start">
        <div className="flex items-center">
          <SettingsPanel />
          <AboutPanel />
          <SetupsPanel />
          {hasDemoLoaded && <MatchKillfeedPanel />}
          {hasDemoLoaded && <BookmarksPanel />}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="ui-layer m-4 items-start justify-start">
        <SettingsPanel />
      </div>

      <div className="ui-layer justift-start m-4 mt-16 items-start">
        <AboutPanel />
      </div>

      <div className="ui-layer justift-start m-4 mt-28 items-start">
        <SetupsPanel />
      </div>

      {hasDemoLoaded && (
        <div className="ui-layer m-4 mt-40 items-start justify-start">
          <MatchKillfeedPanel />
        </div>
      )}

      {hasDemoLoaded && (
        <div className="ui-layer m-4 mt-52 items-start justify-start">
          <BookmarksPanel />
        </div>
      )}
    </>
  )
}

//
// ─── COMPONENT ──────────────────────────────────────────────────────────────────
//
type DemoViewerProps = {
  demo?: AsyncParser
  map: string
}

class DemoViewer extends Component<DemoViewerProps> {
  playbackSub = function () {}
  settingsSub = function () {}
  canvasRef = createRef<HTMLCanvasElement>()
  uiLayers = createRef<HTMLDivElement>()

  // Perf logging
  perfLoggingEnabled = isPerfLoggingEnabled()
  perfLogTimer = 0

  // Timing variables for animation loop
  elapsedTime = 0
  lastTimestamp = 0
  lastTouchPos = { x: 0, y: 0 }

  state = {
    playback: getState().playback,
    settings: getState().settings,
  }

  //
  // ─── LIFECYCLE ──────────────────────────────────────────────────────────────────
  //

  componentDidMount() {
    this.animate(0)

    // These zustand subscribers are necessary because useStore.getState doesn't
    // update correctly in React class components. Unfortunately I've decided to
    // keep this component as a class component instead of converting to a functional
    // component -- because it seems to be SUPER PAINFUL trying to get the animate()
    // requestAnimationFrame stuff working correctly as a functional component
    // (it ends up annihilating the fps and some other buggy behaviour)
    this.playbackSub = useStore.subscribe(state => this.setState({ playback: state.playback }))
    this.settingsSub = useStore.subscribe(state => this.setState({ settings: state.settings }))

    // Force tabIndex (r3f seems to ignore it if provided in props) as this is how
    // we can ensure separation of Global and Canvas-only keyboard events when certain
    // elements are in focus (e.g. when menu is open, we don't want to trigger Canvas events)
    // https://github.com/pmndrs/react-three-fiber/issues/1238
    this.canvasRef.current?.setAttribute('tabindex', '0')
  }

  componentWillUnmount() {
    this.playbackSub()
    this.settingsSub()
  }

  //
  // ─── ANIMATION LOOP ─────────────────────────────────────────────────────────────
  //

  // TODO: it may be better to try using THREE.js Clock for playback instead
  // of this requestAnimationFrame() implementation
  // https://threejs.org/docs/#api/en/core/Clock
  animate = async (timestamp: number) => {
    const { playback } = this.state

    const intervalPerTick = playback.intervalPerTick || 0.015
    const millisPerTick = 1000 * intervalPerTick * (1 / playback.speed)
    const frameDelta = timestamp - this.lastTimestamp

    this.elapsedTime += frameDelta

    if (playback.playing) {
      if (this.elapsedTime >= millisPerTick) {
        const ticksToAdvance = Math.floor(this.elapsedTime / millisPerTick)
        this.elapsedTime -= ticksToAdvance * millisPerTick
        goToTickAction(playback.tick + ticksToAdvance)
      }
      useInstance.getState().setFrameProgress(Math.min(this.elapsedTime / millisPerTick, 0.999))
    } else {
      useInstance.getState().setFrameProgress(0)
      this.elapsedTime = 0
    }

    if (this.perfLoggingEnabled) {
      this.perfLogTimer += frameDelta
      if (this.perfLogTimer >= 5000) {
        this.perfLogTimer = 0
        const heapMb = readJsHeapMemoryMb()
        const { runtimePerf } = useInstance.getState()
        console.log(
          `[Perf] tick=${playback.tick}` +
            ` calls=${runtimePerf.renderCalls}` +
            ` triangles=${runtimePerf.renderTriangles}` +
            ` visibleChunks=${runtimePerf.visibleChunkCount}` +
            ` cluster=${runtimePerf.currentCluster ?? 'all'}` +
            (heapMb !== undefined ? ` heap=${heapMb.toFixed(1)}MB` : '')
        )
      }
    }

    this.lastTimestamp = timestamp

    requestAnimationFrame(this.animate)
  }

  onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    this.lastTouchPos = { x: event.clientX, y: event.clientY }
  }

  onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointerMoved =
      Math.abs(event.clientX - this.lastTouchPos.x) >= 10 ||
      Math.abs(event.clientY - this.lastTouchPos.y) >= 10

    if (useInstance.getState().mapCenterPickerActive) {
      if (pointerMoved) {
        return
      }

      const scene = useInstance.getState().threeScene
      const camera = (scene as THREE.Scene & { camera?: THREE.Camera }).camera
      const domElement = event.currentTarget.querySelector('canvas')

      if (!camera || !domElement) {
        return
      }

      const point = getWorldIntersectionFromScreen({
        camera,
        domElement,
        scene,
        screenX: event.clientX,
        screenY: event.clientY,
      })

      if (point) {
        setSceneRtsCenterAction({ x: point.x, y: point.y, z: point.z })
      }

      return
    }

    if (getState().drawing.stickerDrag.active) {
      return
    }

    if (getState().drawing.enabled && getState().drawing.tool === DrawingTool.STICKERS) {
      return
    }

    if (!pointerMoved) {
      forceShowPanelAction()
    }
  }

  //
  // ─── RENDER ─────────────────────────────────────────────────────────────────────
  //

  render() {
    const { playback, settings } = this.state
    const { demo, map } = this.props
    const INTERP_DELAY_TICKS = 2
    const renderTick = Math.max(1, playback.tick - INTERP_DELAY_TICKS)
    const MAX_PROJECTILES_FOR_HIGH_QUALITY_INTERPOLATION = 16
    // Cap Retina/high-density DPR so fill-rate does not erase later draw-call wins.
    const canvasDpr =
      typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 1.25)

    let playersThisTick: CachedPlayer[] = []
    let playersNextTick: CachedPlayer[] = []
    let actorsThisTick: ActorProps[] = []
    let projectilesThisTick: InterpolatedProjectile[] = []

    if (!!demo) {
      playersThisTick = demo
        .getPlayersAtTick(renderTick)
        .filter(({ connected, teamId }) => connected && [2, 3].includes(teamId)) // Only get CONNECTED and RED/BLU players

      playersNextTick = demo
        .getPlayersAtTick(renderTick + 1)
        .filter(({ connected, teamId }) => connected && [2, 3].includes(teamId)) // Only get CONNECTED and RED/BLU players

      const nextTickMap = new Map(playersNextTick.map(p => [p.user.entityId, p]))

      actorsThisTick = playersThisTick.map(player => {
        const next = nextTickMap.get(player.user.entityId)
        return {
          ...player,
          positionNext: next?.position ?? player.position,
          viewAnglesNext: next?.viewAngles ?? player.viewAngles,
        }
      })

      const projectilesCurrentTick = demo.getProjectilesAtTick(renderTick)
      const projectilesNextTick = demo.getProjectilesAtTick(renderTick + 1)
      const projectilesNextById = new Map(projectilesNextTick.map(p => [p.entityId, p]))

      const useHighQualityProjectileInterpolation =
        projectilesCurrentTick.length <= MAX_PROJECTILES_FOR_HIGH_QUALITY_INTERPOLATION
      const projectilesPrevTick = useHighQualityProjectileInterpolation
        ? demo.getProjectilesAtTick(Math.max(renderTick - 1, 1))
        : []
      const projectilesNext2Tick = useHighQualityProjectileInterpolation
        ? demo.getProjectilesAtTick(renderTick + 2)
        : []
      const projectilesPrevById = new Map(projectilesPrevTick.map(p => [p.entityId, p]))
      const projectilesNext2ById = new Map(projectilesNext2Tick.map(p => [p.entityId, p]))

      projectilesThisTick = projectilesCurrentTick.map(projectile => {
        const nextProjectile = projectilesNextById.get(projectile.entityId)
        const prevProjectile = projectilesPrevById.get(projectile.entityId)
        const next2Projectile = projectilesNext2ById.get(projectile.entityId)
        return {
          ...projectile,
          positionPrev: prevProjectile?.position ?? projectile.position,
          positionNext: nextProjectile?.position ?? projectile.position,
          positionNext2:
            next2Projectile?.position ?? nextProjectile?.position ?? projectile.position,
          rotationNext: nextProjectile?.rotation ?? projectile.rotation,
        }
      })
    }

    return (
      <div className="h-screen w-screen">
        <Canvas
          ref={this.canvasRef}
          id="main-canvas"
          gl={{ alpha: true }}
          dpr={canvasDpr}
          onContextMenu={e => e.preventDefault()}
          onPointerDown={this.onPointerDown}
          onPointerUp={this.onPointerUp}
        >
          {/* Base scene elements */}

          <Lights map={map} />
          <Controls />
          <PerfProbe enabled={this.perfLoggingEnabled} />
          <CanvasKeyHandler />

          {/* World Map */}

          <Suspense fallback={null}>
            <World map={map} mode={settings.scene.mode} />
          </Suspense>

          {ENABLE_DEBUG_MAP_OFFSET && <MapCenterMarker />}

          <Stickers />

          {/* Skybox */}

          {settings.ui.showSkybox && <Skybox map={map} />}

          {/* Actors */}

          <Suspense fallback={null}>
            <Selection>
              <Actors actors={actorsThisTick} />

              <EffectComposer enabled={settings.ui.playerOutlines} autoClear={false}>
                <Outline
                  blendFunction={BlendFunction.SCREEN}
                  visibleEdgeColor={0xffffff}
                  hiddenEdgeColor={0xffffff}
                  xRay={true}
                />
              </EffectComposer>
            </Selection>
          </Suspense>

          {/* Projectiles */}

          <Projectiles
            projectiles={projectilesThisTick}
            tick={renderTick}
            intervalPerTick={demo?.intervalPerTick ?? 0.015}
          />
        </Canvas>

        {/* Normal React (non-THREE.js) UI elements */}

        {settings.ui.showStats && <FpsCounter />}

        <div className="ui-layer pointer-events-none items-center justify-center">
          <Crosshair />
        </div>

        <div className="ui-layers" ref={this.uiLayers}>
          <DoubleTapSeek />

          <div className="ui-layer mb-4 items-end justify-center text-center">
            <PlaybackPanel />
          </div>

          <div className="ui-layer m-4 items-start justify-end">
            <div className="flex flex-col items-end gap-2">
              {ENABLE_DEBUG_MAP_OFFSET && <MapOffsetDebugPanel />}
              {demo && <Killfeed parser={demo} tick={playback.tick} />}
            </div>
          </div>

          {demo && (
            <div className="ui-layer m-4 items-end justify-start">
              <ChatHud parser={demo} tick={playback.tick} />
            </div>
          )}

          {playersThisTick.length > 0 && (
            <div className="ui-layer items-center justify-stretch">
              <PlayerStatuses
                players={playersThisTick}
                tick={playback.tick}
                intervalPerTick={demo?.intervalPerTick ?? 0.015}
              />
            </div>
          )}

          {playersThisTick.length > 0 && (
            <FocusedPlayerLayer
              players={playersThisTick}
              tick={playback.tick}
              intervalPerTick={demo?.intervalPerTick ?? 0.015}
            />
          )}

          <PanelToolbar hasDemoLoaded={!!demo} />
        </div>
      </div>
    )
  }
}

export { DemoViewer }

function vector3ToTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z]
}

function quaternionToTuple(quaternion: THREE.Quaternion): [number, number, number, number] {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
}

//
// ─── DATA FOR DEBUGGING ─────────────────────────────────────────────────────────
//

export const TEST_PROJECTILES = [
  {
    entityId: 4,
    position: new THREE.Vector3(-100, 50, 0),
    rotation: new THREE.Vector3(0, 0, 0),
    teamNumber: 2,
    type: 'stickybomb',
  },
  {
    entityId: 5,
    position: new THREE.Vector3(-100, -50, 0),
    rotation: new THREE.Vector3(0, 0, 0),
    teamNumber: 3,
    type: 'stickybomb',
  },
  {
    entityId: 6,
    position: new THREE.Vector3(-100, 0, 0),
    rotation: new THREE.Vector3(0, 0, 0),
    teamNumber: 3,
    type: 'rocket',
  },
  {
    entityId: 7,
    position: new THREE.Vector3(-100, 100, 0),
    rotation: new THREE.Vector3(0, 0, 0),
    teamNumber: 2,
    type: 'pipebomb',
  },
  {
    entityId: 8,
    position: new THREE.Vector3(-100, -100, 0),
    rotation: new THREE.Vector3(0, 0, 0),
    teamNumber: 3,
    type: 'pipebomb',
  },
]

export const TEST_ACTORS = [
  {
    position: { x: 0, y: 0, z: 0 },
    viewAngles: { x: 0, y: 0, z: 0 },
    classId: 1,
    health: 125,
    team: '',
    user: { name: 'None', entityId: 1 },
  },
  {
    position: { x: 0, y: 200, z: 0 },
    viewAngles: { x: 0, y: 0, z: 0 },
    classId: 1,
    health: 125,
    team: 'red',
    user: { name: 'Red', entityId: 2 },
  },
  {
    position: { x: 0, y: -200, z: 0 },
    viewAngles: { x: 0, y: 0, z: 0 },
    classId: 1,
    health: 125,
    team: 'blue',
    user: { name: 'Blue', entityId: 3 },
  },
]
