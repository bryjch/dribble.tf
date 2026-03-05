import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync, spawnSync } from 'node:child_process'
import * as THREE from 'three'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const mapChunkingConfigPath = path.join(repoRoot, 'src', 'constants', 'mapChunking.json')
const mapChunkingConfig = JSON.parse(fs.readFileSync(mapChunkingConfigPath, 'utf8'))
const MAP_CHUNKING_ENABLED = mapChunkingConfig.enabled === true

const parseArgs = argv => {
  const args = new Map()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args.set(key, next)
      i++
    } else {
      args.set(key, 'true')
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

// ── Config file loading ──
// Config values are used as fallbacks when CLI args are not provided.
const defaultConfigPath = path.join(repoRoot, 'scripts', 'convert-config.json')
const configPath = args.get('config') ?? defaultConfigPath
let config = {}
if (configPath && fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (error) {
    throw new Error(`Failed to parse config file ${configPath}: ${error.message}`)
  }
} else if (args.has('config')) {
  throw new Error(`Config file not found: ${configPath}`)
}

const toBool = (value, fallback = false) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false
  }
  return fallback
}

const getArg = (key, fallback) => {
  return args.get(key) ?? config[key] ?? fallback
}

const requireArg = key => {
  const value = getArg(key)
  if (!value) {
    throw new Error(`Missing required argument: --${key}`)
  }
  return value
}

const runCommand = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    shell: false,
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${commandArgs.join(' ')}`)
  }
}

const ensureDir = dir => {
  fs.mkdirSync(dir, { recursive: true })
}

const hasNonEmptyFile = filePath => {
  return fs.existsSync(filePath) && fs.statSync(filePath).size > 0
}

const statOutputFile = filePath => {
  return {
    file: path.basename(filePath),
    bytes: fs.statSync(filePath).size,
  }
}

const parseNormalizedScaleArg = (value, argName) => {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new Error(`Invalid --${argName}: ${value}. Expected a number greater than 0 and at most 1.`)
  }
  return String(parsed)
}

const formatScaleForFileName = value => {
  return String(value).replace(/\./g, 'p')
}

const findFirstFile = (dir, predicate) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const match = findFirstFile(fullPath, predicate)
      if (match) return match
    } else if (predicate(fullPath)) {
      return fullPath
    }
  }
  return null
}

const findFileByName = (dir, fileName) => {
  return findFirstFile(dir, filePath => path.basename(filePath).toLowerCase() === fileName)
}

const normalizeMaterialReference = value => {
  if (value == null) return null
  const cleaned = String(value).trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '')
  if (!cleaned) return null
  if (/^\d+$/.test(cleaned)) return null

  let normalized = cleaned
  if (normalized.toLowerCase().startsWith('materials/')) {
    normalized = normalized.slice('materials/'.length)
  }
  normalized = normalized.replace(/^\//, '')
  if (!normalized.toLowerCase().endsWith('.vmt')) normalized += '.vmt'
  return `materials/${normalized.toLowerCase()}`
}

const parseVmtBoolean = value => {
  if (value == null) return false
  const normalized = String(value).trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

const parseVmtMaterialFile = text => {
  const scrubbed = String(text || '')
    .replace(/\/\/[^\n\r]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  const shaderMatch = scrubbed.match(/^\s*"?([A-Za-z0-9_]+)"?\s*\{/m)
  const entries = {}
  for (const match of scrubbed.matchAll(/"([^"]+)"\s+"([^"]*)"/g)) {
    entries[String(match[1]).trim().toLowerCase()] = String(match[2]).trim()
  }

  const envMapRaw = entries['$envmap']
  const hasEnvMap =
    typeof envMapRaw === 'string' &&
    envMapRaw.trim() !== '' &&
    !['0', 'none', 'null', 'editor/cubemap', 'env_cubemap'].includes(envMapRaw.trim().toLowerCase())

  return {
    shader: shaderMatch ? String(shaderMatch[1]).toLowerCase() : null,
    include: normalizeMaterialReference(entries.include),
    baseTexture: entries['$basetexture'] || null,
    bumpMap: entries['$bumpmap'] || entries['$normalmap'] || null,
    surfaceProp: entries['$surfaceprop'] || null,
    translucent: parseVmtBoolean(entries['$translucent']) || parseVmtBoolean(entries['$alpha']),
    additive: parseVmtBoolean(entries['$additive']),
    selfIllum: parseVmtBoolean(entries['$selfillum']),
    alphaTest: parseVmtBoolean(entries['$alphatest']),
    noCull: parseVmtBoolean(entries['$nocull']),
    hasEnvMap,
  }
}

const readVmfMaterialReferences = vmfPath => {
  try {
    const text = fs.readFileSync(vmfPath, 'utf8')
    const refs = new Set()
    for (const match of text.matchAll(/"material"\s+"([^"]+)"/gi)) {
      const normalized = normalizeMaterialReference(match[1])
      if (normalized) refs.add(normalized)
    }
    return Array.from(refs).sort()
  } catch {
    return []
  }
}

/**
 * Pre-filter a decompiled VMF to strip brush entities that should be invisible
 * at runtime according to Source engine rules.  Plumber imports ALL brush
 * entities (including func_brush, triggers) when vmf_import_brushes=True, but
 * has no concept of rendermode, StartDisabled, or trigger EF_NODRAW.
 *
 * Entities removed:
 *  - func_brush  with StartDisabled=1  (hidden until I/O toggles them on)
 *  - Any brush entity with rendermode=10 (kRenderNone) or rendermode=6
 *  - trigger_* entities  (always EF_NODRAW in engine)
 *  - func_occluder       (visibility helper, not rendered)
 *
 * The filtered VMF is written next to the original with a `_filtered` suffix.
 * Returns the path to the filtered file.
 */
const filterVmfInvisibleEntities = vmfPath => {
  const raw = fs.readFileSync(vmfPath, 'utf8')

  /* ── Tokenise into top-level blocks ── */
  const blocks = [] // { start, end, header }
  let depth = 0
  let blockStart = -1
  let headerStart = -1
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '{') {
      if (depth === 0) {
        blockStart = headerStart >= 0 ? headerStart : i
      }
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && blockStart >= 0) {
        blocks.push({ start: blockStart, end: i + 1, header: raw.slice(blockStart, i + 1) })
        blockStart = -1
        headerStart = -1
      }
    } else if (depth === 0 && /\S/.test(ch) && headerStart < 0) {
      headerStart = i
    }
  }

  const readProp = (text, key) => {
    const re = new RegExp(`"${key}"\\s+"([^"]*)"`, 'i')
    const m = text.match(re)
    return m ? m[1] : null
  }

  /* ── Decide which entity blocks to keep ── */
  let removed = 0
  const removedClassnames = {}
  const keep = new Uint8Array(blocks.length)
  for (let i = 0; i < blocks.length; i++) {
    const text = blocks[i].header
    keep[i] = 1

    const classname = readProp(text, 'classname')
    if (!classname) continue // worldspawn or non-entity – always keep

    const cn = classname.toLowerCase()

    // Triggers are always invisible (EF_NODRAW via InitTrigger)
    if (cn.startsWith('trigger_')) {
      keep[i] = 0
      removed++
      removedClassnames[cn] = (removedClassnames[cn] || 0) + 1
      continue
    }

    // func_occluder is a visibility optimisation brush, not rendered
    if (cn === 'func_occluder') {
      keep[i] = 0
      removed++
      removedClassnames[cn] = (removedClassnames[cn] || 0) + 1
      continue
    }

    // rendermode=10 (kRenderNone) or rendermode=6 (kRenderEnvironmental) → never drawn
    const rendermode = Number(readProp(text, 'rendermode') ?? '0')
    if (rendermode === 10 || rendermode === 6) {
      keep[i] = 0
      removed++
      removedClassnames[cn] = (removedClassnames[cn] || 0) + 1
      continue
    }

    // func_brush with StartDisabled=1 → hidden at spawn (no game I/O in our viewer)
    if (cn === 'func_brush') {
      const startDisabled = Number(readProp(text, 'StartDisabled') ?? '0')
      if (startDisabled === 1) {
        keep[i] = 0
        removed++
        removedClassnames[cn] = (removedClassnames[cn] || 0) + 1
        continue
      }
    }
  }

  if (removed === 0) {
    console.log('VMF filter: nothing to remove, using original VMF.')
    return vmfPath
  }

  /* ── Rebuild the file, skipping removed blocks ── */
  const parts = []
  let cursor = 0
  for (let i = 0; i < blocks.length; i++) {
    if (keep[i]) continue
    parts.push(raw.slice(cursor, blocks[i].start))
    cursor = blocks[i].end
  }
  parts.push(raw.slice(cursor))

  const filteredPath = vmfPath.replace(/\.vmf$/i, '_filtered.vmf')
  fs.writeFileSync(filteredPath, parts.join(''), 'utf8')

  const summary = Object.entries(removedClassnames)
    .map(([cn, n]) => `${cn}(${n})`)
    .join(', ')
  console.log(`VMF filter: removed ${removed} invisible entities [${summary}]`)
  console.log(`Filtered VMF: ${filteredPath}`)

  return filteredPath
}

const readSkyname = vmfPath => {
  const content = fs.readFileSync(vmfPath, 'utf8')
  const match = content.match(/"skyname"\s+"([^"]+)"/i)
  if (!match) {
    throw new Error('Unable to find skyname in VMF.')
  }
  return match[1]
}

const countVmfLightEntities = vmfPath => {
  const content = fs.readFileSync(vmfPath, 'utf8')
  const matches = content.match(
    /"classname"\s+"(light|light_spot|light_environment|light_dynamic|light_dynamic_relative|light_glspot)"/gi
  )
  return matches ? matches.length : 0
}

