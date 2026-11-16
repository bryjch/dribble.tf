//
// ─── KEYBOARD SHORTCUTS ─────────────────────────────────────────────────────────
//
// Every key the viewer answers to, as Settings → Keys lists them (? opens it). The handlers
// are CanvasKeyHandler (with the scene focused), GlobalKeyHandler (anywhere but a text field),
// and the cameras themselves (RtsControls, SpectatorControls); keep this in step with them.
//

export interface Shortcut {
  /** Each entry is one key or chord, shown as its own <kbd>. */
  keys: string[]
  label: string
}

export const SHORTCUTS: { group: string; items: Shortcut[] }[] = [
  {
    group: 'Playback',
    items: [
      { keys: ['Space'], label: 'Play / pause' },
      { keys: ['←', '→'], label: 'Seek back / forward' },
      { keys: [',', '.'], label: 'Step one tick' },
      { keys: ['↓', '↑'], label: 'Slower / faster' },
      { keys: ['B'], label: 'Bookmark' },
      { keys: ['Tab'], label: 'Scoreboard (hold)' },
    ],
  },
  {
    group: 'Camera',
    items: [
      { keys: ['1', 'Shift + 1'], label: 'POV: next / previous player' },
      { keys: ['2'], label: 'Free camera' },
      { keys: ['3'], label: 'Orbit camera' },
      { keys: ['W', 'A', 'S', 'D'], label: 'Move' },
      { keys: ['Q', 'E'], label: 'Turn (orbit)' },
      { keys: ['E', 'C'], label: 'Up / down (free)' },
      { keys: ['Shift'], label: 'Move faster' },
      { keys: ['R'], label: 'Reset orbit camera' },
    ],
  },
  {
    group: 'View',
    items: [
      { keys: ['P'], label: 'Player rails: full, compact, hidden' },
      { keys: ['H'], label: 'Hide the whole HUD (H or Esc brings it back)' },
      { keys: ['O'], label: 'Outlines' },
      { keys: ['N'], label: 'Nameplates' },
      { keys: ['M'], label: 'Cycle map material' },
      { keys: ['L'], label: 'Lighting: baked / flat' },
      { keys: ['V'], label: 'Weapon in POV' },
      { keys: ['X'], label: 'Crosshair' },
      { keys: ['I'], label: 'Match events sidebar' },
      { keys: ['T'], label: 'Chat' },
      { keys: ['?'], label: 'These shortcuts' },
    ],
  },
  {
    group: 'Drawing',
    items: [
      { keys: ['F'], label: 'Draw' },
      { keys: ['G'], label: 'Stickers' },
      { keys: ['C'], label: 'Clear' },
      { keys: ['Z', 'Shift + Z'], label: 'Undo / redo' },
      { keys: ['Delete'], label: 'Delete selected sticker' },
      { keys: ['Esc'], label: 'Close / back' },
    ],
  },
]
