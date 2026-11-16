import { useEffect, useState, useSyncExternalStore } from 'react'

import {
  CHANGELOG,
  ChangelogEntry,
  ChangelogType,
  TYPE_LABELS,
  formatChangelogDate,
} from '@utils/changelog'

//
// ─── CHANGELOG ──────────────────────────────────────────────────────────────────
//
// The About panel's Changelog tab: one line per change, newest first, its type (new, improved,
// fixed) as an icon on a tile in the type's colour, opened for the detail.
// Entries come from /changelog (see changelog/README.md). Changes this browser hasn't seen get
// a dot, on their row and on the tab, until the tab is opened.
//

const GITHUB_PR_URL = 'https://github.com/bryjch/dribble.tf/pull/'

//
// ─── SEEN ───────────────────────────────────────────────────────────────────────
// The ids of the entries this browser has seen, in localStorage. Storage can be missing or
// blocked (private windows), in which case every visit starts with nothing seen.
//

const STORAGE_KEY = 'dribble.changelog.seen'

const readSeen = (): Set<string> => {
  try {
    const ids = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(ids) ? ids : [])
  } catch {
    return new Set()
  }
}

let seen = readSeen()
const listeners = new Set<() => void>()

const markAllSeen = () => {
  if (CHANGELOG.every(entry => seen.has(entry.id))) return
  // Only ids still in the changelog, so the list doesn't grow with deleted entries.
  seen = new Set(CHANGELOG.map(entry => entry.id))
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]))
  } catch {}
  listeners.forEach(listener => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Whether any change hasn't been seen yet: the dot on the Changelog tab. */
export const useHasUnseenChanges = () =>
  useSyncExternalStore(subscribe, () => CHANGELOG.some(entry => !seen.has(entry.id)))

//
// ─── LIST ───────────────────────────────────────────────────────────────────────
//

// The types' icons, 16-unit boxes drawn at 12px on the tile.
const TYPE_ICONS: Record<ChangelogType, JSX.Element> = {
  new: (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 1.5c.3 2.9 1.6 4.2 4.5 4.5-2.9.3-4.2 1.6-4.5 4.5C7.7 7.6 6.4 6.3 3.5 6 6.4 5.7 7.7 4.4 8 1.5Z" />
      <path d="M12.5 9.5c.15 1.4.8 2.05 2.2 2.2-1.4.15-2.05.8-2.2 2.2-.15-1.4-.8-2.05-2.2-2.2 1.4-.15 2.05-.8 2.2-2.2Z" />
    </svg>
  ),
  improved: (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" />
    </svg>
  ),
  fixed: (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.2 2.3a3.3 3.3 0 0 0-3.9 4.4L2.6 10.4a1.4 1.4 0 0 0 2 2l3.7-3.7a3.3 3.3 0 0 0 4.4-3.9l-2 2-1.9-.5-.5-1.9 1.9-2.1Z" />
    </svg>
  ),
}

const Chevron = () => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const ChangelogRow = ({ entry, unseen }: { entry: ChangelogEntry; unseen: boolean }) => {
  const [open, setOpen] = useState(false)
  const detailId = `changelog-${entry.id}`

  return (
    <li className="ui-changelog__row" data-type={entry.type} data-open={open}>
      <button
        type="button"
        className="ui-changelog__toggle"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen(!open)}
      >
        <span className="ui-changelog__tile" data-unseen={unseen} title={TYPE_LABELS[entry.type]}>
          {TYPE_ICONS[entry.type]}
          <span className="sr-only">
            {TYPE_LABELS[entry.type]}
            {unseen && ', not seen yet'}:
          </span>
        </span>
        <span className="ui-changelog__title">{entry.title}</span>
        <time className="ui-changelog__date" dateTime={entry.date}>
          {formatChangelogDate(entry.date, false)}
        </time>
        <span className="ui-changelog__chevron">
          <Chevron />
        </span>
      </button>
      {open && (
        <div id={detailId} className="ui-changelog__detail">
          <p>{entry.body}</p>
          <div className="ui-changelog__meta">
            <span className="ui-changelog__type">{TYPE_LABELS[entry.type]}</span>
            {entry.prs.map(pr => (
              <a
                key={pr}
                href={`${GITHUB_PR_URL}${pr}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ui-link"
              >
                #{pr}
              </a>
            ))}
          </div>
        </div>
      )}
    </li>
  )
}

/** Opening it marks everything seen; the rows keep their dots until it closes. */
export const ChangelogList = () => {
  const [unseen] = useState(() => new Set(CHANGELOG.filter(e => !seen.has(e.id)).map(e => e.id)))
  useEffect(markAllSeen, [])

  if (!CHANGELOG.length) return <p className="ui-changelog__empty">Nothing here yet.</p>

  return (
    <ul className="ui-changelog">
      {CHANGELOG.map(entry => (
        <ChangelogRow key={entry.id} entry={entry} unseen={unseen.has(entry.id)} />
      ))}
    </ul>
  )
}
