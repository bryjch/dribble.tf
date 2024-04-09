import { Component, createRef, useRef, useEffect, Suspense } from 'react'

// THREE related imports
import * as THREE from 'three'
import { Canvas, useFrame, useThree, extend } from '@react-three/fiber'
import { PerspectiveCamera, Stats } from '@react-three/drei'
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
import { CachedProjectile } from './Analyse/Data/ProjectileCache'

// UI Panels
import { AboutPanel } from '@components/UI/AboutPanel'
import { SettingsPanel } from '@components/UI/SettingsPanel'
import { PlaybackPanel } from '@components/UI/PlaybackPanel'
import { Killfeed } from '@components/UI/Killfeed'
import { PlayerStatuses } from '@components/UI/PlayerStatuses'
import { FocusedPlayer } from '@components/UI/FocusedPlayer'

// Actions & utils
import { useStore, getState, useInstance } from '@zus/store'
import { goToTickAction } from '@zus/actions'
import { DEFAULT_SCENE } from '@constants/scene'

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
    let cameraOffset = DEFAULT_SCENE.cameraOffset
    let controlsOffset = new THREE.Vector3(0, 0, 100)

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
    cameraRef.current.far = 15000

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

//
// ─── COMPONENT ──────────────────────────────────────────────────────────────────
//
type DemoViewerProps = {
  demo?: AsyncParser
}

class DemoViewer extends Component<DemoViewerProps> {
  playbackSub = function () {}
  settingsSub = function () {}
  canvasRef = createRef<HTMLCanvasElement>()
  uiLayers = createRef<HTMLDivElement>()

  // Timing variables for animation loop
  elapsedTime = 0
  lastTimestamp = 0

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

    const intervalPerTick = 0.03 // TODO: read value from demo file instead
    const millisPerTick = 1000 * intervalPerTick * (1 / playback.speed)

    this.elapsedTime += timestamp - this.lastTimestamp

    if (playback.playing) {
      if (this.elapsedTime > millisPerTick) {
        goToTickAction(playback.tick + 1)
        this.elapsedTime = 0
      }
    } else {
      this.elapsedTime = 0
    }

    this.lastTimestamp = timestamp

    requestAnimationFrame(this.animate)
  }

  //
  // ─── RENDER ─────────────────────────────────────────────────────────────────────
  //

  render() {
    const { playback, settings } = this.state
    const { demo } = this.props

    let playersThisTick: CachedPlayer[] = []
    let projectilesThisTick: CachedProjectile[] = []

    if (!!demo) {
      playersThisTick = demo
        .getPlayersAtTick(playback.tick)
        .filter(({ connected, teamId }) => connected && [2, 3].includes(teamId)) // Only get CONNECTED and RED/BLU players

      projectilesThisTick = demo.getProjectilesAtTick(playback.tick)
    }

    return (
      <div className="h-screen w-screen">
        <Canvas
          ref={this.canvasRef}
          id="main-canvas"
          gl={{ alpha: true }}
          onContextMenu={e => e.preventDefault()}
        >
          {/* Base scene elements */}

          <Lights />
          <Controls />
          <CanvasKeyHandler />
          {settings.ui.showStats && (
            <Stats className="!left-[unset] !top-[unset] bottom-0 right-0" parent={this.uiLayers} />
          )}

          {/* World Map */}

          <Suspense fallback={null}>
            {demo?.header?.map ? (
              <World map={demo.header.map} mode={settings.scene.mode} />
            ) : (
              <World map={DEFAULT_SCENE.mapName} mode={settings.scene.mode} />
            )}
          </Suspense>

          {/* Skybox */}

          {settings.ui.showSkybox &&
            (demo?.header?.map ? (
              <Skybox map={demo.header.map} />
            ) : (
              <Skybox map={DEFAULT_SCENE.mapName} />
            ))}

          {/* Actors */}

          <Suspense fallback={null}>
            <Selection>
              <Actors players={playersThisTick} />

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

          <Projectiles projectiles={projectilesThisTick} />
        </Canvas>

        {/* Normal React (non-THREE.js) UI elements */}

        <div className="ui-layers" ref={this.uiLayers}>
          <div className="ui-layer mb-4 items-end justify-center text-center">
            <PlaybackPanel />
          </div>

          {demo && (
            <div className="ui-layer m-4 items-start justify-end">
              <Killfeed parser={demo} tick={playback.tick} />
            </div>
          )}

          {playersThisTick.length > 0 && (
            <div className="ui-layer items-center justify-stretch">
              <PlayerStatuses players={playersThisTick} />
            </div>
          )}

          {playersThisTick.length > 0 && (
            <div className="ui-layer bottom-[20vh] items-end justify-center">
              <FocusedPlayer players={playersThisTick} />
            </div>
          )}

          <div className="ui-layer m-4 items-start justify-start">
            <SettingsPanel />
          </div>

          <div className="ui-layer justift-start m-4 mt-[calc(1.75rem+33px)] items-start">
            <AboutPanel />
          </div>
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
