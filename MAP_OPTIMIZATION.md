# `plan.md` Backlog: Map Optimization for 120 FPS Target

## Summary

Goal: make the map pipeline and viewer capable of sustaining near-120 FPS on a midrange desktop at 1080p by reducing static-map draw calls, fixing chunk generation, fixing BSP visibility metadata, and consuming that metadata at runtime.

Primary bottleneck: static-map scene fragmentation. Current Snakewater output is roughly 390k triangles, but also roughly 5.5k mesh nodes and roughly 10.1k primitives in the final GLB. The current chunk/PVS path is not working, so the browser renders essentially the whole static map all the time.

Success criteria:

- Snakewater conversion produces many usable chunk roots, not 2.
- `visibility.json` contains valid chunk visibility data, not empty cluster assignments.
- Runtime only shows chunks visible from the current BSP cluster.
- Render-call count drops substantially.
- Textured Snakewater navigation on Chrome at 1080p is close to the 120 FPS target on a midrange desktop.

## Public APIs, Interfaces, and Types

Add or change the following interfaces before runtime integration:

```ts
type MapVisibilityMetadata = {
  version: 2
  transform: 'gltf-to-source:x,-z,y'
  chunkNames: string[]
  chunkBounds: { min: [number, number, number]; max: [number, number, number] }[]
  planes: [number, number, number, number][]
  nodes: [number, number, number][]
  leafClusters: number[]
  visibleChunksByCluster: number[][]
}
```

```ts
getMapVisibilityUrl(loadedMapName: string): string | undefined
```

`conversion.json.visibility` should include:

- `version`
- `chunkCount`
- `clusterCount`
- `valid`

## Backlog

### Phase 1: Baseline and Guardrails

- [x] Add a short comment block near the map conversion output stage in [scripts/convert-map.mjs](/Users/bryan/Github/dribble.tf/scripts/convert-map.mjs) documenting the intended static-map optimization pipeline order: import -> chunk -> lightmap inject -> gltfpack -> metadata export.
- [x] Add a small Node inspection script under `scripts/` that prints GLB stats: node count, mesh count, primitive count, triangle count, material count, texture count, and chunk-root count.
- [x] Run that stats script against `public/models/maps/cp_snakewater_final1/textured_compressed.glb` and record the current baseline numbers in a code comment at the top of the script for reference.
- [x] Extend the same script to print the count of static mesh nodes by prefix: `worldspawn`, `func_detail`, `func_brush`, `prop_static`.
- [x] Extend the script to print whether `visibility.json` exists and whether any chunks have non-empty cluster assignments.
- [x] Keep this script read-only and diagnostic only; do not make it part of the runtime bundle.

### Phase 2: Define Chunking Rules

- [x] In [scripts/chunk_map_glb.py](/Users/bryan/Github/dribble.tf/scripts/chunk_map_glb.py), define the exact static object categories to chunk: `worldspawn*`, `func_detail*`, `func_brush*`, `prop_static*`.
- [x] Explicitly define the categories to skip from chunking: `prop_dynamic*`, `prop_physics*`, non-mesh nodes, lights, and helper nodes.
- [x] Set the default map chunk grid in [scripts/convert-map.mjs](/Users/bryan/Github/dribble.tf/scripts/convert-map.mjs) from `4` to `8`.
- [x] Add a short code comment beside the new default explaining that the grid is chosen to trade chunk count against draw-call reduction and PVS usefulness.

### Phase 3: Rewrite the Blender Chunker

- [x] Refactor [scripts/chunk_map_glb.py](/Users/bryan/Github/dribble.tf/scripts/chunk_map_glb.py) so it loads all mesh objects and classifies them as chunkable or non-chunkable.
- [x] Replace the single-target `find_target_object()` flow with a whole-scene chunking flow.
- [x] Preserve existing import and export entrypoints so [scripts/convert-map.mjs](/Users/bryan/Github/dribble.tf/scripts/convert-map.mjs) does not need a large call-site rewrite.
- [x] Compute global static-map world bounds from chunkable objects only, not from every mesh in the scene.
- [x] Add a helper that maps a world-space point to `(ix, iy)` chunk coordinates using the configured grid.
- [x] Add a helper that creates or retrieves a Blender object for a chunk root named exactly `chunk_${ix}_${iy}`.
- [x] Ensure chunk roots are the only static nodes that keep stable names needed by runtime lookup.

### Phase 4: Chunk Brush Geometry

