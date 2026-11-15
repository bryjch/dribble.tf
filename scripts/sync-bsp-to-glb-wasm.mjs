import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, '../bsp-to-glb/pkg')
const destination = resolve(root, 'src/vendor/bsp-to-glb')
const pin = JSON.parse(await readFile(resolve(root, 'scripts/bsp-to-glb-wasm-pin.json'), 'utf8'))
const wasm = await readFile(resolve(source, 'bsp_to_glb_bg.wasm'))
const actual = createHash('sha256').update(wasm).digest('hex')

if (actual !== pin.wasmSha256) throw new Error(`bsp-to-glb WASM SHA-256 mismatch: ${actual}`)
await mkdir(destination, { recursive: true })
await Promise.all(
  ['bsp_to_glb.js', 'bsp_to_glb.d.ts', 'bsp_to_glb_bg.wasm', 'bsp_to_glb_bg.wasm.d.ts'].map(file =>
    copyFile(resolve(source, file), resolve(destination, file))
  )
)
console.log(JSON.stringify({ ...pin, bytes: wasm.byteLength }))
