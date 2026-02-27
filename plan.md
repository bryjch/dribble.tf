# Port Performance Improvements from tf2jump/dev

## Context

The `tf2jump` remote (`https://github.com/Hona/dribble.tf.git`) has a `dev` branch with 320 commits (57,704 insertions across 216 files). While most changes are TF2-jump-specific features, the branch contains significant general-purpose performance improvements to rendering, playback, parsing, and asset loading that would benefit the base dribble.tf project.

This backlog extracts only the performance improvements, ordered by dependency. Each task is small and isolated.

---

## Phase 0: Playback Timing Bug Fixes

Quick fixes for correctness bugs. Tasks 0.1 and 0.2 are **superseded by Phase 1** (parser2 outputs correct intervalPerTick natively) — but are listed here as immediate fixes if Phase 1 is deferred.

- [x] **0.1 — Fix tick rate calculation in parser utility**
  - File: `src/utils/parser.ts:1`
  - Change `tickRate = 66.67 / 2` to `tickRate = 66.67` in `getDurationFromTicks()` default param
  - The halved tick rate causes all duration displays to show 2x real duration
  - **Superseded by: 1.3** (parser2 provides correct intervalPerTick)

- [x] **0.2 — Remove intervalPerTick doubling in ParseWorker**
  - File: `src/components/Analyse/Data/ParseWorker.ts:33`
  - Change `parser.match.intervalPerTick * 2` to `parser.match.intervalPerTick`
  - The `* 2` was a workaround for the halved tick rate that's no longer needed after 0.1
  - **Depends on: 0.1** (must ship together)
  - **Superseded by: 1.3** (ParseWorker is fully rewritten)

- [ ] **0.3 — Use parsed intervalPerTick instead of hardcoded 0.03 in DemoViewer**
  - File: `src/components/DemoViewer.tsx:218`
  - Add `intervalPerTick: number` to `StoreState.playback` in `src/zustand/store.ts:89-95` (default: `0.015`)
  - Replace `const intervalPerTick = 0.03` with `const intervalPerTick = playback.intervalPerTick || 0.015`
  - Different demos can have different tick rates; hardcoding plays back at wrong speed
  - **Depends on: 0.1, 0.2** (or Phase 1 completion)

---

## Phase 1: Migrate to parser2 (Rust/WASM Parser)

Replace the JavaScript demo parser (`@bryjch/demo.js` + `Parser.ts`) with a pre-compiled Rust/WASM parser that is **10-100x faster** and outputs memory-efficient typed arrays. The WASM binary (~2.1MB) is already compiled — no Rust toolchain needed.

Source: `tf2jump/dev` branch, files under `src/libs/parser2/` and modifications to `AsyncParser.ts` + `ParseWorker.ts`.

- [ ] **1.1 — Copy parser2 WASM files into project**
  - Extract from `tf2jump/dev`: `src/libs/parser2/parser2.js`, `parser2.d.ts`, `parser2_bg.wasm`, `parser2_bg.wasm.d.ts`
  - Place in `src/libs/parser2/`
  - These are pre-built artifacts from https://github.com/Hona/parser (Rust fork of demostf/parser)
  - Verify Vite can bundle the WASM file (may need `vite-plugin-wasm` or `?url` import)

- [ ] **1.2 — Update Vite config for WASM support**
  - File: `vite.config.mts`
  - Ensure WASM files are handled correctly — may need to add `vite-plugin-wasm` and `vite-plugin-top-level-await`, or configure `optimizeDeps.exclude` for the parser2 module
  - Test that `import init, { parse_demo_cache_with_progress } from '@libs/parser2/parser2'` works in a worker context
  - **Depends on: 1.1**

