import { debounce } from 'lodash'

/**
 * Simple sleep helper function
 */

export const sleep = (millis: number) => {
  return new Promise(resolve => {
    return setTimeout(resolve, millis)
  })
}

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

/**
 * Conditionally fetch map file from either 1. local assets or 2. Cloudfront
 * (becausing serving large static binaries on Netlify is really slow)
 * (TODO: ther should be some check if fetching from Cloudfront fails --
 * if so, it should always fallback to loading from local assets)
 */

export const getAsset = (endpoint: string): string => {
  let url = ''

  if (import.meta.env.PROD && !!import.meta.env.VITE_APP_ASSET_URL) {
    url += `${import.meta.env.VITE_APP_ASSET_URL}`
  }

  url += endpoint

  return url
}
