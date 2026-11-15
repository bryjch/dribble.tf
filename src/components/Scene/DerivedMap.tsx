import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

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

type ContextValue = {
  result: DerivedMapResult | null
  error: MapResolutionError | null
}

let snapshot: ContextValue = { result: null, error: null }
const listeners = new Set<() => void>()

function publish(value: ContextValue) {
  snapshot = value
  listeners.forEach(listener => listener())
}

const STAGE_LABELS: Record<MapLoadStage['name'], string> = {
  catalog: 'Checking Serveme catalog',
  download: 'Downloading BSP',
  inspect: 'Inspecting map dependencies',
  assets: 'Fetching verified shared assets',
  convert: 'Converting map in browser',
  cache: 'Saving verified Derived Map',
}

export const DerivedMapController = ({ map }: { map: string }) => {
  const [result, setResult] = useState<DerivedMapResult | null>(null)
  const [error, setError] = useState<MapResolutionError | null>(null)
  const loadId = useRef(0)
  const downloadKey = `derived-map:${map}`

  const reportStage = (stage: MapLoadStage) => {
    const progress = stage.totalBytes
      ? Math.min(99, (Number(stage.loadedBytes ?? 0) / stage.totalBytes) * 100)
      : 0
    const bytes = stage.loadedBytes ? ` (${(stage.loadedBytes / (1024 * 1024)).toFixed(1)} MB)` : ''
    void updateDownloadAction(downloadKey, {
      progress,
      size: stage.totalBytes,
      stage: `${STAGE_LABELS[stage.name]}${bytes}`,
    })
  }

  const load = (file?: File) => {
    const id = ++loadId.current
    setResult(null)
    setError(null)
    publish({ result: null, error: null })
    void addDownloadAction({ type: 'map', name: map, url: downloadKey })
    void resolveDerivedMap(map, reportStage, file)
      .then(value => {
        if (id !== loadId.current) return
        setResult(value)
        publish({ result: value, error: null })
        finishDownloadAction(downloadKey)
        if (value.kind === 'derived')
          void applyDerivedMapBoundsAction(map, value.manifest.worldBounds)
      })
      .catch(cause => {
        if (id !== loadId.current) return
        const failure =
          cause instanceof MapResolutionError
            ? cause
            : new MapResolutionError('ConversionFailed', String(cause))
        if (failure.code !== 'Cancelled') setError(failure)
        if (failure.code !== 'Cancelled') publish({ result: null, error: failure })
        finishDownloadAction(downloadKey, 'error')
      })
  }

  useEffect(() => {
    load()
    return () => {
      loadId.current += 1
      cancelDerivedMapResolution()
      // The cancelled load's own handlers bail out on the stale id, so end its download here.
      finishDownloadAction(downloadKey, 'error')
      publish({ result: null, error: null })
    }
    // reportStage and load intentionally belong to this map generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  const coverage = useMemo(() => {
    if (result?.kind !== 'derived' || !result.manifest.degraded) return null
    return Object.entries(result.manifest.assetCoverage)
      .filter(([, value]) => value.unavailable || value.unsupported)
      .map(
        ([domain, value]) =>
          `${domain}: ${value.unavailable} unavailable, ${value.unsupported} unsupported`
      )
      .join(' · ')
  }, [result])

  const localOverrideAllowed =
    error &&
    ['CatalogMiss', 'CatalogUnavailable', 'DownloadFailed', 'IntegrityFailure'].includes(error.code)

  return (
    <>
      {localOverrideAllowed && (
        <div className="ui-layer pointer-events-none items-center justify-center">
          <label className="pointer-events-auto max-w-md rounded-lg bg-pp-panel/95 px-5 py-4 text-center shadow-xl">
            <div className="mb-1 font-semibold">Map source unavailable</div>
            <div className="mb-3 text-sm opacity-70">{error.message}</div>
            <span className="cursor-pointer rounded bg-white/10 px-3 py-2 text-sm hover:bg-white/20">
              Choose Local Override BSP
              <input
                className="hidden"
                type="file"
                accept=".bsp,application/octet-stream"
                onChange={event => {
                  const file = event.target.files?.[0]
                  if (file) load(file)
                }}
              />
            </span>
          </label>
        </div>
      )}
      {error && !localOverrideAllowed && (
        <div className="ui-layer pointer-events-none bottom-0 items-end justify-center p-4">
          <div className="rounded bg-red-950/90 px-4 py-2 text-sm">{error.message}</div>
        </div>
      )}
      {coverage && (
        <div className="ui-layer pointer-events-none bottom-0 items-end justify-center p-4">
          <div className="max-w-3xl rounded bg-amber-950/90 px-4 py-2 text-xs">
            Degraded Derived Map · {coverage}
          </div>
        </div>
      )}
    </>
  )
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
