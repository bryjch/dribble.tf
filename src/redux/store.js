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
      center: new THREE.Vector3(0, 0, 0),
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
      mode: 'default',
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
      rotateSpeed: 5,
      zoomSpeed: 5,
      enableDamping: true,
    },
    ui: {
      showNames: false,
    },
  },
  ui: {
    activePanels: [],
  },
}

const store = createStore(rootReducer, initialState, composeWithDevTools(applyMiddleware(thunk)))

export default store
