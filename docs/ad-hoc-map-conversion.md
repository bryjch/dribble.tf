# Ad-hoc Map Conversion

Status: proposed; implementation starts only after review.

## Outcome

Opening a demo resolves its Map Name to the current Canonical Build, loads a matching Published or locally cached Derived Map when possible, and otherwise downloads the BSP and generates an Ad-hoc Derived Map in a browser worker. A catalog miss prompts for a Local Override. Existing published maps remain available throughout migration.

`playsrc` is a reference for its worker, identity, and cache patterns only. It compiles its own runtime map representation and does not use `bsp-to-glb`. dribble.tf retains Three.js and standardizes both Published and Ad-hoc Derived Maps on `bsp-to-glb`.

## Resolution order

1. Read the exact Map Name from the demo.
2. Read the Published Derived Map descriptor and the last locally resolved Map Build record, if present.
3. Revalidate the exact Serveme FastDL path through the same-origin relay using response metadata.
4. Use a matching Published Derived Map first, then a matching local Derived Map cache entry.
5. Otherwise download the BSP, enforce byte limits while streaming, compute SHA-256, inspect dependencies, fetch the required shared assets, and convert it.
6. If Serveme is unavailable, allow a previously verified Published or cached result with a stale-source warning.
7. If no usable result exists, prompt for a Local Override. Local files never leave the browser.

The catalog's current response is the Canonical Build when a Map Name has been reused. ETag, length, and last-modified values are revalidation hints only; SHA-256 of the complete BSP is the Map Build identity.

## Derived Map contract

Each Derived Map has a small manifest containing:

- Map Name and BSP SHA-256;
- pinned `bsp-to-glb` version and source revision;
- Conversion Profile and Shared Asset Pack versions;
- content hash and byte length for every component;
- world bounds, environment and sky identity;
- geometry, material, lightmap, prop, decal, overlay, and visibility Asset Coverage.

The component package contains the direct world GLB, visibility and entity data, lightmap atlases, map-specific decoded textures, supported decal/overlay data, and references to shared assets. Common TF2 content is never duplicated into every map package.

Published and browser conversion must produce the same semantic package from the same inputs. Native publication may apply HTTP or file transport compression, but no native-only Blender, VMF, Plumber, or enrichment pass may change the result.

## Shared Asset Pack

The Shared Asset Pack is a versioned index of individually addressable, content-hashed resources rather than one large download. It provides common TF2 VMT/VTF-derived textures, StudioModel GLBs and manifests, and skybox faces. The browser fetches only the dependency closure required by the current Map Build. BSP PAK resources retain precedence and remain map-specific.

`bsp-to-glb` needs a two-stage API shared by native and WASM callers:

1. `inspect` parses bounded map identity, bounds, environment, material, model, and sky dependencies without producing render output.
2. `convert` accepts the BSP plus a bounded in-memory resource bundle and returns the complete Derived Map components and Asset Coverage.

This avoids asynchronous callbacks from Rust into JavaScript and avoids downloading the whole Shared Asset Pack. The existing file/VPK resolver remains the native pack-generation input; the browser uses an in-memory resolver over verified fetched bytes.

The project owner confirmed on 2026-08-03 that redistribution of the selected TF2-derived assets has been checked and is permitted for this project.

## Browser conversion

- Add the WASM binding and browser release artifact to `bsp-to-glb`, not dribble.tf, so both consumers share one tested conversion core.
- Expose one coarse inspection call and one coarse conversion call. Transfer the BSP to a dedicated Web Worker and terminate the worker to cancel.
- Start single-threaded. Do not add cross-origin isolation or a thread pool until profiling proves conversion time requires it.
- Keep input, output, recursion, archive, image, and resource-count limits in the Rust trust boundary. Reject invalid `VBSP` content before conversion.
- Use monotonically increasing map-load generations so late worker or fetch results cannot replace the active map.
- Return stage names and real byte progress where available; do not fabricate conversion percentages.
- Target Conversion-capable desktop browsers initially. Other clients continue to use Published Derived Maps.

The first implementation downloads Serveme's uncompressed `.bsp` response. Browser bzip2 support is deferred until bandwidth measurements justify another decoder.

## Rendering integration

Keep `World.tsx` as the scene owner and replace URL-only map lookup with a resolver that returns one Derived Map regardless of whether it was published, cached, or generated.

