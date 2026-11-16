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

**World coordinates**:
Where something is in a match, as the game itself places it (Source units, z up); the scene is drawn in them.
_Avoid_: scene coordinates, relative positions, boundaryMin-relative

**Objective**:
What a game mode makes teams fight over: a control point, a payload cart, or an intelligence flag.
_Avoid_: point (for a cart or flag), intel (for any objective)

**Round state**:
Where the current round stands: setup, running, won or stalemated, with its timers, the rounds won and the stopwatch.
_Avoid_: game state, match state

### Maps

How dribble.tf identifies the map needed to present a match when several compiled versions may share a name, and how it gets a renderer-ready copy of that map.

**Map Name**:
The map identifier recorded by a demo and used for catalog lookup. A Map Name does not necessarily identify one exact Map Build.
_Avoid_: Map identity

**Map Build**:
The exact compiled map content used for presentation. Different content under the same Map Name represents different Map Builds.
_Avoid_: Map, when exact content matters

**Map Catalog**:
A trusted collection that associates each Map Name with an available Map Build and identifies the current Canonical Build.
_Avoid_: Map list

**Map Source**:
The provenance and retrieval location from which a Map Build is acquired. A Map Source does not establish the identity of the retrieved content.
_Avoid_: Map Catalog

**Canonical Build**:
The Map Build selected automatically by the Map Catalog when the demo cannot identify exact content.
_Avoid_: Latest map


**Derived Map**:
A renderer-ready representation produced from one Map Build under a specific Conversion Profile.
_Avoid_: Precompiled map

**Built map**:
A Derived Map converted ahead of time by `scripts/maps/build-maps.mjs` and listed in `models/maps/index.json` on the asset host (ADR 0006). Maps without one fall back to their Blender-built GLB.
_Avoid_: Published Derived Map, Ad-hoc Derived Map (the parked in-browser plan)

**Conversion Profile**:
The declared quality and feature contract under which a Derived Map is produced.
_Avoid_: Converter settings

**Derived Map Manifest**:
A built map's `map.json`: its identity, how it was built, its bounds, lighting and sky, and its component files.
_Avoid_: Conversion metadata, conversion.json (the Blender-built maps' file)

**Shared prop model**:
A prop's model in one skin, built once and placed by every built map that uses it (`models/props/<hash>.glb`).
_Avoid_: Shared Asset Pack (the parked plan's per-resource store)

**Degraded Derived Map**:
A usable Derived Map whose world can be presented but whose optional assets have explicit unresolved or unsupported coverage.
_Avoid_: Failed map

**Asset Coverage**:
The explicit account of which requested map presentation assets were resolved, unsupported, or unavailable.
_Avoid_: Warnings

## Relationships

- A **Match** comes from exactly one **Match source**
- A **Demo** and a **Live match** are the two kinds of **Match source** today

## Flagged ambiguities

- "demo" was used for any match, live or not (`DemoViewer`, `demo_type: 'stv.tf'`): resolved — **Demo** means the `.dem` file only; the thing watched is a **Match**.
