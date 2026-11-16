import { LiveSource, StreamMessage } from '@components/Analyse/Data/LiveSource'
import { builtMapNames } from '@utils/derivedMap'
import { pickMapVersion } from '@utils/mapVersions'
import { setUrlDemoStatus } from '@utils/notice'
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
// Pasting such a link anywhere on the page opens it too (see @utils/matchLink).
//

// Playback stays this far behind the newest snapshot, so the stream's jitter never runs it
// dry. A delay in the link (…/w/<id>/5, to line up with a stream) adds to it.
const LIVE_LAG_SECONDS = 0.5
// Playback within this of the edge is following the match, and is brought back to the edge
// once it falls behind by more than the second.
const FOLLOW_SECONDS = 5
const CATCH_UP_SECONDS = 1

// Any host may serve a match: stv.tf, serveme.tf's /live, or anyone running stvtf-web
// themselves. A link is recognised by stv.tf's page shape (below), not by its domain; the
// browser's CORS rules decide whether its event stream can actually be read.

export interface LiveRequest {
  /** The link as given, to send people back to stv.tf when something goes wrong. */
  link: string
  eventsUrl: string
  delaySeconds: number
}

/** The host a match link points at, for messages ("stv.tf", "serveme.tf", ...). */
const hostOf = (link: string) => {
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    return 'the server'
  }
}

const isWebUrl = (url: URL) => url.protocol === 'https:' || url.protocol === 'http:'

/** Whether a link has the shape of an stv.tf match page (/w/<id>/…) or start link (/start). */
export const isLiveLink = (text: string) => {
  try {
    const url = new URL(text.trim())
    return isWebUrl(url) && /(\/w\/[\w-]+|\/start)(\/|$)/.test(url.pathname)
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
  if (!isWebUrl(url)) throw new Error("That isn't a web link.")

  // A start link starts the match (or joins it) and says which page it is on.
  if (url.pathname.endsWith('/start')) {
    url.searchParams.set('format', 'json')
    const response = await fetch(url)
    if (!response.ok)
      throw new Error(`${url.hostname} could not start this match (${response.status})`)
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
    setUrlDemoStatus({ state: 'resolving', message: `Connecting to ${hostOf(link)}…` })
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
  const host = hostOf(request.link)
  const stvLink = { href: request.link, label: `Open on ${host}` }
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
    const map = live.header.map
    const built = await builtMapNames()
    if (source !== live) return
    if (pickMapVersion(map, built)) clear()
    else
      setUrlDemoStatus({
        state: 'notice',
        message: `dribble.tf has no 3D model of ${map} yet: the players move over an empty scene.`,
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
            message: m.reason || `${host} lost the connection to this match.`,
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
        message: `${host} refused the stream: the match may have ended or the link expired.`,
        link: stvLink,
      })
    } else {
      info('Lost the stream, reconnecting ...')
    }
  }

  // Dropping a demo in ends the stream.
  const unsubscribe = useInstance.subscribe(state => {
    if (state.match && state.match.kind !== 'live') {
      stream.close()
      unsubscribe()
    }
  })
}
