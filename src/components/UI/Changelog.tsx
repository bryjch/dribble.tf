import { useEffect, useState, useSyncExternalStore } from 'react'

import { AREA_LABELS, CHANGELOG, ChangelogEntry, formatChangelogDate } from '@utils/changelog'

//
// ─── CHANGELOG ──────────────────────────────────────────────────────────────────
//
// The About panel's Changelog tab: one line per change, newest first, opened for the detail.
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

const Chevron = () => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const ChangelogRow = ({ entry, unseen }: { entry: ChangelogEntry; unseen: boolean }) => {
  const [open, setOpen] = useState(false)
  const detailId = `changelog-${entry.id}`

  return (
    <li className="ui-changelog__row" data-open={open}>
      <button
        type="button"
        className="ui-changelog__toggle"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen(!open)}
      >
        <span className="ui-changelog__dot" data-unseen={unseen}>
          {unseen && <span className="sr-only">New: </span>}
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
            <span className="ui-changelog__area">{AREA_LABELS[entry.area]}</span>
            <span>{formatChangelogDate(entry.date)}</span>
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