const readGlbPunctualLightCount = glbPath => {
  if (!fs.existsSync(glbPath)) return 0
  const data = fs.readFileSync(glbPath)
  if (data.length < 20) return 0
  if (data.toString('utf8', 0, 4) !== 'glTF') return 0

  const jsonChunkLength = data.readUInt32LE(12)
  const jsonChunkType = data.toString('utf8', 16, 20)
  if (jsonChunkType !== 'JSON' || jsonChunkLength <= 0) return 0

  const jsonStart = 20
  const jsonEnd = jsonStart + jsonChunkLength
  if (jsonEnd > data.length) return 0

  const json = JSON.parse(data.toString('utf8', jsonStart, jsonEnd))
  const lights = json?.extensions?.KHR_lights_punctual?.lights
  return Array.isArray(lights) ? lights.length : 0
}

const clampColorByte = value => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

const parseVmfColorBrightness = value => {
  if (typeof value !== 'string') return null
  const parts = value
    .trim()
    .split(/\s+/)
    .map(item => Number(item))

  if (parts.length < 3) return null
  if (parts.slice(0, 3).some(component => !Number.isFinite(component) || component < 0)) return null

  return {
    color: [clampColorByte(parts[0]), clampColorByte(parts[1]), clampColorByte(parts[2])],
    brightness: Number.isFinite(parts[3]) ? Math.max(0, parts[3]) : null,
  }
}

const parseEntityNumber = value => {
  if (typeof value !== 'string') return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return numeric
}

const parseVmfRgb = value => {
  if (typeof value !== 'string') return null
  const parts = value
    .trim()
    .split(/\s+/)
    .map(item => Number(item))
  if (parts.length < 3 || parts.slice(0, 3).some(component => !Number.isFinite(component)))
    return null
  return [clampColorByte(parts[0]), clampColorByte(parts[1]), clampColorByte(parts[2])]
}

const escapeRegExp = value => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const readVmfLightEnvironment = vmfPath => {
  const content = fs.readFileSync(vmfPath, 'utf8')
  const entityBlocks = content.match(/entity\s*\{[\s\S]*?\n\}/gi) ?? []

  const readField = (entityText, key) => {
    const match = entityText.match(new RegExp(`"${escapeRegExp(key)}"\\s+"([^"]+)"`, 'i'))
    return match ? match[1] : null
  }

  for (const entityText of entityBlocks) {
    const className = readField(entityText, 'classname')
    if (!className || className.toLowerCase() !== 'light_environment') continue

    const ambient =
      parseVmfColorBrightness(readField(entityText, '_ambient')) ??
      parseVmfColorBrightness(readField(entityText, '_ambientHDR'))
    const sun =
      parseVmfColorBrightness(readField(entityText, '_light')) ??
      parseVmfColorBrightness(readField(entityText, '_lightHDR'))

    const angles = readField(entityText, 'angles')
    let yaw = null
    if (angles) {
      const parts = angles
        .trim()
        .split(/\s+/)
        .map(item => Number(item))
      if (parts.length >= 2 && Number.isFinite(parts[1])) {
        yaw = parts[1]
      }
    }

    return {
      ambient,
      sun,
      pitch: parseEntityNumber(readField(entityText, 'pitch')),
      yaw,
      sunSpreadAngle: parseEntityNumber(readField(entityText, 'SunSpreadAngle')),
    }
  }

  return null
}

const readVmfFogSettings = vmfPath => {
  const content = fs.readFileSync(vmfPath, 'utf8')
  const worldspawnMatch = content.match(/worldspawn\s*\{[\s\S]*?\n\}/i)
  if (!worldspawnMatch) return null

  const worldspawnText = worldspawnMatch[0]
  const readField = key => {
    const match = worldspawnText.match(new RegExp(`"${escapeRegExp(key)}"\\s+"([^"]+)"`, 'i'))
    return match ? match[1] : null
  }

  const enabledValue = readField('fogenable') ?? readField('fog_enable')
  const enabled = enabledValue === '1'
  const primaryColor = parseVmfRgb(readField('fogcolor'))
  const secondaryColor = parseVmfRgb(readField('fogcolor2'))
  const start = parseEntityNumber(readField('fogstart'))
  const end = parseEntityNumber(readField('fogend'))
  const maxDensity = parseEntityNumber(readField('fogmaxdensity'))
  const farZ = parseEntityNumber(readField('farz'))

  if (
    !enabled &&
    !primaryColor &&
    !secondaryColor &&
    !Number.isFinite(start) &&
    !Number.isFinite(end)
  ) {
    return null
  }

  return {
    enabled,
    primaryColor,
    secondaryColor,
    start: Number.isFinite(start) ? Math.max(0, start) : null,
    end: Number.isFinite(end) ? Math.max(0, end) : null,
    maxDensity: Number.isFinite(maxDensity) ? Math.max(0, Math.min(1, maxDensity)) : null,
    farZ: Number.isFinite(farZ) ? Math.max(0, farZ) : null,
  }
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
    if (!lump || lump.fileLength <= 0) {
      return Buffer.alloc(0)
    }

    const start = lump.fileOffset
    const end = lump.fileOffset + lump.fileLength
    if (start < 0 || end > data.length || start >= end) {
      return Buffer.alloc(0)
    }

    const raw = data.subarray(start, end)
    if (raw.length >= 4 && raw.toString('ascii', 0, 4) === 'LZMA') {
      return decompressLzmaLump(raw)
    }
    return raw
  }

  return { readLump }
}

const GLTF_COMPONENT_BYTE_SIZES = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
}

const GLTF_TYPE_COMPONENT_COUNTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
}