- Parse the world GLB from verified bytes with the existing `GLTFLoader` (with the meshopt decoder, see ADR 0004) and preserve the existing Source-to-Three transform. `bsp-to-glb` writes Source world coordinates (glTF y-up), as published GLBs are, and the scene is drawn in them (ADR 0005), so a Derived Map needs no offset. Its manifest `worldBounds` only feed `scene.bounds` for the camera, when no match supplies the world's bounds.
- Load the model once per resolved map, as published GLBs are: the scene mode swaps materials, and props, decals and lightmap textures belong to the model so one dispose frees them after React removes it.
- Resolve common and map-specific materials from the manifests; map supported VMT features onto existing Three.js materials.
- Decode flat and directional RGBExp32 lightmaps in the material shader and use displacement alpha for supported blends.
- Load each required shared StudioModel once and clone or instance prop occurrences from the prop manifest instead of embedding duplicate geometry in the map GLB.
- Resolve the skybox and light/environment data from the Derived Map Manifest rather than hardcoded map-name tables.
- Adapt the existing BSP node/leaf traversal and chunk culling to `bsp-to-glb.visibility` version 2 rather than maintaining a second visibility generator.
- Render supported decal/overlay output. Unsupported records contribute to Asset Coverage without blocking the world.

A bad BSP or unusable world geometry is a conversion failure. Missing optional materials, props, decals, overlays, or skybox assets produce a Degraded Derived Map with precise counts.

## Browser cache

Reuse the installed IndexedDB-backed `localforage` dependency. Cache complete verified Derived Map components and map-specific extracted assets, not raw BSP bytes. The cache key includes BSP SHA-256, converter version/revision, Conversion Profile, Shared Asset Pack version, and component role.

Caching is best-effort. Browser quota eviction is allowed; unavailable or corrupt entries are treated as misses. A small Map Name record retains the last source metadata and resolved BSP hash for revalidation. Ad-hoc results remain local and are never uploaded automatically.

## Catalog relay

Production is currently served by Vercel. Use a fixed-host external rewrite for validated Map Name paths rather than a Vercel Function: Functions cap response bodies at 4.5 MB, while current BSPs are commonly tens of megabytes. The rewrite forwards only `GET` and `HEAD`-style browser use to the fixed Serveme FastDL map path and may use upstream cache headers. It cannot accept a destination URL.

Validate Map Names before constructing the local relay URL, reject separators and traversal, cap declared and received bytes, require the expected binary content, and hash the complete BSP. The browser remains responsible for content verification because catalog and HTTP metadata are not identity.

## Published-map migration

1. Preserve every existing GLB and map folder until its replacement passes comparison.
2. Recreate the local TF2 content mount and generate the first Shared Asset Pack version.
3. Convert one representative map through native `bsp-to-glb` using the same profile planned for WASM.
4. Compare fixed-camera screenshots, scene bounds, triangle and displacement coverage, materials, lightmaps, props, skybox, visibility behavior, bytes transferred, load time, and peak memory against the existing asset.
5. Fix shared converter or renderer gaps; do not add per-map patches when the issue affects sibling maps.
6. Migrate the remaining existing BSP corpus only after the pilot passes.
7. Replace substring-based `MAP_NAME_SEARCH_MAP` and `MAP_SKYBOX_MAP` behavior with explicit Published Derived Map descriptors. Keep the tables only as a temporary legacy path during migration.

No S3 or other remote publication is part of local implementation or verification. Publishing generated assets is a separate remote mutation and requires explicit target confirmation.

## Implementation phases

### 1. Converter contract (`bsp-to-glb`)

- Add bounded dependency inspection, in-memory resolution, world/environment summary, and a browser WASM artifact.
- Keep native and WASM fixture output semantically identical.
- Publish version/build metadata and hashes for the browser artifact alongside native releases.

### 2. Shared assets (`bsp-to-glb` plus dribble scripts)

- Generate content-addressed material, texture, model, and sky descriptors from a verified TF2 install.
- Produce the versioned Shared Asset Pack index and dependency closures.
- Validate every referenced hash and report unsupported coverage.

### 3. Acquisition and cache (`dribble.tf`)

- Add the fixed Serveme relay route, source revalidation, BSP streaming/hash validation, Local Override, manifest validation, and Derived Map cache.
- Preserve the current Published Derived Map path behind the same resolver.

