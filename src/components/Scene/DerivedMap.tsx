import { useEffect, useRef, useSyncExternalStore } from 'react'

import {
  addDownloadAction,
  applyDerivedMapBoundsAction,
  finishDownloadAction,
  updateDownloadAction,
} from '@zus/actions'
import {
  cancelDerivedMapResolution,
  DerivedMapResult,
  MapLoadStage,
  MapResolutionError,
  resolveDerivedMap,
} from '@utils/derivedMap'
import { reportError } from '@utils/notice'

let snapshot: { result: DerivedMapResult | null } = { result: null }
const listeners = new Set<() => void>()

function publish(result: DerivedMapResult | null) {
  snapshot = { result }
  listeners.forEach(listener => listener())
}

/** Resolves the scene's map (see @utils/derivedMap) and shares the result with the scene. */
export const DerivedMapController = ({ map }: { map: string }) => {
  const loadId = useRef(0)

  useEffect(() => {
    const id = ++loadId.current
    const downloadKey = `map:${map}`
    publish(null)
    void addDownloadAction({ type: 'map', name: map, url: downloadKey })
    const reportStage = (stage: MapLoadStage) => {
      if (id !== loadId.current) return
      void updateDownloadAction(downloadKey, {
        progress: Math.min(99, (stage.loadedBytes / stage.totalBytes) * 100),
        size: stage.totalBytes,
      })
    }
    resolveDerivedMap(map, reportStage)
      .then(result => {
        if (id !== loadId.current) return
        publish(result)
        finishDownloadAction(downloadKey)
        if (result.kind === 'derived' && result.manifest.worldBounds)
          void applyDerivedMapBoundsAction(map, result.manifest.worldBounds)
      })
      .catch(cause => {
        if (id !== loadId.current) return
        finishDownloadAction(downloadKey, 'error')
        if (cause instanceof MapResolutionError && cause.code === 'Cancelled') return
        console.error(cause)
        if (cause instanceof MapResolutionError && cause.code === 'NotAvailable') {
          reportError('No 3D model for this map yet', `dribble.tf hasn't converted ${map} yet.`)
        } else {
          reportError("Couldn't load the map", `${map} failed to load. Try reloading.`)
        }
      })
    return () => {
      loadId.current += 1
      cancelDerivedMapResolution()
      // The cancelled load's own handlers bail out on the stale id, so end its download here.
      finishDownloadAction(downloadKey, 'error')
      publish(null)
    }
  }, [map])

  return null
}

export const useDerivedMap = () =>
  useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => snapshot
  )