- [ ] **1.3 — Rewrite ParseWorker to use parser2 WASM**
  - File: `src/components/Analyse/Data/ParseWorker.ts` (full rewrite)
  - Replace `Parser` JS class import with WASM: `import init, { parse_demo_cache_with_progress } from '@libs/parser2/parser2'`
  - Call `await init()` to initialize WASM module, then `parse_demo_cache_with_progress(new Uint8Array(buffer), progressCallback)`
  - The WASM function returns a structured object with typed arrays: `playerCache` (position/viewAngles/health/meta/connected as `Uint32Array`/`Uint16Array`/`Uint8Array`), `projectileCache`, `header`, `ticks`, `intervalPerTick`, `world`, `deaths`, `rounds`
  - Parser2 outputs correct `intervalPerTick` directly (no `* 2` hack needed)
  - Collect `performance.now()` timing around parse call for perf stats
  - Post result back with typed array buffers as transferables
  - **Depends on: 1.2**

- [ ] **1.4 — Update CachedDemo type and AsyncParser hydration**
  - File: `src/components/Analyse/Data/AsyncParser.ts`
  - Update `CachedDemo` interface to match parser2 output: typed arrays for player/projectile caches instead of JS objects
  - Update `getCachedData()` to hydrate WASM typed arrays into the existing `PlayerCache`/`ProjectileCache` format that the rest of the app expects
  - Key mapping: WASM `Uint32Array` position data → decode into `{x, y, z}` vectors using the encoding scheme (positions are packed as 3 floats per player per tick into Uint32Array via `f32.to_bits()`)
  - Add `ParserPerformanceStats` interface and populate from worker results
  - **Depends on: 1.3**

- [ ] **1.5 — Update PlayerCache and ProjectileCache for typed array storage**
  - Files: `src/components/Analyse/Data/PlayerCache.ts`, `src/components/Analyse/Data/ProjectileCache.ts`
  - Update cache classes to accept typed array data from parser2
  - Ensure `getPlayersAtTick(tick)` and `getProjectilesAtTick(tick)` decode from typed arrays on-the-fly, maintaining the same return type (`CachedPlayer[]`, `CachedProjectile[]`) for downstream consumers
  - This keeps DemoViewer, Actors, and Projectiles components working without changes
  - **Depends on: 1.4**

- [ ] **1.6 — Remove old JS parser dependency**
  - Delete `src/components/Analyse/Data/Parser.ts` (222 lines, old JS implementation)
  - Remove `@bryjch/demo.js` from `package.json` dependencies
  - Remove `src/libs/demo.js/` directory if present
  - Clean up any remaining imports referencing the old parser
  - Run `yarn install` to update lockfile
  - **Depends on: 1.5** (everything must work with parser2 before removing old parser)

---

## Phase 2: Playback Engine Improvements

- [ ] **2.1 — Multi-tick advance for high-speed playback**
  - File: `src/components/DemoViewer.tsx:223-228`
  - Replace single-tick advance with: `const ticksToAdvance = Math.floor(elapsedTime / millisPerTick)`
  - Call `goToTickAction(playback.tick + ticksToAdvance)` and carry remainder: `elapsedTime -= ticksToAdvance * millisPerTick`
  - Clamp frameProgress: `Math.min(elapsedTime / millisPerTick, 0.999)`
  - Without this, max effective speed is capped at ~1x because only 1 tick advances per frame
  - **Depends on: 0.3**

- [ ] **2.2 — Fix player-to-next-tick matching by entityId**
  - File: `src/components/DemoViewer.tsx:274-278`
  - Current code matches by array index: `playersNextTick[index]` — breaks when player order changes between ticks
  - Build a `Map` keyed by `player.user.entityId` for lookup: `const nextTickMap = new Map(playersNextTick.map(p => [p.user.entityId, p]))`
  - Use `nextTickMap.get(player.user.entityId)` instead of `playersNextTick[index]`
  - Index-based matching causes actors to interpolate toward wrong player positions

---

## Phase 3: Actor Rendering Improvements

- [ ] **3.1 — Add Source engine angle-to-quaternion helpers**
  - File: `src/utils/geometry.ts` (append)
  - Add `cameraQuaternionFromSourceAnglesDeg(pitchDeg, yawDeg, rollDeg)` — builds quaternion using Source convention (yaw around Z, pitch around Y, roll around X)
  - Add `yawQuaternionFromDegrees(yawDeg)` — yaw-only quaternion for body rotation
  - Existing code uses generic `setFromAxisAngle` which doesn't handle Source angle convention correctly

