import React, { useRef, useEffect } from 'react'
import { connect } from 'react-redux'

// THREE related imports
import * as THREE from 'three'
import { Canvas, useFrame, useThree, extend } from 'react-three-fiber'
import { PerspectiveCamera, OrthographicCamera, Stats } from 'drei'

// Scene items
import { DemoControls } from '@components/DemoControls'
import { Lights } from '@components/Scene/Lights'
import { Actors } from '@components/Scene/Actors'
import { World } from '@components/Scene/World'

import { Actor } from '@components/Scene/Actor'

// UI Panels
import { SettingsPanel } from '@components/UI/SettingsPanel'
import { PlaybackPanel } from '@components/UI/PlaybackPanel'
import { DemoInfoPanel } from '@components/UI/DemoInfoPanel'
import { Killfeed } from '@components/UI/Killfeed'
import { PlayerStatuses } from '@components/UI/PlayerStatuses'

// Actions & utils
import {
  loadSceneFromParserAction,
  togglePlaybackAction,
  goToTickAction,
  popUIPanelAction,
} from '@redux/actions'
import { objCoordsToVector3 } from '@utils/geometry'

//
// ─── THREE SETTINGS & ELEMENTS ──────────────────────────────────────────────────
//

// Modify default UP axis to be consistent with game coordinates
THREE.Object3D.DefaultUp.set(0, 0, 1)

// Basic controls for our scene
extend({ DemoControls })
const Controls = (settings = {}) => {
  const ref = useRef()
  const { camera, gl } = useThree()

  useFrame(() => {
    // Update these controls
    ref.current.update()

    // Update camera settings if necessary
    if (camera.fov !== settings.camera.fov) {
      camera.fov = settings.camera.fov
      camera.updateProjectionMatrix()
    }
  })

  return (
    <demoControls ref={ref} name="controls" args={[camera, gl.domElement]} {...settings.controls} />
  )
}

// This is just a dummy scene element that is used to detect parser changes
// (i.e. loaded a new demo file) and reposition any relevant scene items to
// the appropriate demo coordinates
const Repositioner = ({ position }) => {
  const ref = useRef()
  const { scene } = useThree()
  const world = scene.children.find(({ name }) => name === 'world')
  const camera = scene.children.find(({ name }) => name === 'camera')
  const controls = scene.__objects.find(({ name }) => name === 'controls')

  useEffect(() => {
    try {
      // Any time the Repositioner receives a new {position}, we need to center
      // the World, Camera & Controls at that {position} - because the players'
      // tick coordinate information at based on this {position}
      const newPos = objCoordsToVector3(position)
      if (world) world.position.copy(newPos)
      if (camera) camera.position.copy(newPos).add(new THREE.Vector3(3000, -3000, 3000))
      if (controls) controls.target.copy(newPos).add(new THREE.Vector3(0, 0, 500))
    } catch (error) {
      console.error(`Error occurred when repositioning scene elements:`)
      console.error(error)
    }
  }, [position]) // eslint-disable-line react-hooks/exhaustive-deps

  return <group ref={ref} name="repositioner" />
}

//
// ─── COMPONENT ──────────────────────────────────────────────────────────────────
//

class DemoViewer extends React.Component {
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
        case keys.ESC: // Escape
          this.props.popUIPanel()
          break

        default:
          break
      }
    } catch (error) {
      console.error(error)
    }
  }

  canvasKeyDown = async ({ keyCode }) => {
    const keys = { SPACE: 32, LEFT: 37, UP: 38, RIGHT: 39, BOTTOM: 40 }

    try {
      switch (keyCode) {
        case keys.SPACE:
          this.props.togglePlayback()
          break

        case keys.LEFT:
          this.props.goToTick(this.props.playback.tick - 50)
          break

        case keys.RIGHT:
          this.props.goToTick(this.props.playback.tick + 50)
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

    const Camera = settings.camera.orthographic ? OrthographicCamera : PerspectiveCamera

    return (
      <div className="demo-viewer" ref={el => (this.demoViewer = el)}>
        <Canvas onKeyDown={this.canvasKeyDown}>
          {/* Base scene elements */}
          <fog attach="fog" args={['#eeeeee', 10, 15000]} />
          <Camera name="camera" attach="camera" makeDefault {...settings.camera} />
          <Controls {...settings} />
          <Lights />

          {/* Demo specific elements */}
          {parser?.header?.map && <World map={parser.header.map} mode={settings.scene.mode} />}
          {parser && playback && <Actors parser={parser} playback={playback} />}

          {/* Misc elements */}
          <Repositioner position={scene.bounds.center} />
          <Stats />

          {!parser && (
            <group>
              <gridHelper
                args={[1000, 100]}
                position={[0, 0, -40]}
                rotation={[Math.PI / 2, 0, 0]}
              />
              <Actor
                position={new THREE.Vector3(0, 0, 0)}
                viewAngles={new THREE.Vector3(45, -30, 0)}
                classId={1}
                health={100}
                team=""
                user={{ name: 'Player' }}
              />
            </group>
          )}
        </Canvas>

        <div className="ui-layers">
          <div className="ui-layer settings">
            <SettingsPanel />
          </div>

          <div className="ui-layer playback">
            <PlaybackPanel />
          </div>

          {parser && (
            <div className="ui-layer demo-info">
              <DemoInfoPanel parser={parser} tick={playback.tick} />
            </div>
          )}

          {parser && (
            <div className="ui-layer killfeed">
              <Killfeed parser={parser} tick={playback.tick} />
            </div>
          )}

          {parser && (
            <div className="ui-layer player-statuses">
              <PlayerStatuses parser={parser} tick={playback.tick} />
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
              justify-content: flex-end;
              align-items: flex-start;
              margin: 1rem;
            }

            &.killfeed {
              justify-content: flex-end;
              align-items: flex-start;
              margin: 1rem;
              margin-top: 100px;
            }

            &.player-statuses {
              justify-content: stretch;
              align-items: center;
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
  togglePlayback: () => dispatch(togglePlaybackAction()),
  goToTick: tick => dispatch(goToTickAction(tick)),
  popUIPanel: () => dispatch(popUIPanelAction()),
})

DemoViewer = connect(mapState, mapDispatch)(DemoViewer)

export { DemoViewer }
