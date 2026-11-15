# Use one Conversion Profile for Published and Ad-hoc Derived Maps

Published and Ad-hoc Derived Maps use the same pinned `bsp-to-glb` behavior, Conversion Profile, and Shared Asset Pack version. Publication may add transport compression, but it cannot add a separate enrichment pipeline or change presentation semantics. This sacrifices native-only post-processing opportunities so that a map looks the same whether it was prepared ahead of time or generated in the browser.
