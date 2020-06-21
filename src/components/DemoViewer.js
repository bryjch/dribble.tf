import React from 'react'
import moment from 'moment'
import { clamp } from 'lodash'
import humanizeDuration from 'humanize-duration'

// THREE related imports
import * as THREE from 'three'
import Stats from 'stats.js'
import SpriteText from 'three-spritetext'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'

import { DemoControls } from './DemoControls'
import { Nameplate } from './Nameplate'

//
// ─── CONSTANTS ──────────────────────────────────────────────────────────────────
//

const ENABLE_ANTIALIAS = true
const ENABLE_FOG = true
const ACTOR_SIZE = { x: 49, y: 49, z: 83 }

//
// ─── MATERIALS ──────────────────────────────────────────────────────────────────
//

const MAP_WIREFRAME_MATERIAL = (opts = {}) =>
  new THREE.MeshBasicMaterial({
    color: 'green',
    opacity: 0.2,
    transparent: true,
    wireframe: true,
    ...opts,
  })
const MAP_DEFAULT_MATERIAL = (opts = {}) =>
  new THREE.MeshLambertMaterial({
    color: 'white',
    ...opts,
  })

//
// ─── COMPONENT ──────────────────────────────────────────────────────────────────
//

export class DemoViewer extends React.Component {
  keyPressed = null

  intervalPerTick = 0.03
  playStartTick = 0
  playStartTime = 0
  lastFrameTime = 0

  state = {
    scene: null,
    world: null,
    map: null,
    camera: null,
    controls: null,
    players: [],
    actors: [],
    tick: 1,
    maxTicks: 100,
    playing: false,
    playSpeed: 1,
  }

  webglRenderer = null
  css2dRenderer = null

  // Keep track of references to nameplates so can be accessed by both
  // React DOM and three.js CSS2D
  nameplates = []

  //
  // ─── LIFECYCLE ──────────────────────────────────────────────────────────────────
  //

  componentDidMount() {
    this.init()

    this.demoViewer.addEventListener('keydown', event => {
      switch (event.code) {
        case 'Space':
          event.preventDefault()
          event.stopPropagation()
          this.togglePlayback()
          break

        default:
          break
      }
    })
  }

  componentDidUpdate(prevProps) {
    if (this.props.parser !== prevProps.parser) {
      console.log('Parser received:')
      console.log(this.props.parser)
      this.updateScene(this.props.parser)
    }
  }

  //
  // ─── ANIMATION ──────────────────────────────────────────────────────────────────
  //

  ////////////////////
  // Initialization //
  ////////////////////

  init = async () => {
    THREE.Object3D.DefaultUp.set(0, 0, 1)

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#eeeeee')
    if (ENABLE_FOG) scene.fog = new THREE.Fog('#eeeeee', 10, 15000)

    // Camera
    const camera = new THREE.PerspectiveCamera(70, 2, 0.1, 15000)
    camera.aspect = this.demoViewer.clientWidth / this.demoViewer.clientHeight
    camera.updateProjectionMatrix()
    camera.position.set(0, -4000, 2000)

    // Renderers
    const { clientWidth, clientHeight } = this.demoViewer

    const webglRenderer = new THREE.WebGLRenderer({
      antialias: ENABLE_ANTIALIAS,
    })
    webglRenderer.setSize(clientWidth, clientHeight, false)
    webglRenderer.domElement.classList.add('webgl-renderer')
    this.webglRendererContainer.appendChild(webglRenderer.domElement)
    this.webglRenderer = webglRenderer

    const css2dRenderer = new CSS2DRenderer()
    css2dRenderer.setSize(clientWidth, clientHeight)
    css2dRenderer.domElement.classList.add('css2d-renderer')
    this.css2dRendererContainer.appendChild(css2dRenderer.domElement)
    this.css2dRenderer = css2dRenderer

    // Lighting
    const ambientLight = new THREE.AmbientLight('#ffffff', 0.3)

    const directionalLightMax = new THREE.DirectionalLight(0xffffff, 0.5)
    directionalLightMax.position.set(100, 100, 100)

    const directionalLightMin = new THREE.DirectionalLight(0xffffff, 0.5)
    directionalLightMin.position.set(-100, -100, 100)

    scene.add(ambientLight)
    scene.add(directionalLightMax)
    scene.add(directionalLightMin)

    // Grid
    const grid = new THREE.GridHelper(10000, 100)
    grid.rotation.set(Math.PI / 2, 0, 0)
    scene.add(grid)

    // Controls
    const controls = new DemoControls(camera, webglRenderer.domElement)

    // Stats
    const stats = new Stats()
    stats.showPanel(0)
    this.css2dRenderer.domElement.appendChild(stats.dom)
    this.stats = stats

    // Store references
    // TODO: These don't actually need to be in React state
    // Consider making them class variables instead
    await this.setState({
      scene: scene,
      camera: camera,
      controls: controls,
    })

    this.animate(0)
  }

