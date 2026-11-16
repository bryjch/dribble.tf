//
// ─── MAPS ───────────────────────────────────────────────────────────────────────
//
// Resolves a Map Name to what the viewer draws. Maps built by scripts/maps/build-maps.mjs
// (bsp-to-glb, ahead of time) are listed in models/maps/index.json on the asset host; each has a
// map.json naming its world model, textures, lightmap, props and decals. Maps only converted the
// older way (Blender) still load from the legacy name tables in @utils/game.
//

import mapChunkingConfig from '@constants/mapChunking.json'
import { getAsset, isPerfLoggingEnabled } from '@utils/misc'
import {
  getMapConversionUrl,
  getMapModelUrls,
  getMapSkyboxUrls,
  getMapVisibilityUrl,
  resolveMapFolderName,
} from '@utils/game'

const MAP_NAME = /^[a-z0-9_]{1,128}$/
const FETCH_CONCURRENCY = 12

export type SkyboxUrls = NonNullable<ReturnType<typeof getMapSkyboxUrls>>

/** models/maps/<map>/map.json, written by scripts/maps/build-maps.mjs. */
export type MapManifest = {
  schema: 'dribble.map'
  version: 1
  mapName: string
  bspSha256: string
  worldBounds: { mins: [number, number, number]; maxs: [number, number, number] } | null
  environment: {
    skyName: string | null
    ambient: [number, number, number, number] | null
    sunlight: [number, number, number, number] | null
    sunlightAngles: [number, number, number] | null
  }
  skybox: string | null
  /** Each sky face's file under models/ (content-hashed). */
  skyboxFaces?: Record<'lf' | 'rt' | 'ft' | 'bk' | 'up' | 'dn', string> | null
  skyCamera: { origin: [number, number, number]; scale: number } | null
  components: { role: string; file: string; bytes: number; optional?: boolean }[]
  /** Doors: each brush model (model_<n>_ nodes) and dynamic prop entities that move with it. */
  doors?: {
    entityIndex: number
    classname: string
    targetname: string | null
    brushModel: number | null
    props: number[]
  }[]
  /** "<model asset index>:<skin>" -> a shared models/props/<file>. */
  props: Record<string, string>
}

type MapIndex = { schema: 'dribble.maps'; version: 1; maps: Record<string, unknown> }

export type DerivedMapResult =
  | {
      kind: 'derived'
      manifest: MapManifest
      /** Each component's bytes by role; props as props/<asset>_<skin>.glb. */
      components: Map<string, Uint8Array>
      skyboxUrls?: SkyboxUrls
    }
  | {
      kind: 'legacy'
      modelUrl: string
      visibilityUrl?: string
      conversionUrl?: string
      skyboxUrls?: SkyboxUrls
    }

export type MapLoadStage = { name: 'download'; loadedBytes: number; totalBytes: number }

export class MapResolutionError extends Error {
  constructor(
    readonly code: 'NotAvailable' | 'DownloadFailed' | 'Invalid' | 'Cancelled',
    message: string
  ) {
    super(message)
    this.name = 'MapResolutionError'
  }
}

let indexRequest: Promise<MapIndex | null> | undefined

/** The maps built ahead of time; null when the asset host has no index (or is unreachable). */
function mapIndex(): Promise<MapIndex | null> {
  indexRequest ??= fetch(getAsset('/models/maps/index.json'))
    .then(async response => {
      if (!response.ok || response.headers.get('content-type')?.includes('text/html')) return null
      const index = (await response.json()) as MapIndex
      return index?.schema === 'dribble.maps' && index.version === 1 && index.maps ? index : null
    })
    .catch(() => {
      indexRequest = undefined // try again on the next map
      return null
    })
  return indexRequest
}

function legacyResult(mapName: string): DerivedMapResult | null {
  const model = getMapModelUrls(mapName)
  if (!model) return null
  return {
    kind: 'legacy',
    modelUrl: model.textured,
    visibilityUrl: getMapVisibilityUrl(mapName),
    conversionUrl: getMapConversionUrl(mapName),
    skyboxUrls: getMapSkyboxUrls(mapName),
  }
}

const skyboxUrls = (faces: NonNullable<MapManifest['skyboxFaces']>): SkyboxUrls =>
  Object.fromEntries(
    (['lf', 'rt', 'ft', 'bk', 'up', 'dn'] as const).map(face => [
      face,
      getAsset(`/models/${faces[face]}`),
    ])
  ) as unknown as SkyboxUrls