- [ ] **3.2 — Add frame-rate-independent smoothing alpha utility**
  - File: `src/utils/geometry.ts` (append)
  - Add `smoothingAlpha(deltaSeconds, tauSeconds)` returning `1 - Math.exp(-deltaSeconds / tauSeconds)`
  - Current hardcoded `viewSmoothing = 0.35` is frame-rate dependent (behaves differently at 30fps vs 144fps)

- [ ] **3.3 — Add resolveViewAngles helper for zero-valued angles**
  - File: `src/components/Scene/Actors.tsx` (add helper function)
  - Parser sometimes returns `{x:0, y:0, z:0}` for view angles (known bug)
  - Current code has scattered `!== 0` checks (lines 125-126, 144, 154)
  - Centralize into a single function that falls back to previous non-zero angles
  - Prepares for quaternion-based interpolation which needs clean angle data

- [ ] **3.4 — Rewrite Actor interpolation with separate body and aim quaternions**
  - File: `src/components/Scene/Actors.tsx:114-159` (replace `useFrame` callback)
  - Add constants: `RENDER_POSITION_SMOOTH_SECONDS = 0.04`, `RENDER_ROTATION_SMOOTH_SECONDS = 0.03`, `TELEPORT_LERP_DISTANCE = 4096`
  - Add refs: `lerpedPosition`, `bodyQuat`, `aimQuat`
  - Use `useFrame((_, delta) => { ... })` with `delta` for frame-rate-independent smoothing via `smoothingAlpha()`
  - Separate body rotation (yaw only via `yawQuaternionFromDegrees`) from aim rotation (pitch+yaw via `cameraQuaternionFromSourceAnglesDeg`)
  - Add teleport detection: skip interpolation if distance > `TELEPORT_LERP_DISTANCE`
  - Remove the `playback.speed > 1` guard that currently disables interpolation at fast speeds (line 122)
  - **Depends on: 3.1, 3.2, 3.3**

---

## Phase 4: Scene Rendering Optimizations

- [ ] **4.1 — Add tool material filtering to World mesh traversal**
  - File: `src/components/Scene/World.tsx:108-123`
  - Add `INVISIBLE_TOOL_MATERIALS` list: `toolsnodraw`, `toolsclip`, `toolsplayerclip`, `toolsinvisible`, `toolsinvisibleladder`, `toolstrigger`, `toolsareaportal`, `toolsblockbullets`, `toolshint`, `toolsskip`, `toolsfog`, `toolsskybox`
  - Add `isInvisibleToolMaterial(materialName)` helper
  - In `mapModel.traverse` callback, set `node.visible = false` for matches
  - Source engine converters include invisible tool brushes as visible geometry — hiding them reduces draw calls

- [ ] **4.2 — Enable frustum culling on world meshes with proper bounding volumes**
  - File: `src/components/Scene/World.tsx:108-123`
  - In the `mapModel.traverse` callback, for each `Mesh` child: call `mesh.geometry.computeBoundingBox()` and `mesh.geometry.computeBoundingSphere()`
  - Set `mesh.frustumCulled = true` (Three.js default but requires valid bounds)
  - Without valid bounding volumes, Three.js submits every mesh to the GPU regardless of visibility

- [ ] **4.3 — Rewrite Skybox with async loading and mismatched face handling**
  - File: `src/components/Scene/Skybox.tsx` (full rewrite)
  - Replace synchronous `CubeTextureLoader.load()` (line 32) with async `Promise.all` image loading
  - Add `normalizeCubeFace()` to resize mismatched cube face dimensions via canvas — some maps have faces at different resolutions which causes Three.js errors
  - Add `pickTargetFaceSize()` to use the largest face dimension
  - Set texture properties: `colorSpace = SRGBColorSpace`, `generateMipmaps = false`, `minFilter = LinearFilter`
  - Add PMREM environment map generation (`PMREMGenerator.fromCubemap()`) for PBR reflections on map materials
  - Set `scene.environment = envMap` alongside `scene.background = cubeTexture`
  - Add cleanup: dispose textures and null out scene.background/environment on unmount
  - Prevents main thread blocking during texture decode; enables physically correct reflections

