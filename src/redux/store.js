import { createStore, applyMiddleware } from 'redux'
import thunk from 'redux-thunk'

import rootReducer from './reducer'

const initialState = {
  settings: {
    controls: {
      panSpeed: 5,
      rotateSpeed: 5,
      zoomSpeed: 5,
      enableDamping: true,
    },
  },
}

const store = createStore(rootReducer, initialState, applyMiddleware(thunk))

export default store
