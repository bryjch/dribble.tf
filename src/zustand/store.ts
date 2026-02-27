import { create } from 'zustand'
import { redux } from 'zustand/middleware'
import CanvasDraw from 'react-canvas-draw'
import { isMobile } from 'react-device-detect'
import * as THREE from 'three'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'
import { getMapBoundaries } from '@components/Analyse/MapBoundaries'

import { parseMapBoundaries } from '@utils/scene'

import {
  ControlsMode,
  Download,
  DrawingActivation,
  ParserStatus,
  SceneMode,
  UIPanelType,
} from '@constants/types'
import rootReducer from './reducer'

// This "Instance Store" is meant to be used for larger objects that are problematic
// to keep in the "Standard Store". (e.g. parsed demo file (AsyncParser), three.js objects)
// We wanna keep easily accessible references to these important objects because they're
// used a lot throughout.

// three.js is fundamentally not that well suited for React based apps (often easier to
// directly manipulate the objects instead), and react-three-fiber hooks are a bit too
// restrictive (hard to pass values/references around).

export type InstanceState = {
  threeScene: THREE.Scene
  parsedDemo?: AsyncParser
  focusedObject?: THREE.Object3D
  lastFocusedPOV?: THREE.Object3D
  drawingCanvas?: CanvasDraw
  frameProgress: number
  setThreeScene: (threeScene: THREE.Scene) => void
  setParsedDemo: (parsedDemo: AsyncParser | undefined) => void
  setDrawingCanvas: (drawingCanvas: CanvasDraw) => void
  setFocusedObject: (focusedObject?: THREE.Object3D) => void
  setLastFocusedPOV: (lastFocusedPOV?: THREE.Object3D) => void
  setFrameProgress: (frameProgress: number) => void
}

const useInstance = create<InstanceState>()(set => ({
  threeScene: new THREE.Scene(),
  parsedDemo: undefined,
  focusedObject: undefined,
  lastFocusedPOV: undefined,
  drawingCanvas: undefined,
  frameProgress: 0,
  setThreeScene: (threeScene: THREE.Scene) => set({ threeScene }),
  setParsedDemo: (parsedDemo: AsyncParser | undefined) => set({ parsedDemo }),
  setDrawingCanvas: (drawingCanvas: CanvasDraw) => set({ drawingCanvas }),
  setFocusedObject: (focusedObject?: THREE.Object3D) => set({ focusedObject }),
  setLastFocusedPOV: (lastFocusedPOV?: THREE.Object3D) => set({ lastFocusedPOV }),
  setFrameProgress: (frameProgress: number) => set({ frameProgress }),
}))

// This "Standard Store" is pretty much just a typical Redux store. Note that we are using
// redux middleware on top of zustand because the project was previously using Redux. It was
// decided to shift towards zustand because of annoying React context conflict stuff.

// Note that we also have Redux devtools enabled. This is another reason we need to separate
// into the separate "Instance Store" - because those large objects cause Redux devtools to
// crap itself and annihilates performance.

export type StoreState = {
  parser: {
    status: ParserStatus
    progress: number
    error?: Error
  }
  scene: {
    players: Map<any, any>
    map: string
    bounds: {
      min: THREE.Vector3
      max: THREE.Vector3
      center: THREE.Vector3
      defaultCameraOffset: THREE.Vector3
      defaultControlOffset: THREE.Vector3
    }
    controls: {
      mode: ControlsMode
    }
  }
  playback: {
    playing: boolean
    speed: number
    tick: number
    maxTicks: number
    forceShowPanel: boolean
    intervalPerTick: number
  }
  drawing: {
    enabled: boolean
  }
  settings: {
    scene: {
      mode: SceneMode
      interpolateFrames: boolean
    }
    camera: {
      position: [number, number, number]
      near: number
      far: number
      fov: number
    }
    controls: {
      panSpeed: number
      rotateSpeed: number
      zoomSpeed: number
      enableDamping: boolean
      lookSpeed: number
      moveSpeed: number
    }
    drawing: {
      activation: DrawingActivation
      autoClear: boolean
    }
    ui: {
      nameplate: {
        enabled: boolean
        showName: boolean
        showHealth: boolean
        showClass: boolean
      }
      playerOutlines: boolean
      showStats: boolean
      showSkybox: boolean
      viewDistance: number
    }
  }
  ui: {
    activePanels: UIPanelType[]
  }
  eventHistory: {
    type: string
    value?: string
    timestamp: number
  }[]
  downloads: Map<string, Download>
}

export const initialState: StoreState = {
  parser: {
    status: ParserStatus.INIT,
    progress: 0,
    error: undefined,
  },

  scene: {
    players: new Map(),
    map: 'cp_snakewater',
    bounds: parseMapBoundaries(getMapBoundaries('cp_snakewater')!),
    controls: {
      mode: ControlsMode.RTS,
    },
  },

  playback: {
    playing: false,
    speed: 1,
    tick: 1,
    maxTicks: 3000,
    forceShowPanel: false,
    intervalPerTick: 0.015,
  },

  drawing: {
    enabled: false,
  },

  settings: {
    scene: {
      mode: isMobile ? SceneMode.UNTEXTURED : SceneMode.TEXTURED,
      interpolateFrames: true,
    },
    camera: {
      position: [0, -400, 200] as [number, number, number],
      near: 0.1,
      far: 15000,
      fov: 90,
    },
    controls: {
      // RTS camera settings
      panSpeed: 5,
      rotateSpeed: 3,
      zoomSpeed: 5,
      enableDamping: true,

      // Spectator camera settings
      lookSpeed: 3,
      moveSpeed: 5,
    },
    drawing: {
      activation: DrawingActivation.TOGGLE,
      autoClear: true,
    },
    ui: {
      nameplate: {
        enabled: true,
        showName: true,
        showHealth: true,
        showClass: true,
      },
      playerOutlines: false,
      showStats: false,
      showSkybox: true,
      viewDistance: 15000,
    },
  },

  ui: {
    activePanels: [UIPanelType.ABOUT],
  },

  eventHistory: [],

  downloads: new Map(),
}

export type StoreAction = {
  type: string
  payload?: any
}

// TODO: why tf is this erroring? check after TS upgrade
const useStore = create(redux<StoreState, StoreAction>(rootReducer as any, initialState))

// Export these functions at first level because they will be used very frequently
// and are essentially the Redux equivalents (makes migration/adoption easier)
const { dispatch, getState } = useStore

export { useStore, dispatch, getState, useInstance }
