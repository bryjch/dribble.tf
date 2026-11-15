# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: competitive TF2 players (6s / Highlander) reviewing their own matches tick by tick, and the coaches and analysts studying positioning, setups and fights with them. They know the game's HUD, the class icons and team colours by heart, and many run custom HUDs in-game. Secondary: people following a shared demos.tf link or a live stv.tf match.

## Product Purpose

dribble.tf replays a TF2 match in the browser in full 3D on a rebuilt map: every player, projectile, building and objective, tick by tick, from a SourceTV demo or a live stv.tf stream. Success is a reviewer finding the moment that matters, seeing it from the right angle, and marking or sharing it, without the interface getting between them and the scene.

## Positioning

A 3D, free-camera replay of a real match in a browser tab, with no TF2 install, no game client and no recording step. Demos open from disk, from a demos.tf link, or live from stv.tf.

## Operating Context

Long sessions over a 3D scene that fills the window; the UI floats over that scene, so every panel competes with busy map geometry and sky. Reviewers scrub, step tick by tick, change camera modes (spectator, POV, RTS), bookmark moments, draw and place stickers, save and share camera setups. Keyboard-heavy use on desktop; touch is supported but secondary.

## Capabilities and Constraints

- Match HUD: player status lists per team (class, health, overheal, weapon, conditions, über charge), killfeed, objective and round state, chat, focused player.
- Playback: play/pause, tick stepping, seek, speed, rounds, bookmarks, live edge for live matches, jump to tick.
- Panels: settings, about, setups, bookmarks, match killfeed; drawing and sticker tools.
- Stack: React + Tailwind + framer-motion over react-three-fiber. Overlays sit above drei Html nameplates via the `.ui-layer` z-index scheme.
- Theming is a design goal: the UI should be built from shared tokens and primitives so alternative looks can be swapped without rewriting components.

## Brand Commitments

- Team identity is RED and BLU; team colour must always be unambiguous.
- Terminology in CONTEXT.md (Match, Demo, Live match, Objective, Round state) is binding for UI copy.

## Product Principles

1. The scene is the product; the UI earns every pixel it covers.
2. Read at a glance mid-scrub: health, team, class and time never need a second look.
3. Speak the game's language: class icons, team colours and conventions players already know.
4. Precision over flourish for tools reviewers use for hours.