const parseChunkClusterVisibility = ({ bspPath, glbPath }) => {
  const data = readBspData(bspPath)
  const { readLump } = createBspLumpReader(data)

  const LUMP_PLANES = 1
  const LUMP_NODES = 5
  const LUMP_VISIBILITY = 4
  const LUMP_LEAFS = 10

  const planeLump = readLump(LUMP_PLANES)
  const planes = []
  for (let planeOffset = 0; planeOffset + 20 <= planeLump.length; planeOffset += 20) {
    planes.push([
      Number(planeLump.readFloatLE(planeOffset + 0).toFixed(5)),
      Number(planeLump.readFloatLE(planeOffset + 4).toFixed(5)),
      Number(planeLump.readFloatLE(planeOffset + 8).toFixed(5)),
      Number(planeLump.readFloatLE(planeOffset + 12).toFixed(5)),
    ])
  }

  const nodeLump = readLump(LUMP_NODES)
  const nodes = []
  for (let nodeOffset = 0; nodeOffset + 32 <= nodeLump.length; nodeOffset += 32) {
    nodes.push([
      nodeLump.readInt32LE(nodeOffset + 0),
      nodeLump.readInt32LE(nodeOffset + 4),
      nodeLump.readInt32LE(nodeOffset + 8),
    ])
  }

  const leafLump = readLump(LUMP_LEAFS)
  const leafClusters = []
  for (let leafOffset = 0; leafOffset + 32 <= leafLump.length; leafOffset += 32) {
    leafClusters.push(leafLump.readInt16LE(leafOffset + 4))
  }

  const visibilityLump = readLump(LUMP_VISIBILITY)
  const clusterCount = visibilityLump.length >= 4 ? visibilityLump.readInt32LE(0) : 0
  const clusterVisibilityOffsets = []
  for (let clusterIndex = 0; clusterIndex < clusterCount; clusterIndex += 1) {
    const rowOffset = 4 + clusterIndex * 8
    if (rowOffset + 4 > visibilityLump.length) {
      clusterVisibilityOffsets.push(-1)
      continue
    }
    clusterVisibilityOffsets.push(visibilityLump.readInt32LE(rowOffset))
  }

  const decodeClusterVisibilityRow = clusterIndex => {
    const rowOffset = clusterVisibilityOffsets[clusterIndex]
    if (!Number.isInteger(rowOffset) || rowOffset < 0 || rowOffset >= visibilityLump.length) {
      return []
    }

    const visibleClusters = new Set()
    let decodedClusterIndex = 0
    let cursor = rowOffset

    while (decodedClusterIndex < clusterCount && cursor < visibilityLump.length) {
      const visibilityByte = visibilityLump[cursor]
      cursor += 1

      if (visibilityByte === 0) {
        if (cursor >= visibilityLump.length) {
          return []
        }
        decodedClusterIndex += visibilityLump[cursor] * 8
        cursor += 1
        continue
      }

      for (let bitIndex = 0; bitIndex < 8 && decodedClusterIndex < clusterCount; bitIndex += 1) {
        if ((visibilityByte & (1 << bitIndex)) !== 0) {
          visibleClusters.add(decodedClusterIndex)
        }
        decodedClusterIndex += 1
      }
    }

    return Array.from(visibleClusters).sort((a, b) => a - b)
  }

  if (!fs.existsSync(glbPath)) {
    return null
  }

  const glbData = fs.readFileSync(glbPath)
  if (glbData.length < 20 || glbData.toString('utf8', 0, 4) !== 'glTF') {
    return null
  }

  const jsonChunkLength = glbData.readUInt32LE(12)
  const jsonChunkType = glbData.toString('utf8', 16, 20)
  if (jsonChunkType !== 'JSON' || jsonChunkLength <= 0) {
    return null
  }

  const jsonStart = 20
  const jsonEnd = jsonStart + jsonChunkLength
  if (jsonEnd > glbData.length) {
    return null
  }

  const gltf = JSON.parse(glbData.toString('utf8', jsonStart, jsonEnd))
  const binChunkOffset = jsonEnd + 8
  const bin = binChunkOffset <= glbData.length ? glbData.subarray(binChunkOffset) : Buffer.alloc(0)

  const readAccessorBounds = accessorIndex => {
    const accessor = gltf.accessors?.[accessorIndex]
    if (!accessor || accessor.type !== 'VEC3') return null

    if (
      Array.isArray(accessor.min) &&
      accessor.min.length >= 3 &&
      Array.isArray(accessor.max) &&
      accessor.max.length >= 3
    ) {
      return {
        min: [Number(accessor.min[0]), Number(accessor.min[1]), Number(accessor.min[2])],
        max: [Number(accessor.max[0]), Number(accessor.max[1]), Number(accessor.max[2])],
      }
    }

    const bufferView = gltf.bufferViews?.[accessor.bufferView]
    if (!bufferView || accessor.componentType !== 5126) return null

    const componentCount = GLTF_TYPE_COMPONENT_COUNTS[accessor.type] ?? 3
    const componentSize = GLTF_COMPONENT_BYTE_SIZES[accessor.componentType] ?? 4
    const elementSize = componentCount * componentSize
    const stride = bufferView.byteStride || elementSize
    const baseOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0)

    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]

    for (let index = 0; index < accessor.count; index += 1) {
      const pointOffset = baseOffset + index * stride
      if (pointOffset + 12 > bin.length) break
      const x = bin.readFloatLE(pointOffset)
      const y = bin.readFloatLE(pointOffset + 4)
      const z = bin.readFloatLE(pointOffset + 8)
      if (x < min[0]) min[0] = x
      if (y < min[1]) min[1] = y
      if (z < min[2]) min[2] = z
      if (x > max[0]) max[0] = x
      if (y > max[1]) max[1] = y
      if (z > max[2]) max[2] = z
    }

    if (!Number.isFinite(min[0]) || !Number.isFinite(max[0])) {
      return null
    }

    return { min, max }
  }

  const locateLeafIndex = sourcePoint => {
    let nodeIndex = 0

    while (Number.isInteger(nodeIndex) && nodeIndex >= 0) {
      if (nodeIndex >= nodes.length) return -1
      const node = nodes[nodeIndex]
      const plane = planes[node[0]]
      if (!plane) return -1

      const distance =
        sourcePoint[0] * plane[0] + sourcePoint[1] * plane[1] + sourcePoint[2] * plane[2] - plane[3]
      nodeIndex = distance >= 0 ? node[1] : node[2]
    }

    const leafIndex = -nodeIndex - 1
    return leafIndex >= 0 && leafIndex < leafClusters.length ? leafIndex : -1
  }

  const parentIndices = new Int32Array((gltf.nodes || []).length).fill(-1)
  ;(gltf.nodes || []).forEach((node, nodeIndex) => {
    if (!Array.isArray(node?.children)) return
    for (const childIndex of node.children) {
      if (Number.isInteger(childIndex) && childIndex >= 0 && childIndex < parentIndices.length) {
        parentIndices[childIndex] = nodeIndex
      }
    }
  })

  const nodeWorldMatrices = new Array((gltf.nodes || []).length)
  const getNodeWorldMatrix = nodeIndex => {
    const cached = nodeWorldMatrices[nodeIndex]
    if (cached) return cached

    const node = gltf.nodes?.[nodeIndex] ?? {}
    const localMatrix = new THREE.Matrix4()
    if (Array.isArray(node.matrix) && node.matrix.length === 16) {
      localMatrix.fromArray(node.matrix)
    } else {
      localMatrix.compose(
        new THREE.Vector3(
          Number(node.translation?.[0] ?? 0),
          Number(node.translation?.[1] ?? 0),
          Number(node.translation?.[2] ?? 0)
        ),
        new THREE.Quaternion(
          Number(node.rotation?.[0] ?? 0),
          Number(node.rotation?.[1] ?? 0),
          Number(node.rotation?.[2] ?? 0),
          Number(node.rotation?.[3] ?? 1)
        ),
        new THREE.Vector3(
          Number(node.scale?.[0] ?? 1),
          Number(node.scale?.[1] ?? 1),
          Number(node.scale?.[2] ?? 1)
        )
      )
    }

    const parentIndex = parentIndices[nodeIndex]
    const worldMatrix =
      parentIndex >= 0
        ? getNodeWorldMatrix(parentIndex).clone().multiply(localMatrix)
        : localMatrix.clone()

    nodeWorldMatrices[nodeIndex] = worldMatrix
    return worldMatrix
  }

  const chunkAssignments = []
  const chunkBounds = []
  const chunkNamePattern = /^chunk_\d+_\d+$/
  const samplePoint = new THREE.Vector3()
  const worldBoundsSample = new THREE.Vector3()
  const visibilityTransform = 'gltf-to-source:x,-z,y'
  const minAssignedChunkRatio = 0.8

  const convertGltfPointToSource = point => {
    // GLTF world space is Y-up, while Source BSP space is Z-up with inverted Y.
    return [point[0], -point[2], point[1]]
  }

  const createEmptyBounds = () => ({
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  })

  const expandBoundsWithPoint = (bounds, point) => {
    bounds.min[0] = Math.min(bounds.min[0], point.x)
    bounds.min[1] = Math.min(bounds.min[1], point.y)
    bounds.min[2] = Math.min(bounds.min[2], point.z)
    bounds.max[0] = Math.max(bounds.max[0], point.x)
    bounds.max[1] = Math.max(bounds.max[1], point.y)
    bounds.max[2] = Math.max(bounds.max[2], point.z)
  }

  const expandBoundsWithAccessor = (bounds, accessorIndex, worldMatrix) => {
    const accessorBounds = readAccessorBounds(accessorIndex)
    if (!accessorBounds) return false

    const [minX, minY, minZ] = accessorBounds.min
    const [maxX, maxY, maxZ] = accessorBounds.max
    const corners = [
      [minX, minY, minZ],
      [minX, minY, maxZ],
      [minX, maxY, minZ],
      [minX, maxY, maxZ],
      [maxX, minY, minZ],
      [maxX, minY, maxZ],
      [maxX, maxY, minZ],
      [maxX, maxY, maxZ],
    ]

    for (const corner of corners) {
      worldBoundsSample.set(corner[0], corner[1], corner[2]).applyMatrix4(worldMatrix)
      expandBoundsWithPoint(bounds, worldBoundsSample)
    }

    return true
  }

  const getChunkDescendantBounds = chunkRootIndex => {
    const bounds = createEmptyBounds()
    let foundGeometry = false

    const visitNode = nodeIndex => {
      const node = gltf.nodes?.[nodeIndex]
      if (!node) return

      if (node.mesh != null) {
        const mesh = gltf.meshes?.[node.mesh]
        const worldMatrix = getNodeWorldMatrix(nodeIndex)
        if (mesh && Array.isArray(mesh.primitives)) {
          for (const primitive of mesh.primitives) {
            const positionAccessor = primitive?.attributes?.POSITION
            if (positionAccessor == null) continue
            if (expandBoundsWithAccessor(bounds, positionAccessor, worldMatrix)) {
              foundGeometry = true
            }
          }
        }
      }

      for (const childIndex of node.children || []) {
        visitNode(childIndex)
      }
    }

    visitNode(chunkRootIndex)
    return foundGeometry ? bounds : null
  }

  const collectClustersForBoundsSamples = samples => {
    const clusterSet = new Set()

    for (const localSample of samples) {
      samplePoint.set(localSample[0], localSample[1], localSample[2])
      const leafIndex = locateLeafIndex(
        convertGltfPointToSource([samplePoint.x, samplePoint.y, samplePoint.z])
      )
      if (leafIndex < 0) continue
      const clusterIndex = leafClusters[leafIndex]
      if (Number.isInteger(clusterIndex) && clusterIndex >= 0) {
        clusterSet.add(clusterIndex)
      }
    }

    return Array.from(clusterSet).sort((a, b) => a - b)
  }

  let emptyChunkCount = 0
  let assignedChunkCount = 0

  for (let nodeIndex = 0; nodeIndex < (gltf.nodes || []).length; nodeIndex += 1) {
    const node = gltf.nodes[nodeIndex]
    if (typeof node?.name !== 'string' || !chunkNamePattern.test(node.name)) continue

    const bounds = getChunkDescendantBounds(nodeIndex)
    if (!bounds) {
      emptyChunkCount += 1
      continue
    }

    chunkBounds.push({
      name: node.name,
      min: bounds.min,
      max: bounds.max,
    })

    const centerX = (bounds.min[0] + bounds.max[0]) * 0.5
    const centerY = (bounds.min[1] + bounds.max[1]) * 0.5
    const centerZ = (bounds.min[2] + bounds.max[2]) * 0.5
    const primarySamples = [
      [centerX, centerY, centerZ],
      [bounds.min[0], bounds.min[1], bounds.min[2]],
      [bounds.min[0], bounds.min[1], bounds.max[2]],
      [bounds.min[0], bounds.max[1], bounds.min[2]],
      [bounds.min[0], bounds.max[1], bounds.max[2]],
      [bounds.max[0], bounds.min[1], bounds.min[2]],
      [bounds.max[0], bounds.min[1], bounds.max[2]],
      [bounds.max[0], bounds.max[1], bounds.min[2]],
      [bounds.max[0], bounds.max[1], bounds.max[2]],
    ]
    const fallbackFaceCenterSamples = [
      [bounds.min[0], centerY, centerZ],
      [bounds.max[0], centerY, centerZ],
      [centerX, bounds.min[1], centerZ],
      [centerX, bounds.max[1], centerZ],
      [centerX, centerY, bounds.min[2]],
      [centerX, centerY, bounds.max[2]],
    ]

    let clusters = collectClustersForBoundsSamples(primarySamples)
    if (clusters.length === 0) {
      clusters = collectClustersForBoundsSamples(fallbackFaceCenterSamples)
    }
    if (clusters.length > 0) {
      assignedChunkCount += 1
    }

    chunkAssignments.push({
      name: node.name,
      clusters,
    })
  }

  if (chunkAssignments.length === 0) {
    return null
  }

  const hasBspVisibilityRows =
    clusterCount > 0 && clusterVisibilityOffsets.some(offset => Number.isInteger(offset) && offset >= 0)
  const assignedChunkRatio = chunkAssignments.length > 0 ? assignedChunkCount / chunkAssignments.length : 0

  if (assignedChunkCount === 0) {
    return {
      version: 2,
      valid: false,
      transform: visibilityTransform,
      chunkCount: chunkAssignments.length,
      assignedChunkCount,
      clusterCount,
      emptyChunkCount,
      warning: hasBspVisibilityRows
        ? 'Visibility metadata generation failed: no chunks resolved to any BSP cluster samples.'
        : 'Visibility metadata generation failed: no chunks resolved to BSP clusters and the BSP has no usable visibility rows.',
    }
  }

  if (hasBspVisibilityRows && assignedChunkRatio < minAssignedChunkRatio) {
    return {
      version: 2,
      valid: false,
      transform: visibilityTransform,
      chunkCount: chunkAssignments.length,
      assignedChunkCount,
      clusterCount,
      emptyChunkCount,
      warning: `Visibility metadata skipped: only ${assignedChunkCount}/${chunkAssignments.length} chunks resolved to BSP clusters.`,
    }
  }

  const chunkNames = chunkAssignments.map(assignment => assignment.name)
  const orderedChunkBounds = chunkBounds.map(bounds => ({
    min: bounds.min,
    max: bounds.max,
  }))

  const chunkIndicesByCluster = new Map()
  chunkAssignments.forEach((assignment, chunkIndex) => {
    for (const clusterIndex of assignment.clusters) {
      const chunkIndices = chunkIndicesByCluster.get(clusterIndex)
      if (chunkIndices) {
        chunkIndices.push(chunkIndex)
      } else {
        chunkIndicesByCluster.set(clusterIndex, [chunkIndex])
      }
    }
  })

  const visibleChunksByCluster = Array.from({ length: clusterCount }, (_, clusterIndex) => {
    const visibleChunkSet = new Set()

    for (const visibleClusterIndex of decodeClusterVisibilityRow(clusterIndex)) {
      const chunkIndices = chunkIndicesByCluster.get(visibleClusterIndex)
      if (!chunkIndices) continue
      for (const chunkIndex of chunkIndices) {
        visibleChunkSet.add(chunkIndex)
      }
    }

    return Array.from(visibleChunkSet).sort((a, b) => a - b)
  })

  return {
    version: 2,
    valid: true,
    transform: visibilityTransform,
    chunkCount: chunkAssignments.length,
    assignedChunkCount,
    clusterCount,
    emptyChunkCount,
    metadata: {
      version: 2,
      transform: visibilityTransform,
      chunkNames,
      chunkBounds: orderedChunkBounds,
      planes,
      nodes,
      leafClusters,
      visibleChunksByCluster,
    },
  }
}

