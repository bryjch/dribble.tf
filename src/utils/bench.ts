import type * as THREE from 'three'

import {
  changeControlsModeAction,
  changePlaySpeedAction,
  goToTickAction,
  jumpToPlayerPOVCamera,
  loadEmptySceneMapAction,
  togglePlaybackAction,
  updateSettingsOptionAction,
} from '@zus/actions'
import { getState, useInstance } from '@zus/store'
import { ControlsMode, SavedSetupCamera } from '@constants/types'

//
// ─── BENCH HOOK ─────────────────────────────────────────────────────────────────
//
// `?bench` exposes window.__dribble, the small, stable surface scripts/render-check.mjs drives:
// seek to a tick, place the camera, play, and read counters. It is the same across refactors so
// before/after runs are comparable; see docs/adr/0001-*.md.
//

export const benchEnabled = (): boolean => {
  try {
    return new URLSearchParams(window.location.search).has('bench')
  } catch {
    return false
  }
}

/**
 * How many ticks behind the playback tick the scene draws. Seeking to a scene tick adds it, so
 * screenshots compare the same moment whatever the viewer's delay is.
 */
let sceneDelayTicks = 0
export const setBenchSceneDelay = (ticks: number) => {
  sceneDelayTicks = ticks
}

let renderer: THREE.WebGLRenderer | undefined
export const setBenchRenderer = (gl: THREE.WebGLRenderer) => {
  renderer = gl
  if (!benchEnabled()) return
  // Time each draw of the scene: three's render calls plus the GPU work the driver waits on.
  const render = gl.render.bind(gl)
  gl.render = (scene, camera) => {
    const start = performance.now()
    render(scene, camera)
    counters.renderMs = (counters.renderMs ?? 0) + performance.now() - start
    counters.renders = (counters.renders ?? 0) + 1
  }
}

const counters: Record<string, number> = {}
/** Counts an event (a React render of the viewer, say) when ?bench is on. */
export const benchCount = (name: string) => {
  counters[name] = (counters[name] ?? 0) + 1
}

type Tuple3 = [number, number, number]

/** The scene draws positions relative to the map's boundaryMin. */
const worldToScene = ([x, y, z]: Tuple3): Tuple3 => {
  const { min } = getState().scene.bounds
  return [x - min.x, y - min.y, z - min.z]
}
const sceneToWorld = ([x, y, z]: Tuple3): Tuple3 => {
  const { min } = getState().scene.bounds
  return [x + min.x, y + min.y, z + min.z]
}

const frames = () => new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))

export const installBench = () => {
  if (!benchEnabled()) return

  const api = {
    status: () => {
      const demo = useInstance.getState().match as any
      const { playback, scene, downloads } = getState()
      return {
        demoLoaded: !!demo,
        map: scene.map,
        tick: playback.tick,
        maxTicks: playback.maxTicks,
        playing: playback.playing,
        downloadsLoading: Array.from(downloads.values())
          .filter(d => d.status === 'loading')
          .map(d => `${d.name} ${d.progress}%`),
        triangles: renderer?.info.render.triangles ?? 0,
        perf: demo?.stats ?? null,
      }
    },
    renderInfo: () => ({
      calls: renderer?.info.render.calls ?? 0,
      triangles: renderer?.info.render.triangles ?? 0,
      geometries: renderer?.info.memory.geometries ?? 0,
      textures: renderer?.info.memory.textures ?? 0,
      programs: renderer?.info.programs?.length ?? 0,
    }),
    counters: () => ({ ...counters }),
    /** Textures reachable from the scene's materials, against what the renderer holds. */
    textureAudit: () => {
      const seen = new Set<unknown>()
      useInstance.getState().threeScene.traverse(node => {
        const material = (node as THREE.Mesh).material
        for (const m of Array.isArray(material) ? material : material ? [material] : []) {
          for (const value of Object.values(m)) if ((value as THREE.Texture)?.isTexture) seen.add(value)
        }
      })
      return { reachable: seen.size, renderer: renderer?.info.memory.textures ?? 0 }
    },
    resetCounters: () => {
      for (const key of Object.keys(counters)) delete counters[key]
    },
    /** Players (slot order) at a tick: entity id, team, class, alive. */
    players: (tick: number) => {
      const demo = useInstance.getState().match as any
      if (!demo) return []
      return demo
        .playersAt(tick)
        .filter((p: any) => p.connected && (p.teamId === 2 || p.teamId === 3))
        .map((p: any) => ({
          entityId: p.user.entityId,
          name: p.user.name,
          team: p.team,
          classId: p.classId,
          alive: p.health > 0,
        }))
    },
    projectileCount: (tick: number) => {
      const demo = useInstance.getState().match as any
      return demo ? demo.projectilesAt(tick).length : 0
    },
    pause: async () => {
      await togglePlaybackAction(false as any)
    },
    play: async (speed = 1) => {
      await changePlaySpeedAction(speed)
      await togglePlaybackAction(true as any)
    },
    /** Pauses and seeks so the scene shows `tick`, then waits for a few frames. */
    seek: async (tick: number) => {
      await togglePlaybackAction(false as any)
      await goToTickAction(tick + sceneDelayTicks)
      for (let i = 0; i < 4; i++) await frames()
    },
    rts: async () => {
      await changeControlsModeAction(ControlsMode.RTS)
      for (let i = 0; i < 2; i++) await frames()
    },
    /** The camera now, in Source world coordinates (see worldToScene). */
    captureCamera: () => {
      const camera = useInstance.getState().setupCameraBridge?.capture()
      if (!camera) return null
      const position = sceneToWorld(camera.position)
      return camera.mode === 'rts'
        ? { ...camera, position, target: sceneToWorld(camera.target) }
        : { ...camera, position }
    },
    /** Places the camera; positions are Source world coordinates, so they survive a change of scene origin. */
    camera: async (worldCamera: SavedSetupCamera) => {
      const position = worldToScene(worldCamera.position)
      const camera: SavedSetupCamera =
        worldCamera.mode === 'rts'
          ? { ...worldCamera, position, target: worldToScene(worldCamera.target) }
          : { ...worldCamera, position }
      useInstance.getState().setupCameraBridge?.apply(camera)
      for (let i = 0; i < 4; i++) await frames()
      // Applying may switch the controls mode first; apply again once it has.
      useInstance.getState().setupCameraBridge?.apply(camera)
      for (let i = 0; i < 30; i++) await frames()
    },
    pov: async (entityId: number) => {
      await jumpToPlayerPOVCamera(entityId)
      for (let i = 0; i < 4; i++) await frames()
    },
    setting: async (path: string, value: unknown) => {
      await updateSettingsOptionAction(path, value)
      for (let i = 0; i < 2; i++) await frames()
    },
    loadMap: async (map: string) => {
      await loadEmptySceneMapAction(map)
    },
    bounds: () => {
      const { bounds } = getState().scene
      return {
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
        rtsCenter: bounds.defaultRtsCenter.toArray(),
        cameraOffset: bounds.defaultCameraOffset.toArray(),
      }
    },
    sceneDelayTicks: () => sceneDelayTicks,
  }

  ;(window as any).__dribble = api
}