- [x] Add a helper that identifies brush-like objects by name prefix: `worldspawn`, `func_detail`, `func_brush`.
- [x] For each brush-like object, iterate faces and assign each face to a chunk using face-center in world space.
- [x] Preserve all UV layers when copying brush faces into chunk meshes.
- [x] Preserve material indices when copying brush faces into chunk meshes.
- [x] Preserve object transforms by baking face positions into the destination chunk object correctly.
- [x] Merge all brush faces that land in the same chunk into a single mesh object per chunk source category.
- [x] After copying, remove original brush-like source objects from the scene.
- [x] Add a validation step in the chunker that errors if brush chunking creates zero chunk roots.

### Phase 5: Chunk Static Props

- [x] Add a helper that identifies `prop_static*` objects.
- [x] Compute each static prop’s chunk assignment from its world-space bounding-box center.
- [x] Parent each static prop under the corresponding chunk root.
- [x] Clear the prop node name before export so `gltfpack` is free to merge and instance aggressively.
- [x] Keep transforms intact after reparenting.
- [x] Keep materials intact after reparenting.
- [x] Do not merge props in Blender; leave merging and instancing opportunities to `gltfpack`.
- [x] Add a validation step that chunked props still exist in the scene after reparenting.

### Phase 6: Preserve Non-Chunked Scene Content

- [x] Leave non-static objects untouched in the scene graph so dynamic or special-case content is not accidentally culled with static chunks.
- [x] Ensure lights still export when present.
- [x] Ensure chunk root creation does not break scene export when there are no props in a chunk.
- [x] Ensure empty chunk roots are not exported.

### Phase 7: Export-Side Naming Strategy

- [x] Add a pre-export cleanup pass in the Blender chunker that strips names from all static child nodes beneath chunk roots.
- [x] Keep chunk root names stable and unique.
- [x] Confirm no runtime code depends on `worldspawn_*`, `func_detail_*`, or `prop_static_*` node names before finalizing the cleanup behavior.
- [x] Add a brief code comment documenting that this name stripping exists to let `gltfpack` merge static nodes more aggressively.

### Phase 8: Update `gltfpack` Invocation

- [x] In [scripts/convert-map.mjs](/Users/bryan/Github/dribble.tf/scripts/convert-map.mjs), change the default `gltfpack` arguments to include `-mi`.
- [x] Keep `-kn` because chunk roots remain named and need to survive export.
- [x] Keep `-kv -vtf` only when lightmap UV injection is enabled.
- [x] Keep existing texture format and texture scale/limit behavior unchanged in this pass.
- [x] Do not add simplification flags by default in this pass.
- [x] Add a code comment explaining why simplification is deferred until after draw-call reduction is validated.

### Phase 9: Build Correct Chunk Bounds for Metadata

- [x] In [scripts/convert-map.mjs](/Users/bryan/Github/dribble.tf/scripts/convert-map.mjs), update `parseChunkClusterVisibility()` so chunk bounds are computed from chunk root descendants recursively, not from the root mesh only.
- [x] Add a helper that accumulates all descendant primitive position bounds under a chunk root.
- [x] Make the helper respect node transforms all the way down the hierarchy.
- [x] Skip chunk roots that still resolve to no geometry bounds and count them separately for diagnostics.
- [x] Record per-chunk AABBs in the returned metadata.

### Phase 10: Fix Coordinate-Space Conversion

- [x] Add a small helper inside `parseChunkClusterVisibility()` that converts GLTF coordinates to Source BSP coordinates as `[x, -z, y]`.
- [x] Apply that transform to every sampled chunk point before BSP leaf lookup.
- [x] Add a short code comment explaining why the transform is needed.
- [x] Ensure the same transform string is written into `visibility.json` as metadata version information.

### Phase 11: Improve Chunk-to-Cluster Sampling

- [x] Keep the existing 9 sample points per chunk: center plus 8 AABB corners.
- [x] If those produce no cluster, add 6 face-center samples for the chunk AABB.
- [x] Deduplicate resulting clusters per chunk.
- [x] Sort cluster lists numerically before serialization.
- [x] Count how many chunks got at least one cluster assignment.
- [x] If no chunks get clusters, fail metadata generation and mark visibility invalid in `conversion.json`.
- [x] If fewer than 80% of chunks get clusters on a map with BSP visibility data, skip writing `visibility.json`, mark visibility invalid, and emit a warning.

### Phase 12: Expand BSP PVS Offline

- [x] Add a helper in [scripts/convert-map.mjs](/Users/bryan/Github/dribble.tf/scripts/convert-map.mjs) to decode the BSP visibility lump row for a cluster.
- [x] Expand raw BSP visibility into a set of visible source clusters per cluster.
- [x] Build a reverse mapping from source cluster to chunk indices using the sampled chunk cluster assignments.
- [x] Precompute `visibleChunksByCluster` so runtime does not have to decode BSP PVS bitfields every frame.
- [x] Deduplicate and sort each `visibleChunksByCluster[c]` array.
- [x] For invalid or missing cluster rows, default to an empty visible set at metadata build time and let runtime use its fallback behavior.

