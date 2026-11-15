# Generate Ad-hoc Derived Maps in the browser

Ad-hoc Derived Maps are generated in a Web Worker by a WASM build of `bsp-to-glb`, with no backend conversion service; Published Derived Maps use the same Conversion Profile through the native converter. This preserves dribble.tf's static hosting model and removes server conversion operations at the cost of using the viewer's CPU and memory.
