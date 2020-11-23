import create from 'zustand'
import { devtools, redux } from 'zustand/middleware'
import * as THREE from 'three'

import rootReducer from './reducer'

const initialState = {
  parser: {
    status: 'init',
    progress: 0,
    parser: null,
    error: null,
  },

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
    activePanels: ['AboutPanel'],
  },
}

const [useStore, storeApi] = create(devtools(redux(rootReducer, initialState)))

const dispatch = storeApi.dispatch
const getState = useStore.getState

export { useStore, storeApi, dispatch, getState }
