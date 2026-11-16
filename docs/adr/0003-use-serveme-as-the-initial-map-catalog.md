# Use serveme.tf as the initial Map Catalog

> Superseded by ADR 0006: the viewer no longer downloads BSPs. `scripts/maps/build-maps.mjs` still fetches them from serveme.tf's FastDL when it builds a map.

The initial Map Catalog is `serveme.tf`, with BSP downloads relayed through a same-origin Vercel external rewrite because its FastDL responses do not permit browser cross-origin reads. The rewrite accepts only a bounded Map Name path and forwards to the fixed serveme.tf download origin; it never accepts arbitrary upstream URLs. A Vercel Function is not used because ordinary BSP responses exceed its response-body limit. Local Override remains the path for catalog misses.