async function fetchBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new MapResolutionError('DownloadFailed', `${url} returned HTTP ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

/** Runs `tasks` with at most FETCH_CONCURRENCY at once. */
async function inParallel(tasks: (() => Promise<void>)[]) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, tasks.length) }, async () => {
      while (next < tasks.length) await tasks[next++]()
    })
  )
}

async function loadBuiltMap(
  folder: string,
  signal: AbortSignal,
  stage: (stage: MapLoadStage) => void
): Promise<DerivedMapResult> {
  const base = `/models/maps/${folder}/`
  const started = performance.now()
  const manifestResponse = await fetch(getAsset(`${base}map.json`), { signal })
  if (!manifestResponse.ok) {
    throw new MapResolutionError(
      'DownloadFailed',
      `${folder}'s map.json returned HTTP ${manifestResponse.status}`
    )
  }
  const manifest = (await manifestResponse.json()) as MapManifest
  if (
    manifest?.schema !== 'dribble.map' ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.components) ||
    !manifest.components.some(component => component.role === 'world.glb')
  ) {
    throw new MapResolutionError('Invalid', `${folder}'s map.json isn't one this viewer reads`)
  }

  // Visibility is only read for chunk culling.
  const wanted = manifest.components.filter(
    component =>
      !component.optional || (component.role === 'visibility.json' && mapChunkingConfig.enabled)
  )
  const propFiles = [...new Set(Object.values(manifest.props ?? {}))]
  const components = new Map<string, Uint8Array>()
  const propBytes = new Map<string, Uint8Array>()
  // Prop sizes aren't in the manifest; progress counts them once they arrive.
  const totalBytes = wanted.reduce((total, component) => total + component.bytes, 0)
  let loadedBytes = 0
  const progress = (bytes: Uint8Array) => {
    loadedBytes += bytes.byteLength
    stage({ name: 'download', loadedBytes, totalBytes: Math.max(totalBytes, loadedBytes) })
  }
  await inParallel([
    ...wanted.map(component => async () => {
      const bytes = await fetchBytes(getAsset(`${base}${component.file}`), signal)
      components.set(component.role, bytes)
      progress(bytes)
    }),
    ...propFiles.map(file => async () => {
      const bytes = await fetchBytes(getAsset(`/models/props/${file}`), signal)
      propBytes.set(file, bytes)
      progress(bytes)
    }),
  ])
  if (isPerfLoggingEnabled())
    console.info(
      `[Perf][Map] ${folder}: ${wanted.length + propFiles.length} files, ${(loadedBytes / 2 ** 20).toFixed(1)} MB in ${Math.round(performance.now() - started)} ms`
    )
  for (const [key, file] of Object.entries(manifest.props ?? {})) {
    const bytes = propBytes.get(file)
    if (bytes) components.set(`props/${key.replace(':', '_')}.glb`, bytes)
  }
  return {
    kind: 'derived',
    manifest,
    components,
    skyboxUrls: manifest.skyboxFaces ? skyboxUrls(manifest.skyboxFaces) : undefined,
  }
}

let active:
  | { mapName: string; abort: AbortController; promise: Promise<DerivedMapResult> }
  | undefined

async function resolve(
  mapName: string,
  abort: AbortController,
  stage: (stage: MapLoadStage) => void
): Promise<DerivedMapResult> {
  if (!MAP_NAME.test(mapName))
    throw new MapResolutionError('Invalid', `${mapName} isn't a map name`)
  const index = await mapIndex()
  if (abort.signal.aborted) throw new MapResolutionError('Cancelled', 'map load was superseded')
  // This exact map, else the version dribble.tf has of it (cp_snakewater_u13 -> _final1).
  const family = resolveMapFolderName(mapName)
  const folder = index?.maps[mapName] ? mapName : index?.maps[family] ? family : null
  if (folder) {
    try {
      return await loadBuiltMap(folder, abort.signal, stage)
    } catch (error) {
      if (abort.signal.aborted) throw new MapResolutionError('Cancelled', 'map load was superseded')
      // A map built ahead of time that won't load falls back to the older model, if any.
      const legacy = legacyResult(mapName)
      if (legacy) {
        console.warn(error)
        return legacy
      }
      throw error
    }
  }
  const legacy = legacyResult(mapName)
  if (legacy) return legacy
  throw new MapResolutionError('NotAvailable', `${mapName} has no 3D model yet`)
}

export function resolveDerivedMap(
  mapName: string,
  stage: (stage: MapLoadStage) => void = () => undefined
): Promise<DerivedMapResult> {
  if (active?.mapName === mapName) return active.promise
  active?.abort.abort()
  const abort = new AbortController()
  const promise = resolve(mapName, abort, stage)
  active = { mapName, abort, promise }
  return promise
}

export function cancelDerivedMapResolution() {
  active?.abort.abort()
  active = undefined
}

export function textComponent(
  result: Extract<DerivedMapResult, { kind: 'derived' }>,
  role: string
): unknown {
  const bytes = result.components.get(role)
  return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null
}
