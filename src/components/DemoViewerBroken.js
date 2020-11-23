import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import { ReactReduxContext, Provider } from 'react-redux'

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
import { useStore, getState, dispatch } from '@redux/store'
import { loadSceneFromParserAction, goToTickAction, popUIPanelAction } from '@redux/actions'

import { useEventListener, useAnimationFrame } from '@utils/hooks'

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

  const settings = useStore(state => state.settings)
  const boundsCenter = useStore(state => state.scene.bounds.center)
  const lastFocusedObject = useStore(state => state.scene.controls.focusedObject)
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

const DemoViewer = props => {
  const demoViewer = useRef()
  const uiLayers = useRef()

  // Timing variables for animation loop
  const [e, sete] = useState(0)
  const elapsedTime = useRef(0)
  const lastTimestamp = useRef(0)

  const playback = useStore(state => state.playback)
  const settings = useStore(state => state.settings)
  const scene = useStore(state => state.scene)

  const { parser } = props

  //
  // ─── KEYDOWN HANDLERS ───────────────────────────────────────────────────────────
  //

  const globalKeyDown = ({ keyCode }) => {
    const keys = { ESC: 27 }

    try {
      switch (keyCode) {
        case keys.ESC:
          dispatch(popUIPanelAction())
          break

        default:
          break
      }
    } catch (error) {
      console.error(error)
    }
  }

  //
  // ─── LIFECYCLE ──────────────────────────────────────────────────────────────────
  //

  useEffect(() => {
    animate(0)
  }, [])

  useEventListener('keydown', globalKeyDown, demoViewer)

  // componentDidMount() {
  //   this.animate(0)
  //   this.demoViewer.addEventListener('keydown', this.globalKeyDown)
  // }

  // componentWillUnmount() {
  //   this.demoViewer.removeEventListener('keydown', this.globalKeyDown)
  // }

  // async componentDidUpdate(prevProps) {
  //   if (this.props.parser !== prevProps.parser) {
  //     // await dispatch(loadSceneFromParserAction(this.props.parser))
  //   }
  // }

  //
  // ─── ANIMATION LOOP ─────────────────────────────────────────────────────────────
  //

  // TODO: it may be better to try using THREE.js Clock for playback instead
  // of this requestAnimationFrame() implementation
  // https://threejs.org/docs/#api/en/core/Clock
  const animate = async timestamp => {
    // const { playback } = getState()
    // const intervalPerTick = 0.03 // TODO: read value from demo file instead
    // const millisPerTick = 1000 * intervalPerTick * (1 / playback.speed)
    // elapsedTime.current += timestamp - lastTimestamp.current
    // if (playback.playing) {
    //   if (elapsedTime.current > millisPerTick) {
    //     dispatch(goToTickAction(playback.tick + 1))
    //     elapsedTime.current = 0
    //   }
    // } else {
    //   elapsedTime.current = 0
    // }
    // lastTimestamp.current = timestamp
    // requestAnimationFrame(animate)
  }

  // useEffect(() => {
  //   const intervalPerTick = 0.03 // TODO: read value from demo file instead
  //   const millisPerTick = 1000 * intervalPerTick * (1 / playback.speed)

  //   // elapsedTime.current += deltaTime

  //   // console.log('elapsed: ', e, ' | ', playback)

  //   if (playback.playing) {
  //     if (e > millisPerTick) {
  //       console.log('go to tocik', playback.tick + 1)
  //       dispatch(goToTickAction(playback.tick + 1))
  //       // elapsedTime.current = 0
  //       sete(0)
  //     }
  //   } else {
  //     // elapsedTime.current = 0
  //     sete(0)
  //   }

  //   // lastTimestamp.current = deltaTime
  // }, [e, playback.playing, playback.tick])

  const cbb = useCallback(deltaTime => {
    elapsedTime.current += deltaTime

    const tick = getState().playback.tick
    const playing = getState().playback.playing

    if (playing) {
      if (elapsedTime.current > 100) {
        dispatch(goToTickAction(tick + 1))
        elapsedTime.current = 0
      }
    } else {
      elapsedTime.current = 0
    }

    // if (playback.playing) {
    //   if (elapsedTime.current > millisPerTick) {
    //     dispatch(goToTickAction(playback.tick + 1))
    //     elapsedTime.current = 0
    //   }
    // } else {
    //   elapsedTime.current = 0
    // }
  }, [])

  useAnimationFrame(async deltaTime => {
    const tick = getState().playback.tick
    const speed = getState().playback.speed
    const playing = getState().playback.playing

    const intervalPerTick = 0.03 // TODO: read value from demo file instead
    const millisPerTick = 1000 * intervalPerTick * (1 / speed)

    elapsedTime.current += deltaTime

    if (playing) {
      if (elapsedTime.current > millisPerTick) {
        await dispatch(goToTickAction(tick + 1))
        elapsedTime.current = 0
      }
    } else {
      elapsedTime.current = 0
    }
  })

  // useAnimationFrame(deltaTime => {
  //   const intervalPerTick = 0.03 // TODO: read value from demo file instead
  //   const millisPerTick = 1000 * intervalPerTick * (1 / playback.speed)

  //   elapsedTime.current += deltaTime

  //   if (playback.playing) {
  //     if (elapsedTime.current > millisPerTick) {
  //       dispatch(goToTickAction(playback.tick + 1))
  //       elapsedTime.current = 0
  //     }
  //   } else {
  //     elapsedTime.current = 0
  //   }

  //   // console.log(elapsedTime.current)

  //   // lastTimestamp.current = deltaTime

  //   console.log(playback.playing, elapsedTime.current)
  // })

  // useAnimationFrame(deltaTime => {

  //   // elapsedTime.current += deltaTime
  //   // sete(e + deltaTime)
  //   // console.log(elapsedTime.current)
  // })

  // useEffect(() => {

  // }, [playback])

  //
  // ─── RENDER ─────────────────────────────────────────────────────────────────────
  //

  // render() {
  // const { scene, playback, settings } = getState()
  // const { parser } = this.props

  // console.log(object)

  // console.log(useStore.getState().playback.tick)

  const playersThisTick = parser
    ? parser
        .getPlayersAtTick(playback.tick)
        // Only handle players that are still connected (to server)
        // and are in relevant teams (BLU, RED)
        .filter(({ connected, teamId }) => connected && [2, 3].includes(teamId))
    : []

  return (
    <div className="demo-viewer" ref={demoViewer}>
      <Canvas id="main-canvas" onContextMenu={e => e.preventDefault()}>
        {/* Base scene elements */}
        <Lights />

        {scene.controls.mode === 'free' && <FreeControls />}

        {/* Demo specific elements */}
        {parser?.header?.map ? (
          <World map={parser.header.map} mode={settings.scene.mode} />
        ) : (
          <World map={`koth_product_rcx`} mode={settings.scene.mode} />
        )}

        {parser && playback && <Actors parser={parser} playback={playback} settings={settings} />}

        {TEST_ACTORS}

        <Projectiles parser={parser} playback={playback} />

        {/* Misc elements */}
        <CanvasKeyHandler />

        {settings.ui.showStats && <Stats className="stats-panel" parent={uiLayers} />}
      </Canvas>

      {/* Normal React (non-THREE.js) UI elements */}

      <div className="ui-layers" ref={uiLayers}>
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
  // }
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
