# AGENTS.md — Operational Details for AI Agents

## Build & Dev

- **Package manager**: npm (`yarn` not installed; use `npm run build`, `npm run dev`)
- **Build**: `npm run build` — completes in ~10s
- **Type check**: `npx tsc --noEmit` — note: has pre-existing TS errors (uninitialized properties in AsyncParser, unused React imports)
- **Dev server**: `npm run dev` (Vite)
- **Converter config precedence**: `scripts/convert-config.json` overrides `scripts/convert-map.mjs` defaults when present, so map-conversion verification should pass explicit CLI flags or update the config if testing a changed default such as `chunk-grid`
- **Converter validation reruns**: pass `--chunk-grid 8` explicitly while `scripts/convert-config.json` still pins `chunk-grid=4`; `--skip-material-truth true` skips the slow VPK material scan when validating chunking/visibility output
- **Converter resume path**: `node scripts/convert-map.mjs ... --metadata-only true` reuses the temp BSP/VMF/GLBs/lightmaps to finish skybox, teleports, visibility, and `conversion.json` after a late-stage failure; skybox conversion still needs `vtf2img` importable from the `python3` on `PATH`
- **Headless browser validation**: Chrome remote debugging currently needs both `--user-data-dir=<tmp>` and `--remote-allow-origins=*`, and WebGL-backed validation in headless mode needed `--use-angle=swiftshader --enable-unsafe-swiftshader --enable-webgl --ignore-gpu-blocklist`; runtime perf logs are enabled with `?perf=true`
- **WASM support**: Vite 5 handles `.wasm` via `new URL('./file.wasm', import.meta.url)` natively — no `vite-plugin-wasm` or `vite-plugin-top-level-await` needed; wasm-bindgen's JS glue uses this pattern and has its own MIME-type fallback
- **Demo decoder**: `decoder/` is a small Rust crate around stvtf (pinned by git rev in `decoder/Cargo.toml`); `npm run build:decoder` rebuilds `src/libs/decoder/decoder.wasm`, which is committed so `npm run build` needs no Rust. rustup installs the toolchain pinned in `decoder/rust-toolchain.toml`.
- **Render/perf check**: `npm run build && npx vite preview --port 4173`, then `node scripts/render-check.mjs run --url http://localhost:4173 --out bench/<name> --scenarios docs/adr/0005/scenarios.json` and `node scripts/render-check.mjs compare bench/<a> bench/<b>`; it drives `?bench` (`src/utils/bench.ts`) in headless Chrome on the real GPU. Single runs are noisy: compare builds served side by side, alternated, several times (`--perf-only true` skips screenshots and memory; `--uncapped true` turns off vsync so GPU cost shows in fps; `--settings '{"ui.playerOutlines":true}'` measures with settings on). `renderer.info` is per frame only if extra passes set `gl.info.autoReset = false`: the bench waits on its triangle count. See docs/adr/0005
- **Decoder format**: `decoder/src/lib.rs` `FORMAT` and `ParseWorker.ts` `DECODER_FORMAT` must match; bump both when the arrays or metadata change
- **Map models**: meshopt FILTER via `scripts/meshopt-map.mjs` (a converter step); not the gltf-transform CLI's `meshopt`, whose quantization misplaces instanced props
- **Viewmodels**: `npm run build:viewmodels` builds first-person arms, their animations and every weapon from TF2's VPKs (`game-dir`/`hl2-dir` in `scripts/convert-config.json`; on macOS the content comes from DepotDownloader, not Steam) into `public/models/viewmodels/` plus `manifest.json` (item definition index → model + animation slot per class). It clones and builds a pinned `bsp-to-glb` into `scripts/tools/bsp-to-glb` (needs Rust) and converts textures with Python `vtf2img` + Pillow; unchanged models are skipped (`--force` rebuilds, `--classes`/`--items` build a subset). A full build from scratch takes ~8 min, a rebuild with cached textures ~2 min. Known gap: the Ubersaw/Vita-Saw models fail in bsp-to-glb ("sequence layer start is not finite"). Viewmodels use gltf-transform's `meshopt` (with quantization), which is safe for them: unlike map props they have no instancing
- **Model assets wizard**: `npm run assets` (`scripts/assets-wizard.sh`) is the human path for TF2 files → viewmodel rebuild → S3 upload → CloudFront invalidation; it saves `ASSET_AWS_PROFILE`, `ASSET_S3_BUCKET`, `ASSET_S3_ORIGIN_PATH`, `ASSET_S3_REGION`, `ASSET_CLOUDFRONT_DISTRIBUTION_ID` and `TF2_STEAM_USERNAME` to the main checkout's `.env`. Production loads `/models/...` from `VITE_APP_ASSET_URL` (CloudFront → S3), so new or changed files in `public/models` need uploading. The library above its STAGES marker comes from the /wizard skill template; edit only the stages
- **Framework**: React + Three.js (react-three-fiber) + Zustand + Tailwind

## Project Structure

- `src/utils/parser.ts` — Duration/tick utilities
- `src/components/Analyse/Data/` — Match sources (MatchSource, DemoSource + ParseWorker, LiveSource) and the decoder's arrays (PlayerTracks, ProjectileCache, BuildingCache, ObjectiveTimeline)
- `src/components/Scene/` — 3D scene rendering (World, Actors, Projectiles, Skybox, Lights)
- `src/components/DemoViewer.tsx` — The viewer; playback runs in `Scene/PlaybackDriver.tsx` + `utils/playback.ts`
- `src/components/UI/` — UI panels (PlaybackPanel, SettingsPanel)
- `src/zustand/store.ts` — Global state store
- `public/models/players/` — Player model GLB files

## Git

- Remotes: `origin` (bryjch/dribble.tf), `tf2jump` (Hona/dribble.tf)
- Reference branch for perf work: `tf2jump/dev`
