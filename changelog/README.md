# Changelog

What the About panel's Changelog tab shows. One file per user-facing change, bundled at build
time by `src/utils/changelog.ts`: adding a file is all it takes, and parallel branches never
conflict over a shared list.

```md
---
date: 2026-11-16
title: Reworked orbit camera
type: improved
pr: 90
highlight: true
---

One or two sentences for someone watching demos: what they can now do or see.
```

- **File name**: `YYYY-MM-DD-slug.md`, the day it shipped (merged into `dev`).
- **type**: `new` (something you couldn't do before), `improved` (something that works better,
  looks better or runs faster) or `fixed` (something that was broken). The list shows it as an icon.
- **pr**: the PR number, or several (`82, 89`). `missing` uses it to tell which PRs are covered.
- **highlight**: `true` for the changes worth leading with; leave it out otherwise.
- **Body**: plain text, written for players, not developers. Name the setting or key if there
  is one. No implementation detail.

## Commands

```bash
npm run changelog -- new "Reworked orbit camera" --type improved --pr 90 --highlight
npm run changelog -- missing
```

`new` writes the file with today's date and this branch's commits as notes to rewrite. `missing`
lists merged PRs, from the oldest entry on, that no entry names; list PRs players won't notice
(tooling, docs, refactors) in `.skip`, one number per line with a `# reason`.
