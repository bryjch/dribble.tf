import { createStore, applyMiddleware } from 'redux'
import { composeWithDevTools } from 'redux-devtools-extension'
import thunk from 'redux-thunk'
import * as THREE from 'three'

import rootReducer from './reducer'

const initialState = {
  scene: {
    players: new Map(),
    map: null,
    bounds: {
      min: new THREE.Vector3(0, 0, 0),
      max: new THREE.Vector3(0, 0, 0),
      center: new THREE.Vector3(1500, 0, 0), // offset is to account for default spawned map
    },
    controls: {
      mode: 'free', // 'pov', 'follow'
      focusedObject: null,
    },
  },
  playback: {
    playing: false,
    speed: 1,
    tick: 1,
    maxTicks: 3000,
  },
  settings: {
    scene: {
      mode: 'untextured',
    },
    camera: {
      orthographic: false,
      position: [0, -400, 200],
      near: 0.1,
      far: 15000,
      fov: 90,
    },
    controls: {
      panSpeed: 5,
      rotateSpeed: 3,
      zoomSpeed: 5,
      enableDamping: true,
    },
    ui: {
      nameplate: {
        enabled: true,
        showName: true,
        showHealth: true,
        showClass: true,
      },
      xrayPlayers: true,
      showStats: false,
    },
  },
  ui: {
    activePanels: [],
  },
}

const store = createStore(rootReducer, initialState, composeWithDevTools(applyMiddleware(thunk)))

export default store
