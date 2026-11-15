//
// ─── MATCH NOTICE ───────────────────────────────────────────────────────────────
//
// The one status line for getting a match on screen: looking a demo up, connecting to a live
// match, and anything that went wrong on the way (a download, the parse, the map). Shown by
// <UrlDemoNotice>, which lets an error or notice be dismissed.
//
// Kept out of the zustand store on purpose: nothing else reads it, and it has no imports, so
// the store's actions, @utils/embed and @utils/live can all report through it.
//

export type UrlDemoStatus =
  | { state: 'idle' }
  | { state: 'resolving'; message?: string }
  | { state: 'notice'; message: string }
  | { state: 'error'; title?: string; message: string; link?: { href: string; label: string } }

type UrlDemoStatusListener = (status: UrlDemoStatus) => void

let urlDemoStatus: UrlDemoStatus = { state: 'idle' }
const listeners = new Set<UrlDemoStatusListener>()

export const getUrlDemoStatus = () => urlDemoStatus

export const subscribeToUrlDemoStatus = (listener: UrlDemoStatusListener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const setUrlDemoStatus = (status: UrlDemoStatus) => {
  urlDemoStatus = status
  listeners.forEach(listener => listener(status))
}

export const clearNotice = () => setUrlDemoStatus({ state: 'idle' })

/** Something went wrong getting a match or map on screen. */
export const reportError = (title: string, message: string, link?: { href: string; label: string }) =>
  setUrlDemoStatus({ state: 'error', title, message, link })
