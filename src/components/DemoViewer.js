import React, { useRef, useEffect } from 'react'

// THREE related imports
import * as THREE from 'three'
import { Canvas, useFrame, useThree, extend } from 'react-three-fiber'
import { PerspectiveCamera, OrthographicCamera, Stats } from '@react-three/drei'

// Scene items
import { DemoControls } from '@components/DemoControls'
import { SpectatorControls } from '@components/SpectatorControls'
import { CanvasKeyHandler } from '@components/Scene/CanvasKeyHandler'
import { Lights } from '@components/Scene/Lights'
import { Actors } from '@components/Scene/Actors'
import { Projectiles } from '@components/Scene/Projectiles'
import { World } from '@components/Scene/World'

// UI Panels
import { AboutPanel } from '@components/UI/AboutPanel'
import { SettingsPanel } from '@components/UI/SettingsPanel'
import { PlaybackPanel } from '@components/UI/PlaybackPanel'
import { DemoInfoPanel } from '@components/UI/DemoInfoPanel'
import { Killfeed } from '@components/UI/Killfeed'
import { PlayerStatuses } from '@components/UI/PlayerStatuses'
import { FocusedPlayer } from '@components/UI/FocusedPlayer'

// Actions & utils
import { useStore, getState, dispatch, useInstance } from '@zus/store'
import { goToTickAction } from '@zus/actions'

//
// ─── THREE SETTINGS & ELEMENTS ──────────────────────────────────────────────────
//

// Modify default UP axis to be consistent with game coordinates
THREE.Object3D.DefaultUp.set(0, 0, 1)
THREE.Cache.enabled = true

// Basic controls for our scene
extend({ DemoControls })
extend({ SpectatorControls })

// This component is messy af but whatever yolo
const Controls = props => {
  const cameraRef = useRef()
  const controlsRef = useRef()
  const spectatorRef = useRef()
  const { gl, scene, setDefaultCamera } = useThree()

  const settings = useStore(state => state.settings)
  const controlsMode = useStore(state => state.scene.controls.mode)
  const boundsCenter = useStore(state => state.scene.bounds.center)
  const focusedObject = useInstance(state => state.focusedObject)

  const Camera = settings.camera.orthographic ? OrthographicCamera : PerspectiveCamera

  gl.physicallyCorrectLights = true
  gl.outputEncoding = THREE.sRGBEncoding

  // Keep a reference of our scene in the store's instances for easy access
  useEffect(() => {
    useInstance.getState().setThreeScene(scene)
  }, [scene])

  // Update the default camera when necessary
  useEffect(() => {
    let nextCamera
    try {
      nextCamera = focusedObject.getObjectByName('povCamera')
    } catch (error) {
      nextCamera = scene.getObjectByName('freeCamera')
    }
    setDefaultCamera(nextCamera)
  }, [focusedObject]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update controls & camera position when necessary
  useEffect(() => {
    // Depending on whether there was a previous focused object, we either:
    // - reposition our Controls where that object was
    // - reposition our Controls to the center of the scene
    const newPos = focusedObject ? focusedObject.position : boundsCenter
    let cameraOffset, controlsOffset

    if (focusedObject) {
      cameraOffset = new THREE.Vector3(-700, 0, 1200).applyQuaternion(focusedObject.quaternion)
      controlsOffset = new THREE.Vector3(0, 0, 100)
    } else {
      cameraOffset = new THREE.Vector3(1000, -1000, 1000)
      controlsOffset = new THREE.Vector3(0, 0, 100)
    }

    cameraRef.current.position.copy(newPos).add(cameraOffset)
    cameraRef.current.near = 10
    cameraRef.current.far = 15000

    if (controlsMode === 'rts' && controlsRef.current) {
      controlsRef.current.target.copy(newPos).add(controlsOffset)
      controlsRef.current.saveState()
    }

    if (controlsMode === 'spectator' && spectatorRef.current) {
      // TODO: reposition camera to controlsOffset
      spectatorRef.current.listen()
    }
  }, [cameraRef.current, boundsCenter, controlsMode]) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    if (controlsRef.current) controlsRef.current.update()
    if (spectatorRef.current) spectatorRef.current.update()
  })

  return (
    <>
      <Camera ref={cameraRef} name="freeCamera" attach="camera" {...settings.camera} />

      {controlsMode === 'rts' && cameraRef.current && (
        <demoControls
          ref={controlsRef}
          name="controls"
          attach="controls"
          args={[cameraRef.current, gl.domElement]}
          {...settings.controls}
          {...props}
        />
      )}

      {controlsMode === 'spectator' && cameraRef.current && (
        <spectatorControls
          ref={spectatorRef}
          name="controls"
          attach="controls"
          args={[cameraRef.current, gl.domElement]}
        />
      )}
    </>
  )
}

