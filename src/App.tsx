import React from 'react'

import { ViewerPage } from '@pages/ViewerPage'
import {
  bootstrapSharedSetupFromHashAction,
  loadEmptySceneMapAction,
  loadSetupsAction,
  loadSettingsAction,
} from '@zus/actions'
import { getState } from '@zus/store'

class App extends React.Component {
  state = {
    isReady: false,
  }

  //
  // ─── LIFECYCLE ──────────────────────────────────────────────────────────────────
  //

  async componentDidMount() {
    await loadSettingsAction()
    await loadSetupsAction()
    const sharedSetup = await bootstrapSharedSetupFromHashAction()
    await loadEmptySceneMapAction(sharedSetup?.map ?? getState().scene.map)

    this.setState({ isReady: true })

    // Completely disable right clicks cause it's kinda annoying
    // when interacting with UI elements
    window.addEventListener('contextmenu', event => {
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
