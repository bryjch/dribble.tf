import React, { Suspense, lazy } from 'react'

import { ViewerPage } from '@pages/ViewerPage'
import type { DebugView } from '@components/Debug/scenario'
import {
  bootstrapSharedSetupFromHashAction,
  goToTickAction,
  loadEmptySceneMapAction,
  loadSetupsAction,
  loadSettingsAction,
  updateSettingsOptionAction,
} from '@zus/actions'
import { getState, setSettingsPersisted } from '@zus/store'
import { applyTheme, getThemeFromUrl } from '@theme/themes'
import { getLayoutFromUrl } from '@components/Mobile/useMobileLayout'
import { loadUrlDemoAction, resolveUrlDemoAction } from '@utils/embed'
import { connectLiveAction, resolveLiveAction } from '@utils/live'
import { listenForPastedMatchLinks } from '@utils/matchLink'
import { installBench } from '@utils/bench'
import { trackPlayback } from '@utils/storage'

// /debug: the viewer driven by a scripted match, for testing rendering (src/components/Debug).
// Not linked anywhere; loaded only there, so the viewer's own bundle doesn't grow.
const isDebugPage = () => /^\/debug(\/|$)/.test(window.location.pathname)
const DebugPage = lazy(() => import('@components/Debug/DebugPage'))

// No context menu over the viewer (right-drag pans the camera), except in text fields, where
// it has paste and spellcheck.
const blockContextMenu = () =>
  window.addEventListener('contextmenu', event => {
    const target = event.target as HTMLElement | null
    if (target?.closest?.('input, textarea, [contenteditable="true"]')) return
    event.preventDefault()
  })

/** ?theme= and ?mobile pick a look and an interface; elsewhere they are remembered. */
async function applyUrlSettings() {
  const urlTheme = getThemeFromUrl()
  if (urlTheme) await updateSettingsOptionAction('ui.theme', urlTheme)
  applyTheme(getState().settings.ui.theme)
  const urlLayout = getLayoutFromUrl()
  if (urlLayout) await updateSettingsOptionAction('ui.layout', urlLayout)
}

class App extends React.Component {
  state: { isReady: boolean; debug: boolean; debugView?: DebugView } = {
    isReady: false,
    debug: isDebugPage(),
  }

  //
  // ─── LIFECYCLE ──────────────────────────────────────────────────────────────────
  //

  async componentDidMount() {
    if (this.state.debug) return this.bootDebugPage()

    installBench()
    await loadSettingsAction()

    // ?theme= picks a look and remembers it; after that the overlays follow the setting.
    // ?mobile / ?mobile=off pick the interface the same way.
    await applyUrlSettings()
    await loadSetupsAction()
    const sharedSetup = await bootstrapSharedSetupFromHashAction()

    // A demo may be requested by URL (?demo= / ?demoUrl=) — see @utils/embed. Resolving it
    // first means the empty scene boots straight into that demo's map, instead of
    // downloading the default map's model and discarding it seconds later.
    const urlDemo = await resolveUrlDemoAction()
    // Or a live match from stv.tf (?live=) — see @utils/live.
    const live = urlDemo ? null : await resolveLiveAction()

    await loadEmptySceneMapAction(urlDemo?.map ?? sharedSetup?.map ?? getState().scene.map)

    this.setState({ isReady: true })

    // Only once the viewer is mounted — the download progress overlay lives there.
    if (urlDemo) {
      const loaded = await loadUrlDemoAction(urlDemo)
      if (loaded?.tick) goToTickAction(loaded.tick)
    }

    if (live) connectLiveAction(live)
    listenForPastedMatchLinks()
    trackPlayback()
    blockContextMenu()
  }

  /**
   * /debug boots without the viewer's ways in (a demo or live match from the URL, a shared
   * setup, pasted match links) and without tracking playback for Recents. Settings changed there
   * (?theme= included) stay in memory: a session there is throwaway.
   */
  async bootDebugPage() {
    setSettingsPersisted(false)
    installBench()
    await loadSettingsAction()
    await applyUrlSettings()
    await loadSetupsAction()
    const { bootDebug } = await import('@components/Debug/session')
    const debugView = await bootDebug()
    this.setState({ isReady: true, debugView })
    blockContextMenu()
  }

  //
  // ─── RENDER ─────────────────────────────────────────────────────────────────────
  //

  render() {
    if (!this.state.isReady) return null
    if (!this.state.debug) return <ViewerPage />
    return (
      <Suspense fallback={null}>
        <DebugPage view={this.state.debugView} />
      </Suspense>
    )
  }
}

export default App
