import { downloadFileAction, goToTickAction, parseDemoAction } from '@zus/actions'
import { getAsset } from '@utils/misc'
import { reportError } from '@utils/notice'
import { rememberOpenedDemo, readSavedDemo, saveDemo } from '@utils/storage'

export const SAMPLE_DEMO = {
  file: 'i52_snakewater_gc.dem',
}

/** Downloads and opens the demo bundled with the site, a few seconds in. */
export const loadSampleDemoAction = async () => {
  const url = getAsset(`/samples/${SAMPLE_DEMO.file}`)

  let fileBuffer = await readSavedDemo(url)
  try {
    if (!fileBuffer) {
      fileBuffer = await downloadFileAction({ type: 'demo', url, name: SAMPLE_DEMO.file })
      saveDemo({ url, name: SAMPLE_DEMO.file }, fileBuffer).catch(error =>
        console.error('[storage]', error)
      )
    }
  } catch (error) {
    console.error(error)
    reportError("Couldn't load the sample match", 'The download failed. Check your connection and try again.')
    return
  }

  try {
    const match = await parseDemoAction(fileBuffer)
    rememberOpenedDemo(url, match)
    goToTickAction(1000) // Skip to the juice
  } catch {
    // parseDemoAction reports its own failure.
  }
}
