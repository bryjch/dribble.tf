import localForage from 'localforage'

import type { MatchSource } from '@components/Analyse/Data/MatchSource'
import { getState, useInstance } from '@zus/store'

//
// ─── SAVED DOWNLOADS ────────────────────────────────────────────────────────────
//
// Maps and demos someone has downloaded stay in their browser, so opening them again reads them
// from disk instead of the network (and works offline). Settings → Storage lists them.
//
// The files live in Cache Storage, keyed by their URL: map files in MAP_CACHE, demos in
// DEMO_CACHE. What each saved map or demo is (its files, size, when it was last used) is kept
// in a small list beside them (INDEX_KEY in localForage), since Cache Storage records none of it.
//
// Maps: a map's files are content-hashed (scripts/maps/build-maps.mjs), so a saved file is never
// out of date and is read without asking the network. map.json and maps/index.json keep their
// names when a map is rebuilt, so they are fetched first and the saved copy is only the fallback
// when offline. Props are shared between maps; deleting a map keeps the ones another saved map
// uses. Maps are kept until someone deletes them, or the browser clears the site.
//
// Demos: the KEEP_DEMOS most recently opened, whether opened from a link, the sample or a file;
// opening another pushes the oldest out. A file has no URL, so it is keyed by a made-up one under
// this site (uploadKey), and is opened from storage in place rather than by a link.
//
// The demo showing is the active one (rememberOpenedDemo): what's known once it's read (its
// score, length) goes on its entry, and where playback is every few seconds (trackPlayback), so
// Recents can show progress and open it where it was left.
//
// A browser may still clear a site's storage when the disk runs low, and Safari clears sites not
// visited for a few weeks; everything then downloads again as it did the first time.
//

const MAP_CACHE = 'dribble-maps-v1'
const DEMO_CACHE = 'dribble-demos-v1'
const INDEX_KEY = 'storage.index'
/** How many demos are kept. Fixed for now; it may become a setting. */
export const KEEP_DEMOS = 10

export type SavedMap = {
  /** The built map's folder under models/maps/. */
  name: string
  /** Every file it was drawn from, as fetched. */
  urls: string[]
  bytes: number
  savedAt: number
  lastUsed: number
}

export type SavedDemo = {
  /** Where the demo was downloaded from (its key in DEMO_CACHE), or uploadKey for a file. */
  url: string
  /** Opened from a file on the visitor's disk, so there is no link to it. */
  upload?: boolean
  name: string
  bytes: number
  savedAt: number
  lastOpened: number
  /** demos.tf's id, when it was opened by one. */
  demoId?: string
  map?: string
  /** Seconds, once it has been read. */
  duration?: number
  /** Rounds won at the end, once it has been read. */
  score?: { red: number; blue: number }
  /** The server it was recorded on (its hostname), once it has been read. */
  server?: string
  /** Where playback was when it was last watched, and how far that is through it (0–1). */
  lastTick?: number
  progress?: number
}

type StorageIndex = { version: 1; maps: Record<string, SavedMap>; demos: SavedDemo[] }

/** Cache Storage needs a secure context (https or localhost). */
export const storageAvailable = () => typeof caches !== 'undefined' && window.isSecureContext

//
// ─── THE INDEX ──────────────────────────────────────────────────────────────────
//

let index: StorageIndex = { version: 1, maps: {}, demos: [] }
let loading: Promise<StorageIndex> | undefined
const listeners = new Set<() => void>()

const absolute = (url: string) => new URL(url, window.location.href).href

function loadIndex(): Promise<StorageIndex> {
  loading ??= (async () => {
    try {
      const stored = await localForage.getItem<StorageIndex>(INDEX_KEY)
      if (stored?.version === 1) index = { version: 1, maps: stored.maps ?? {}, demos: stored.demos ?? [] }
      await reconcile()
    } catch (error) {
      console.error('[storage] could not read the saved downloads', error)
    }
    return index
  })()
  return loading
}

/** Drops entries whose files the browser has since cleared. */
async function reconcile() {
  if (!storageAvailable()) return
  const [maps, demos] = await Promise.all([caches.open(MAP_CACHE), caches.open(DEMO_CACHE)])
  for (const map of Object.values(index.maps)) {
    if (!(await maps.match(map.urls[0]))) delete index.maps[map.name]
  }
  const present = await Promise.all(index.demos.map(demo => demos.match(demo.url)))
  index.demos = index.demos.filter((_, i) => present[i])
}

