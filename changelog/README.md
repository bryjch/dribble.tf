# Changelog

What the About panel's Changelog tab shows. One file per user-facing change, bundled at build
time by `src/utils/changelog.ts`: adding a file is all it takes, and parallel branches never
conflict over a shared list.

Entries are per change, not per PR: a PR that brings several changes players would notice gets
an entry for each (all naming the PR), so each reads as one thing.

```md
---
date: 2026-11-16
title: Orbit camera
type: improved
pr: 90
highlight: true
---

Drag to pan, scroll to zoom toward the cursor, Q and E to turn, R to reset, double-click to centre.
```

- **File name**: `YYYY-MM-DD-slug.md`, the day it shipped (merged into `dev`). Don't rename a
  shipped entry's file: the tab's "new" dot tracks entries by it.
- **title**: one to three words naming the feature, like a menu label: `Theming`,
  `Enhanced outlines`, `Damage numbers`. No sentence, no selling.
- **type**: `new` (something you couldn't do before), `improved` (something that works better,
  looks better or runs faster) or `fixed` (something that was broken). The list shows it as an icon.
- **pr**: the PR number, or several (`82, 89`). `missing` uses it to tell which PRs are covered.
- **highlight**: `true` for the changes worth leading with; leave it out otherwise.
- **Body**: one or two short, plain sentences for players: what it does and where to find it
  (name the setting or key). State it; don't sell it (no "now", "a real", "that don't cost",
  exclamation). No implementation detail.

## Commands

```bash
npm run changelog -- new "Orbit camera" --type improved --pr 90 --highlight
npm run changelog -- missing
```

`new` writes the file with today's date and this branch's commits as notes to rewrite. `missing`
lists merged PRs, from the oldest entry on, that no entry names; list PRs players won't notice
(tooling, docs, refactors) in `.skip`, one number per line with a `# reason`.
