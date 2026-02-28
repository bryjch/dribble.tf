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
import { FpsCounter } from '@components/UI/FpsCounter'
import { Crosshair } from '@components/UI/Crosshair'

import { motion } from 'framer-motion'
import { AiFillFastForwardIcon } from '@components/Misc/Icons'

// Actions & utils
import { useStore, getState, useInstance } from '@zus/store'
import { forceShowPanelAction, goToTickAction, playbackJumpAction } from '@zus/actions'
import { ActorProps } from './Scene/Actors'
import { isPerfLoggingEnabled, readJsHeapMemoryMb } from '@utils/misc'
import { useIsMobile } from '@utils/hooks'
import { cn } from '@utils/styling'

//
// ─── THREE SETTINGS & ELEMENTS ──────────────────────────────────────────────────
//

// Modify default UP axis to be consistent with game coordinates
THREE.Object3D.DEFAULT_UP.set(0, 0, 1)
THREE.Cache.enabled = true

// Basic controls for our scene
extend({ RtsControls, SpectatorControls })

// This component is messy af but whatever yolo
const Controls = () => {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null)
  const controlsRef = useRef<any>()
  const spectatorRef = useRef<any>()
  // const [spectatorRef, setSpectatorRef] = useState()
  const { gl, scene, set } = useThree()

  const settings = useStore(state => state.settings)
  const controlsMode = useStore(state => state.scene.controls.mode)
  const bounds = useStore(state => state.scene.bounds)
  const focusedObject = useInstance(state => state.focusedObject)
  const lastFocusedPOV = useInstance(state => state.lastFocusedPOV)

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
    const newPos = lastFocusedPOV ? lastFocusedPOV.position : bounds.center
    let cameraOffset = bounds.defaultCameraOffset
    let controlsOffset = bounds.defaultControlOffset

    if (lastFocusedPOV) {
      if (controlsMode === 'rts') {
        cameraOffset = new THREE.Vector3(-500, 0, 1000).applyQuaternion(lastFocusedPOV.quaternion)
        controlsOffset = new THREE.Vector3(0, 0, 100)
      }

      if (controlsMode === 'spectator') {
        cameraOffset = new THREE.Vector3(-70, 0, 120).applyQuaternion(lastFocusedPOV.quaternion)
        controlsOffset = new THREE.Vector3(0, 0, 100)
      }
    }

    cameraRef.current.position.copy(newPos).add(cameraOffset)
    cameraRef.current.near = 10
    cameraRef.current.far = settings.ui.viewDistance || 15000

    if (controlsMode === 'rts' && controlsRef.current) {
      controlsRef.current.target.copy(newPos).add(controlsOffset)
      controlsRef.current.saveState()
    }

    if (controlsMode === 'spectator' && spectatorRef.current) {
      cameraRef.current.lookAt(new THREE.Vector3().copy(newPos).add(controlsOffset))
      spectatorRef.current.listen()
      spectatorRef.current.enable()
    }
  }, [cameraRef.current, lastFocusedPOV, bounds, controlsMode])

  useEffect(() => {
    if (!cameraRef.current) return
    cameraRef.current.far = settings.ui.viewDistance || 15000
    cameraRef.current.updateProjectionMatrix()
  }, [settings.ui.viewDistance])

  useFrame(() => {
    if (controlsRef.current) controlsRef.current.update()
    if (spectatorRef.current) spectatorRef.current.update()
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
        <div className={cn('absolute inset-y-0 flex items-center justify-center', ripple.side === 'left' ? 'left-0 w-1/2' : 'right-0 w-1/2')}>
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
              {ripple.side === 'left' ? '-' : '+'}{DOUBLE_TAP_SEEK_TICKS} ticks
            </span>
          </motion.div>
        </div>
      )}
    </div>
  )
}

