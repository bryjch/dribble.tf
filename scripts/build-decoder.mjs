// Builds decoder/ (stvtf, pinned, in a small Rust crate) to WebAssembly and copies it next to
// its loader in src/libs/decoder/. Needs Rust; rustup picks the version in
// decoder/rust-toolchain.toml. The built .wasm is committed, so `npm run build` needs no Rust.
import { execFileSync } from 'node:child_process'
import { copyFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const crate = join(root, 'decoder')
execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], {
  cwd: crate,
  stdio: 'inherit',
})
const built = join(crate, 'target/wasm32-unknown-unknown/release/dribble_decoder.wasm')
const out = join(root, 'src/libs/decoder/decoder.wasm')
copyFileSync(built, out)
console.log(`decoder.wasm: ${(statSync(out).size / 1048576).toFixed(1)} MB`)