let saveTimer: number | undefined
function changed() {
  for (const listener of listeners) listener()
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    localForage.setItem(INDEX_KEY, index).catch(error => console.error('[storage]', error))
  }, 200)
}

export function subscribeToStorage(listener: () => void) {
  listeners.add(listener)
  loadIndex().then(listener)
  return () => listeners.delete(listener)
}

/** Saved maps, most recently used first. */
export const savedMaps = () => Object.values(index.maps).sort((a, b) => b.lastUsed - a.lastUsed)
/** Saved demos, most recently opened first. */
export const savedDemos = () => [...index.demos].sort((a, b) => b.lastOpened - a.lastOpened)

const isQuotaError = (error: unknown) =>
  error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)

/** Stores a response, making room by dropping the oldest demos when the browser is full. */
async function put(cache: Cache, url: string, response: Response) {
  for (;;) {
    try {
      await cache.put(url, response.clone())
      return true
    } catch (error) {
      const demos = savedDemos()
      const oldest = demos[demos.length - 1]
      if (!isQuotaError(error) || !oldest) return false
      await deleteDemo(oldest.url)
    }
  }
}

//
// ─── MAPS ───────────────────────────────────────────────────────────────────────
//

/** A map file whose name never changes content: the saved copy if there is one, else the network. */
export async function fetchMapFile(url: string, signal: AbortSignal): Promise<Response> {
  if (!storageAvailable()) return fetch(url, { signal })
  const cache = await caches.open(MAP_CACHE)
  const saved = await cache.match(url)
  if (saved) return saved
  const response = await fetch(url, { signal })
  if (response.ok) await put(cache, url, response)
  return response
}

/** A file that keeps its name when its content changes: the network, else the saved copy offline. */
export async function fetchMapManifest(url: string, init?: RequestInit): Promise<Response> {
  if (!storageAvailable()) return fetch(url, init)
  const cache = await caches.open(MAP_CACHE)
  try {
    const response = await fetch(url, init)
    if (response.ok && !response.headers.get('content-type')?.includes('text/html')) {
      await put(cache, url, response)
    }
    return response
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    const saved = await cache.match(url)
    if (saved) return saved
    throw error
  }
}

/** Records that a map was drawn from these files, so it can be listed and deleted. */
export async function recordMap(name: string, urls: string[], bytes: number) {
  if (!storageAvailable()) return
  await loadIndex()
  const now = Date.now()
  index.maps[name] = {
    name,
    urls: urls.map(absolute),
    bytes,
    savedAt: index.maps[name]?.savedAt ?? now,
    lastUsed: now,
  }
  changed()
}

export async function deleteMap(name: string) {
  await loadIndex()
  const map = index.maps[name]
  if (!map) return
  delete index.maps[name]
  // Props and skies are shared: keep what another saved map still uses.
  const inUse = new Set(Object.values(index.maps).flatMap(other => other.urls))
  const cache = await caches.open(MAP_CACHE)
  await Promise.all(map.urls.filter(url => !inUse.has(url)).map(url => cache.delete(url)))
  changed()
}

//
// ─── DEMOS ──────────────────────────────────────────────────────────────────────
//

/** The made-up URL a demo opened from a file is kept under: the same file gets the same key. */
export const uploadKey = (file: File) =>
  absolute(
    `/saved-demos/${encodeURIComponent(file.name)}?size=${file.size}&modified=${file.lastModified}`
  )

export async function findSavedDemo(by: { url?: string; demoId?: string }) {
  await loadIndex()
  return index.demos.find(
    demo => (by.demoId && demo.demoId === by.demoId) || (by.url && demo.url === by.url)
  )
}

/** A saved demo's bytes, marking it as just opened; null when it isn't saved (any more). */
export async function readSavedDemo(url: string): Promise<ArrayBuffer | null> {
  if (!storageAvailable()) return null
  const demo = await findSavedDemo({ url })
  if (!demo) return null
  const cache = await caches.open(DEMO_CACHE)
  const saved = await cache.match(url)
  const bytes = saved && (await saved.arrayBuffer())
  // Not all there: Safari saved demos empty before saveDemo copied them, so those download again.
  if (!bytes || bytes.byteLength !== demo.bytes) {
    index.demos = index.demos.filter(other => other !== demo)
    if (saved) await cache.delete(url)
    changed()
    return null
  }
  demo.lastOpened = Date.now()
  changed()
  return bytes
}

