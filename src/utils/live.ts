import { LiveSource, StreamMessage } from '@components/Analyse/Data/LiveSource'
import { getMapModelUrls } from '@utils/game'
import { setUrlDemoStatus } from '@utils/embed'
import { goToTickAction, loadSceneFromDemoAction, setMaxTicksAction } from '@zus/actions'
import { getState, useInstance } from '@zus/store'

//
// ─── WATCHING A LIVE MATCH FROM STV.TF ──────────────────────────────────────────
//
// stv.tf shows a live TF2 match top-down, from SourceTV. Every match page has an event
// stream next to it (`/w/<id>/events`, Server-Sent Events, CORS-open) carrying a full
// snapshot of the players, projectiles and objectives about every 4 ticks, plus kills,
// chat and the rest of the feed. This plays that stream in 3D:
//
//   /?live=https://stv.tf/w/abc123/        a match page (also …/overlay, …/5 for a delay)
//   /?live=https://stv.tf/start?t=…        a start link from serveme.tf
//
// Pasting such a link anywhere on the page opens it too.
//

// Playback stays this far behind the newest snapshot, so the stream's jitter never runs it
// dry. A delay in the link (…/w/<id>/5, to line up with a stream) adds to it.
const LIVE_LAG_SECONDS = 0.5
// Playback within this of the edge is following the match, and is brought back to the edge
// once it falls behind by more than the second.
const FOLLOW_SECONDS = 5
const CATCH_UP_SECONDS = 1

// stv.tf and the sites that run it behind their own domain (serveme.tf's /live), plus a
// local stvtf-web. Extend this to watch another deployment.
const ALLOWED_LIVE_HOSTS = [
  /(^|\.)stv\.tf$/i,
  /(^|\.)serveme\.tf$/i,
  /^localhost$/i,
  /^127\.0\.0\.1$/,
  /^\[::1\]$/,
]

export interface LiveRequest {
  /** The link as given, to send people back to stv.tf when something goes wrong. */
  link: string
  eventsUrl: string
  delaySeconds: number
}

const isAllowedLiveUrl = (url: URL) =>
  (url.protocol === 'https:' || url.protocol === 'http:') &&
  (url.origin === window.location.origin ||
    ALLOWED_LIVE_HOSTS.some(pattern => pattern.test(url.hostname)))

/** Whether pasted text is a link this can play. */
export const isLiveLink = (text: string) => {
  try {
    const url = new URL(text.trim())
    return isAllowedLiveUrl(url) && /(\/w\/[\w-]+|\/start)(\/|$)/.test(url.pathname)
  } catch {
    return false
  }
}

/**
 * The event stream behind an stv.tf page, and the delay the page was asked for. A match page
 * is `/w/<id>/`, optionally `overlay` and a delay after it; a server watching a single match
 * serves the same at `/`.
 */
const watchPage = (url: URL): LiveRequest => {
  const path = url.pathname
  const match = path.match(/^(.*?\/w\/[\w-]+)(\/.*)?$/)
  const base = match
    ? `${match[1]}/`
    : (path.match(/^(.*?\/)(overlay\/?)?([\d.]+\/?)?$/)?.[1] ?? '/')
  const rest = path.slice(base.length)
  const delay = Number(rest.match(/([\d.]+)\/?$/)?.[1] ?? url.searchParams.get('delay') ?? 0)

  return {
    link: url.href,
    eventsUrl: new URL(`${base}events`, url).href,
    delaySeconds: Number.isFinite(delay) ? Math.min(60, Math.max(0, delay)) : 0,
  }
}

const resolveLink = async (link: string): Promise<LiveRequest> => {
  const url = new URL(link.trim())
  if (!isAllowedLiveUrl(url)) throw new Error(`${url.hostname} is not an stv.tf server`)

  // A start link starts the match (or joins it) and says which page it is on.
  if (url.pathname.endsWith('/start')) {
    url.searchParams.set('format', 'json')
    const response = await fetch(url)
    if (!response.ok) throw new Error(`stv.tf could not start this match (${response.status})`)
    const { page } = await response.json()
    return watchPage(new URL(page, url))
  }

  return watchPage(url)
}

