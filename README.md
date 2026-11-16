
[![Live website](https://img.shields.io/badge/-View%20Live-%2300C7B7?logo=Netlify&style=flat-square&logoColor=white)](https://dribble.tf/)
[![Trello board](https://img.shields.io/badge/-Trello-%230079BF?logo=trello&style=flat-square)](https://trello.com/b/u7ru88YG/dribbletf)

## TF2 Demo Replay in Browser / [dribble.tf](https://dribble.tf/)

View your Team Fortress 2 STV demo files directly in the browser.

Utilizes [three.js](https://threejs.org) for browser based 3D rendering.

Models are primarily served as glTF assets.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the viewer locally. Models load from `public/models`, so freshly built maps can be checked here before they're uploaded. |
| `npm run build` | Builds the site for production, where models load from the CDN (`VITE_APP_ASSET_URL`). |
| `npm run assets` | The step-by-step way to update the models: gets TF2's files, rebuilds viewmodels and buildings, builds maps, uploads `public/models` to the CDN and refreshes its cache. It checks your AWS login and finds the bucket itself, and every step can be skipped. |
| `npm run build:maps -- <map>...` | Converts maps from their BSP (downloaded from serveme.tf) into `public/models/maps`. Unchanged maps are skipped; `--force` rebuilds them. |
| `npm run maps:popular` | Reads recent demos from demos.tf and lists the maps with no 3D map, or shown on another version, with a `build:maps` command for the most played ones. |
| `npm run build:viewmodels` | Rebuilds the first-person arms and weapons and the engineer's buildings from TF2's files. |
| `npm run build:decoder` | Rebuilds the demo decoder (Rust → WebAssembly). Only needed when `decoder/` changes. |

### Adding maps

1. `npm run maps:popular` to see what demos need.
2. `npm run build:maps -- <map>...` to build them (a few minutes each).
3. `npm run dev` and pick them from the Maps tab, or open a demo, to check they look right.
4. Commit, then `npm run assets`, press Enter at the map names, and choose "built maps only" to upload. They're live once uploaded; no deploy needed.

A demo recorded on a version nobody built is shown on the nearest built version of that map. Maps with no build fall back to the older Blender-made models, else show "No 3D model for this map yet". See [ADR 0006](docs/adr/0006-build-maps-ahead-of-time-with-bsp-to-glb.md) for how maps are built.

### Credits

- [@dylansq](https://github.com/dylansq) - solving map models, textures, skyboxes and grinding map exports
- [demos.tf](https://github.com/demostf/demos.tf) by [@icewind1991](https://github.com/icewind1991) - 2D viewer as basis for the project
- [stvtf](https://github.com/Arie/stvtf) by [@Arie](https://github.com/Arie), on [demostf/parser](https://github.com/demostf/parser) - parsing .dem files
- [bsp-to-glb](https://github.com/Hona/bsp-to-glb) by [@Hona](https://github.com/Hona) - converting maps, props and viewmodels from TF2's files
- [demos.tf](https://demos.tf) - the demo list `npm run maps:popular` reads
- [io_import_vmt](https://github.com/lasa01/io_import_vmf) by [@lasa01](https://github.com/lasa01) - import maps into Blender, for exporting as .gltf
- [react-canvas-draw](https://github.com/embiem/react-canvas-draw) by [embiem](https://github.com/embiem) - canvas drawing tools

-----

<img alt="dribble interface normal" src="https://github.com/bryjch/dribble.tf/assets/9291779/4b6d62ed-52bb-4302-86c2-bb9e44664d76">
<img alt="dribble interface drawing" src="https://github.com/bryjch/dribble.tf/assets/9291779/36d990f8-d310-4f84-b5be-cfdccea70554">
