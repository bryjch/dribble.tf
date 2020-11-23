import create from 'zustand'
import { devtools, redux } from 'zustand/middleware'
import * as THREE from 'three'

import rootReducer from './reducer'

// This "Instance Store" is meant to be used for larger objects that are problematic
// to keep in the "Standard Store". (e.g. parsed demo file (AsyncParser), three.js objects)
// We wanna keep easily accessible references to these important objects because they're
// used a lot throughout.

// three.js is fundamentally not that well suited for React based apps (often easier to
// directly manipulate the objects instead), and react-three-fiber hooks are a bit too
// restrictive (hard to pass values/references around).

const useInstance = create(set => ({
  threeScene: null,
  parsedDemo: null,
  focusedObject: null,
  lastFocusedPOV: null,
  setThreeScene: threeScene => set({ threeScene }),
  setParsedDemo: parsedDemo => set({ parsedDemo }),
  setFocusedObject: focusedObject => set({ focusedObject }),
  setLastFocusedPOV: lastFocusedPOV => set({ lastFocusedPOV }),
}))

// This "Standard Store" is pretty much just a typical Redux store. Note that we are using
// redux middleware on top of zustand because the project was previously using Redux. It was
// decided to shift towards zustand because of annoying React context conflict stuff.

// Note that we also have Redux devtools enabled. This is another reason we need to separate
// into the separate "Instance Store" - because those large objects cause Redux devtools to
// crap itself and annihilates performance.

const initialState = {
  parser: {
    status: 'init',
    progress: 0,
    error: null,
  },

  scene: {
    players: new Map(),
    map: null,
    bounds: {
      min: new THREE.Vector3(0, 0, 0),
      max: new THREE.Vector3(0, 0, 0),
      center: new THREE.Vector3(1500, 0, 0), // offset to account for default spawned map (koth_product)
    },
    controls: {
      mode: 'free', // 'pov', 'follow'
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

// Export these functions at first level because they will be used very frequently
// and are essentially the Redux equivalents (makes migration/adoption easier)
const dispatch = storeApi.dispatch
const getState = useStore.getState

export { useStore, storeApi, dispatch, getState, useInstance }
