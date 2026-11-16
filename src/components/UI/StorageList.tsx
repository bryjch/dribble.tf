import { useEffect, useState } from 'react'

import { DownloadIcon, FaTrashIcon } from '@components/Misc/Icons'
import { UIPanelType } from '@constants/types'

import {
  loadEmptySceneMapAction,
  openDemoBytesAction,
  setSettingsTabAction,
  toggleOnlyUIPanelAction,
} from '@zus/actions'
import { mapFamily } from '@utils/mapVersions'
import { reportError } from '@utils/notice'
import {
  KEEP_DEMOS,
  SavedDemo,
  SavedMap,
  clearAllStorage,
  deleteDemo,
  deleteMap,
  downloadSavedDemo,
  readSavedDemo,
  savedDemoSearch,
  savedDemos,
  savedMaps,
  storageAvailable,
  subscribeToStorage,
} from '@utils/storage'

//
// ─── SAVED DOWNLOADS ────────────────────────────────────────────────────────────
//
// What this browser has kept (@utils/storage): Settings → Storage, and the About panel's
// Recents tab.
//

export const formatBytes = (bytes: number) => {
  if (bytes >= 2 ** 30) return `${(bytes / 2 ** 30).toFixed(1)} GB`
  if (bytes >= 2 ** 20) return `${(bytes / 2 ** 20).toFixed(bytes >= 10 * 2 ** 20 ? 0 : 1)} MB`
  return `${Math.max(1, Math.round(bytes / 2 ** 10))} KB`
}

