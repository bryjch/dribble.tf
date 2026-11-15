// Loads decoder.wasm (built from decoder/ by `npm run build:decoder`) and decodes a demo with it.
// One decode per instance: the module's memory grows to hold the whole demo and never shrinks,
// so each decode gets a fresh instance, which is dropped once its arrays are copied out.

const ARRAYS = { 4: Uint32Array, 2: Uint16Array, 1: Uint8Array }

let compiled = null

/** Compiles the module once; `source` is its bytes (Node) or omitted to fetch it (browser). */
export async function initDecoder(source) {
  if (!compiled) {
    compiled = source ? WebAssembly.compile(source) : fetchModule()
  }
  return compiled
}

async function fetchModule() {
  const url = new URL('./decoder.wasm', import.meta.url)
  try {
    return await WebAssembly.compileStreaming(fetch(url))
  } catch {
    // compileStreaming needs the server to say application/wasm; not every host does.
    const response = await fetch(url)
    return WebAssembly.compile(await response.arrayBuffer())
  }
}

/**
 * Decodes a demo. Resolves to its metadata (see decoder/src/lib.rs, `finish`) and its typed
 * arrays, copied out of the module's memory; rejects with the decoder's error.
 */
export async function decodeDemo(bytes, onProgress) {
  const module = await initDecoder()
  const instance = await WebAssembly.instantiate(module, {
    env: { progress: fraction => onProgress?.(fraction) },
  })
  const x = instance.exports
  const input = new Uint8Array(bytes)
  const ptr = x.alloc(input.length)
  new Uint8Array(x.memory.buffer, ptr, input.length).set(input)
  const ok = x.decode_demo(ptr, input.length)

  const text = new TextDecoder().decode(
    new Uint8Array(x.memory.buffer, x.meta_ptr(), x.meta_len())
  )
  if (!ok) throw new Error(text || 'Failed to decode the demo.')

  const buffers = []
  for (let i = 0; i < x.buffer_count(); i++) {
    const Array = ARRAYS[x.buffer_width(i)]
    buffers.push(new Array(x.memory.buffer, x.buffer_ptr(i), x.buffer_len(i)).slice())
  }
  return { meta: JSON.parse(text), buffers }
}