export async function saveDemo(
  demo: Pick<SavedDemo, 'url' | 'name' | 'demoId' | 'map' | 'upload'>,
  bytes: ArrayBuffer
) {
  if (!storageAvailable()) return
  // The caller hands `bytes` on (parsing transfers it to a worker, which empties it here) as soon
  // as this returns its promise, so the Response gets its own copy. Chrome's Response copies
  // the bytes as it is made, but Safari's keeps the buffer and stores whatever is left in it when
  // cache.put runs: an empty file once it has been transferred.
  const response = new Response(bytes.slice(0), {
    headers: { 'content-type': 'application/octet-stream' },
  })
  const byteLength = bytes.byteLength
  await loadIndex()
  const cache = await caches.open(DEMO_CACHE)
  const now = Date.now()
  // Room for this one first, so a full browser doesn't push out the demo being saved.
  const others = savedDemos().filter(other => other.url !== demo.url)
  for (const old of others.slice(KEEP_DEMOS - 1)) await deleteDemo(old.url)
  const stored = await put(cache, demo.url, response)
  if (!stored) return
  index.demos = [
    ...index.demos.filter(other => other.url !== demo.url),
    { ...demo, bytes: byteLength, savedAt: now, lastOpened: now },
  ]
  changed()
}

async function updateSavedDemo(url: string, details: Partial<SavedDemo>) {
  await loadIndex()
  const demo = index.demos.find(other => other.url === url)
  if (!demo) return
  Object.assign(demo, details)
  changed()
}

let active: { url: string; match: MatchSource } | null = null

/** The demo now showing, read from `url`: notes what is only known once it's read. */
export function rememberOpenedDemo(url: string, match: MatchSource) {
  active = { url, match }
  const score = match.objectivesAt(match.ticks - 1)?.score
  updateSavedDemo(url, {
    map: match.header.map,
    duration: Math.round(match.ticks * match.intervalPerTick),
    server: match.header.server || undefined,
    ...(score ? { score: { red: score.red, blue: score.blue } } : {}),
  })
}

/** Notes where the active demo's playback is, every few seconds and when the page is hidden. */
export function trackPlayback() {
  let last = -1
  const note = () => {
    // Only while that demo is still the one showing (not since replaced by another, or live).
    if (!active || useInstance.getState().match !== active.match) return
    const tick = Math.floor(getState().playback.tick)
    if (Math.abs(tick - last) < 1) return
    last = tick
    updateSavedDemo(active.url, { lastTick: tick, progress: Math.min(1, tick / active.match.ticks) })
  }
  window.setInterval(note, 5000)
  document.addEventListener('visibilitychange', note)
}

export async function deleteDemo(url: string) {
  await loadIndex()
  index.demos = index.demos.filter(demo => demo.url !== url)
  await (await caches.open(DEMO_CACHE)).delete(url)
  changed()
}

/** Saves a copy of a saved demo to the visitor's downloads folder. */
export async function downloadSavedDemo(demo: SavedDemo) {
  const saved = await (await caches.open(DEMO_CACHE)).match(demo.url)
  if (!saved) return
  const href = URL.createObjectURL(await saved.blob())
  const link = document.createElement('a')
  link.href = href
  link.download = demo.name.endsWith('.dem') ? demo.name : `${demo.name}.dem`
  link.click()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
}

export async function clearAllStorage() {
  await loadIndex()
  index = { version: 1, maps: {}, demos: [] }
  await Promise.all([caches.delete(MAP_CACHE), caches.delete(DEMO_CACHE)])
  changed()
}

/**
 * The URL that opens a saved demo, the same as a shared link to it (@utils/embed), at `tick`
 * when given; null for a file, which has no link.
 */
export const savedDemoSearch = (demo: SavedDemo, tick?: number) => {
  if (demo.upload) return null
  const search = demo.demoId
    ? `?demo=${encodeURIComponent(demo.demoId)}`
    : `?demoUrl=${encodeURIComponent(demo.url)}`
  return tick ? `${search}&tick=${tick}` : search
}
