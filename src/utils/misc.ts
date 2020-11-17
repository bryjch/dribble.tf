import { debounce } from 'lodash'

/**
 * Function to force refocus on the main three.js canvas
 * (may be useful in case clicking certain UI causes focus to be lost)
 */

export const focusMainCanvas = debounce((): void => {
  try {
    const mainCanvas = document
      .getElementById(`main-canvas`)
      ?.getElementsByTagName('canvas')
      .item(0)

    mainCanvas?.focus?.()
  } catch (error) {
    console.error(error)
  }
}, 20)