const isLikelyBzip2File = filePath => {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size < 10) return false

    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(3)
      const bytesRead = fs.readSync(fd, buf, 0, 3, 0)
      // bzip2 files start with "BZh"
      return bytesRead === 3 && buf[0] === 0x42 && buf[1] === 0x5a && buf[2] === 0x68
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return false
  }
}

// ── Python helper paths ──
const extractVpkScript = path.join(__dirname, 'extract-vpk.py')
const convertVtfScript = path.join(__dirname, 'convert-vtf.py')

/**
 * Extract a file from a VPK archive using the Python vpk library.
 * @param {string} vpkFile - Path to the _dir.vpk file
 * @param {string} relativePath - Relative path inside the VPK
 * @param {string} outputDir - Directory to extract into
 */
const extractFromVpk = (vpkFile, relativePath, outputDir) => {
  spawnSync('python3', [extractVpkScript, '--vpk', vpkFile, '--extract', relativePath, '--output', outputDir], {
    stdio: 'ignore',
  })
}

/**
 * Convert a VTF file to a standard image format using the Python vtf2img library.
 * @param {string} vtfPath - Path to the VTF file
 * @param {string} outputDir - Output directory
 * @param {string} format - Output format (tga, png, webp)
 */
const convertVtf = (vtfPath, outputDir, format = 'tga') => {
  runCommand('python3', [convertVtfScript, '--file', vtfPath, '--output', outputDir, '--format', format])
}

// ── CLI arguments ──
const mapName = requireArg('map')
const bspPathArg = getArg('bsp-path', null)
if (!bspPathArg) {
  throw new Error('Missing required argument: --bsp-path')
}
const bspsrcDir = requireArg('bspsrc')
const blenderPath = requireArg('blender')
const gameDir = requireArg('game-dir')
const gltfpackArg = getArg('gltfpack', null)
// Default to an 8x8 chunk grid: dense enough to make BSP/PVS metadata useful,
// but not so fine-grained that chunk count overwhelms draw-call reduction.
const chunkGrid = Number(getArg('chunk-grid', '8'))
const textureScale = getArg('texture-scale', null)
const textureLimit = getArg('texture-limit', null)
const textureFormat = getArg('texture-format', null)
const downscaledTextureScale = parseNormalizedScaleArg(
  getArg('downscaled-texture-scale', null),
  'downscaled-texture-scale'
)
const skyboxImageFormat = String(getArg('skybox-image-format', 'webp')).toLowerCase()
const requestedKeepVertexAttributes = toBool(getArg('keep-vertex-attributes', 'true'), true)
const skipSkybox = toBool(getArg('skip-skybox', 'true'), true)
const requireSkybox = toBool(getArg('require-skybox', 'true'), true)
const strictMaterials = toBool(getArg('strict-materials', 'false'), false)
const allowMissingMaterialsArg = getArg('allow-missing-materials', undefined)
const allowMissingMaterials = strictMaterials
  ? false
  : allowMissingMaterialsArg === undefined
    ? true
    : toBool(allowMissingMaterialsArg, true)
const allowSkyboxFallback = toBool(getArg('allow-skybox-fallback', 'true'), true)
const skipMaterialTruth = toBool(getArg('skip-material-truth', 'false'), false)
const metadataOnly = toBool(getArg('metadata-only', 'false'), false)

if (!['png', 'webp'].includes(skyboxImageFormat)) {
  throw new Error(`Invalid --skybox-image-format: ${skyboxImageFormat}. Expected 'png' or 'webp'.`)
}

// Optional import features (Plumber).
const importProps = toBool(getArg('import-props', 'true'), true)
const importLights = toBool(getArg('import-lights', 'true'), true)
const importEntitiesRequested = toBool(getArg('import-entities', 'false'), false)
const importEntities = importEntitiesRequested
const importOverlays = toBool(getArg('import-overlays', 'false'), false)
const importInvisibleSolids = toBool(getArg('import-invisible-solids', 'false'), false)

const noSmartUnpack = toBool(getArg('no-smart-unpack', 'true'), true)
const hl2DirArg = getArg('hl2-dir', null)
const extraSearchPathsArg = getArg('extra-search-path', '')
const extraSearchPaths = extraSearchPathsArg
  .split(/[;,]/)
  .map(value => value.trim())
  .filter(Boolean)

const materialOverridesDir = path.join(repoRoot, 'scripts', 'material-overrides')
if (fs.existsSync(materialOverridesDir)) {
  extraSearchPaths.push(materialOverridesDir)
}
const hl2Dir = hl2DirArg ?? path.join(path.resolve(gameDir, '..', '..'), 'Half-Life 2', 'hl2')
const hl2DirResolved = fs.existsSync(hl2Dir) ? hl2Dir : null
const sevenZip = getArg('sevenzip', '7z')
const tempDir = getArg('temp-dir', path.join(repoRoot, 'scripts', 'temp', mapName))
const decompileDir = path.join(tempDir, 'decompile')
const outDir = getArg('out-dir', path.join(repoRoot, 'public', 'models', 'maps', mapName))
const skyboxDir = getArg('skybox-dir', path.join(repoRoot, 'public', 'models', 'skybox'))
const defaultGltfpack = path.join(repoRoot, 'scripts', 'tools', 'gltfpack', 'gltfpack')
const gltfpackPath = gltfpackArg ?? (fs.existsSync(defaultGltfpack) ? defaultGltfpack : null)

ensureDir(tempDir)
ensureDir(decompileDir)
ensureDir(outDir)

const sourceBspPath = path.resolve(String(bspPathArg))
const bspFileName = path.basename(sourceBspPath)
const bspPath = path.join(tempDir, bspFileName)

if (!fs.existsSync(sourceBspPath)) {
  throw new Error(`Local BSP not found: ${sourceBspPath}`)
}

// Handle bz2-compressed BSP files
if (isLikelyBzip2File(sourceBspPath)) {
  console.log('Detected bzip2-compressed BSP, decompressing...')
  const bspBz2Path = path.join(tempDir, `${bspFileName}.bz2`)
  fs.copyFileSync(sourceBspPath, bspBz2Path)
  const decompressedName = bspFileName.replace(/\.bz2$/i, '')
  const decompressedPath = path.join(tempDir, decompressedName)
  try {
    runCommand(sevenZip, ['x', '-y', `-o${tempDir}`, bspBz2Path])
  } catch {
    console.warn('7zip extraction failed; falling back to bunzip2...')
    runCommand('bunzip2', ['-fk', bspBz2Path])
  }
  if (!fs.existsSync(decompressedPath)) {
    throw new Error(`BSP decompression failed: expected ${decompressedPath}`)
  }
} else {
  fs.copyFileSync(sourceBspPath, bspPath)
  console.log(`Using local BSP: ${sourceBspPath}`)
}

const vmfOutputPath = path.join(decompileDir, `${mapName}.vmf`)
const bspsrcArgs = [
  '--output',
  vmfOutputPath,
  '--unpack_embedded',
  ...(noSmartUnpack ? ['--no_smart_unpack'] : []),
  bspPath,
]

let vmfPath = metadataOnly
  ? findFirstFile(decompileDir, filePath => filePath.toLowerCase().endsWith('.vmf'))
  : null

