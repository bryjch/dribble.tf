import React, { useRef, useEffect } from 'react'
import { connect, useSelector, ReactReduxContext, Provider } from 'react-redux'

// THREE related imports
import * as THREE from 'three'
import { Canvas, useFrame, useThree, extend } from 'react-three-fiber'
import { PerspectiveCamera, OrthographicCamera, Stats } from '@react-three/drei'

// Scene items
import { DemoControls } from '@components/DemoControls'
import { CanvasKeyHandler } from '@components/Scene/CanvasKeyHandler'
import { Lights } from '@components/Scene/Lights'
import { Actors } from '@components/Scene/Actors'
import { Projectiles } from '@components/Scene/Projectiles'
import { World } from '@components/Scene/World'

import { Actor } from '@components/Scene/Actor'

// UI Panels
import { AboutPanel } from '@components/UI/AboutPanel'
import { SettingsPanel } from '@components/UI/SettingsPanel'
import { PlaybackPanel } from '@components/UI/PlaybackPanel'
import { DemoInfoPanel } from '@components/UI/DemoInfoPanel'
import { Killfeed } from '@components/UI/Killfeed'
import { PlayerStatuses } from '@components/UI/PlayerStatuses'
import { FocusedPlayer } from '@components/UI/FocusedPlayer'

// Actions & utils
import { loadSceneFromParserAction, goToTickAction, popUIPanelAction } from '@redux/actions'

//
// ─── THREE SETTINGS & ELEMENTS ──────────────────────────────────────────────────
//

// Modify default UP axis to be consistent with game coordinates
THREE.Object3D.DefaultUp.set(0, 0, 1)
THREE.Cache.enabled = true

// Basic controls for our scene
extend({ DemoControls })