  /////////////////////////
  // Main animation loop //
  /////////////////////////

  animate = async timestamp => {
    const { parser } = this.props
    const { scene, camera, actors, controls, playSpeed } = this.state
    const { tick, maxTicks } = this.state

    // Start logging performance
    this.stats.begin()

    // Calculate what tick should be played next based on frame times etc.
    // TODO: this can perhaps be improved?
    const timePassed = timestamp - this.playStartTime
    const targetTick =
      this.playStartTick + Math.round(timePassed * this.intervalPerTick * playSpeed)
    this.lastFrameTime = timestamp

    // Pause playback automatically once end is reached
    if (targetTick > maxTicks) this.pause()

    // Handle playback play / pause
    if (this.state.playing) await this.setState({ tick: targetTick })

    // Update the positions of each actor
    let playersThisTick = parser ? parser.getPlayersAtTick(tick) : null

    if (playersThisTick) {
      actors.forEach((actor, index) => {
        const player = playersThisTick[index]
        actor.rotation.set(0, 0, player.viewAngle)
        actor.position.set(player.position.x, player.position.y, player.position.z)
        actor.updateVisibility(player.health > 0)
      })
    }

    // Render the THREE.js scene
    controls.update()
    this.webglRenderer.render(scene, camera)
    this.css2dRenderer.render(scene, camera)

    // End logging performance
    this.stats.end()

    requestAnimationFrame(this.animate)
  }

  /////////////////////
  // THREE functions //
  /////////////////////

  // TODO: Load map via value in parser header - by checking some mapping object
  // TODO: Remove the hardcoded process.obj value
  addMap = (position, scene) => {
    try {
      const objLoader = new OBJLoader()
      const objFile = require('../assets/process.obj')
      const objMat = MAP_DEFAULT_MATERIAL()

      const onLoad = obj => {
        obj.traverse(child => {
          if (child.isMesh) {
            child.material = objMat
            child.geometry.computeFaceNormals()
            child.geometry.computeVertexNormals()
          }
        })
        obj.position.copy(position)
        scene.add(obj)

        this.setState({ map: obj })
      }

      const onProgress = xhr => {
        if (xhr.lengthComputable) {
          const percentComplete = (xhr.loaded / xhr.total) * 100
          console.log(`Map loaded: ${Math.round(percentComplete, 2)}%`)
        }
      }

      const onError = error => {
        throw error
      }

      objLoader.load(objFile, onLoad, onProgress, onError)
    } catch (error) {
      console.error(error)
    }
  }

