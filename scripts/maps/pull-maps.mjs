// Fetches built maps from the asset host into public/models, for a checkout that didn't build
// them: the built files aren't in git, only maps/index.json, which records each build.
//
//   npm run maps:pull -- [map...] [--asset-url https://…] [--force]
//
// With no names, every map in the index. Each map.json is checked against the hash the index
// recorded; a mismatch means the asset host has another build (newer or older than this
// checkout's index), and that map is skipped unless --force. Files already here are kept.
// The asset URL is VITE_APP_ASSET_URL, from the environment or a .env (this checkout's or the
// main checkout's, where npm run assets saves it).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAssetUrl } from '../lib/asset-url.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const modelsDir = path.join(repoRoot, 'public/models')
const CONCURRENCY = 12

const argv = process.argv.slice(2)
const options = { force: false, assetUrl: null }
const names = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--force') options.force = true
  else if (argv[i] === '--asset-url') options.assetUrl = argv[++i]
  else if (argv[i].startsWith('--')) {
    console.error('usage: pull-maps.mjs [map...] [--asset-url https://…] [--force]')
    process.exit(1)
  } else names.push(argv[i])
}

const base = options.assetUrl?.replace(/\/+$/, '') ?? findAssetUrl(repoRoot)
if (!base) {
  console.error('No asset URL: set VITE_APP_ASSET_URL (in .env) or pass --asset-url')
  process.exit(1)
}

const index = JSON.parse(fs.readFileSync(path.join(modelsDir, 'maps/index.json'), 'utf8'))
const wanted = names.length ? names : Object.keys(index.maps)
const unknown = wanted.filter(name => !index.maps[name])
if (unknown.length) {
  console.error(`Not in maps/index.json: ${unknown.join(', ')}`)
  process.exit(1)
}

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

async function download(relative) {
  const response = await fetch(`${base}/models/${relative}`)
  if (!response.ok) throw new Error(`${relative}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** Fetches each file (paths under models/) that isn't here yet, CONCURRENCY at a time. */
async function fetchMissing(files) {
  const todo = files.filter(file => !fs.existsSync(path.join(modelsDir, file)))
  let next = 0
  let bytes = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
      while (next < todo.length) {
        const file = todo[next++]
        const data = await download(file)
        fs.mkdirSync(path.dirname(path.join(modelsDir, file)), { recursive: true })
        fs.writeFileSync(path.join(modelsDir, file), data)
        bytes += data.length
      }
    })
  )
  return { fetched: todo.length, bytes }
}

let pulled = 0
const problems = []
for (const name of wanted) {
  const recorded = index.maps[name]
  try {
    const manifestBytes = await download(`maps/${name}/map.json`)
    if (recorded.mapJson && sha256(manifestBytes) !== recorded.mapJson.sha256 && !options.force) {
      problems.push(
        `${name}: the asset host has another build than maps/index.json records (--force takes it)`
      )
      continue
    }
    const manifest = JSON.parse(manifestBytes)
    const files = [
      ...manifest.components.map(component => `maps/${name}/${component.file}`),
      ...[...new Set(Object.values(manifest.props ?? {}))].map(file => `props/${file}`),
      ...Object.values(manifest.skyboxFaces ?? {}),
    ]
    const { fetched, bytes } = await fetchMissing(files)
    fs.mkdirSync(path.join(modelsDir, 'maps', name), { recursive: true })
    fs.writeFileSync(path.join(modelsDir, 'maps', name, 'map.json'), manifestBytes)
    pulled++
    console.log(
      `${name}: ${fetched ? `${fetched} files, ${(bytes / 1048576).toFixed(1)} MB` : 'already here'}`
    )
  } catch (error) {
    problems.push(`${name}: ${error.message ?? error}`)
  }
}

console.log(`\n${pulled} of ${wanted.length} maps pulled from ${base}`)
for (const problem of problems) console.warn(`  ! ${problem}`)
if (problems.length) process.exit(1)