const FreeControls = props => {
  const cameraRef = useRef()
  const controlsRef = useRef()
  const { gl } = useThree()

  const settings = useSelector(state => state.settings)
  const boundsCenter = useSelector(state => state.scene.bounds.center)
  const lastFocusedObject = useSelector(state => state.scene.controls.focusedObject)
  const Camera = settings.camera.orthographic ? OrthographicCamera : PerspectiveCamera

  gl.physicallyCorrectLights = true
  gl.outputEncoding = THREE.sRGBEncoding

  useEffect(() => {
    if (controlsRef.current) {
      // Depending on whether there was a previous focused object, we either:
      // - reposition our FreeControls where that object was
      // - reposition our FreeControls to the center of the scene
      const newPos = lastFocusedObject ? lastFocusedObject.position : boundsCenter
      let cameraOffset, controlsOffset

      if (lastFocusedObject) {
        // TODO: Determine what angle the lastFocusedObject is facing, then adjust the
        // camera offset so that it's facing the same direction as the lastFocusedObject
        cameraOffset = new THREE.Vector3(500, 0, 500)
        controlsOffset = new THREE.Vector3(0, 0, 100)
      } else {
        cameraOffset = new THREE.Vector3(1000, -1000, 1000)
        controlsOffset = new THREE.Vector3(0, 0, 100)
      }

      cameraRef.current.position.copy(newPos).add(cameraOffset)
      controlsRef.current.target.copy(newPos).add(controlsOffset)
      controlsRef.current.saveState()
    }
  }, [cameraRef.current, controlsRef.current, boundsCenter, lastFocusedObject]) // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    // Update these controls
    if (controlsRef.current) {
      controlsRef.current.update()
    }
  })

  return (
    <>
      <Camera ref={cameraRef} name="freeCamera" attach="camera" makeDefault {...settings.camera} />

      {cameraRef.current && (
        <demoControls
          ref={controlsRef}
          name="controls"
          attach="controls"
          args={[cameraRef.current, gl.domElement]}
          {...settings.controls}
          {...props}
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

  //
  // ─── LIFECYCLE ──────────────────────────────────────────────────────────────────
  //

  componentDidMount() {
    this.animate(0)
    this.demoViewer.addEventListener('keydown', this.globalKeyDown)
  }

  componentWillUnmount() {
    this.demoViewer.removeEventListener('keydown', this.globalKeyDown)
  }

  async componentDidUpdate(prevProps) {
    if (this.props.parser !== prevProps.parser) {
      await this.props.loadSceneFromParser(this.props.parser)
    }
  }

  //
  // ─── ANIMATION LOOP ─────────────────────────────────────────────────────────────
  //

  // TODO: it may be better to try using THREE.js Clock for playback instead
  // of this requestAnimationFrame() implementation
  // https://threejs.org/docs/#api/en/core/Clock
  animate = async timestamp => {
    const { playback, goToTick } = this.props

    const intervalPerTick = 0.03 // TODO: read value from demo file instead
    const millisPerTick = 1000 * intervalPerTick * (1 / playback.speed)

    this.elapsedTime += timestamp - this.lastTimestamp

    if (playback.playing) {
      if (this.elapsedTime > millisPerTick) {
        goToTick(playback.tick + 1)
        this.elapsedTime = 0
      }
    } else {
      this.elapsedTime = 0
    }

    this.lastTimestamp = timestamp

    requestAnimationFrame(this.animate)
  }

  //
  // ─── KEYDOWN HANDLERS ───────────────────────────────────────────────────────────
  //

  globalKeyDown = ({ keyCode }) => {
    const keys = { ESC: 27 }

    try {
      switch (keyCode) {
        case keys.ESC:
          this.props.popUIPanel()
          break

        default:
          break
      }
    } catch (error) {
      console.error(error)
    }
  }

  //
  // ─── RENDER ─────────────────────────────────────────────────────────────────────
  //

  render() {
    const { parser, scene, playback, settings } = this.props

    const playersThisTick = parser
      ? parser
          .getPlayersAtTick(playback.tick)
          // Only handle players that are still connected (to server)
          // and are in relevant teams (BLU, RED)
          .filter(({ connected, teamId }) => connected && [2, 3].includes(teamId))
      : []

    return (
      <div className="demo-viewer" ref={el => (this.demoViewer = el)}>
        {/* Note: unfortunately we have to explicitly provide the Redux store inside
        Canvas because of React context reconciler limitations:
        https://github.com/react-spring/react-three-fiber/issues/43
        https://github.com/react-spring/react-three-fiber/issues/262 */}
        <ReactReduxContext.Consumer>
          {({ store }) => (
            <Canvas id="main-canvas" onContextMenu={e => e.preventDefault()}>
              <Provider store={store}>
                {/* Base scene elements */}
                <Lights />

                {scene.controls.mode === 'free' && <FreeControls />}

                {/* Demo specific elements */}
                {parser?.header?.map ? (
                  <World map={parser.header.map} mode={settings.scene.mode} />
                ) : (
                  <World map={`koth_product_rcx`} mode={settings.scene.mode} />
                )}

                {parser && playback && (
                  <Actors parser={parser} playback={playback} settings={settings} />
                )}

                <Projectiles parser={parser} playback={playback} />

                {/* Misc elements */}
                <CanvasKeyHandler />

                {settings.ui.showStats && <Stats className="stats-panel" parent={this.uiLayers} />}
              </Provider>
            </Canvas>
          )}
        </ReactReduxContext.Consumer>

        {/* Normal React (non-THREE.js) UI elements */}

        <div className="ui-layers" ref={this.uiLayers}>
          <div className="ui-layer playback">
            <PlaybackPanel />
          </div>

          {parser && (
            <div className="ui-layer demo-info">
              <DemoInfoPanel parser={parser} />
            </div>
          )}

          {parser && (
            <div className="ui-layer killfeed">
              <Killfeed parser={parser} tick={playback.tick} />
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

const mapState = state => ({
  scene: state.scene,
  playback: state.playback,
  settings: state.settings,
})

const mapDispatch = dispatch => ({
  loadSceneFromParser: parser => dispatch(loadSceneFromParserAction(parser)),
  goToTick: tick => dispatch(goToTickAction(tick)),
  popUIPanel: () => dispatch(popUIPanelAction()),
})

DemoViewer = connect(mapState, mapDispatch)(DemoViewer)

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

export const TEST_ACTORS = (
  <>
    <Actor
      position={new THREE.Vector3(0, 0, 0)}
      viewAngles={new THREE.Vector3(0, 0, 0)}
      classId={1}
      health={125}
      team=""
      user={{ name: 'None', entityId: 1 }}
    />

    <Actor
      position={new THREE.Vector3(0, 200, 0)}
      viewAngles={new THREE.Vector3(0, 0, 0)}
      classId={1}
      health={125}
      team="red"
      user={{ name: 'Red', entityId: 2 }}
    />

    <Actor
      position={new THREE.Vector3(0, -200, 0)}
      viewAngles={new THREE.Vector3(0, 0, 0)}
      classId={1}
      health={125}
      team="blue"
      user={{ name: 'Blue', entityId: 3 }}
    />
  </>
)