  updateScene = async parser => {
    const { scene, camera, controls, actors, map } = this.state

    const playersThisTick = parser.getPlayersAtTick(1)

    // Remove old actors
    actors.forEach(actor => scene.remove(actor))

    // Add new actors
    const newActors = []

    playersThisTick.forEach((player, index) => {
      // TODO: Extract actor to separate file / class
      const geometry = new THREE.BoxGeometry(ACTOR_SIZE.x, ACTOR_SIZE.y, ACTOR_SIZE.z)
      const material = new THREE.MeshLambertMaterial({
        color: player.user.team,
      })
      const actor = new THREE.Mesh(geometry, material)

      const nameDiv = document.createElement('div')
      nameDiv.className = 'label player-name'
      nameDiv.textContent = player.user.name

      const nameLabel = new CSS2DObject(this.nameplates[index])
      nameLabel.position.add(new THREE.Vector3(0, 0, ACTOR_SIZE.z * 1.5))
      actor.add(nameLabel)

      actor.updateVisibility = visible => {
        actor.visible = visible
        nameLabel.visible = visible
      }

      scene.add(actor)
      newActors.push(actor)
    })

    // Remove old map
    if (map) scene.remove(map)

    // Add new world
    const xTotal = parser.world.boundaryMax.x - parser.world.boundaryMin.x
    const yTotal = parser.world.boundaryMax.y - parser.world.boundaryMin.y
    const zOffset = -parser.world.boundaryMin.z - ACTOR_SIZE.z / 2
    const mapPosition = new THREE.Vector3(xTotal * 0.5, yTotal * 0.5, zOffset)

    this.addMap(mapPosition, scene)

    // Update camera & control positions
    camera.position.copy(mapPosition).add(new THREE.Vector3(3000, -3000, 3000))
    controls.target.copy(mapPosition).add(new THREE.Vector3(0, 0, 500))

    // Globals
    this.intervalPerTick = parser.intervalPerTick

    this.setState({
      camera: camera,
      controls: controls,
      actors: newActors,
      maxTicks: parser.ticks - 1,
    })

    await this.goToTick(1)
    await this.play()
  }

  updateSettings = setting => {
    const { map } = this.state

    try {
      switch (setting) {
        case 'toggleWireframe':
          map.traverse(child => {
            if (child.isMesh) {
              child.material = child.material.wireframe
                ? MAP_DEFAULT_MATERIAL()
                : MAP_WIREFRAME_MATERIAL()
            }
          })
          break

        default:
          break
      }
    } catch (error) {
      console.error(error)
    }
  }

  ////////////////////////
  // Playback functions //
  ////////////////////////

  goToTick = async tick => {
    tick = clamp(tick, 1, this.state.maxTicks)
    this.lastFrameTime = 0
    this.playStartTick = tick
    this.playStartTime = window.performance.now()
    this.setState({ tick: tick })
  }

  play = async () => {
    this.playStartTick = this.state.tick
    this.playStartTime = window.performance.now()
    this.setState({ playing: true })
  }

  pause = async () => {
    this.lastFrameTime = 0
    this.setState({ playing: false })
  }

  togglePlayback = async () => {
    if (this.state.tick === this.state.maxTicks) {
      await this.setState({ tick: 1 })
    }
    this.state.playing ? this.pause() : this.play()
  }

  changePlaySpeed = async ({ target }) => {
    // TODO: Fix tick-skipping problem when changing play speed
    this.setState({ playSpeed: target.value })
  }

  //
  // ─── RENDER ─────────────────────────────────────────────────────────────────────
  //

