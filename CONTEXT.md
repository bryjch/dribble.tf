# dribble.tf

A 3D viewer for TF2 matches: it replays what every player did, tick by tick, on a rebuilt map.

## Language

**Match**:
What a viewer watches: one map's play, from a demo or a live match.
_Avoid_: game, demo (when either source is meant)

**Demo**:
A `.dem` file recorded by SourceTV, opened from disk or a URL; its whole length is known up front.
_Avoid_: replay, recording

**Live match**:
A match still being played, watched through an stv.tf event stream; it grows while it is watched.
_Avoid_: live demo, stream (for the match itself)

**Match source**:
Whatever answers "what was the state at tick N" for a match, whether it was read from a demo or is fed by a live match.
_Avoid_: parser (a match source need not parse anything)

**Tick**:
One step of the game's simulation, 66.67 a second; a match's ticks start at 1.

## Relationships

- A **Match** comes from exactly one **Match source**
- A **Demo** and a **Live match** are the two kinds of **Match source** today

## Flagged ambiguities

- "demo" was used for any match, live or not (`DemoViewer`, `demo_type: 'stv.tf'`): resolved — **Demo** means the `.dem` file only; the thing watched is a **Match**.
