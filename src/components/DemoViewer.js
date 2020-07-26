import React, { useRef, useEffect } from 'react'
import { connect, useSelector, ReactReduxContext, Provider } from 'react-redux'

// THREE related imports
import * as THREE from 'three'
import { Canvas, useFrame, useThree, extend } from 'react-three-fiber'
import { PerspectiveCamera, OrthographicCamera, Stats } from 'drei'

// Scene items
import { DemoControls } from '@components/DemoControls'
import { CanvasKeyHandler } from '@components/Scene/CanvasKeyHandler'
import { Lights } from '@components/Scene/Lights'
import { Actors } from '@components/Scene/Actors'
import { Projectiles } from '@components/Scene/Projectiles'
import { World } from '@components/Scene/World'

import { Actor } from '@components/Scene/Actor'

// UI Panels
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

  useEffect(() => {
    if (controlsRef.current) {
      // Depending on whether there was a previous focused object, we either:
      // - reposition our FreeControls where that object was
      // - reposition our FreeControls to the center of the scene
      const newPos = lastFocusedObject ? lastFocusedObject.position : boundsCenter
      let cameraOffset, controlsOffset

      if (lastFocusedObject) {
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
    controlsRef.current.update()
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
            <Canvas onContextMenu={e => e.preventDefault()}>
              <Provider store={store}>
                {/* Base scene elements */}
                <fog attach="fog" args={['#eeeeee', 10, 15000]} />
                <Lights />

                {scene.controls.mode === 'free' && <FreeControls />}

                {/* Demo specific elements */}
                {parser?.header?.map && (
                  <World map={parser.header.map} mode={settings.scene.mode} />
                )}

                {parser && playback && (
                  <Actors parser={parser} playback={playback} settings={settings} />
                )}

                <Projectiles parser={parser} playback={playback} />

                {/* Misc elements */}
                <CanvasKeyHandler />
                <Stats parent={this.uiLayers} />

                {!parser && (
                  <group name="debugObjects">
                    <gridHelper
                      args={[1000, 100]}
                      position={[0, 0, -40]}
                      rotation={[Math.PI / 2, 0, 0]}
                    />
                    <Actor
                      position={
                        new THREE.Vector3(
                          50 * Math.sin(window.performance.now() / 400),
                          30 * Math.sin(window.performance.now() / 300),
                          0,
                          0
                        )
                      }
                      viewAngles={
                        new THREE.Vector3(
                          (window.performance.now() / 30) % 360,
                          15 * Math.sin(window.performance.now() / 300),
                          0
                        )
                      }
                      classId={1}
                      health={100}
                      team=""
                      user={{ name: 'Player', entityId: 1 }}
                      settings={settings}
                    />
                  </group>
                )}
              </Provider>
            </Canvas>
          )}
        </ReactReduxContext.Consumer>

        {/* Normal React (non-THREE.js) UI elements */}

        <div className="ui-layers" ref={this.uiLayers}>
          <div className="ui-layer settings">
            <SettingsPanel />
          </div>

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
              margin-left: 95px;
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
              margin-bottom: 80px;
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
