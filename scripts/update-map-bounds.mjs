/**
 * update-map-bounds.mjs
 *
 * Reads world bounds from a BSP file's models lump (lump 14, model 0 = worldspawn)
 * and patches the corresponding conversion.json with a `worldBounds` field.
 *
 * Usage:
 *   node scripts/update-map-bounds.mjs <bsp-path> [--out-dir <dir>]
 *
 * If --out-dir is not provided, it resolves the output directory from the map name
 * using public/models/maps/<mapName>/.
 *
 * Can also process all existing maps at once:
 *   node scripts/update-map-bounds.mjs --all --bsp-dir <directory-containing-bsp-files>
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const parseArgs = argv => {
  const args = new Map()
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args.set(key, next)
      i++
    } else {
      args.set(key, 'true')
    }
  }
  return { args, positional }
}

const readBspData = bspPath => {
  if (!fs.existsSync(bspPath)) {
    throw new Error(`Missing BSP file: ${bspPath}`)
  }
  const data = fs.readFileSync(bspPath)
  if (data.length < 8 || data.toString('utf8', 0, 4) !== 'VBSP') {
    throw new Error(`Unsupported BSP file (expected VBSP): ${bspPath}`)
  }
  return data
}

const createBspLumpReader = data => {
  const LUMP_COUNT = 64
  const lumps = []
  let offset = 8
  for (let index = 0; index < LUMP_COUNT; index += 1) {
    if (offset + 16 > data.length) {
      throw new Error('BSP lump table incomplete')
    }
    lumps.push({
      fileOffset: data.readInt32LE(offset),
      fileLength: data.readInt32LE(offset + 4),
    })
    offset += 16
  }
  const decompressLzmaLump = buf => {
    if (buf.length < 17 || buf.toString('ascii', 0, 4) !== 'LZMA') return buf
    const uncompSize = buf.readUInt32LE(4)
    const compSize = buf.readUInt32LE(8)
    const props = buf.subarray(12, 17)
    const compressed = buf.subarray(17, 17 + compSize)
    const header = Buffer.alloc(13)
    props.copy(header, 0)
    header.writeUInt32LE(uncompSize, 5)
    header.writeUInt32LE(0, 9)
    return execSync(
      `python3 -c "import sys,lzma;sys.stdout.buffer.write(lzma.decompress(sys.stdin.buffer.read(),format=lzma.FORMAT_ALONE))"`,
      { input: Buffer.concat([header, compressed]), maxBuffer: uncompSize + 1024 * 1024 }
    )
  }

  const readLump = lumpIndex => {
    const lump = lumps[lumpIndex]
    if (!lump || lump.fileLength <= 0) return Buffer.alloc(0)
    const start = lump.fileOffset
    const end = lump.fileOffset + lump.fileLength
    if (start < 0 || end > data.length || start >= end) return Buffer.alloc(0)
    const raw = data.subarray(start, end)
    if (raw.length >= 4 && raw.toString('ascii', 0, 4) === 'LZMA') {
      return decompressLzmaLump(raw)
    }
    return raw
  }
  return { readLump }
}

const readBspWorldBounds = bspPath => {
  const data = readBspData(bspPath)
  const { readLump } = createBspLumpReader(data)
  const entityLump = readLump(0)
  const text = entityLump.toString('utf8')

  const firstEntity = text.match(/\{([\s\S]*?)\}/)
  if (!firstEntity) {
    console.warn(`BSP entity lump: could not find worldspawn entity in ${bspPath}`)
    return null
  }

  const body = firstEntity[1]
  const minsMatch = body.match(/"world_mins"\s+"([^"]+)"/)
  const maxsMatch = body.match(/"world_maxs"\s+"([^"]+)"/)

  if (!minsMatch || !maxsMatch) {
    console.warn(`BSP worldspawn entity missing world_mins/world_maxs in ${bspPath}`)
    return null
  }

  const mins = minsMatch[1].split(/\s+/).map(Number)
  const maxs = maxsMatch[1].split(/\s+/).map(Number)

  if (mins.length < 3 || maxs.length < 3 || mins.some(isNaN) || maxs.some(isNaN)) {
    console.warn(`BSP world_mins/world_maxs: failed to parse coordinates in ${bspPath}`)
    return null
  }

  return {
    boundaryMin: { x: mins[0], y: mins[1], z: mins[2] },
    boundaryMax: { x: maxs[0], y: maxs[1], z: maxs[2] },
  }
}

const patchConversionJson = (conversionJsonPath, worldBounds) => {
  let meta = {}
  if (fs.existsSync(conversionJsonPath)) {
    meta = JSON.parse(fs.readFileSync(conversionJsonPath, 'utf8'))
  }
  meta.worldBounds = worldBounds
  fs.writeFileSync(conversionJsonPath, JSON.stringify(meta, null, 2))
}

const updateSingleMap = (bspPath, outDir) => {
  const mapName = path.basename(bspPath, '.bsp')
  const resolvedOutDir = outDir || path.join(repoRoot, 'public', 'models', 'maps', mapName)
  const conversionJsonPath = path.join(resolvedOutDir, 'conversion.json')

  const worldBounds = readBspWorldBounds(bspPath)
  if (!worldBounds) {
    console.error(`  Failed to read world bounds from: ${bspPath}`)
    return false
  }

  if (!fs.existsSync(resolvedOutDir)) {
    fs.mkdirSync(resolvedOutDir, { recursive: true })
  }

  patchConversionJson(conversionJsonPath, worldBounds)
  console.log(`  ${mapName}: min=(${worldBounds.boundaryMin.x}, ${worldBounds.boundaryMin.y}, ${worldBounds.boundaryMin.z}) max=(${worldBounds.boundaryMax.x}, ${worldBounds.boundaryMax.y}, ${worldBounds.boundaryMax.z})`)
  return true
}

// ── Main ──

const { args, positional } = parseArgs(process.argv.slice(2))

if (args.has('all')) {
  const bspDir = args.get('bsp-dir')
  if (!bspDir || !fs.existsSync(bspDir)) {
    console.error('--all requires --bsp-dir <directory> pointing to a folder of .bsp files')
    process.exit(1)
  }

  // Find all map folders that have a conversion.json
  const mapsDir = path.join(repoRoot, 'public', 'models', 'maps')
  const mapFolders = fs.readdirSync(mapsDir).filter(name => {
    return fs.existsSync(path.join(mapsDir, name, 'conversion.json'))
  })

  console.log(`Found ${mapFolders.length} maps with conversion.json`)

  // Collect all BSP files in the bsp-dir (recursively one level)
  const bspFiles = new Map()
  const scanDir = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.bsp')) {
        bspFiles.set(path.basename(entry.name, '.bsp'), path.join(dir, entry.name))
      } else if (entry.isDirectory()) {
        for (const sub of fs.readdirSync(path.join(dir, entry.name), { withFileTypes: true })) {
          if (sub.isFile() && sub.name.toLowerCase().endsWith('.bsp')) {
            bspFiles.set(path.basename(sub.name, '.bsp'), path.join(dir, entry.name, sub.name))
          }
        }
      }
    }
  }
  scanDir(bspDir)

  let updated = 0
  let skipped = 0
  for (const folder of mapFolders) {
    const bspPath = bspFiles.get(folder)
    if (!bspPath) {
      console.log(`  ${folder}: no matching BSP found, skipping`)
      skipped++
      continue
    }
    const outDir = path.join(mapsDir, folder)
    if (updateSingleMap(bspPath, outDir)) {
      updated++
    }
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped`)
} else {
  if (positional.length === 0) {
    console.error('Usage: node scripts/update-map-bounds.mjs <bsp-path> [--out-dir <dir>]')
    console.error('       node scripts/update-map-bounds.mjs --all --bsp-dir <directory>')
    process.exit(1)
  }

  const bspPath = path.resolve(positional[0])
  const outDir = args.get('out-dir') || null
  console.log(`Reading world bounds from: ${bspPath}`)
  if (!updateSingleMap(bspPath, outDir)) {
    process.exit(1)
  }
  console.log('Done.')
}