- [ ] **4.4 — Add dynamic lighting profiles from map metadata**
  - File: `src/components/Scene/Lights.tsx` (expand from 11 lines)
  - Add `LightingProfile` interface: `ambientColor`, `ambientIntensity`, `keyColor`, `keyIntensity`, `keyDirection`, `fillColor`, `fillIntensity`, `fillDirection`
  - Add `deriveLightingProfile(lightEnv)` that parses Source engine `light_environment` color strings (`"r g b intensity"` format)
  - Blend colors toward white for natural look; clamp intensities to sensible ranges
  - Use `DEFAULT_LIGHTING` profile matching current hardcoded values as fallback
  - Infrastructure-only: will activate per-map once conversion.json metadata is generated

---

## Phase 5: Interpolation Enhancement

- [ ] **5.1 — Add 2-tick interpolation delay with multi-tick data fetching**
  - File: `src/components/DemoViewer.tsx:265-281`
  - Add `const INTERP_DELAY_TICKS = 2`
  - Calculate `const interpTick = Math.max(1, playback.tick - INTERP_DELAY_TICKS)`
  - Fetch player data at `interpTick` and `interpTick + 1` (instead of `playback.tick` and `playback.tick + 1`)
  - This matches Source engine's cl_interp approach — always has future data to interpolate toward
  - **Depends on: 2.2** (needs entityId matching)

- [ ] **5.2 — Add projectile interpolation**
  - File: `src/components/DemoViewer.tsx:280` and `src/components/Scene/Projectiles.tsx`
  - In DemoViewer: fetch `projectilesNextTick` at `interpTick + 1`, build entityId map, attach `positionNext`/`rotationNext` to each projectile
  - Add `InterpolatedProjectile` type extending `CachedProjectile` with optional `positionNext`/`rotationNext`
  - In `RocketProjectile.useFrame`: lerp between `position` and `positionNext` using `frameProgress`
  - Similarly update `PipebombProjectile` and `StickybombProjectile` positions
  - Currently projectiles snap between positions each tick, producing choppy motion
  - **Depends on: 5.1**

---

## Phase 6: Settings & Store Expansions

- [ ] **6.1 — Add viewDistance setting to store and camera**
  - Files: `src/zustand/store.ts`, `src/components/DemoViewer.tsx:102`, `src/components/UI/SettingsPanel.tsx`
  - Add `viewDistance: number` to `StoreState.settings.ui` (default: `15000`)
  - In Controls component (DemoViewer.tsx:102): replace `cameraRef.current.far = 15000` with `settings.ui.viewDistance || 15000`
  - Add `SliderOption` in SettingsPanel under Scene section: min=2000, max=30000, step=500
  - Users on lower-end hardware can reduce view distance; high-end users can increase it

- [ ] **6.2 — Add exportInProgress flag to playback store**
  - File: `src/zustand/store.ts:89-95`
  - Add `exportInProgress: boolean` to `StoreState.playback` (default: `false`)
  - Prepares store for MP4 export. Canvas switches `frameloop` based on this flag
  - **No dependencies**

---

## Phase 7: Video Export Frame Control

- [ ] **7.1 — Add frame advancement infrastructure to store and DemoViewer**
  - File: `src/zustand/store.ts` — add to `InstanceState`: `advanceFrame`, `renderedPlaybackTick`, setters
  - File: `src/components/DemoViewer.tsx`
  - Add `MAX_REALTIME_PLAYBACK_FPS = 100` constant
  - Switch Canvas `frameloop` to `'never'` when `playback.exportInProgress` is true
  - In Canvas `onCreated`, store `state.advance` function in zustand instance store
  - When export is active, frames are advanced manually (frame-perfect capture without drops)
  - **Depends on: 6.2**

