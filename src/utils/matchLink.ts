import { isLiveLink } from '@utils/live'

//
// ─── OPENING A MATCH FROM A LINK ────────────────────────────────────────────────
//
// What someone types or pastes into the About panel's link box, turned into the same URL a
// shared link would use (?demo= / ?demoUrl= from @utils/embed, ?live= from @utils/live).
// Opening it reloads into that URL, so the map loads first and the address bar is shareable.
//
// No domain is required. A demos.tf page is looked up through its API, anything shaped like
// an stv.tf match page (on any host) is watched live, and every other web link is fetched as
// a demo, which @utils/embed checks really is one before parsing it.
//

export type MatchLink =
  | { search: string; kind: 'demos.tf' | 'live' | 'file'; url?: URL }
  | { error: string }

export const parseMatchLink = (input: string): MatchLink => {
  const text = input.trim()
  if (!text) return { error: 'Paste a link to a demo or a live match.' }

  // A bare demos.tf id.
  if (/^\d+$/.test(text)) return { search: `?demo=${text}`, kind: 'demos.tf' }

  // People paste links without the scheme as often as with it.
  const href = /^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`

  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { error: "That doesn't look like a link." }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { error: "That doesn't look like a web link." }
  }
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
    return { error: "That doesn't look like a link." }
  }

  if (/(^|\.)demos\.tf$/i.test(url.hostname)) {
    const id = url.pathname.match(/^\/(\d+)\/?$/)?.[1]
    if (id) return { search: `?demo=${id}`, kind: 'demos.tf', url }
  }

  if (isLiveLink(url.href)) return { search: `?live=${encodeURIComponent(url.href)}`, kind: 'live', url }

  return { search: `?demoUrl=${encodeURIComponent(url.href)}`, kind: 'file', url }
}

const go = (search: string) => {
  const url = new URL(window.location.href)
  url.search = search
  url.hash = ''
  window.location.assign(url.href)
}

/** Opens a link from the link box. Returns an error to show, or null once it is on its way. */
export const openMatchLink = (input: string): string | null => {
  const link = parseMatchLink(input)
  if ('error' in link) return link.error
  go(link.search)
  return null
}

/**
 * Pasting a match link anywhere outside a text field opens it, the same as the link box.
 * Only links that are clearly a match count (a demos.tf page, a .dem file, an stv.tf-shaped
 * match page), so pasting some other link or a number somewhere does nothing.
 */
export const listenForPastedMatchLinks = () => {
  window.addEventListener('paste', event => {
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, [contenteditable="true"]')) return

    const text = (event.clipboardData?.getData('text') ?? '').trim()
    if (!/^https?:\/\//i.test(text) && !/^[\w-]+(\.[\w-]+)+\//.test(text)) return

    const link = parseMatchLink(text)
    if ('error' in link) return
    if (link.kind === 'file' && !/\.dem$/i.test(link.url?.pathname ?? '')) return

    event.preventDefault()
    go(link.search)
  })
}