if (vmfPath) {
  console.log(`Metadata-only mode: reusing existing VMF ${vmfPath}`)
} else {
  console.log('Decompiling BSP...')

  // Resolve bspsrc — the config value may point to a directory, a .jar, or a .sh
  const bspsrcResolved = path.resolve(bspsrcDir)
  const bspsrcIsFile = fs.existsSync(bspsrcResolved) && fs.statSync(bspsrcResolved).isFile()
  const bspsrcBaseDir = bspsrcIsFile ? path.dirname(bspsrcResolved) : bspsrcResolved

  const bspsrcJar = bspsrcIsFile && bspsrcResolved.endsWith('.jar')
    ? bspsrcResolved
    : path.join(bspsrcBaseDir, 'bspsrc.jar')
  const bspsrcSh = bspsrcIsFile && bspsrcResolved.endsWith('.sh')
    ? bspsrcResolved
    : path.join(bspsrcBaseDir, 'bspsrc.sh')
  const bundledJava = path.join(bspsrcBaseDir, 'bin', 'java')
  const javaExe = fs.existsSync(bundledJava) ? bundledJava : 'java'

  if (fs.existsSync(bspsrcJar)) {
    runCommand(javaExe, ['-jar', bspsrcJar, ...bspsrcArgs])
  } else if (fs.existsSync(bspsrcSh)) {
    runCommand('bash', [bspsrcSh, ...bspsrcArgs], { cwd: bspsrcBaseDir })
  } else {
    throw new Error(
      `BSPSource not found in ${bspsrcBaseDir}. Expected bspsrc.jar or bspsrc.sh. ` +
      `Set --bspsrc to the BSPSource directory or directly to bspsrc.jar/bspsrc.sh.`
    )
  }

  vmfPath = findFirstFile(decompileDir, filePath => filePath.toLowerCase().endsWith('.vmf'))
}

if (!vmfPath) {
  throw new Error('VMF file not found after decompile.')
}

const vmfLightEntityCount = countVmfLightEntities(vmfPath)
const vmfLightEnvironment = readVmfLightEnvironment(vmfPath)
const vmfFogSettings = readVmfFogSettings(vmfPath)

console.log(`VMF: ${vmfPath}`)
console.log(`Detected VMF light entities: ${vmfLightEntityCount}`)
if (vmfLightEnvironment) {
  console.log('Detected light_environment entity in VMF.')
}
if (vmfFogSettings?.enabled) {
  console.log('Detected worldspawn fog settings in VMF.')
}

// Pre-filter the VMF to strip brush entities that should be invisible at
// runtime (triggers, StartDisabled func_brush, rendermode=10, etc.).
// The original VMF is kept for skyname / light_environment reads above.
const filteredVmfPath = filterVmfInvisibleEntities(vmfPath)

const blenderScript = path.join(repoRoot, 'scripts', 'plumber_import_vmf.py')
const chunkScript = path.join(repoRoot, 'scripts', 'chunk_map_glb.py')
const rawOutput = path.join(tempDir, `${mapName}.glb`)
const chunkedOutput = path.join(tempDir, `${mapName}_chunked.glb`)
const missingMaterialsPath = path.join(tempDir, 'missing_materials.txt')
const texturedOutput = path.join(outDir, 'textured_compressed.glb')
const downscaledTexturedOutput = downscaledTextureScale
  ? path.join(
      outDir,
      `textured_downscaled_${formatScaleForFileName(downscaledTextureScale)}_compressed.glb`
    )
  : null
const conversionMetaPath = path.join(outDir, 'conversion.json')

const mapAssetRoot = path.join(decompileDir, mapName)
const assetSearchPath = fs.existsSync(mapAssetRoot) ? mapAssetRoot : decompileDir

const collectVpkPaths = rootDir => {
  if (!rootDir || !fs.existsSync(rootDir)) return []
  const entries = fs
    .readdirSync(rootDir)
    .filter(name => name.toLowerCase().endsWith('.vpk'))
    .map(name => path.join(rootDir, name))
  if (entries.length === 0) return []
  const dirVpks = entries.filter(name => name.toLowerCase().endsWith('_dir.vpk'))
  return dirVpks.length > 0 ? dirVpks : entries
}

const buildMaterialTruthMetadata = () => {
  const materialRefs = readVmfMaterialReferences(vmfPath)
  if (materialRefs.length === 0) {
    return { scanned: 0, resolved: 0, unresolved: 0, materials: {} }
  }

  const looseSearchDirs = [
    gameDir,
    path.join(gameDir, 'custom'),
    path.join(gameDir, 'download'),
    ...(hl2DirResolved
      ? [hl2DirResolved, path.join(hl2DirResolved, 'custom'), path.join(hl2DirResolved, 'download')]
      : []),
    ...extraSearchPaths,
  ]

  const vpkCandidates = [
    ...collectVpkPaths(gameDir),
    ...(hl2DirResolved ? collectVpkPaths(hl2DirResolved) : []),
    ...extraSearchPaths.filter(value => value.toLowerCase().endsWith('.vpk')),
  ]
  const materialExtractDir = path.join(tempDir, 'material_truth_vpk')
  ensureDir(materialExtractDir)

  const resolveMaterialFile = materialRef => {
    const normalized = normalizeMaterialReference(materialRef)
    if (!normalized) return null
    const rel = normalized.slice('materials/'.length)

    const embeddedPath = path.join(decompileDir, 'materials', rel)
    if (fs.existsSync(embeddedPath)) return embeddedPath

    if (fs.existsSync(mapAssetRoot)) {
      const mapEmbeddedPath = path.join(mapAssetRoot, 'materials', rel)
      if (fs.existsSync(mapEmbeddedPath)) return mapEmbeddedPath
    }

    for (const dir of looseSearchDirs) {
      const loosePath = path.join(dir, 'materials', rel)
      if (fs.existsSync(loosePath)) return loosePath
      const directPath = path.join(dir, rel)
      if (fs.existsSync(directPath)) return directPath
    }

    if (vpkCandidates.length === 0) return null

    const extractedPath = path.join(materialExtractDir, 'materials', rel)
    ensureDir(path.dirname(extractedPath))
    const vpkRelative = `materials/${rel}`
    const expectedBase = path.basename(rel).toLowerCase()
    for (const vpkFile of vpkCandidates) {
      extractFromVpk(vpkFile, vpkRelative, materialExtractDir)
      if (fs.existsSync(extractedPath)) return extractedPath
      const extractedByName = findFileByName(materialExtractDir, expectedBase)
      if (extractedByName) return extractedByName
    }

    return null
  }

  const cache = new Map()
  const resolving = new Set()
  const readTruth = materialRef => {
    const normalized = normalizeMaterialReference(materialRef)
    if (!normalized) return null
    if (cache.has(normalized)) return cache.get(normalized)
    if (resolving.has(normalized)) return null
    resolving.add(normalized)

    const filePath = resolveMaterialFile(normalized)
    if (!filePath) {
      cache.set(normalized, null)
      resolving.delete(normalized)
      return null
    }

    let merged = null
    try {
      const parsed = parseVmtMaterialFile(fs.readFileSync(filePath, 'utf8'))
      const parent = parsed.include ? readTruth(parsed.include) : null
      merged = parent ? { ...parent, ...parsed } : parsed
      merged.sourcePath = normalized
      merged.filePath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
      cache.set(normalized, merged)
    } catch {
      cache.set(normalized, null)
    }

    resolving.delete(normalized)
    return cache.get(normalized)
  }

  const materials = {}
  let resolved = 0
  const shaderCounts = {}
  const unresolvedMaterials = []
  for (const ref of materialRefs) {
    const truth = readTruth(ref)
    if (!truth) {
      unresolvedMaterials.push(ref)
      continue
    }
    resolved++
    const shaderKey = String(truth.shader || 'unknown').toLowerCase()
    shaderCounts[shaderKey] = (shaderCounts[shaderKey] || 0) + 1
    materials[ref] = {
      shader: truth.shader ?? null,
      baseTexture: truth.baseTexture ?? null,
      bumpMap: truth.bumpMap ?? null,
      surfaceProp: truth.surfaceProp ?? null,
      translucent: Boolean(truth.translucent),
      additive: Boolean(truth.additive),
      selfIllum: Boolean(truth.selfIllum),
      alphaTest: Boolean(truth.alphaTest),
      noCull: Boolean(truth.noCull),
      hasEnvMap: Boolean(truth.hasEnvMap),
      sourcePath: truth.sourcePath ?? ref,
    }
  }

  return {
    scanned: materialRefs.length,
    resolved,
    unresolved: Math.max(0, materialRefs.length - resolved),
    shaderCounts,
    unresolvedSamples: unresolvedMaterials.slice(0, 32),
    materials,
  }
}

const runPackedGlb = ({
  input,
  output,
  targetTextureFormat = textureFormat,
  targetTextureScale = textureScale,
  targetTextureLimit = textureLimit,
  keepVertexAttributes = false,
}) => {
  if (gltfpackPath) {
    const gltfpackArgs = ['-i', input, '-o', output, '-kn', '-mi']
    if (targetTextureFormat === 'ktx2') gltfpackArgs.push('-tc')
    if (targetTextureFormat === 'uastc') gltfpackArgs.push('-tu')
    if (targetTextureFormat === 'webp') gltfpackArgs.push('-tw')
    if ((targetTextureScale || targetTextureLimit) && !targetTextureFormat) {
      gltfpackArgs.push('-tw')
    }
    if (targetTextureScale) gltfpackArgs.push('-ts', targetTextureScale)
    if (targetTextureLimit) gltfpackArgs.push('-tl', targetTextureLimit)

    if (keepVertexAttributes) {
      gltfpackArgs.push('-kv', '-vtf')
    }

    runCommand(gltfpackPath, gltfpackArgs)
    return
  }

  console.warn(`gltfpack not found; copying ${path.basename(input)} to ${path.basename(output)}.`)
  fs.copyFileSync(input, output)
}

const materialTruth = skipMaterialTruth
  ? {
      scanned: 0,
      resolved: 0,
      unresolved: 0,
      shaderCounts: {},
      unresolvedSamples: [],
      materials: {},
    }
  : buildMaterialTruthMetadata()
if (skipMaterialTruth) {
  console.log('Material truth scan skipped by --skip-material-truth.')
} else {
  console.log(
    `Material truth: resolved ${materialTruth.resolved}/${materialTruth.scanned} VMF materials (${materialTruth.unresolved} unresolved)`
  )
  if (materialTruth.shaderCounts && Object.keys(materialTruth.shaderCounts).length > 0) {
    console.log('[Material truth] Shader counts:', materialTruth.shaderCounts)
  }
}

