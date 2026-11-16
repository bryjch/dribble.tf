//
// ─── CHANGELOG ──────────────────────────────────────────────────────────────────
//
// Every file in /changelog is one user-facing change (see changelog/README.md). Vite bundles
// them at build time, so adding a file is the whole job: nothing to register, and parallel
// branches never conflict over one shared list.
//

/** What kind of change it is: drawn as its icon in the list. */
export type ChangelogType = 'new' | 'improved' | 'fixed'

export interface ChangelogEntry {
  /** The file name without .md, e.g. 2026-11-16-orbit-camera. */
  id: string
  /** YYYY-MM-DD. */
  date: string
  title: string
  type: ChangelogType
  body: string
  prs: number[]
  /** Worth leading with: shown first, and in "what's new". */
  highlight: boolean
}

export const TYPE_LABELS: Record<ChangelogType, string> = {
  new: 'New',
  improved: 'Improved',
  fixed: 'Fixed',
}

const files = import.meta.glob('/changelog/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Just enough YAML for the front matter: `key: value` lines between `---` fences. */
const parse = (path: string, source: string): ChangelogEntry | null => {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return null
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  if (!meta.date || !meta.title) return null
  return {
    id: path.split('/').pop()!.replace(/\.md$/, ''),
    date: meta.date,
    title: meta.title,
    type: (meta.type as ChangelogType) in TYPE_LABELS ? (meta.type as ChangelogType) : 'improved',
    body: match[2].trim(),
    prs: (meta.pr ?? '')
      .split(/[,\s]+/)
      .map(Number)
      .filter(n => n > 0),
    highlight: meta.highlight === 'true',
  }
}

/** Newest first; highlights first within a day. */
export const CHANGELOG: ChangelogEntry[] = Object.entries(files)
  .filter(([path]) => !path.endsWith('/README.md'))
  .map(([path, source]) => parse(path, source))
  .filter((entry): entry is ChangelogEntry => !!entry)
  .sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      Number(b.highlight) - Number(a.highlight) ||
      a.title.localeCompare(b.title)
  )

/** Entries grouped by day, newest day first. */
export const CHANGELOG_BY_DAY: { date: string; entries: ChangelogEntry[] }[] = CHANGELOG.reduce(
  (days, entry) => {
    const day = days[days.length - 1]
    if (day?.date === entry.date) day.entries.push(entry)
    else days.push({ date: entry.date, entries: [entry] })
    return days
  },
  [] as { date: string; entries: ChangelogEntry[] }[]
)

/** "16 Nov 2026" (dates are calendar days, so no time zone shifts them). */
export const formatChangelogDate = (date: string, withYear = true) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  })