  render() {
    const { playing, tick, maxTicks } = this.state
    const { parser } = this.props

    const playersThisTick = parser ? parser.getPlayersAtTick(tick) : null

    return (
      <div className="demo-viewer" ref={el => (this.demoViewer = el)}>
        <div className="webgl-renderer-container" ref={el => (this.webglRendererContainer = el)} />

        <div className="css2d-renderer-container" ref={el => (this.css2dRendererContainer = el)}>
          {!!playersThisTick &&
            playersThisTick.map((player, index) => (
              <Nameplate
                key={`nameplate-${index}-${player.id}`}
                ref={el => (this.nameplates[index] = el)}
                {...player}
              />
            ))}
        </div>

        <div className="ui-layer settings">
          <div className="panel">
            <button onClick={this.updateSettings.bind(this, 'toggleWireframe')}>
              Toggle Wireframe
            </button>
          </div>
        </div>

        {/* PLAYBACK CONTROLS */}

        <div className="ui-layer controls">
          <div className="panel">
            <div>Tick #{tick}</div>

            <div className="playback">
              <span className="px-4"></span>
              <button onClick={this.goToTick.bind(this, 1)}>{'<<'}</button>
              <button onClick={this.goToTick.bind(this, tick - 1)}>{'<'}</button>
              <button onClick={this.togglePlayback}>{playing ? 'Pause' : 'Play'}</button>
              <button onClick={this.goToTick.bind(this, tick + 1)}>{'>'}</button>
              <button onClick={this.goToTick.bind(this, maxTicks)}>{'>>'}</button>
              <select defaultValue={1} onChange={this.changePlaySpeed} className="ml-2">
                <option value={0.5}>x0.5</option>
                <option value={1}>x1</option>
                <option value={2}>x2</option>
              </select>
            </div>

            <div className="timeline">
              <input
                type="range"
                min="1"
                max={maxTicks}
                value={tick}
                onChange={({ target }) => this.goToTick(Number(target.value))}
              ></input>
            </div>
          </div>
        </div>

        {/* PLAYER DEBUG COORDINATES */}

        {playersThisTick && (
          <div className="ui-layer players">
            <div className="panel">
              {playersThisTick
                .sort((a, b) => (a.user.team > b.user.team ? -1 : 1))
                .map((player, index) => (
                  <div key={`player-debug-info-${index}`}>
                    <span style={{ color: player.user.team }}>{player.user.name} </span>
                    <span style={{ display: 'inline-block', width: '1.5rem' }}>
                      {player.health}
                    </span>
                    {false && JSON.stringify(player.position)}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* MAP INFORMATION */}

        {parser && (
          <div className="ui-layer map">
            <div className="panel">
              <div>{parser.header.server}</div>
              <div>{parser.header.map}</div>
              <div>
                {humanizeDuration(moment.duration(parser.header.duration, 'seconds'), {
                  round: true,
                })}
                {` (${maxTicks} ticks)`}
              </div>
            </div>
          </div>
        )}

        <style>{`
          .label.player-name {
            color: #ffffff;
            background-color: rgba(0, 0, 0, 0.7);
            font-family: monospace;
            font-size: 0.9rem;
            line-height: 0.9rem;
            padding: 0.2rem 0.3rem;
            border-radius: 3px;
          }
        `}</style>

        <style jsx>{`
          .demo-viewer {
            width: 100vw;
            height: 100vh;
          }

          .webgl-renderer-container {
            width: 100%;
            height: 100%;

            canvas {
              width: 100%;
              height: 100%;
              background-color: #eeeeee;
            }
          }

          .css2d-renderer-container {
            width: 100%;
            height: 100%;
            position: absolute;
            top: 0;
            left: 0;
            overflow: hidden;
            pointer-events: none;
          }

          .ui-layer {
            &.settings {
              justify-content: center;
              align-items: flex-start;
              margin: 1rem;
            }

            &.controls {
              justify-content: center;
              align-items: flex-end;
              margin-bottom: 1rem;

              .timeline input[type='range'] {
                max-width: 100%;
                width: 400px;
              }
            }

            &.map {
              justify-content: flex-end;
              align-items: flex-start;

              .panel {
                font-family: monospace;
                text-align: right;
                margin: 1rem;
              }
            }

            &.players {
              justify-content: flex-end;
              align-items: flex-end;

              .panel {
                font-family: monospace;
                text-align: right;
                margin: 1rem;
              }
            }
          }
        `}</style>
      </div>
    )
  }
}

// Helpers
// TODO: Move to separate file(s)

export const addDebugAxes = (position, scene) => {
  try {
    if (!(position instanceof THREE.Vector3)) {
      position = new THREE.Vector3(position.x, position.y, position.z)
    }

    const axes = new THREE.AxesHelper(100)

    const txt = new SpriteText(position.toArray())
    txt.fontFace = 'monospace'
    txt.fontSize = 50
    txt.textHeight = 50
    txt.padding = 2
    txt.backgroundColor = '#ce2333'
    txt.position.add(new THREE.Vector3(0, 0, 100))

    const root = new THREE.Object3D()
    root.add(axes)
    root.add(txt)
    root.position.copy(position)

    scene.add(root)
  } catch (error) {
    console.error(error)
  }
}

export const objectToVector3 = ({ x, y, z }) => {
  return new THREE.Vector3(x, y, z)
}