// ── Extract BSP lightmaps (before Plumber import so the data is ready) ──
const lightmapScript = path.join(repoRoot, 'scripts', 'extract-bsp-lightmaps.mjs')
const lightmapDir = path.join(tempDir, 'lightmaps')
let lightmapDataPath = null
const existingLightmapDataPath = path.join(lightmapDir, 'lightmap_data.json')

if (metadataOnly && fs.existsSync(existingLightmapDataPath)) {
  lightmapDataPath = lightmapDir
  console.log(`Metadata-only mode: reusing existing lightmap data ${existingLightmapDataPath}`)
} else {
  try {
    console.log('Extracting lightmaps from BSP...')
    runCommand(process.execPath, [lightmapScript, '--bsp', bspPath, '--out', lightmapDir])
    if (fs.existsSync(existingLightmapDataPath)) {
      lightmapDataPath = lightmapDir
      console.log('Lightmap data ready for Blender import.')
    }
  } catch (lmError) {
    console.warn('Lightmap extraction failed (non-fatal):')
    console.warn(lmError instanceof Error ? lmError.message : String(lmError))
  }
}

const blenderBaseArgs = [
  '-b',
  '-noaudio',
  '--python',
  blenderScript,
  '--',
  '--vmf',
  filteredVmfPath,
  '--bsp',
  bspPath,
  '--game-dir',
  gameDir,
  '--asset-search-path',
  assetSearchPath,
  '--out',
  rawOutput,
  '--missing-materials-out',
  missingMaterialsPath,
]

if (hl2DirResolved) {
  blenderBaseArgs.push('--hl2-dir', hl2DirResolved)
}

if (extraSearchPaths.length > 0) {
  blenderBaseArgs.push('--extra-search-path', extraSearchPaths.join(';'))
}

if (allowMissingMaterials) {
  blenderBaseArgs.push('--allow-missing-materials')
}

if (lightmapDataPath) {
  blenderBaseArgs.push('--lightmap-dir', lightmapDataPath)
}

const buildBlenderImportArgs = ({
  includeProps,
  includeLights,
  includeEntities,
  includeOverlays,
  includeInvisibleSolids,
}) => {
  const args = [...blenderBaseArgs]

  if (includeProps) {
    args.push('--import-props')
  }

  if (includeLights) {
    args.push('--import-lights')
  }

  if (includeEntities) {
    args.push('--import-entities')
  }

  if (includeOverlays) {
    args.push('--import-overlays')
  }

  if (includeInvisibleSolids) {
    args.push('--import-invisible-solids')
  }

  return args
}

const runBlenderImport = (importOptions, modeLabel) => {
  if (fs.existsSync(rawOutput)) {
    fs.unlinkSync(rawOutput)
  }

  if (fs.existsSync(missingMaterialsPath)) {
    fs.unlinkSync(missingMaterialsPath)
  }

  console.log(`Blender import mode: ${modeLabel}`)
  const importArgs = buildBlenderImportArgs(importOptions)
  runCommand(blenderPath, importArgs)
}

const hasValidRawOutput = () => {
  return fs.existsSync(rawOutput) && fs.statSync(rawOutput).size > 0
}

let importFallbackUsed = false
let importFallbackReason = null
let importFallbackMode = null
const primaryImportOptions = {
  includeProps: importProps,
  includeLights: importLights,
  includeEntities: importEntities,
  includeOverlays: importOverlays,
  includeInvisibleSolids: importInvisibleSolids,
}
let effectiveImportOptions = primaryImportOptions
const fallbackImportStages = [
  {
    modeLabel: 'safe-no-props',
    options: {
      includeProps: false,
      includeLights: importLights,
      includeEntities: importEntities,
      includeOverlays: false,
      includeInvisibleSolids: importInvisibleSolids,
    },
  },
  {
    modeLabel: 'safe-brushes-only',
    options: {
      includeProps: false,
      includeLights: false,
      includeEntities: false,
      includeOverlays: false,
      includeInvisibleSolids: importInvisibleSolids,
    },
  },
]

let importedLightCount = 0

if (metadataOnly) {
  console.log('Metadata-only mode: reusing existing raw/chunked/packed outputs.')

  if (hasValidRawOutput()) {
    importedLightCount = readGlbPunctualLightCount(rawOutput)
    console.log(`Imported punctual lights: ${importedLightCount}`)
  } else {
    console.warn(`Raw GLB missing in metadata-only mode: ${rawOutput}`)
  }

  if (!fs.existsSync(chunkedOutput) || fs.statSync(chunkedOutput).size === 0) {
    if (!MAP_CHUNKING_ENABLED && hasValidRawOutput()) {
      fs.copyFileSync(rawOutput, chunkedOutput)
    } else {
      throw new Error(`Metadata-only mode requires an existing chunked GLB at ${chunkedOutput}`)
    }
  }
  if (!fs.existsSync(texturedOutput) || fs.statSync(texturedOutput).size === 0) {
    throw new Error(`Metadata-only mode requires an existing packed GLB at ${texturedOutput}`)
  }
  if (downscaledTexturedOutput && !hasNonEmptyFile(downscaledTexturedOutput)) {
    throw new Error(
      `Metadata-only mode requires an existing downscaled GLB at ${downscaledTexturedOutput}`
    )
  }
} else {
  console.log('Importing VMF with Blender + Plumber...')

  try {
    runBlenderImport(primaryImportOptions, 'full')
    if (!hasValidRawOutput()) {
      throw new Error(`GLB export missing after full import: ${rawOutput}`)
    }
  } catch (primaryError) {
    const canFallback =
      primaryImportOptions.includeProps ||
      primaryImportOptions.includeLights ||
      primaryImportOptions.includeEntities ||
      primaryImportOptions.includeOverlays

    if (!canFallback) {
      throw primaryError
    }

    importFallbackUsed = true
    importFallbackReason = primaryError instanceof Error ? primaryError.message : String(primaryError)
    console.warn('Primary Blender import failed; retrying with safer fallback import modes.')
    console.warn(importFallbackReason)

    let lastFallbackReason = null
    for (const fallbackStage of fallbackImportStages) {
      try {
        runBlenderImport(fallbackStage.options, fallbackStage.modeLabel)
        if (!hasValidRawOutput()) {
          throw new Error(`GLB export missing after ${fallbackStage.modeLabel}: ${rawOutput}`)
        }
        importFallbackMode = fallbackStage.modeLabel
        effectiveImportOptions = fallbackStage.options
        break
      } catch (fallbackError) {
        lastFallbackReason =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        console.warn(`Fallback Blender import failed in mode ${fallbackStage.modeLabel}.`)
        console.warn(lastFallbackReason)
      }
    }

    if (!importFallbackMode) {
      throw new Error(
        `Blender import failed in all modes. primary=${importFallbackReason}; fallback=${lastFallbackReason}`
      )
    }
  }

  if (fs.existsSync(missingMaterialsPath)) {
    const missingMaterials = fs.readFileSync(missingMaterialsPath, 'utf8').trim()
    if (missingMaterials.length > 0) {
      if (!allowMissingMaterials) {
        throw new Error(`Missing materials detected. See ${missingMaterialsPath}`)
      }
    }
  }

  if (!fs.existsSync(rawOutput) || fs.statSync(rawOutput).size === 0) {
    throw new Error(`GLB export failed. Missing output at ${rawOutput}`)
  }

  importedLightCount = readGlbPunctualLightCount(rawOutput)
  console.log(`Imported punctual lights: ${importedLightCount}`)

  // Inject after chunking, not before. Blender chunking can drop/simplify triangles
  // when fed an already lightmap-split GLB, which creates visible holes.
  const injectLightmapScript = path.join(repoRoot, 'scripts', 'inject-glb-lightmaps.mjs')

  if (MAP_CHUNKING_ENABLED) {
    if (Number.isNaN(chunkGrid) || chunkGrid < 1) {
      throw new Error(`Invalid --chunk-grid value: ${chunkGrid}`)
    }

    console.log(`Chunking GLB with Blender (grid ${chunkGrid}x${chunkGrid})...`)
    runCommand(blenderPath, [
      '-b',
      '-noaudio',
      '--python',
      chunkScript,
      '--',
      '--input',
      rawOutput,
      '--out',
      chunkedOutput,
      '--grid',
      String(chunkGrid),
      '--target',
      'worldspawn',
    ])
  } else {
    console.log('Map chunking disabled by MAP_CHUNKING_ENABLED; copying raw GLB through.')
    fs.copyFileSync(rawOutput, chunkedOutput)
  }

  // Preserve a pre-lightmap-injection chunked GLB for fast reinject iteration.
  const chunkedPreLmOutput = path.join(tempDir, `${mapName}_chunked_pre_lm.glb`)
  if (fs.existsSync(chunkedOutput) && fs.statSync(chunkedOutput).size > 0) {
    fs.copyFileSync(chunkedOutput, chunkedPreLmOutput)
  }

  /*
   * Static-map output pipeline order matters here:
   * import -> chunk -> lightmap inject -> gltfpack -> metadata export.
   * The later optimization and metadata steps assume they are operating on the
   * chunked GLB, and the exported metadata should describe the packed map output.
   */
  // ── Inject BSP lightmaps into the chunked GLB ──
  if (lightmapDataPath && fs.existsSync(chunkedOutput) && fs.statSync(chunkedOutput).size > 200) {
    try {
      console.log('Injecting lightmap UVs + atlas into chunked GLB...')
      // Use a unique temporary output file so stale *_chunked_lm.glb caches can
      // never be reused accidentally across reconvert runs.
      const lmOutput = path.join(
        tempDir,
        `${path.basename(chunkedOutput, '.glb')}_lm_tmp_${Date.now()}_${process.pid}.glb`
      )
      const chunkedSizeBefore = fs.statSync(chunkedOutput).size

      try {
        runCommand(process.execPath, [
          injectLightmapScript,
          '--glb',
          chunkedOutput,
          '--out',
          lmOutput,
          '--lightmap-dir',
          lightmapDataPath,
        ])

        if (!fs.existsSync(lmOutput)) {
          console.warn('Lightmap injector did not produce output; skipping.')
        } else if (fs.statSync(lmOutput).size > chunkedSizeBefore) {
          fs.copyFileSync(lmOutput, chunkedOutput)
          // Copy atlas PNG to output dir (separate file - Three.js loads it independently)
          const atlasSrc = path.join(lightmapDataPath, 'lightmap_atlas.png')
          const atlasDst = path.join(outDir, 'lightmap_atlas.png')
          if (fs.existsSync(atlasSrc)) {
            fs.copyFileSync(atlasSrc, atlasDst)
            console.log(`Lightmap atlas: ${atlasDst}`)
          }
          console.log('Lightmap injection complete.')
        } else {
          console.warn('Lightmap GLB was not larger than chunked source; skipping.')
        }
      } finally {
        if (fs.existsSync(lmOutput)) {
          fs.unlinkSync(lmOutput)
        }
      }
    } catch (lmError) {
      console.warn('Lightmap injection failed (non-fatal):')
      console.warn(lmError instanceof Error ? lmError.message : String(lmError))
    }
  }

  const keepVertexAttributes = Boolean(lightmapDataPath) && requestedKeepVertexAttributes
  console.log(`Optimizing GLB with gltfpack: ${gltfpackPath ?? '(copy fallback)'}`)
  runPackedGlb({
    input: chunkedOutput,
    output: texturedOutput,
    keepVertexAttributes,
  })

  // ── Post-process with gltf-transform ──
  const gltfTransformBin = path.join(repoRoot, 'node_modules', '.bin', 'gltf-transform')
  {
    const step1 = path.join(tempDir, `${mapName}_gt_instance.glb`)
    const step2 = path.join(tempDir, `${mapName}_gt_joined.glb`)
    const step3 = path.join(tempDir, `${mapName}_gt_resized.glb`)

    console.log('gltf-transform: flattening instances...')
    runCommand(gltfTransformBin, ['instance', texturedOutput, step1])

    console.log('gltf-transform: joining meshes...')
    runCommand(gltfTransformBin, ['join', step1, step2])

    console.log('gltf-transform: resizing textures to 128x128...')
    runCommand(gltfTransformBin, ['resize', step2, step3, '--width', '128', '--height', '128'])

    fs.copyFileSync(step3, texturedOutput)
    console.log('gltf-transform post-processing complete.')

    for (const f of [step1, step2, step3]) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
  }

  if (downscaledTexturedOutput) {
    console.log(
      `Generating downscaled textured GLB (${downscaledTextureScale}x textures): ${path.basename(downscaledTexturedOutput)}`
    )
    runPackedGlb({
      input: chunkedOutput,
      output: downscaledTexturedOutput,
      targetTextureScale: downscaledTextureScale,
      keepVertexAttributes,
    })
  }

}