//
// ─── COMPONENT ──────────────────────────────────────────────────────────────────
//

class DemoViewer extends React.Component {
  uiLayers = React.createRef()

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
    this.playbackSub = useStore.subscribe(
      playback => this.setState({ playback }),
      state => state.playback
    )
    this.settingsSub = useStore.subscribe(
      settings => this.setState({ settings }),
      state => state.settings
    )
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
  animate = async timestamp => {
    const { playback } = this.state

    const intervalPerTick = 0.03 // TODO: read value from demo file instead
    const millisPerTick = 1000 * intervalPerTick * (1 / playback.speed)

    this.elapsedTime += timestamp - this.lastTimestamp

    if (playback.playing) {
      if (this.elapsedTime > millisPerTick) {
        dispatch(goToTickAction(playback.tick + 1))
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

    let playersThisTick = []
    let projectilesThisTick = []

    if (!!demo) {
      playersThisTick = demo
        .getPlayersAtTick(playback.tick)
        .filter(({ connected, teamId }) => connected && [2, 3].includes(teamId)) // Only get CONNECTED and RED/BLU players

      projectilesThisTick = demo.getProjectilesAtTick(playback.tick)
    }

    return (
      <div className="demo-viewer" ref={el => (this.demoViewer = el)}>
        <Canvas id="main-canvas" onContextMenu={e => e.preventDefault()}>
          {/* Base scene elements */}
          <Lights />
          <Controls />
          <CanvasKeyHandler />
          {settings.ui.showStats && <Stats className="stats-panel" parent={this.uiLayers} />}

          {/* Demo specific elements */}
          {demo?.header?.map ? (
            <World map={demo.header.map} mode={settings.scene.mode} />
          ) : (
            <World map={`cp_process_f12`} mode={settings.scene.mode} />
          )}

          <Actors players={playersThisTick} />

          <Projectiles projectiles={projectilesThisTick} />
        </Canvas>

        {/* Normal React (non-THREE.js) UI elements */}

        <div className="ui-layers" ref={this.uiLayers}>
          <div className="ui-layer playback">
            <PlaybackPanel />
          </div>

          {demo && (
            <div className="ui-layer demo-info">
              <DemoInfoPanel parser={demo} />
            </div>
          )}

          {demo && (
            <div className="ui-layer killfeed">
              <Killfeed parser={demo} tick={playback.tick} />
            </div>
          )}

          {playersThisTick.length > 0 && (
            <div className="ui-layer player-statuses">
              <PlayerStatuses players={playersThisTick} />
            </div>
          )}

          {playersThisTick.length > 0 && (
            <div className="ui-layer focused-player">
              <FocusedPlayer players={playersThisTick} />
            </div>
          )}

          <div className="ui-layer settings">
            <SettingsPanel />
          </div>

          <div className="ui-layer about">
            <AboutPanel />
          </div>
        </div>

        <style jsx>{`
          .demo-viewer {
            width: 100vw;
            height: 100vh;
          }

          .ui-layer {
            &.settings {
              justify-content: flex-start;
              align-items: flex-start;
              margin: 1rem;
            }

            &.about {
              justify-content: flex-start;
              align-items: flex-start;
              margin: 1rem;
              margin-top: calc(1.75rem + 33px);
            }

            &.playback {
              justify-content: center;
              align-items: flex-end;
              text-align: center;
              margin-bottom: 1rem;
            }

            &.demo-info {
              justify-content: flex-start;
              align-items: flex-end;
              margin: 1rem;
            }

            &.killfeed {
              justify-content: flex-end;
              align-items: flex-start;
              margin: 1rem;
            }

            &.player-statuses {
              justify-content: stretch;
              align-items: center;
            }

            &.focused-player {
              justify-content: center;
              align-items: flex-end;
              bottom: 20vh;
            }
          }
        `}</style>

        <style jsx global>{`
          .stats-panel {
            top: unset !important;
            left: unset !important;
            bottom: 0;
            right: 0;
          }
        `}</style>
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
