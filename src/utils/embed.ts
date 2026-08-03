import axios from 'axios'

import { addDownloadAction, updateDownloadAction, parseDemoAction } from '@zus/actions'

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

const DEMOS_TF_API = 'https://api.demos.tf/demos'

// ?demoUrl= is attacker-controllable, so the hosts it may point at are restricted. Nothing
// here can reach a private network (it's a browser fetch, not server-side), but an
// unrestricted version would turn any dribble.tf link into "fetch this arbitrary URL with
// dribble.tf as the referrer". Extend this if you self-host demos elsewhere.
const ALLOWED_DEMO_HOSTS = [/(^|\.)demos\.tf$/i]

const isAllowedDemoUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url, window.location.origin)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    if (parsed.origin === window.location.origin) return true
    return ALLOWED_DEMO_HOSTS.some(pattern => pattern.test(parsed.hostname))
  } catch {
    return false
  }
}

export type UrlDemoStatus =
  | { state: 'idle' }
  | { state: 'resolving' }
  | { state: 'error'; message: string; link?: { href: string; label: string } }

type UrlDemoStatusListener = (status: UrlDemoStatus) => void

let urlDemoStatus: UrlDemoStatus = { state: 'idle' }
const listeners = new Set<UrlDemoStatusListener>()

export const getUrlDemoStatus = () => urlDemoStatus

export const subscribeToUrlDemoStatus = (listener: UrlDemoStatusListener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const setUrlDemoStatus = (status: UrlDemoStatus) => {
  urlDemoStatus = status
  listeners.forEach(listener => listener(status))
}

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

    if (demoId) {
      // demos.tf's API is public, keyless and CORS-open. The record also carries the
      // original filename, which reads better in the download overlay than the hashed
      // storage path, plus the map name we want for the head start above.
      const { data } = await axios.get(`${DEMOS_TF_API}/${encodeURIComponent(demoId)}`, {
        responseType: 'json',
      })

      if (!data?.url) throw new Error(`demos.tf ${demoId} has no downloadable file`)

      request = { url: data.url, name: data.name ?? `${demoId}.dem`, map: data.map, tick, demoId }
    } else {
      const url = explicitUrl as string
      request = { url, name: decodeURIComponent(url.split('/').pop() ?? 'demo.dem'), tick }
    }

    if (!isAllowedDemoUrl(request.url)) throw new Error('That demo host is not allowed')

    setUrlDemoStatus({ state: 'idle' })

    return request
  } catch (error) {
    reportUrlDemoError(error, demoId ?? undefined)
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
  try {
    await addDownloadAction({ type: 'demo', url: request.url, name: request.name })

    const fileBuffer = await axios
      .get(request.url, {
        responseType: 'arraybuffer',
        onDownloadProgress: event => {
          updateDownloadAction(request.url, {
            progress: event.progress ? event.progress * 100 : 0,
            size: event.total,
          })
        },
      })
      .then(res => res.data)

    await parseDemoAction(fileBuffer)

    return { tick: request.tick }
  } catch (error) {
    reportUrlDemoError(error, request.demoId)
    return null
  }
}
