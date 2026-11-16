---
status: accepted
date: 2026-11-16
supersedes: 0002, 0003
amends: 0001
---

# Build maps ahead of time with bsp-to-glb

ADR 0002 planned Ad-hoc Derived Maps: any map a demo names would be converted in the viewer's browser, from a BSP relayed from serveme.tf, with TF2's common assets fetched from a Shared Asset Pack. The browser half was built, but the pack never was, and sizing it showed why: TF2 and HL2 hold about 155,000 materials and models, so one index would be tens of MB, while a map uses about 2% of them. Each map would also download its BSP (tens of MB) before converting. We parked it (branch `park/ad-hoc-derived-maps`; the plan stays in `docs/ad-hoc-map-conversion.md`) and build maps ahead of time instead.

## Decisions

1. **Maps are converted ahead of time, from their compiled BSP, by bsp-to-glb** (`npm run build:maps`, `scripts/maps/build-maps.mjs`), by hand or on a schedule. There's no Blender, VMF or Plumber step, so it can run on a server. bsp-to-glb is pinned to the same revision the viewmodel build uses (`scripts/lib/source-models.mjs`).
2. **The output is files on the asset host (CloudFront in front of S3)**, uploaded with `npm run assets`, like every other model. `models/maps/index.json` lists the built maps; a new map ships by uploading, without deploying the site.
3. **A map is a folder of components named by `map.json`**: the world GLB (meshopt FILTER), base textures as WebP (half size, at most 1024 px, alpha only where a material blends), the flat RGBExp32 lightmap, and the materials, props, decals and visibility the viewer reads. Every file but `map.json` has a content-hashed name, so a rebuilt map never meets a stale cache.
4. **Prop models and skies are shared between maps** (`models/props/<hash>.glb`, `models/skybox/<sky>/`). This is what ADR 0001 wanted from the Shared Asset Pack, at the granularity the viewer loads: one file per model and skin, cached by the browser across maps.
5. **The viewer draws a built map with the Derived Map renderer** (`World.tsx`), with static props instanced. A map without a build falls back to its Blender-built GLB (`MAP_NAME_SEARCH_MAP`), and a demo's map version falls back to the version dribble.tf has (`cp_snakewater_u13` → `cp_snakewater_final1`).

## Consequences

- Maps nobody has built show "No 3D model for this map yet". Covering new maps is a pipeline job (pick names from demos.tf or serveme.tf), not a viewer feature.
- The serveme.tf relay (Vercel rewrite and dev proxy), the conversion worker and the vendored bsp-to-glb WASM are gone.
- Known gaps, all fixable in the converter or renderer: faces lit by switchable light styles make bsp-to-glb refuse a map's lightmaps (those maps build unlit by them, e.g. cp_gullywash_f9); glass and water lack their envmap/refraction look; the 3D skybox (`sky_camera`) isn't drawn yet; props are lit by scene lights, not Source's per-prop lighting; custom skies packed in a BSP aren't read.
