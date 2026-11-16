---
status: accepted
date: 2026-11-16
supersedes: 0002, 0003
amends: 0001
---

# Build maps ahead of time with bsp-to-glb

ADR 0002 planned Ad-hoc Derived Maps: any map a demo names would be converted in the viewer's browser, from a BSP relayed from serveme.tf, with TF2's common assets fetched from a Shared Asset Pack. The browser half was built, but the pack never was, and sizing it showed why: TF2 and HL2 hold about 155,000 materials and models, so one index would be tens of MB, while a map uses about 2% of them. Each map would also download its BSP (tens of MB) before converting. We parked it (branch `park/ad-hoc-derived-maps`; the plan stays in `docs/ad-hoc-map-conversion.md`) and build maps ahead of time instead.

## Decisions

1. **Maps are converted ahead of time, from their compiled BSP, by bsp-to-glb** (`npm run build:maps`, `scripts/maps/build-maps.mjs`), by hand or on a schedule. There's no Blender, VMF or Plumber step, so it can run on a server. bsp-to-glb is pinned to the same revision the viewmodel build uses (`scripts/lib/source-models.mjs`), with our patch applied on top (`scripts/lib/bsp-to-glb.patch`): faces lit by several light styles (switchable lights) sum their styles' lightmaps, as the game draws them with every light on, where upstream refuses the map's lightmaps; unresolvable materials and sizeless faces are skipped rather than failing the map.
2. **The output is files on the asset host (CloudFront in front of S3)**, uploaded with `npm run assets`, like every other model. `models/maps/index.json` lists the built maps; a new map ships by uploading, without deploying the site. The built files aren't committed: they're reproducible and the asset host is their home, while every rebuild would grow git's history for good. The index is committed as the record of each build (what BSP, converter build and `map.json` hash), and `npm run maps:pull` fetches the files into a checkout that wants them. Production builds leave `public/models` out of the deploy.
3. **A map is a folder of components named by `map.json`**: the world GLB (meshopt FILTER), base textures as WebP (half size, at most 1024 px, alpha only where a material blends), the flat RGBExp32 lightmap, and the materials, props, decals and visibility the viewer reads. Every file but `map.json` has a content-hashed name, so a rebuilt map never meets a stale cache.
4. **Prop models and skies are shared between maps** (`models/props/<hash>.glb`, `models/skybox/<sky>/`). This is what ADR 0001 wanted from the Shared Asset Pack, at the granularity the viewer loads: one file per model and skin, cached by the browser across maps.
5. **The viewer draws a built map with the Derived Map renderer** (`World.tsx`), with static props instanced. A map without a build shows "No 3D model for this map yet", and a demo of a version nobody built is shown on the nearest built version of the map's family, its name without the version (`src/utils/mapVersions.ts`: `koth_bagel_rc11` → `koth_bagel_rc12`, `cp_snakewater_u13` → `cp_snakewater_final1`).
6. **A map with lightmaps can be lit two ways** (Settings > Lighting). *Baked* (the default) is TF2's look: brushes take their light from the lightmaps alone, and props, which have none, keep 35% of the scene's light. Baked surfaces skip the renderer's ACES tone mapping (TF2 has none) and draw at 1.3x by default (Settings > Lighting > Brightness). *Flat* lights brushes and props alike by the scene's lights, as the Blender-built maps are. One shared shader uniform switches them.
7. **Doors are listed, and left out until the viewer animates map entities.** `map.json`'s `doors` names each func_door's brush model and the props riding it (and door props animated on their own). Drawn, they'd stand shut all match, so the viewer skips them (`DRAW_DOORS` in `World.tsx`); the same list is what animating them would start from.
8. **A map's packed files come first.** Community maps pack custom props, their materials and their skies into the BSP (its pakfile lump). The build extracts them (`scripts/maps/pakfile.py`) and looks there before TF2's VPKs, as the game does.
9. **Sky faces are padded and turned at build time.** TF2's side faces are often half height (the game repeats their bottom row below the horizon), and three's cube maps assume y up where the scene is Source's z up, so each face is written square and turned as the Blender-built skies were. They're content-hashed like map components and named in `map.json` (`skyboxFaces`).

## Consequences

- Once every Blender-built map had a build (2026-11), the Blender models, their skies, the lookup tables and the Blender conversion pipeline (`convert-map.mjs` and its helpers) were removed; git history keeps them. Positions saved relative to those models before 2026-11 convert through their recorded corners (`BLENDER_MODEL_CORNERS`).

- Maps nobody has built show "No 3D model for this map yet". Covering new maps is a pipeline job (pick names from demos.tf or serveme.tf), not a viewer feature.
- The serveme.tf relay (Vercel rewrite and dev proxy), the conversion worker and the vendored bsp-to-glb WASM are gone.
- Known gaps, all fixable in the converter or renderer: glass and water lack their envmap/refraction look; the 3D skybox (`sky_camera`) isn't drawn yet; props are lit by (dimmed) scene lights, not Source's per-prop lighting, so a prop in shade under baked lighting is still lit as if in the open. A pakfile texture that overrides a stock one by the same path can be shadowed by the shared texture cache (`scripts/temp/maps`).
