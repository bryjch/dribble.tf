Match Killfeed Panel

Context

The existing killfeed (Killfeed.tsx) only shows kills within a 200-tick window of the current
playback position. Users need a way to see ALL kills in the entire match to quickly locate
specific moments — especially kills by/against a particular player. This panel provides a
searchable, scrollable list of every kill event with timestamps for instant seeking.

Files to Create

1. src/utils/matchEvents.ts — Event extraction utilities

- getAllKills(parser): Flattens parser.deaths (keyed by tick) into a sorted MatchKillEvent[]
array
- getUberPops(parser): Scans parser.playerCache.uberCache for medics (classId 5) whose charge
drops from ~100 to a lower value. Returns MatchUberEvent[] with medic identity and tick
- Types: MatchKillEvent, MatchUberEvent, MatchEvent (union)

2. src/components/UI/MatchKillfeedPanel.tsx — Main panel component

Structure:
MatchKillfeedPanel
  TogglePanelButton (list icon)
  TogglePanel (slide-in, following SettingsPanel/AboutPanel pattern)
    Header: "Match Killfeed"
    Filter input (text, filters by player name across killer/victim/assister)
    "Uber pops" checkbox toggle
    Event count indicator
    Scrollable list of MatchEventRow items
      Kill rows: timestamp | killer [+assister] | weapon icon | victim
      Uber rows: timestamp | medic name | "popped uber"

- Clicking any row calls goToTickAction(tick) to seek playback
- Kill rendering reuses weapon icon pattern from existing KillfeedItem (kill icon aliases, team
colors, fallback skull icon)
- All events computed via useMemo (keyed on parser + showUberPops), filtering via useMemo
(keyed on events + filterText)

Files to Modify

3. src/constants/types.ts — Add panel type

Add MATCH_KILLFEED: 'MatchKillfeed' to the UIPanelType const. The existing toggleUIPanelAction
and reducer cases work generically with any UIPanelType value.

4. src/components/DemoViewer.tsx — Wire panel into UI

- Import MatchKillfeedPanel
- Add a new ui-layer div below the AboutPanel layer, guarded by {demo && ...} since the data
depends on a loaded demo
- Position: left side, below the existing About button (mt-28 roughly — will tune visually)

Key Patterns to Reuse

- TogglePanelButton + TogglePanel from src/components/UI/Shared/TogglePanel.tsx
- toggleUIPanelAction from src/zustand/actions.ts for panel open/close state
- KillfeedItem weapon icon pattern from src/components/UI/Killfeed.tsx (icon aliases, team
color classes, error fallback)
- getDurationFromTicks() from src/utils/parser.ts for timestamp formatting
- goToTickAction() from src/zustand/actions.ts for seeking
- useInstance(state => state.parsedDemo) to access the parser
- useStore(state => state.ui.activePanels) for panel visibility

Uber Pop Detection

ChargeLevel data is sampled every 16 ticks (~0.24s) via SparseDataCache. We detect a "pop" when
a medic's charge drops from >=95 to <50 between consecutive samples. This gives ~0.24s
accuracy, which is sufficient for seeking purposes.

Verification

1. Load a demo file and confirm the panel toggle button appears on the left side
2. Open the panel — verify all kills are listed with correct timestamps, names, weapon icons,
and team colors
3. Type a player name in the filter — verify the list filters to kills involving that player
4. Click a row — verify playback seeks to that tick
5. Toggle "Uber pops" — verify uber events appear/disappear from the list
6. Confirm no performance issues with the scrollable list