### Phase 13: Write `visibility.json` v2

- [x] Change the emitted visibility metadata shape to the new version-2 schema.
- [x] Include `version: 2`.
- [x] Include `transform: 'gltf-to-source:x,-z,y'`.
- [x] Include `chunkNames` ordered exactly as the runtime should use them.
- [x] Include `chunkBounds` in the same order as `chunkNames`.
- [x] Include `planes`, `nodes`, and `leafClusters`.
- [x] Include `visibleChunksByCluster`.
- [x] Remove the old `chunkAssignments` structure from the written file.
- [x] Keep serialization compact; no pretty-printing is necessary for this file.

### Phase 14: Update `conversion.json`

- [x] In [scripts/convert-map.mjs](/Users/bryan/Github/dribble.tf/scripts/convert-map.mjs), extend `conversion.json.visibility` to include `version`.
- [x] Add `valid: true` when `visibility.json` was successfully produced with usable chunk data.
- [x] Add `valid: false` when metadata generation is skipped or invalid.
- [x] Keep `chunkCount` and `clusterCount` when available.
- [x] Ensure `conversion.json` still writes successfully even when visibility generation fails.

### Phase 15: Add Frontend URL Helper

- [x] In [src/utils/game.ts](/Users/bryan/Github/dribble.tf/src/utils/game.ts), add `getMapVisibilityUrl(loadedMapName: string)`.
- [x] Make it resolve the map folder with the same folder-name logic used by `getMapConversionUrl()`.
- [x] Return `undefined` when the map name is missing.
- [x] Keep the function side-effect free.

### Phase 16: Add Frontend Visibility Types

- [x] Create a small type definition for `MapVisibilityMetadata` in the frontend codebase.
- [x] Put the type near other scene/map-related types so `World.tsx` can import it without circular dependencies.
- [x] Include the exact version-2 fields only.
- [x] Avoid optional fields except where truly necessary for fallback parsing.

### Phase 17: Load Visibility Metadata in `World`

- [x] In [src/components/Scene/World.tsx](/Users/bryan/Github/dribble.tf/src/components/Scene/World.tsx), add local state for loaded `MapVisibilityMetadata | null`.
- [x] Reset visibility metadata state to `null` when the map changes.
- [x] Fetch `visibility.json` using `getMapVisibilityUrl()` when the map GLB is requested.
- [x] If the fetch fails, keep metadata state as `null` and allow the map to render fully.
- [x] Do not block GLB rendering on visibility metadata fetch success.

### Phase 18: Index Chunk Roots at Runtime

- [x] After GLTF load in `World`, traverse the scene and collect chunk roots by exact name pattern `chunk_\\d+_\\d+`.
- [x] Store a stable map from chunk name to `THREE.Object3D`.
- [x] Validate that every `chunkNames[]` entry from metadata exists in the loaded GLB before enabling runtime culling.
- [x] If any named chunk root is missing, disable runtime visibility culling for that map load and fall back to showing all chunks.
- [x] Keep this validation local to `World`; do not throw globally.

### Phase 19: Freeze Static Map Transforms

- [x] In `World`, add a one-time pass after GLTF load that sets `matrixAutoUpdate = false` recursively on the static map subtree.
- [x] Call `updateMatrixWorld(true)` once after freezing.
- [x] Compute missing geometry bounding boxes once.
- [x] Compute missing geometry bounding spheres once.
- [x] Keep `frustumCulled = true` for meshes.
- [x] Avoid recomputing bounds on every render or setting update.

### Phase 20: Implement Runtime BSP Leaf Lookup

- [ ] In `World`, add a helper that converts camera position from world coordinates into the map’s local GLTF coordinates.
- [ ] Reuse the map group transform and its inverse instead of hardcoding offsets.
- [ ] Convert the resulting local point into Source BSP coordinates using `[x, -z, y]`.
- [ ] Add a helper that walks BSP nodes and planes to find the current leaf index.
- [ ] Add a helper that maps leaf index to source cluster index.
- [ ] If any lookup step fails, treat the cluster as invalid and show all chunks.

### Phase 21: Implement Runtime Chunk Visibility

- [ ] Add a `useFrame` loop in `World` that reads the current camera position and computes the current source cluster.
- [ ] Only recompute chunk visibilities when the cluster changes.
- [ ] If metadata is missing or invalid, show all chunk roots.
- [ ] If the current cluster is invalid, show all chunk roots.
- [ ] Otherwise, look up `visibleChunksByCluster[currentCluster]` and toggle chunk-root `.visible` flags from that list.
- [ ] Make hidden chunks `visible = false`; do not remove them from the scene.
- [ ] Ensure non-chunk map nodes remain visible and unaffected.
- [ ] Keep the logic map-local so it does not interfere with actors, projectiles, or UI.

