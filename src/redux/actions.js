import localForage from 'localforage'

export const loadSettingsAction = () => async dispatch => {
  try {
    const settings = await localForage.getItem('settings')

    if (!settings) return null

    dispatch({ type: 'LOAD_SETTINGS', settings: settings })
  } catch (error) {
    console.error(error)
  }
}

export const updateSettingsOptionAction = (option, value) => async dispatch => {
  try {
    dispatch({ type: 'UPDATE_SETTINGS_OPTION', option, value })
  } catch (error) {
    console.error(error)
  }
}