- [ ] **7.2 — Create videoExport utility with manual frame advancement**
  - File: `src/utils/videoExport.ts` (new)
  - Add `waitForRenderedPlaybackTick(tick)` — polls instance store until tick renders
  - Add `waitForTaskTurn()` — uses `MessageChannel` for non-RAF scheduling
  - Export loop drives frames manually: `manualAdvanceFrame!(timestamp, true)` then increments timestamp by `frameDurationMs`
  - Removes real-time pacing bottleneck — video renders as fast as GPU allows
  - **Depends on: 7.1**

---

## Phase 8: Performance Monitoring & Debugging

- [ ] **8.1 — Create FpsCounter component**
  - File: `src/components/UI/FpsCounter.tsx` (new)
  - Lightweight text-based FPS counter using `useFrame` + `performance.now()` delta tracking
  - Render as fixed overlay: `bg-black/50 px-2 py-1 font-mono text-xs`
  - Alternative to existing `Stats` from drei which renders a full canvas stats panel

- [ ] **8.2 — Add JS heap memory profiling utility**
  - File: `src/utils/misc.ts` (append)
  - Add `readJsHeapMemoryMb()` — reads `performance.memory.usedJSHeapSize` (Chrome only), returns `undefined` elsewhere
  - Add `isPerfLoggingEnabled()` — checks URL for `?perf=true`

- [ ] **8.3 — Add perf logging to DemoViewer animate loop**
  - File: `src/components/DemoViewer.tsx`
  - Add class fields: `perfLoggingEnabled = isPerfLoggingEnabled()`, `perfLogTimer = 0`
  - In `animate()`: increment `perfLogTimer`, every 5 seconds log tick and heap memory to console
  - Append `?perf=true` to URL to enable during testing
  - **Depends on: 8.2**

- [ ] **8.4 — Add parser performance tracking**
  - File: `src/components/Analyse/Data/AsyncParser.ts` — add `ParserPerformanceStats` interface with `parseMs`, `playerCount`, `ticks`
  - File: `src/components/Analyse/Data/ParseWorker.ts` — wrap `parser.cacheData()` in `performance.now()` timing, attach stats to `CachedDemo`
  - In AsyncParser `onmessage` handler: compute transfer time (`performance.now() - cachedData.now`) and log both parse + transfer durations
  - Identifies whether parser or data transfer is the bottleneck for large demos

---

## Phase 9: Asset Optimization

- [ ] **9.1 — Compress player model GLB files with gltfpack**
  - Directory: `public/models/players/`
  - Run `gltfpack -i <file>.glb -o <file>.glb` (or equivalent `optimizeglb`) on all 18 player model files
  - Expected reduction: ~90% (e.g. Scout 3.6MB → 109KB)
  - Asset-only change, no code modifications
  - Verify models still render correctly after compression

---

## Verification Plan

After implementing all phases:
1. **Parser2 WASM**: Load a demo file, verify it parses successfully with console timing output. Compare parse time to old JS parser (~10-100x improvement expected). Verify all player positions, projectiles, and events display correctly
2. **Playback timing**: Verify duration display matches expected game time (should be ~half what it showed before fixes)
3. **High-speed playback**: Play at 4x speed, verify it actually plays 4x faster (not capped at ~1x)
4. **Actor smoothness**: Watch a demo at 1x, verify player models move smoothly without jitter or teleporting at team boundaries
5. **Scene performance**: Open browser DevTools Performance tab, verify reduced draw calls with tool material filtering and frustum culling
6. **Skybox**: Load a map with mismatched skybox face sizes, verify no errors and correct rendering
7. **FPS counter**: Enable via settings, verify reasonable frame rate
8. **Perf logging**: Append `?perf=true`, verify heap memory logs in console every 5s
9. **Model sizes**: Check network tab, verify player model GLBs are ~100-500KB not multi-MB