let skyboxOutputDir = null
let skyboxName = null
if (!skipSkybox) {
  try {
    const skynameRaw = readSkyname(vmfPath)
    const skyname = skynameRaw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const skynameLeaf = path.posix.basename(skyname)
    const skynameVariants = Array.from(new Set([skyname, skynameLeaf].filter(Boolean)))

    skyboxName = skynameLeaf || skyname
    console.log(`Skyname: ${skyname}`)

    const skyboxSides = ['bk', 'dn', 'ft', 'lf', 'rt', 'up']
    skyboxOutputDir = path.join(skyboxDir, skyboxName)
    ensureDir(skyboxOutputDir)

    const hasExistingSkybox = skyboxSides.every(side => {
      const filePath = path.join(skyboxOutputDir, `${skyboxName}_${side}.${skyboxImageFormat}`)
      return fs.existsSync(filePath) && fs.statSync(filePath).size > 0
    })

    if (hasExistingSkybox) {
      console.log(`Reusing existing skybox assets: ${skyboxOutputDir}`)
    }

    if (!hasExistingSkybox) {
      const skyboxExtractDir = path.join(tempDir, 'skybox')
      ensureDir(skyboxExtractDir)

      const looseSearchDirs = [
        gameDir,
        path.join(gameDir, 'custom'),
        path.join(gameDir, 'download'),
        ...(hl2DirResolved
          ? [
              hl2DirResolved,
              path.join(hl2DirResolved, 'custom'),
              path.join(hl2DirResolved, 'download'),
            ]
          : []),
        ...extraSearchPaths,
      ]

      const vpkCandidates = [
        ...collectVpkPaths(gameDir),
        ...(hl2DirResolved ? collectVpkPaths(hl2DirResolved) : []),
        ...extraSearchPaths.filter(value => value.toLowerCase().endsWith('.vpk')),
      ]

      const normalizeMaterialPath = value => {
        const cleaned = value.replace(/\\/g, '/').replace(/^\//, '')
        return cleaned.startsWith('materials/') ? cleaned.slice('materials/'.length) : cleaned
      }

      const resolveMaterialFile = relativePath => {
        const normalized = normalizeMaterialPath(relativePath)
        const embeddedPath = path.join(decompileDir, 'materials', normalized)
        if (fs.existsSync(embeddedPath)) return embeddedPath

        if (fs.existsSync(mapAssetRoot)) {
          const mapEmbeddedPath = path.join(mapAssetRoot, 'materials', normalized)
          if (fs.existsSync(mapEmbeddedPath)) return mapEmbeddedPath
        }

        for (const dir of looseSearchDirs) {
          const loosePath = path.join(dir, 'materials', normalized)
          if (fs.existsSync(loosePath)) return loosePath
          const directPath = path.join(dir, normalized)
          if (fs.existsSync(directPath)) return directPath
        }

        const vpkRelative = `materials/${normalized}`
        const expectedBase = path.basename(normalized).toLowerCase()
        const extractedPath = path.join(skyboxExtractDir, 'materials', normalized)
        ensureDir(path.dirname(extractedPath))
        for (const vpkFile of vpkCandidates) {
          extractFromVpk(vpkFile, vpkRelative, skyboxExtractDir)
          if (fs.existsSync(extractedPath)) return extractedPath
          const extractedByName = findFileByName(skyboxExtractDir, expectedBase)
          if (extractedByName) return extractedByName
        }

        return null
      }

      const readVmtBaseTextures = vmtPath => {
        const text = fs.readFileSync(vmtPath, 'utf8')
        const textures = []
        const baseMatch = text.match(/"\$basetexture"\s+"([^"]+)"/i)
        if (baseMatch) textures.push(baseMatch[1])
        const hdrMatch = text.match(/"\$hdrbasetexture"\s+"([^"]+)"/i)
        if (hdrMatch && hdrMatch[1] !== baseMatch?.[1]) {
          textures.push(hdrMatch[1])
        }
        return textures
      }

      const readVmtColor = vmtPath => {
        const text = fs.readFileSync(vmtPath, 'utf8')
        const lines = text.split(/\r?\n/)
        const colorLine = lines.find(line => /\$color2?/i.test(line))
        if (!colorLine) return null
        const numbers = colorLine.match(/-?\d*\.?\d+/g)
        if (!numbers || numbers.length < 3) return null
        const values = numbers.slice(0, 3).map(value => Number(value))
        if (values.some(value => Number.isNaN(value))) return null
        const max = Math.max(...values)
        const scale = max <= 1 ? 255 : 1
        return values.map(value => Math.max(0, Math.min(255, Math.round(value * scale))))
      }

      const expandHdrCandidates = candidates => {
        const expanded = new Set()
        for (const candidate of candidates) {
          expanded.add(candidate)
          if (!candidate.toLowerCase().includes('hdr')) {
            const extIndex = candidate.lastIndexOf('.')
            if (extIndex !== -1) {
              expanded.add(`${candidate.slice(0, extIndex)}_hdr${candidate.slice(extIndex)}`)
            }
          }
        }
        return Array.from(expanded)
      }

      const getHdrPrefixCandidates = side => {
        const candidates = []
        for (const variant of skynameVariants) {
          candidates.push(`${variant}_hdr${side}.vmt`, `${variant}hdr${side}.vmt`)
        }
        if (['bk', 'ft', 'lf', 'rt'].includes(side)) {
          for (const variant of skynameVariants) {
            candidates.push(`${variant}_hdrside.vmt`, `${variant}hdrside.vmt`)
          }
        }
        if (side === 'dn') {
          for (const variant of skynameVariants) {
            candidates.push(
              `${variant}_hdrdn.vmt`,
              `${variant}hdrdn.vmt`,
              `${variant}_hdrdown.vmt`,
              `${variant}hdrdown.vmt`
            )
          }
        }
        if (side === 'up') {
          for (const variant of skynameVariants) {
            candidates.push(`${variant}_hdrup.vmt`, `${variant}hdrup.vmt`)
          }
        }
        return candidates
      }

      const getSkyboxVmtCandidates = side => {
        const candidates = []
        for (const variant of skynameVariants) {
          candidates.push(`${variant}_${side}.vmt`, `${variant}${side}.vmt`)
        }
        if (['bk', 'ft', 'lf', 'rt'].includes(side)) {
          for (const variant of skynameVariants) {
            candidates.push(`${variant}_side.vmt`, `${variant}side.vmt`)
          }
        }
        if (side === 'dn') {
          for (const variant of skynameVariants) {
            candidates.push(`${variant}_down.vmt`, `${variant}down.vmt`)
          }
        }
        if (side === 'up') {
          for (const variant of skynameVariants) {
            candidates.push(`${variant}_up.vmt`, `${variant}up.vmt`)
          }
        }
        return expandHdrCandidates(candidates.concat(getHdrPrefixCandidates(side)))
      }

      const getHdrPrefixVtfCandidates = side => {
        const candidates = []
        for (const variant of skynameVariants) {
          candidates.push(`${variant}_hdr${side}.vtf`, `${variant}hdr${side}.vtf`)
        }
        if (['bk', 'ft', 'lf', 'rt'].includes(side)) {
          for (const variant of skynameVariants) {
            candidates.push(`${variant}_hdrside.vtf`, `${variant}hdrside.vtf`)
          }
        }
        if (side === 'dn') {
          for (const variant of skynameVariants) {
            candidates.push(
              `${variant}_hdrdn.vtf`,
              `${variant}hdrdn.vtf`,
              `${variant}_hdrdown.vtf`,
              `${variant}hdrdown.vtf`
            )
          }
        }
        if (side === 'up') {
          for (const variant of skynameVariants) {
            candidates.push(`${variant}_hdrup.vtf`, `${variant}hdrup.vtf`)
          }
        }
        return candidates
      }

      const resolveSkyboxVmt = side => {
        const candidates = getSkyboxVmtCandidates(side)
        for (const fileName of candidates) {
          const resolved = resolveMaterialFile(`skybox/${fileName}`)
          if (resolved) return resolved
        }
        return null
      }

      const resolveSkyboxSide = side => {
        const vmtPath = resolveSkyboxVmt(side)
        let fallbackColor = null
        if (vmtPath) {
          const baseTextures = readVmtBaseTextures(vmtPath)
          for (const baseTexture of baseTextures) {
            if (!baseTexture) continue
            const normalized = normalizeMaterialPath(baseTexture)
            const normalizedCandidates = [normalized]
            if (!normalized.includes('/')) {
              normalizedCandidates.push(`skybox/${normalized}`)
            }
            for (const candidate of normalizedCandidates) {
              const withExt = candidate.endsWith('.vtf') ? candidate : `${candidate}.vtf`
              const resolved = resolveMaterialFile(withExt)
              if (resolved) return { vtfPath: resolved, color: null }
            }
          }
          fallbackColor = readVmtColor(vmtPath)
        }

        const candidates = []
        for (const variant of skynameVariants) {
          candidates.push(`${variant}_${side}.vtf`, `${variant}${side}.vtf`)
        }
        if (['bk', 'ft', 'lf', 'rt'].includes(side)) {
          for (const variant of skynameVariants) {
            candidates.push(`${variant}_side.vtf`, `${variant}side.vtf`)
          }
        }
        if (side === 'dn') {
          for (const variant of skynameVariants) {
            candidates.push(
              `${variant}_dn.vtf`,
              `${variant}dn.vtf`,
              `${variant}_down.vtf`,
              `${variant}down.vtf`
            )
          }
        }
        if (side === 'up') {
          for (const variant of skynameVariants) {
            candidates.push(`${variant}_up.vtf`, `${variant}up.vtf`)
          }
        }

        const expandedCandidates = expandHdrCandidates(
          candidates.concat(getHdrPrefixVtfCandidates(side))
        )
        for (const fileName of expandedCandidates) {
          const resolved = resolveMaterialFile(`skybox/${fileName}`)
          if (resolved) return { vtfPath: resolved, color: null }
        }

        if (fallbackColor) {
          return { vtfPath: null, color: fallbackColor }
        }

        if (allowSkyboxFallback) {
          console.warn(`Skybox side ${side} missing for ${skyname}; using fallback color.`)
          return { vtfPath: null, color: [0, 0, 0] }
        }

        throw new Error(
          `Skybox VTF missing for ${side}. Tried: ${expandedCandidates
            .map(name => `materials/skybox/${name}`)
            .join(', ')}`
        )
      }

      const vtfOutputDir = path.join(tempDir, 'skybox_vtf')
      ensureDir(vtfOutputDir)

      const sideInfoMap = new Map()
      for (const side of skyboxSides) {
        sideInfoMap.set(side, resolveSkyboxSide(side))
      }

      const uniqueVtfs = Array.from(
        new Set(
          Array.from(sideInfoMap.values())
            .map(info => info.vtfPath)
            .filter(Boolean)
        )
      )
      for (const vtfPath of uniqueVtfs) {
        convertVtf(vtfPath, vtfOutputDir, 'tga')
      }

      for (const side of skyboxSides) {
        const info = sideInfoMap.get(side)
        const skyboxImagePath = path.join(
          skyboxOutputDir,
          `${skyboxName}_${side}.${skyboxImageFormat}`
        )
        if (info?.color) {
          const color = info.color
          runCommand('magick', [
            '-size',
            '1x1',
            `xc:rgb(${color[0]},${color[1]},${color[2]})`,
            skyboxImagePath,
          ])
          continue
        }
        const vtfPath = info?.vtfPath
        const tgaName = vtfPath ? `${path.basename(vtfPath, path.extname(vtfPath))}.tga` : null
        const tgaCandidates = [
          tgaName,
          `${skyname}_${side}.tga`,
          `${skyname}${side}.tga`,
          `${skynameLeaf}_${side}.tga`,
          `${skynameLeaf}${side}.tga`,
        ].filter(Boolean)
        if (['bk', 'ft', 'lf', 'rt'].includes(side)) {
          tgaCandidates.push(
            `${skyname}_side.tga`,
            `${skyname}side.tga`,
            `${skynameLeaf}_side.tga`,
            `${skynameLeaf}side.tga`
          )
        }
        let tgaPath = null
        for (const candidate of tgaCandidates) {
          tgaPath = findFileByName(vtfOutputDir, String(candidate).toLowerCase())
          if (tgaPath) break
        }
        if (!tgaPath) {
          throw new Error(`TGA not found for ${tgaCandidates.join(', ')}`)
        }
        const magickArgs = [tgaPath]
        if (skyboxImageFormat === 'webp') {
          magickArgs.push('-quality', '92')
        }
        magickArgs.push(skyboxImagePath)
        runCommand('magick', magickArgs)
      }
    }
  } catch (error) {
    if (requireSkybox) throw error
    console.warn(
      `Skybox extraction skipped: ${error instanceof Error ? error.message : String(error)}`
    )
  }
} else {
  console.log('Skybox extraction skipped.')
}

