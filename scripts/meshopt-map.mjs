#!/usr/bin/env node
//
// Compresses a map model's geometry with EXT_meshopt_compression, in place or to a new file:
//
//   node scripts/meshopt-map.mjs <input.glb> [output.glb]
//
// Uses meshopt's FILTER method, which keeps vertex data in the model's own coordinates. The
// QUANTIZE method (the gltf-transform CLI's `meshopt`) moves each mesh into a quantized space
// and adds a node transform to undo it, which lands outside EXT_mesh_gpu_instancing's instance
// transforms and misplaces instanced props (trees, rocks). World.tsx decodes with three's
// MeshoptDecoder.
//
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { reorder } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const [input, output = input] = process.argv.slice(2)
if (!input) {
  console.error('usage: meshopt-map.mjs <input.glb> [output.glb]')
  process.exit(1)
}

await MeshoptEncoder.ready
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
})

const document = await io.read(input)
await document.transform(reorder({ encoder: MeshoptEncoder, level: 'medium' }))
document
  .createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER })
await io.write(output, document)
