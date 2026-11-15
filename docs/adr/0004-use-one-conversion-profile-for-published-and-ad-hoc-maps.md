# Use one Conversion Profile for Published and Ad-hoc Derived Maps

Published and Ad-hoc Derived Maps use the same pinned `bsp-to-glb` behavior, Conversion Profile, and Shared Asset Pack version. Publication may add transport compression, but it cannot add a separate enrichment pipeline or change presentation semantics. This sacrifices native-only post-processing opportunities so that a map looks the same whether it was prepared ahead of time or generated in the browser.

## Meshopt is transport compression, not part of the profile

Published map models are meshopt-compressed (`scripts/meshopt-map.mjs`, a step of `scripts/convert-map.mjs`; see ADR 0005). That counts as transport compression under this decision, so Ad-hoc Derived Maps do not get it: they are built in the browser and kept in IndexedDB, never sent over the network, and the encoder would cost the viewer conversion time and memory for nothing it can see. For it to stay transport compression:

- It must leave the picture unchanged. The FILTER method does (0 changed pixels on the ADR 0005 map shots); QUANTIZE does not, since it misplaces instanced props, so it is not allowed.
- The viewer decodes it on every path (`GLTFLoader.setMeshoptDecoder` for published GLBs and for Derived Map `world.glb` components), so a Published Derived Map may carry a compressed `world.glb` and an ad-hoc one an uncompressed one.
- A Published Derived Map's manifest hashes the bytes it publishes, so its `world.glb` hash differs from an ad-hoc conversion of the same BSP. Identity is the BSP hash, converter revision, Conversion Profile and Shared Asset Pack version, never the component hashes.