/** Resolves to null when no live match was asked for, so the other ways in are untouched. */
export const resolveLiveAction = async (): Promise<LiveRequest | null> => {
  const link = new URLSearchParams(window.location.search).get('live')
  if (!link) return null

  try {
    setUrlDemoStatus({ state: 'resolving', message: 'Connecting to stv.tf ...' })
    return await resolveLink(link)
  } catch (error) {
    setUrlDemoStatus({
      state: 'error',
      title: "Couldn't watch this match",
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Plays the match: a new LiveSource for each map, loaded into the scene once it knows where
 * the map is, with the end of the timeline following the newest snapshot.
 */
export const connectLiveAction = (request: LiveRequest) => {
  const stream = new EventSource(request.eventsUrl)
  const stvLink = { href: request.link, label: 'Open on stv.tf' }
  let source: LiveSource | null = null
  let loaded = false
  let server: StreamMessage | null = null
  let world: StreamMessage | null = null

  const info = (message: string) => setUrlDemoStatus({ state: 'resolving', message })
  const clear = () => setUrlDemoStatus({ state: 'idle' })

  const lagTicks = (live: LiveSource) =>
    Math.round((LIVE_LAG_SECONDS + request.delaySeconds) / live.intervalPerTick)

  const start = () => {
    if (!server) return
    const live = new LiveSource(
      server.map,
      server.hostname ?? '',
      server.tick_interval ?? 0.015,
      world ? [world.min, world.max] : null
    )
    live.onReset = start
    source = live
    loaded = false
  }

  const load = async (live: LiveSource) => {
    loaded = true
    await loadSceneFromDemoAction(live)
    if (source !== live) return
    const edge = Math.max(1, live.latestTick - lagTicks(live))
    setMaxTicksAction(edge)
    goToTickAction(edge)
    if (getMapModelUrls(live.header.map)) clear()
    else
      setUrlDemoStatus({
        state: 'notice',
        message: `dribble.tf has no 3D model of ${live.header.map} yet: the players move over an empty scene.`,
      })
  }

  stream.onmessage = event => {
    const m: StreamMessage = JSON.parse(event.data)

    switch (m.type) {
      case 'server':
        // A signon restart announces the same map again: keep what has been seen.
        if (server?.map !== m.map || !source) {
          server = m
          world = null
          start()
        }
        return
      case 'world':
        world = m
        break
      case 'status':
        if (m.state === 'full') {
          if (loaded) clear()
        } else if (m.state === 'map_change') {
          info('The server is changing map ...')
        } else if (m.state === 'disconnected' || m.state === 'connect_failed') {
          setUrlDemoStatus({
            state: 'error',
            title: 'SourceTV disconnected',
            message: m.reason || 'stv.tf lost the connection to this match.',
            link: stvLink,
          })
        } else if (!loaded) {
          info(`SourceTV: ${String(m.state).replace(/_/g, ' ')} ...`)
        }
        return
    }

    const live = source
    if (!live) return
    live.handle(m)

    if (m.type !== 'snapshot' || source !== live) return
    if (!loaded) {
      if (live.hasWorld) load(live)
      return
    }
    const edge = live.latestTick - lagTicks(live)
    const { tick, maxTicks, playing, speed } = getState().playback
    setMaxTicksAction(edge)
    // Someone following the match (playing, near the edge) stays with it: slow frames or a
    // hidden tab leave playback behind. Seeking back further leaves them where they went.
    const second = 1 / live.intervalPerTick
    if (
      playing &&
      speed === 1 &&
      tick >= maxTicks - FOLLOW_SECONDS * second &&
      tick < edge - CATCH_UP_SECONDS * second
    ) {
      goToTickAction(edge)
    }
  }

  // stv.tf starts every (re)connect with the latest snapshot, so a reconnect picks up there.
  stream.onopen = () => {
    if (loaded) clear()
  }

  stream.onerror = () => {
    if (stream.readyState === EventSource.CLOSED) {
      setUrlDemoStatus({
        state: 'error',
        title: "Couldn't watch this match",
        message: 'stv.tf refused the stream: the match may have ended or the link expired.',
        link: stvLink,
      })
    } else {
      info('Lost the stream, reconnecting ...')
    }
  }

  // Dropping a demo in ends the stream.
  const unsubscribe = useInstance.subscribe(state => {
    if (state.parsedDemo && !(state.parsedDemo instanceof LiveSource)) {
      stream.close()
      unsubscribe()
    }
  })
}

/** Pasting an stv.tf link opens it, the same as following a ?live= link. */
export const listenForPastedLiveLinks = () => {
  window.addEventListener('paste', event => {
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, [contenteditable="true"]')) return
    const text = event.clipboardData?.getData('text') ?? ''
    if (!isLiveLink(text)) return
    event.preventDefault()
    const url = new URL(window.location.href)
    url.search = `?live=${encodeURIComponent(text.trim())}`
    url.hash = ''
    window.location.assign(url.href)
  })
}
