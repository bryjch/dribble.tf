import React from 'react'
import { connect } from 'react-redux'

import { ViewerPage } from '@pages/ViewerPage.tsx'

import { dispatch, getState } from '@redux/store'
import { loadSettingsAction } from '@redux/actions'

import 'semantic-ui-css/semantic.min.css'
import './App.scss'

class App extends React.Component {
  state = {
    isReady: false,
  }

  //
  // ─── LIFECYCLE ──────────────────────────────────────────────────────────────────
  //

  async componentDidMount() {
    await dispatch(loadSettingsAction())

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
    return <div id="app">{this.state.isReady ? <ViewerPage /> : null}</div>
  }
}

export default App
