import { create } from 'zustand'
import localForage from 'localforage'
import { redux } from 'zustand/middleware'
import CanvasDraw from 'react-canvas-draw'
import { isMobile } from 'react-device-detect'
import * as THREE from 'three'

import type { MatchSource } from '@components/Analyse/Data/MatchSource'
import { getMapBoundaries } from '@components/Analyse/MapBoundaries'

import { parseMapBoundaries } from '@utils/scene'

import {
  ControlsMode,
  CrosshairStyle,
  Download,
  DrawingActivation,
  ParserStatus,
  RailsMode,
  SavedSetup,
  SavedSetupCamera,
  SceneMode,
  SettingsTab,
  UIPanelType,
} from '@constants/types'
import { DrawingState, createInitialDrawingState } from './drawing'
import rootReducer from './reducer'
import { DEFAULT_THEME, ThemeId } from '@theme/themes'

export type InterfaceLayout = 'auto' | 'desktop' | 'touch'

// This "Instance Store" is meant to be used for larger objects that are problematic
// to keep in the "Standard Store". (e.g. the match being watched (MatchSource), three.js objects)
// We wanna keep easily accessible references to these important objects because they're
// used a lot throughout.

// three.js is fundamentally not that well suited for React based apps (often easier to
// directly manipulate the objects instead), and react-three-fiber hooks are a bit too
// restrictive (hard to pass values/references around).

export type InstanceState = {
  mapOffsetDebug: {
    cameraOffset: { x: number; y: number; z: number }
  }
  mapCenterPickerActive: boolean
  threeScene: THREE.Scene
  match?: MatchSource
  focusedObject?: THREE.Object3D
  lastFocusedPOV?: THREE.Object3D
  /** In POV, the spectated player is a sniper looking down their scope (Scene/SniperScope). */
  povScoped: boolean
  drawingCanvas?: CanvasDraw
  runtimePerf: {
    renderCalls: number
    renderTriangles: number
    visibleChunkCount: number
    currentCluster: number | null
  }
  setupCameraBridge?: {
    capture: () => SavedSetupCamera | null
    apply: (camera: SavedSetupCamera) => void
  }
  setThreeScene: (threeScene: THREE.Scene) => void
  setMatch: (match: MatchSource | undefined) => void
  setDrawingCanvas: (drawingCanvas: CanvasDraw) => void
  setFocusedObject: (focusedObject?: THREE.Object3D) => void
  setLastFocusedPOV: (lastFocusedPOV?: THREE.Object3D) => void
  setPovScoped: (povScoped: boolean) => void
  setMapCenterPickerActive: (mapCenterPickerActive: boolean) => void
  setMapOffsetDebug: (mapOffsetDebug: { cameraOffset: { x: number; y: number; z: number } }) => void
  setRuntimePerf: (
    runtimePerf: Partial<{
      renderCalls: number
      renderTriangles: number
      visibleChunkCount: number
      currentCluster: number | null
    }>
  ) => void
  setSetupCameraBridge: (setupCameraBridge?: {
    capture: () => SavedSetupCamera | null
    apply: (camera: SavedSetupCamera) => void
  }) => void
}

const sameOffsetVector = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
) => a.x === b.x && a.y === b.y && a.z === b.z

