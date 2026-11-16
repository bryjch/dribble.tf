import { downloadFileAction, parseDemoAction } from '@zus/actions'
import { setUrlDemoStatus } from '@utils/notice'
import { rememberOpenedDemo, findSavedDemo, readSavedDemo, saveDemo } from '@utils/storage'

//
// ─── LOADING A DEMO FROM THE URL ────────────────────────────────────────────────
//
// Lets a demo be opened by link instead of only by drag-and-drop:
//
//   /?demo=693769                       a demos.tf id, resolved via their public API
//   /?demoUrl=https://…/foo.dem         a direct .dem URL
//   …&tick=1000                         optional tick to seek to once loaded
//
// This makes dribble.tf linkable from anywhere a demo is referenced — match pages,
// forum posts, Discord — and is what an <iframe> embed needs to say which demo to show.
//
// The demo is fetched by the visitor's browser; demos.tf serves
// `access-control-allow-origin: *`, so no proxy is involved.
//
// A demo opened by link is kept in the browser (@utils/storage): opening the same link again
// reads it from there, without asking demos.tf or downloading it.
//

const DEMOS_TF_API = 'https://api.demos.tf/demos'

// ?demoUrl= takes any http(s) link; there is no host allowlist, so demos hosted anywhere open.
// What protects visitors is the browser: the fetch runs as them, under CORS, so a host has to
// opt in before its files can be read, and nothing here can reach a private network that
// the visitor's browser would not let any other site reach. What comes back is checked to
// be a SourceTV demo before it is parsed.
const isFetchableUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url, window.location.origin)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

// Every SourceTV demo starts with this.
const DEMO_MAGIC = 'HL2DEMO'

const isDemoFile = (buffer: ArrayBuffer) =>
  buffer.byteLength > DEMO_MAGIC.length &&
  String.fromCharCode(...new Uint8Array(buffer, 0, DEMO_MAGIC.length)) === DEMO_MAGIC

/** Why a download failed, in words someone can act on. */
const describeDownloadError = (error: unknown, url: string): string => {
  let host = 'that site'
  try {
    host = new URL(url, window.location.origin).hostname
  } catch {}
  // fetch rejects with a TypeError when it never got a response: offline, or blocked by CORS.
  if (error instanceof TypeError) {
    return `Couldn't download from ${host}. It may be offline, or it may not let other sites load its files.`
  }
  const status = error instanceof Error ? Number(error.message.match(/: (\d{3})$/)?.[1]) : NaN
  if (status === 404) return `${host} has no file at that link.`
  if (status) return `${host} refused the download (${status}).`
  return error instanceof Error && error.message ? error.message : 'Could not load this demo.'
}

export type { UrlDemoStatus } from '@utils/notice'
export { getUrlDemoStatus, subscribeToUrlDemoStatus, setUrlDemoStatus } from '@utils/notice'

export interface UrlDemoRequest {
  url: string
  name: string
  /** Map the demo was played on, when known up front — see resolveUrlDemoAction. */
  map?: string
  tick: number
  demoId?: string
}

const reportUrlDemoError = (error: unknown, demoId?: string) => {
  console.error('[url-demo] failed to load demo', error)

  setUrlDemoStatus({
    state: 'error',
    message:
      error instanceof Error && error.message
        ? error.message
        : 'Could not load this demo. It may have been removed.',
    link: demoId ? { href: `https://demos.tf/${demoId}`, label: 'View on demos.tf' } : undefined,
  })
}

/**
 * Phase 1 — work out WHAT to load, without downloading it yet.
 *
 * Split from the download deliberately: the demos.tf record names the map, and knowing it
 * before the scene boots lets App load that map's geometry straight away. Otherwise the
 * viewer downloads the default map's (multi-MB) model first and throws it away the moment
 * the demo finishes parsing.
 *
 * Resolves to null when no demo was requested, so the normal drag-and-drop flow is untouched.
 */
export const resolveUrlDemoAction = async (): Promise<UrlDemoRequest | null> => {
  const params = new URLSearchParams(window.location.search)
  const demoId = params.get('demo')
  const explicitUrl = params.get('demoUrl')

  if (!demoId && !explicitUrl) return null

  const tick = Number(params.get('tick')) || 0

  try {
    setUrlDemoStatus({ state: 'resolving' })

    let request: UrlDemoRequest

    const saved = await findSavedDemo(demoId ? { demoId } : { url: explicitUrl ?? undefined })

    if (saved) {
      request = { url: saved.url, name: saved.name, map: saved.map, tick, demoId: saved.demoId }
    } else if (demoId) {
      // demos.tf's API is public, keyless and CORS-open. The record also carries the
      // original filename, which reads better in the download overlay than the hashed
      // storage path, plus the map name we want for the head start above.
      const response = await fetch(`${DEMOS_TF_API}/${encodeURIComponent(demoId)}`)
      if (!response.ok) throw new Error(`demos.tf ${demoId}: ${response.status}`)
      const data = await response.json()

      if (!data?.url) throw new Error(`demos.tf ${demoId} has no downloadable file`)

      request = { url: data.url, name: data.name ?? `${demoId}.dem`, map: data.map, tick, demoId }
    } else {
      const url = explicitUrl as string
      request = { url, name: decodeURIComponent(url.split('/').pop() ?? 'demo.dem'), tick }
    }

    if (!isFetchableUrl(request.url)) throw new Error("That isn't a web link.")

    setUrlDemoStatus({ state: 'idle' })

    return request
  } catch (error) {
    const notFound = error instanceof Error && /: 404$/.test(error.message)
    reportUrlDemoError(
      notFound ? new Error(`demos.tf has no demo ${demoId}.`) : error,
      demoId ?? undefined
    )
    return null
  }
}

/**
 * Phase 2 — download and parse. Must run after the viewer has mounted, so the existing
 * download progress overlay is on screen for what is often a 50MB+ transfer.
 *
 * Returns the tick to seek to, which the caller applies once the scene is up.
 */
export const loadUrlDemoAction = async (
  request: UrlDemoRequest
): Promise<{ tick: number } | null> => {
  let fileBuffer: ArrayBuffer | null = await readSavedDemo(request.url)
  const fromStorage = !!fileBuffer
  if (!fileBuffer) {
    try {
      fileBuffer = await downloadFileAction({ type: 'demo', url: request.url, name: request.name })
    } catch (error) {
      reportUrlDemoError(new Error(describeDownloadError(error, request.url)), request.demoId)
      return null
    }
  }

  if (!isDemoFile(fileBuffer)) {
    reportUrlDemoError(
      new Error("That link didn't lead to a SourceTV demo (.dem) file."),
      request.demoId
    )
    return null
  }

  if (!fromStorage) {
    saveDemo(request, fileBuffer).catch(error => console.error('[storage]', error))
  }

  try {
    const match = await parseDemoAction(fileBuffer)
    rememberOpenedDemo(request.url, match)
    return { tick: request.tick }
  } catch {
    // parseDemoAction reports its own failure.
    return null
  }
}