export const formatAgo = (time: number) => {
  const minutes = Math.round((Date.now() - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

export const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

const MODES: Record<string, string> = {
  cp: 'Control points',
  koth: 'King of the hill',
  pl: 'Payload',
  plr: 'Payload race',
  ctf: 'Capture the flag',
  pass: 'PASS Time',
  arena: 'Arena',
  ultiduo: 'Ultiduo',
  mge: 'MGE',
}

/** cp_process_f12 → Process; koth_product_final → Product. */
export const mapTitle = (map: string) =>
  mapFamily(map)
    .replace(/^[a-z]+_/, '')
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

/** cp_process_f12 → Control points. */
export const mapMode = (map: string) => MODES[map.split('_')[0]] ?? null

/** Its map, length and size, as far as they're known. */
export const demoDetail = (demo: SavedDemo) =>
  [demo.map, demo.duration ? formatDuration(demo.duration) : null, formatBytes(demo.bytes)]
    .filter(Boolean)
    .join(' · ')

/** Where it was left, when it was left partway (not at the start, nor watched to the end). */
export const resumeTick = (demo: SavedDemo) =>
  demo.lastTick && demo.progress && demo.progress > 0.01 && demo.progress < 0.97
    ? demo.lastTick
    : undefined

/** Re-renders whenever something is saved or deleted. */
export const useSavedDownloads = () => {
  const [ready, setReady] = useState(false)
  const [, setVersion] = useState(0)
  useEffect(() => {
    const unsubscribe = subscribeToStorage(() => {
      setReady(true)
      setVersion(version => version + 1)
    })
    return () => {
      unsubscribe()
    }
  }, [])
  return { ready, maps: savedMaps(), demos: savedDemos() }
}

/**
 * Opens a saved demo, at `tick` if given: one from a link the way its link would, so the address
 * bar is shareable; one from a file straight from storage, since there is no link to it.
 */
export const openSavedDemo = async (demo: SavedDemo, tick?: number) => {
  const search = savedDemoSearch(demo, tick)
  if (search) {
    const url = new URL(window.location.href)
    // Keep anything unrelated (?variant=, ?perf=); swap the demo.
    for (const param of ['demo', 'demoUrl', 'live', 'tick']) url.searchParams.delete(param)
    for (const [key, value] of new URLSearchParams(search)) url.searchParams.set(key, value)
    url.hash = ''
    window.location.assign(url.href)
    return
  }
  const bytes = await readSavedDemo(demo.url)
  if (!bytes) {
    reportError("Couldn't open this demo", "It's no longer saved in this browser. Open the file again.")
    return
  }
  // Whatever demo link was in the address bar isn't the one showing any more.
  const url = new URL(window.location.href)
  for (const param of ['demo', 'demoUrl', 'live', 'tick']) url.searchParams.delete(param)
  window.history.replaceState(window.history.state, '', url.href)
  openDemoBytesAction(bytes, demo.url, tick)
}

export const openStorageSettings = () => {
  setSettingsTabAction('storage')
  toggleOnlyUIPanelAction(UIPanelType.SETTINGS)
}

/** A saved demo's download and delete buttons. */
export const DemoActions = ({ demo }: { demo: SavedDemo }) => (
  <>
    <button
      type="button"
      className="ui-icon-btn"
      aria-label={`Download ${demo.name}`}
      title="Download the .dem file"
      onClick={event => {
        event.stopPropagation()
        downloadSavedDemo(demo)
      }}
    >
      <DownloadIcon className="h-3.5 w-3.5" />
    </button>
    <DeleteButton label={`Delete ${demo.name}`} onClick={() => deleteDemo(demo.url)} />
  </>
)

export const DeleteButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    className="ui-icon-btn"
    aria-label={label}
    title={label}
    onClick={event => {
      event.stopPropagation()
      onClick()
    }}
  >
    <FaTrashIcon className="h-3 w-3" />
  </button>
)

//
// ─── SETTINGS → STORAGE ─────────────────────────────────────────────────────────
// A bar of what takes the room, then a card per demo (led by its map) and a tile per map.
//

export const StorageTab = () => {
  const { maps, demos } = useSavedDownloads()

  if (!storageAvailable()) {
    return (
      <div className="ui-empty-note">
        This browser can't save downloads for this site (it needs a secure https page), so maps and
        demos download each time.
      </div>
    )
  }

  const demoBytes = demos.reduce((sum, demo) => sum + demo.bytes, 0)
  const mapBytes = maps.reduce((sum, map) => sum + map.bytes, 0)
  const total = demoBytes + mapBytes

  return (
    <div className="flex flex-col gap-4">
      <div className="ui-card flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[22px] font-bold tabular-nums">{formatBytes(total)}</span>
          <span className="ui-muted text-[12px]">used by dribble.tf in this browser</span>
        </div>
        <div className="ui-meter" aria-hidden>
          <span className="ui-meter__demos" style={{ flexGrow: demoBytes || 0.0001 }} />
          <span className="ui-meter__maps" style={{ flexGrow: mapBytes || 0.0001 }} />
        </div>
        <div className="flex gap-4 text-[12px]">
          <span className="flex items-center gap-1.5">
            <i className="ui-meter__key ui-meter__demos" /> Demos {formatBytes(demoBytes)}
          </span>
          <span className="flex items-center gap-1.5">
            <i className="ui-meter__key ui-meter__maps" /> Maps {formatBytes(mapBytes)}
          </span>
        </div>
      </div>

      <section>
        <div className="ui-section-title !mt-0">Demos</div>
        <p className="ui-storage__note mb-2">
          The {KEEP_DEMOS} most recently opened are kept; opening another removes the oldest.
        </p>
        {demos.length === 0 ? (
          <div className="ui-empty-note">Demos you open show up here.</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {demos.map(demo => (
              <DemoCard key={demo.url} demo={demo} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="ui-section-title !mt-0">Maps</div>
        {maps.length === 0 ? (
          <div className="ui-empty-note">Maps you open show up here.</div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {maps.map(map => (
              <MapTile key={map.name} map={map} />
            ))}
          </div>
        )}
      </section>

      {total > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            className="ui-btn ui-btn--danger ui-btn--small"
            onClick={() => {
              if (window.confirm('Delete every saved map and demo? They download again next time you open them.'))
                clearAllStorage()
            }}
          >
            Delete everything
          </button>
        </div>
      )}
    </div>
  )
}

const DemoCard = ({ demo }: { demo: SavedDemo }) => (
  <div className="ui-storage-card" onClick={() => openSavedDemo(demo, resumeTick(demo))}>
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-[13.5px] font-semibold">{demo.map ?? demo.name}</span>
      <span className="ui-storage__detail truncate">
        {demo.map ? `${demo.name} · ` : ''}
        {formatBytes(demo.bytes)} · {formatAgo(demo.lastOpened)}
      </span>
    </div>
    <DemoActions demo={demo} />
  </div>
)

const MapTile = ({ map }: { map: SavedMap }) => (
  <div className="ui-storage-card !py-1.5" onClick={() => loadEmptySceneMapAction(map.name)}>
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-[12.5px]">{map.name}</span>
      <span className="ui-storage__detail">{formatBytes(map.bytes)}</span>
    </div>
    <DeleteButton label={`Delete ${map.name}`} onClick={() => deleteMap(map.name)} />
  </div>
)

//
// ─── RECENTS (About panel) ──────────────────────────────────────────────────────
// A card per saved demo, newest first: a block with the score (BLU first, as the score HUD has
// it) over the length; the map and when, the file, and how far it was watched beside it. A card
// opens its match where it was left, if left partway.
//

export const RecentsList = () => {
  const { demos } = useSavedDownloads()
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {demos.map(demo => (
        <RecentCard key={demo.url} demo={demo} />
      ))}
    </div>
  )
}

const RecentCard = ({ demo }: { demo: SavedDemo }) => (
  <button type="button" className="ui-recent" onClick={() => openSavedDemo(demo, resumeTick(demo))}>
    <span
      className="ui-recent__block"
      aria-label={demo.score ? `BLU ${demo.score.blue}, RED ${demo.score.red}` : undefined}
    >
      {demo.score ? (
        <span className="ui-recent__score">
          <b data-team="blue">{demo.score.blue}</b>
          <span className="ui-recent__colon">:</span>
          <b data-team="red">{demo.score.red}</b>
        </span>
      ) : (
        <span className="ui-recent__quiet">–</span>
      )}
      {!!demo.duration && <span className="ui-recent__len">{formatDuration(demo.duration)}</span>}
    </span>
    <span className="ui-recent__body">
      <span className="ui-recent__row">
        <span className="ui-recent__map">{demo.map ?? 'Unknown map'}</span>
        <span className="ui-recent__quiet">{formatAgo(demo.lastOpened)}</span>
      </span>
      <span className="ui-recent__file">{demo.name}</span>
      {!!demo.progress && (
        <span className="ui-recent__progress" aria-hidden>
          <span style={{ width: `${Math.round(demo.progress * 100)}%` }} />
        </span>
      )}
    </span>
  </button>
)
