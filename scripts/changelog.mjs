#!/usr/bin/env node
// The in-app changelog's helper (changelog/README.md).
//
//   npm run changelog -- new "Title" [--type new|improved|fixed] [--pr 92] [--highlight]
//       Adds changelog/<today>-<slug>.md, with this branch's commits as notes to rewrite.
//   npm run changelog -- missing [--base origin/dev]
//       Lists merged PRs that no entry names (by `pr:`) and changelog/.skip doesn't excuse,
//       from the oldest entry on. Run it before an update post, or to backfill.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(import.meta.dirname, '..', 'changelog')
const TYPES = ['new', 'improved', 'fixed']

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const [command, ...rest] = process.argv.slice(2)
const flags = {}
const positional = []
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith('--')) positional.push(rest[i])
  else if (rest[i + 1] && !rest[i + 1].startsWith('--')) flags[rest[i].slice(2)] = rest[++i]
  else flags[rest[i].slice(2)] = true
}

const entries = () =>
  readdirSync(DIR)
    .filter(file => file.endsWith('.md') && file !== 'README.md')
    .map(file => {
      const text = readFileSync(join(DIR, file), 'utf8')
      const meta = Object.fromEntries(
        (text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '')
          .split('\n')
          .map(line => [line.slice(0, line.indexOf(':')).trim(), line.slice(line.indexOf(':') + 1).trim()])
      )
      return { file, meta, prs: (meta.pr ?? '').split(/[,\s]+/).map(Number).filter(Boolean) }
    })

if (command === 'new') {
  const title = positional.join(' ').trim()
  if (!title) {
    console.error('Usage: npm run changelog -- new "Title" [--type <type>] [--pr <n>] [--highlight]')
    process.exit(1)
  }
  const type = flags.type ?? 'new'
  if (!TYPES.includes(type)) {
    console.error(`--type must be one of: ${TYPES.join(', ')}`)
    process.exit(1)
  }
  const date = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD, local
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
  const file = join(DIR, `${date}-${slug}.md`)
  if (existsSync(file)) {
    console.error(`Already exists: ${file}`)
    process.exit(1)
  }
  const base = flags.base ?? 'origin/dev'
  let commits = ''
  try {
    commits = git('log', `${base}..HEAD`, '--no-merges', '--format=- %s')
  } catch {}
  const front = [`date: ${date}`, `title: ${title}`, `type: ${type}`]
  if (flags.pr) front.push(`pr: ${flags.pr}`)
  if (flags.highlight) front.push('highlight: true')
  const notes = commits
    ? `\n<!-- This branch's commits, to rewrite as one or two sentences for players (then delete):\n${commits}\n-->\n`
    : ''
  writeFileSync(file, `---\n${front.join('\n')}\n---\n\nWhat changed, for someone watching demos.\n${notes}`)
  console.log(`Wrote ${file}`)
} else if (command === 'missing') {
  const all = entries()
  const covered = new Set(all.flatMap(entry => entry.prs))
  const skipFile = join(DIR, '.skip')
  if (existsSync(skipFile)) {
    for (const line of readFileSync(skipFile, 'utf8').split('\n')) {
      const pr = Number(line.split('#')[0].trim())
      if (pr) covered.add(pr)
    }
  }
  const since = all.map(entry => entry.meta.date).sort()[0] ?? '1970-01-01'
  const base = flags.base ?? 'origin/dev'
  const log = git('log', base, '--merges', `--since=${since}T00:00`, '--date=short', '--format=%x1e%ad%x1f%s%x1f%b')
  const missing = log
    .split('\x1e')
    .filter(Boolean)
    .map(record => {
      const [date, subject, body] = record.split('\x1f')
      const pr = Number(subject.match(/^Merge pull request #(\d+)/)?.[1])
      return { date, pr, title: body.trim().split('\n')[0] || subject }
    })
    .filter(({ pr }) => pr && !covered.has(pr))
  if (!missing.length) {
    console.log(`Every PR merged into ${base} since ${since} has an entry (or is in changelog/.skip).`)
  } else {
    console.log(`PRs merged into ${base} since ${since} with no changelog entry:\n`)
    for (const { date, pr, title } of missing) console.log(`  #${pr}  ${date}  ${title}`)
    console.log('\nAdd one with `npm run changelog -- new "..." --pr <n>`, or list it in changelog/.skip if players won\'t notice it.')
  }
} else {
  console.log(readFileSync(import.meta.filename, 'utf8').split('\n').slice(1, 9).join('\n').replace(/^\/\/ ?/gm, ''))
}