// FocusedPlayer wrapper - adjusts positioning for mobile
const FocusedPlayerLayer = (props: { players: CachedPlayer[]; tick: number; intervalPerTick: number }) => {
  const isMobile = useIsMobile()
  return (
    <div className={cn('ui-layer items-end justify-center', isMobile ? 'bottom-[12vh]' : 'bottom-[20vh]')}>
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

      {hasDemoLoaded && (
        <div className="ui-layer m-4 mt-28 items-start justify-start">
          <MatchKillfeedPanel />
        </div>
      )}

      {hasDemoLoaded && (
        <div className="ui-layer m-4 mt-40 items-start justify-start">
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
        console.log(
          `[Perf] tick=${playback.tick}` +
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
    if (
      Math.abs(event.clientX - this.lastTouchPos.x) < 10 &&
      Math.abs(event.clientY - this.lastTouchPos.y) < 10
    ) {
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

      actorsThisTick = playersThisTick.map((player) => {
        const next = nextTickMap.get(player.user.entityId)
        return {
          ...player,
          positionNext: next?.position ?? player.position,
          viewAnglesNext: next?.viewAngles ?? player.viewAngles,
        }
      })

      const projectilesCurrentTick = demo.getProjectilesAtTick(renderTick)
      const projectilesNextTick = demo.getProjectilesAtTick(renderTick + 1)
      const projectilesNextById = new Map(
        projectilesNextTick.map(p => [p.entityId, p])
      )

      const useHighQualityProjectileInterpolation =
        projectilesCurrentTick.length <= MAX_PROJECTILES_FOR_HIGH_QUALITY_INTERPOLATION
      const projectilesPrevTick = useHighQualityProjectileInterpolation
        ? demo.getProjectilesAtTick(Math.max(renderTick - 1, 1))
        : []
      const projectilesNext2Tick = useHighQualityProjectileInterpolation
        ? demo.getProjectilesAtTick(renderTick + 2)
        : []
      const projectilesPrevById = new Map(
        projectilesPrevTick.map(p => [p.entityId, p])
      )
      const projectilesNext2ById = new Map(
        projectilesNext2Tick.map(p => [p.entityId, p])
      )

      projectilesThisTick = projectilesCurrentTick.map(projectile => {
        const nextProjectile = projectilesNextById.get(projectile.entityId)
        const prevProjectile = projectilesPrevById.get(projectile.entityId)
        const next2Projectile = projectilesNext2ById.get(projectile.entityId)
        return {
          ...projectile,
          positionPrev: prevProjectile?.position ?? projectile.position,
          positionNext: nextProjectile?.position ?? projectile.position,
          positionNext2: next2Projectile?.position ?? nextProjectile?.position ?? projectile.position,
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
          onContextMenu={e => e.preventDefault()}
          onPointerDown={this.onPointerDown}
          onPointerUp={this.onPointerUp}
        >
          {/* Base scene elements */}

          <Lights map={map} />
          <Controls />
          <CanvasKeyHandler />


          {/* World Map */}

          <Suspense fallback={null}>
            <World map={map} mode={settings.scene.mode} />
          </Suspense>

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

        <div className="ui-layer items-center justify-center pointer-events-none">
          <Crosshair />
        </div>

        <div className="ui-layers" ref={this.uiLayers}>
          <DoubleTapSeek />

          <div className="ui-layer mb-4 items-end justify-center text-center">
            <PlaybackPanel />
          </div>

          {demo && (
            <div className="ui-layer m-4 items-start justify-end">
              <Killfeed parser={demo} tick={playback.tick} />
            </div>
          )}

          {demo && (
            <div className="ui-layer m-4 items-end justify-start">
              <ChatHud parser={demo} tick={playback.tick} />
            </div>
          )}

          {playersThisTick.length > 0 && (
            <div className="ui-layer items-center justify-stretch">
              <PlayerStatuses players={playersThisTick} tick={playback.tick} intervalPerTick={demo?.intervalPerTick ?? 0.015} />
            </div>
          )}

          {playersThisTick.length > 0 && (
            <FocusedPlayerLayer players={playersThisTick} tick={playback.tick} intervalPerTick={demo?.intervalPerTick ?? 0.015} />
          )}

          <PanelToolbar hasDemoLoaded={!!demo} />
        </div>
      </div>
    )
  }
}

export { DemoViewer }

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
