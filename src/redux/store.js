import { createStore, applyMiddleware } from 'redux'
import { composeWithDevTools } from 'redux-devtools-extension'
import thunk from 'redux-thunk'

import rootReducer from './reducer'

const initialState = {
  scene: {
    map: null,
    bounds: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
      center: { x: 0, y: 0, z: 0 },
    },
  },
  playback: {
    playing: false,
    speed: 1,
    tick: 1,
    maxTicks: 100,
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
  },
  ui: {
    activePanels: [],
  },
}

const store = createStore(rootReducer, initialState, composeWithDevTools(applyMiddleware(thunk)))

export default store
