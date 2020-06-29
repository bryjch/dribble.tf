import React from 'react'
import { connect } from 'react-redux'

import ViewerPage from './pages/ViewerPage.tsx'

import { loadSettingsAction } from './redux/actions'

import './App.scss'

class App extends React.Component {
  state = {
    isReady: false,
  }

  //
  // ─── LIFECYCLE ──────────────────────────────────────────────────────────────────
  //

  async componentWillMount() {
    await this.props.loadSettings()
    this.setState({ isReady: true })
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
