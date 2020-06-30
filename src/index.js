import React from 'react'
import ReactDOM from 'react-dom'
import { Provider as ReduxProvider } from 'react-redux'

import App from './App'
import * as serviceWorker from './serviceWorker'

import './index.scss'
import 'bootstrap/dist/css/bootstrap.min.css'

import store from '@redux/store'

// Use BrowserFS so user can upload their demos to browser for direct parsing
const BrowserFS = require('browserfs')
BrowserFS.install(window)
BrowserFS.configure(
  {
    fs: 'LocalStorage',
  },
  error => {
    if (error) {
      console.error(error)
      throw error
    }
    window.fs = window.require('fs')
    console.log('BrowserFS loaded.')
  }
)

ReactDOM.render(
  <React.StrictMode>
    <ReduxProvider store={store}>
      <App />
    </ReduxProvider>
  </React.StrictMode>,
  document.getElementById('root')
)

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister()
