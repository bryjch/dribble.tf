import { downloadFileAction, goToTickAction, parseDemoAction } from '@zus/actions'
import { getAsset } from '@utils/misc'
import { reportError } from '@utils/notice'

export const SAMPLE_DEMO = {
  file: 'i52_snakewater_gc.dem',
}

/** Downloads and opens the demo bundled with the site, a few seconds in. */
export const loadSampleDemoAction = async () => {
  const url = getAsset(`/samples/${SAMPLE_DEMO.file}`)

  let fileBuffer: ArrayBuffer
  try {
    fileBuffer = await downloadFileAction({ type: 'demo', url, name: SAMPLE_DEMO.file })
  } catch (error) {
    console.error(error)
    reportError("Couldn't load the sample match", 'The download failed. Check your connection and try again.')
    return
  }

  try {
    await parseDemoAction(fileBuffer)
    goToTickAction(1000) // Skip to the juice
  } catch {
    // parseDemoAction reports its own failure.
  }
}
