import React from 'react'
import { connect } from 'react-redux'

import { ViewerPage } from '@pages/ViewerPage.tsx'

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
    await this.props.loadSettings()
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

const mapState = state => ({
  settings: state.settings,
})

const mapDispatch = dispatch => ({
  loadSettings: () => dispatch(loadSettingsAction()),
})

App = connect(mapState, mapDispatch)(App)

export default App