### 4. Worker and renderer (`dribble.tf`)

- Add the conversion worker and generation-safe orchestration.
- Load GLB bytes, materials, lightmaps, shared props, sky, environment, and visibility through one Derived Map adapter.
- Replace blocking alerts with existing loading UI plus a compact Asset Coverage result.

### 5. Migration

- Pilot one existing map, lock the measured quality/size/performance budgets, then rebuild the remaining published corpus.
- Remove legacy conversion and map-name fallbacks only after all published descriptors pass.

## Verification

Converter checks:

- `cargo fmt --check`
- `cargo test --release`
- `cargo clippy --all-targets -- -D warnings`
- native/WASM parity fixtures for inspection, GLB structure, manifests, lightmaps, visibility, dependency gaps, and deterministic identities

Application checks:

- `npm run build`
- existing repository type check, with pre-existing errors reported separately
- fixed headed and headless WebGL captures for one existing published map, one catalog-only map, and one Local Override
- cold conversion, warm cache, source revision change, offline stale cache, catalog 404, corrupt download, corrupt cache, missing shared asset, cancellation/map switch, size-limit, and unsupported-device scenarios

Acceptance criteria:

- no additional input for a Serveme-hosted map on a Conversion-capable Client;
- warm cache performs no BSP body download and no conversion;
- current map changes invalidate only identities that include the changed BSP or dependency;
- world geometry and displacement output match the converter's compiled-BSP coverage checks;
- every existing-map material, prop, lightmap, and sky gap is either resolved or visible in Asset Coverage;
- optional gaps never masquerade as full coverage and never suppress usable world geometry;
- main-thread playback and UI remain responsive during conversion;
- the pilot Published Derived Map transfers fewer map-specific bytes than its current GLB before corpus migration begins;
- late or cancelled work never replaces the active map;
- local BSPs and Ad-hoc Derived Maps are never uploaded.

Exact WASM time and peak-memory gates are calibrated from the pilot on real desktop hardware, then committed as regression budgets. They are not guessed before a browser build and valid Shared Asset Pack exist.

## Decision ledger

| Decision                                                            | Reason                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Zero-input catalog resolution with Local Override                   | Normal viewing should work automatically without making catalog misses terminal.     |
| Catalog Canonical Build wins same-name ambiguity                    | The current demo parser exposes no exact BSP checksum.                               |
| `bsp-to-glb` is the sole map conversion core                        | It directly consumes compiled BSP data and targets dribble.tf's GLB-based renderer.  |
| `playsrc` is pattern evidence, not an integration dependency        | Its browser path uses a different canonical runtime format rather than `bsp-to-glb`. |
| Published and Ad-hoc maps share one Conversion Profile              | Prevents browser-generated maps from becoming a permanently lower-quality product.   |
| Shared TF2 assets are fetched individually from one versioned pack  | Preserves quality without duplicating common content in every map.                   |
| Browser conversion runs in a dedicated worker                       | Keeps static hosting and avoids blocking UI/playback.                                |
| First release is single-threaded and desktop conversion only        | Avoids premature COOP/COEP and low-memory complexity.                                |
| Serveme is the initial Map Catalog                                  | It covers the current competitive-map use case and exposes direct BSPs.              |
| Vercel external rewrite, not Function                               | Same-origin CORS relay is needed; map sizes exceed Function response limits.         |
| Uncompressed BSP first                                              | It already works; bzip2 is added only if measured bandwidth warrants it.             |
| SHA-256 defines Map Build identity                                  | Names, ETags, and timestamps are insufficient identity.                              |
| Cache Derived Maps, not BSPs                                        | Saves repeated conversion without retaining the largest replaceable input.           |
| Cache is best-effort and self-invalidating by full input identity   | Browser storage is not durable authority.                                            |
| Ad-hoc output remains local                                         | Automatic remote publication adds abuse, cost, and mutation boundaries.              |
| Missing optional assets degrade with explicit coverage              | A partial but honest world is more useful than a terminal missing-prop error.        |
| Existing GLBs are preserved until per-map validation passes         | Migration stays reversible and protects current visual quality.                      |
| Shared bugs are fixed in converter/adapter, not map exceptions      | One root fix covers Published and Ad-hoc callers.                                    |
| Shared Asset Pack redistribution was confirmed by the project owner | The required permission check was completed before implementation.                   |
