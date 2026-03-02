# AGENTS.md — Operational Details for AI Agents

## Build & Dev

- **Package manager**: npm (`yarn` not installed; use `npm run build`, `npm run dev`)
- **Build**: `npm run build` — completes in ~10s
- **Type check**: `npx tsc --noEmit` — note: has pre-existing TS errors (uninitialized properties in AsyncParser, unused React imports)
- **Dev server**: `npm run dev` (Vite)
- **Converter config precedence**: `scripts/convert-config.json` overrides `scripts/convert-map.mjs` defaults when present, so map-conversion verification should pass explicit CLI flags or update the config if testing a changed default such as `chunk-grid`
- **WASM support**: Vite 5 handles `.wasm` via `new URL('./file.wasm', import.meta.url)` natively — no `vite-plugin-wasm` or `vite-plugin-top-level-await` needed; wasm-bindgen's JS glue uses this pattern and has its own MIME-type fallback
- **Framework**: React + Three.js (react-three-fiber) + Zustand + Tailwind

## Project Structure

- `src/utils/parser.ts` — Duration/tick utilities
- `src/components/Analyse/Data/` — Demo parsing (ParseWorker, AsyncParser, PlayerCache, ProjectileCache)
- `src/components/Scene/` — 3D scene rendering (World, Actors, Projectiles, Skybox, Lights)
- `src/components/DemoViewer.tsx` — Main playback engine
- `src/components/UI/` — UI panels (PlaybackPanel, SettingsPanel)
- `src/zustand/store.ts` — Global state store
- `public/models/players/` — Player model GLB files

## Git

- Remotes: `origin` (bryjch/dribble.tf), `tf2jump` (Hona/dribble.tf)
- Reference branch for perf work: `tf2jump/dev`