const useInstance = create<InstanceState>()(set => ({
  mapOffsetDebug: {
    cameraOffset: { x: 0, y: 0, z: 0 },
  },
  mapCenterPickerActive: false,
  threeScene: new THREE.Scene(),
  match: undefined,
  focusedObject: undefined,
  lastFocusedPOV: undefined,
  povScoped: false,
  drawingCanvas: undefined,
  runtimePerf: {
    renderCalls: 0,
    renderTriangles: 0,
    visibleChunkCount: 0,
    currentCluster: null,
  },
  setupCameraBridge: undefined,
  setThreeScene: (threeScene: THREE.Scene) => set({ threeScene }),
  setMatch: (match: MatchSource | undefined) => set({ match }),
  setDrawingCanvas: (drawingCanvas: CanvasDraw) => set({ drawingCanvas }),
  setFocusedObject: (focusedObject?: THREE.Object3D) => set({ focusedObject }),
  setLastFocusedPOV: (lastFocusedPOV?: THREE.Object3D) => set({ lastFocusedPOV }),
  setPovScoped: (povScoped: boolean) => set({ povScoped }),
  setMapCenterPickerActive: (mapCenterPickerActive: boolean) => set({ mapCenterPickerActive }),
  setMapOffsetDebug: mapOffsetDebug =>
    set(state => {
      if (sameOffsetVector(state.mapOffsetDebug.cameraOffset, mapOffsetDebug.cameraOffset)) {
        return state
      }

      return { mapOffsetDebug }
    }),
  setRuntimePerf: runtimePerf =>
    set(state => ({
      runtimePerf: {
        ...state.runtimePerf,
        ...runtimePerf,
      },
    })),
  setSetupCameraBridge: setupCameraBridge => set({ setupCameraBridge }),
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
    map: string
    bounds: {
      min: THREE.Vector3
      max: THREE.Vector3
      center: THREE.Vector3
      defaultCameraOffset: THREE.Vector3
      defaultRtsCenter: THREE.Vector3
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
  drawing: DrawingState
  settings: {
    scene: {
      mode: SceneMode
      /** Maps with baked lighting: drawn by it, as TF2 does, or flat. Saved settings from before lack it. */
      lighting?: 'baked' | 'flat'
      /** Baked light's brightness, 1 as the lightmaps hold it. Saved settings from before lack it. */
      bakedBrightness?: number
      interpolateFrames: boolean
      /** Saved RTS centres per map, Source world coordinates. */
      worldRtsCenters: Record<string, { x: number; y: number; z: number }>
      /** Saved before 2026-11, relative to each map model's minimum corner; read, not written. */
      rtsCenters: Record<string, { x: number; y: number; z: number }>
    }
    camera: {
      position: [number, number, number]
      near: number
      far: number
      fov: number
    }
    controls: {
      /** The orbit (RTS) camera. Speeds are multipliers: 1 is the default feel. */
      rts: {
        rotateSpeed: number
        zoomSpeed: number
        keyPanSpeed: number
        /** Ease the camera toward where it is going, rather than jumping there. */
        smoothing: boolean
      }
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
        /** Badges for burning, Jarate, crits, über and the like. Saved settings from before lack it. */
        showConditions?: boolean
      }
      crosshair: {
        style: CrosshairStyle
        size: number
        opacity: number
        color: string
        /** The style X turns the crosshair back on to. Saved settings from before lack it. */
        lastStyle?: CrosshairStyle
      }
      /** The team rails; Tab opens them out into the scoreboard whichever this is. */
      rails: RailsMode
      playerOutlines: boolean
      /** In POV, the damage the spectated player deals, over whoever they hit. */
      damageNumbers: boolean
      /** Hits on one player closer together than this many seconds add up into one number. */
      damageBatchSeconds: number
      /** In POV, arrows round the crosshair toward where the spectated player is being hit from. */
      damageIndicator: boolean
      /** Sentries: a line to who they are shooting at, and a ring of how far they reach. */
      buildings: {
        sentryTargets: boolean
        sentryRange: boolean
      }
      showStats: boolean
      showSkybox: boolean
      /** The score, timer and objectives HUD, and the objectives in the world. Saved settings from before lack it. */
      showObjectives?: boolean
      /** The chat HUD. Saved settings from before lack it. */
      showChat?: boolean
      viewDistance: number
      killfeedSeekBuffer: number
      /** Whether the match events sidebar is shown. */
      matchEvents: {
        open: boolean
      }
      /** Which look the overlays use; see @theme/themes. Saved settings from before lack it. */
      theme?: ThemeId
      /** Desktop HUD or the touch interface; 'auto' decides by device (@components/Mobile/useMobileLayout). */
      layout?: InterfaceLayout
      /** The spectated player's arms and weapon in POV; fov is Source's viewmodel_fov. */
      viewmodel: {
        enabled: boolean
        fov: number
      }
    }
  }
  bookmarks: number[]
  ui: {
    activePanels: UIPanelType[]
    /** Shown while Tab is held. */
    scoreboardOpen: boolean
    /** Every overlay hidden (H), for a clean view. Not saved: a reload brings the HUD back. */
    hudHidden: boolean
    settingsTab: SettingsTab
  }
  eventHistory: {
    type: string
    value?: string
    timestamp: number
  }[]
  downloads: Map<string, Download>
  setups: {
    items: SavedSetup[]
    draftName: string
    pendingSharedSetup?: SavedSetup
  }
}

export const initialState: StoreState = {
  parser: {
    status: ParserStatus.INIT,
    progress: 0,
    error: undefined,
  },

  scene: {
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

  drawing: createInitialDrawingState(),

  settings: {
    scene: {
      mode: isMobile ? SceneMode.UNTEXTURED : SceneMode.TEXTURED,
      lighting: 'baked',
      bakedBrightness: 1.3,
      interpolateFrames: true,
      worldRtsCenters: {},
      rtsCenters: {},
    },
    camera: {
      position: [0, -400, 200] as [number, number, number],
      near: 0.1,
      far: 15000,
      fov: 90,
    },
    controls: {
      rts: {
        rotateSpeed: 1,
        zoomSpeed: 1,
        keyPanSpeed: 1,
        smoothing: true,
      },

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
        showConditions: true,
      },
      crosshair: {
        style: 'crosshair' as CrosshairStyle,
        size: 16,
        opacity: 0.8,
        color: '#ffffff',
      },
      rails: 'full' as RailsMode,
      playerOutlines: true,
      damageNumbers: true,
      damageBatchSeconds: 0.75,
      damageIndicator: true,
      buildings: {
        sentryTargets: true,
        sentryRange: false,
      },
      showStats: true,
      showSkybox: true,
      showObjectives: true,
      showChat: true,
      viewDistance: 15000,
      killfeedSeekBuffer: 2,
      matchEvents: {
        open: false,
      },
      theme: DEFAULT_THEME,
      layout: 'auto' as InterfaceLayout,
      viewmodel: {
        enabled: true,
        fov: 70,
      },
    },
  },

  bookmarks: [],

  ui: {
    activePanels: [UIPanelType.ABOUT],
    scoreboardOpen: false,
    hudHidden: false,
    settingsTab: 'hud',
  },

  eventHistory: [],

  downloads: new Map(),

  setups: {
    items: [],
    draftName: '',
    pendingSharedSetup: undefined,
  },
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

// Settings changed on the /debug page stay in memory: a session there is throwaway.
let settingsPersisted = true
export const setSettingsPersisted = (persisted: boolean) => {
  settingsPersisted = persisted
}

// Settings and setups are saved whenever they change, outside the reducers so those stay pure.
useStore.subscribe((state, previous) => {
  if (state.settings !== previous.settings && settingsPersisted)
    localForage.setItem('settings', state.settings)
  if (state.setups.items !== previous.setups.items)
    localForage.setItem('setups', state.setups.items)
})

export { useStore, dispatch, getState, useInstance }