console.log('Map conversion complete.')
console.log(`Map GLB: ${outDir}`)
if (skyboxOutputDir) {
  console.log(`Skybox: ${skyboxOutputDir}`)
}

let missingMaterialsCount = 0
if (fs.existsSync(missingMaterialsPath)) {
  const missingMaterials = fs.readFileSync(missingMaterialsPath, 'utf8').trim()
  if (missingMaterials.length > 0) {
    missingMaterialsCount = missingMaterials.split(/\r?\n/).filter(Boolean).length
  }
}

let clusterVisibilityMetadata = null
const clusterVisibilityPath = path.join(outDir, 'visibility.json')
if (MAP_CHUNKING_ENABLED) {
  try {
    clusterVisibilityMetadata = parseChunkClusterVisibility({
      bspPath,
      glbPath: chunkedOutput,
    })
    if (clusterVisibilityMetadata?.valid) {
      fs.writeFileSync(clusterVisibilityPath, JSON.stringify(clusterVisibilityMetadata.metadata))
      console.log(
        `Visibility metadata: ${clusterVisibilityPath} (${clusterVisibilityMetadata.assignedChunkCount}/${clusterVisibilityMetadata.chunkCount} chunks assigned, ${clusterVisibilityMetadata.clusterCount} clusters)`
      )
    } else if (clusterVisibilityMetadata && typeof clusterVisibilityMetadata.warning === 'string') {
      if (fs.existsSync(clusterVisibilityPath)) {
        fs.unlinkSync(clusterVisibilityPath)
      }
      console.warn(clusterVisibilityMetadata.warning)
    }
  } catch (error) {
    console.warn(
      `Visibility metadata extraction failed: ${error instanceof Error ? error.message : error}`
    )
  }
} else {
  if (fs.existsSync(clusterVisibilityPath)) {
    fs.unlinkSync(clusterVisibilityPath)
  }
  console.log('Visibility metadata skipped because map chunking is disabled.')
}

const conversionMeta = {
  mapName,
  timestamp: new Date().toISOString(),
  chunkingEnabled: MAP_CHUNKING_ENABLED,
  chunkGrid: MAP_CHUNKING_ENABLED ? chunkGrid : null,
  textureScale: textureScale ?? null,
  textureLimit: textureLimit ?? null,
  textureFormat: textureFormat ?? null,
  downscaledTextureScale: downscaledTextureScale ?? null,
  downscaledTexturedOutput:
    downscaledTexturedOutput && hasNonEmptyFile(downscaledTexturedOutput)
      ? statOutputFile(downscaledTexturedOutput)
      : null,
  requireSkybox,
  importProps,
  importLights,
  importEntitiesRequested,
  importEntities,
  importOverlays,
  importInvisibleSolids,
  strictMaterials,
  allowMissingMaterials,
  missingMaterialsCount,
  vmfLightEntityCount,
  lightEnvironment: vmfLightEnvironment,
  fog: vmfFogSettings,
  materialTruth,
  importedLightCount,
  detectedFullbright: importedLightCount === 0,
  importFallbackUsed,
  importFallbackReason,
  importFallbackMode,
  effectiveImportProps: effectiveImportOptions.includeProps,
  effectiveImportLights: effectiveImportOptions.includeLights,
  effectiveImportEntities: effectiveImportOptions.includeEntities,
  effectiveImportOverlays: effectiveImportOptions.includeOverlays,
  skyboxName: skyboxName ?? null,
  skyboxImageFormat,
  allowSkyboxFallback,
  visibility: {
    version: clusterVisibilityMetadata?.version ?? null,
    chunkCount: clusterVisibilityMetadata?.chunkCount ?? null,
    clusterCount: clusterVisibilityMetadata?.clusterCount ?? null,
    valid: clusterVisibilityMetadata?.valid === true,
  },
  keepVertexAttributes: Boolean(lightmapDataPath) && requestedKeepVertexAttributes,
  gltfpack: gltfpackPath ?? null,
  success: true,
}

fs.writeFileSync(conversionMetaPath, JSON.stringify(conversionMeta, null, 2))
