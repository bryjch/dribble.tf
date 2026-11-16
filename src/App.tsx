import React from 'react'

import { ViewerPage } from '@pages/ViewerPage'
import {
  bootstrapSharedSetupFromHashAction,
  goToTickAction,
  loadEmptySceneMapAction,
  loadSetupsAction,
  loadSettingsAction,
  updateSettingsOptionAction,
} from '@zus/actions'
import { getState } from '@zus/store'
import { applyTheme, getThemeFromUrl } from '@theme/themes'
import { getLayoutFromUrl } from '@components/Mobile/useMobileLayout'
import { loadUrlDemoAction, resolveUrlDemoAction } from '@utils/embed'
import { connectLiveAction, resolveLiveAction } from '@utils/live'
import { listenForPastedMatchLinks } from '@utils/matchLink'
import { installBench } from '@utils/bench'
import { trackPlayback } from '@utils/storage'

class App extends React.Component {
  state = {
    isReady: false,
  }

  //
  // ─── LIFECYCLE ──────────────────────────────────────────────────────────────────
  //

  async componentDidMount() {
    installBench()
    await loadSettingsAction()

    // ?theme= picks a look and remembers it; after that the overlays follow the setting.
    const urlTheme = getThemeFromUrl()
    if (urlTheme) await updateSettingsOptionAction('ui.theme', urlTheme)
    applyTheme(getState().settings.ui.theme)
    // ?mobile / ?mobile=off pick the interface the same way.
    const urlLayout = getLayoutFromUrl()
    if (urlLayout) await updateSettingsOptionAction('ui.layout', urlLayout)
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

    // No context menu over the viewer (right-drag pans the camera), except in text fields, where
    // it has paste and spellcheck.
    window.addEventListener('contextmenu', event => {
      const target = event.target as HTMLElement | null
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
    })
  }

  //
  // ─── RENDER ─────────────────────────────────────────────────────────────────────
  //

  render() {
    return this.state.isReady ? <ViewerPage /> : null
  }
}

export default App