### Phase 22: Runtime State Hygiene

- [ ] Reset cached runtime cluster state when the map changes.
- [ ] Reset cached chunk-root maps when the GLTF scene changes.
- [ ] Prevent stale async fetches from older maps from overwriting current metadata state.
- [ ] Ensure repeated toggling between textured and untextured modes does not leak old chunk visibility state.

### Phase 23: Clamp Canvas DPR

- [x] In [src/components/DemoViewer.tsx](/Users/bryan/Github/dribble.tf/src/components/DemoViewer.tsx), set the canvas `dpr` prop to `Math.min(window.devicePixelRatio, 1.25)`.
- [x] Keep this as the default for desktop and mobile unless a later perf mode is introduced.
- [x] Add a brief comment explaining that uncapped Retina DPR can dominate GPU cost after draw-call fixes.

### Phase 24: Perf Logging

- [ ] Extend the existing `?perf=true` logging path in [src/components/DemoViewer.tsx](/Users/bryan/Github/dribble.tf/src/components/DemoViewer.tsx) to include `renderer.info.render.calls`.
- [ ] Also log `renderer.info.render.triangles`.
- [ ] Expose current visible chunk count from `World` through a lightweight shared store or callback.
- [ ] Log current visible chunk count every 5 seconds with the existing perf logger.
- [ ] Log current BSP cluster every 5 seconds with the same logger.
- [ ] Keep logging disabled by default.

### Phase 25: Converter Validation Tasks

- [ ] Re-run Snakewater conversion with the updated chunker and `chunk-grid=8`.
- [ ] Confirm the chunk-root count is materially larger than 2.
- [ ] Confirm `visibility.json.version === 2`.
- [ ] Confirm most chunks have valid sampled source clusters before PVS expansion.
- [ ] Confirm `conversion.json.visibility.valid === true`.
- [ ] Confirm `gltfpack` output node and primitive counts drop materially relative to the current baseline.
- [ ] Confirm lightmap atlas output still exists and the final GLB still renders.

### Phase 26: Runtime Validation Tasks

- [ ] Load Snakewater in the browser with perf logging enabled.
- [ ] Measure render-call count while stationary in a representative outdoor area.
- [ ] Measure render-call count while stationary in a representative indoor area.
- [ ] Move the camera across multiple BSP regions and confirm visible chunk count changes.
- [ ] Confirm no obvious chunk pop-in beyond normal BSP/PVS visibility changes.
- [ ] Confirm actors and projectiles still align with the map.
- [ ] Confirm invisible tool materials remain hidden.
- [ ] Confirm toggling skybox on and off still works.

### Phase 27: Regression Checks

- [ ] Test at least one other converted map besides Snakewater to ensure the new chunker is not overfit to Snakewater naming/layout.
- [ ] Verify a map with missing or bad `visibility.json` still renders fully without runtime errors.
- [ ] Verify untextured and wireframe modes still load.
- [ ] Verify player outlines still work when enabled.
- [ ] Verify camera controls still function correctly after map transform and chunk visibility logic changes.

### Phase 28: Acceptance Review

- [ ] Compare before/after GLB stats using the diagnostic script.
- [ ] Compare before/after render-call counts using the in-browser perf logger.
- [ ] Compare before/after visible chunk counts across a short recorded camera path.
- [ ] Confirm the map is close to the 120 FPS target on the chosen midrange desktop at 1080p in textured mode with outlines off.
- [ ] If FPS is still materially below target after draw-call reduction, create a follow-up backlog for optional second-pass work: mesh simplification, KTX2 loader path, skybox cost reduction, and material-side cleanup.

## Test Cases and Scenarios

- Snakewater conversion produces more than 16 non-empty chunk roots at `chunk-grid=8`.
- Snakewater `visibility.json` contains valid chunk names and non-empty `visibleChunksByCluster` data.
- Snakewater runtime chunk visibility changes as the camera moves between distinct BSP regions.
- Missing or invalid visibility metadata falls back to rendering all chunks.
- Lightmap UVs and atlas remain intact after chunking and final packing.
- At least one non-Snakewater map converts and renders successfully with the new path.

## Assumptions and Defaults

- Target hardware: midrange desktop at 1080p.
- Allowed tradeoff: moderate visual cuts, but no default geometry simplification in this pass.
- Optimization scope: converter plus runtime.
- Default chunk grid: `8`.
- Texture path remains WebP in this pass because the viewer does not yet configure `KTX2Loader`.
- Runtime visibility is chunk-root toggling only; no per-frame GLB reloading or scene reconstruction.
