#!/usr/bin/env node
/**
 * Builds maps for the viewer from their compiled BSPs with bsp-to-glb (no Blender or VMF), into
 * public/models, ready to upload with `npm run assets`:
 *
 *   maps/<map>/map.json      what the viewer loads: bounds, lighting, sky, and the files below
 *   maps/<map>/*             the world model, its textures, lightmaps, props and decals, with
 *                            content-hashed names, so a rebuilt map never meets a stale cache
 *   props/<hash>.glb         prop models, shared by every map that places them
 *   skybox/<sky>/*.webp      sky faces, shared by every map with that sky
 *   maps/index.json          every map built this way
 *
 * A map is a map name (its BSP is downloaded from serveme.tf's FastDL, or taken from --bsp-dir)
 * or a path to a .bsp. Maps whose BSP and build settings haven't changed are skipped.
 *
 * Needs TF2's VPKs (scripts/convert-config.json `game-dir` / `hl2-dir`), Rust (bsp-to-glb), and
 * Python with vtf2img and Pillow.
 *
 * Usage:
 *   node scripts/maps/build-maps.mjs <map|file.bsp>... [--bsp-dir <dir>] [--force]
 *        [--game-dir <tf>] [--hl2-dir <hl2>]
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Logger, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { dedup, meshopt, prune } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import { VpkSet } from '../viewmodels/vpk.mjs'
import {
  BSP_TO_GLB_REV,
  applyTextures,
  bspToGlb,
  convertTextures,
  exportStudioModel,
  flipWinding,
  keepDefaultLod,
  materialPlan,
  readMaterial,
  repoRoot,
} from '../lib/source-models.mjs'

// Bump to rebuild every map (a change to what this script writes or how).
const PIPELINE_VERSION = 2
// The map profile: as the Blender-built maps were, textures at half size, at most 1024 px.
const TEXTURE_SCALE = 0.5
const TEXTURE_LIMIT = 1024
const PROP_TEXTURE_SIZE = 512
const SKY_TEXTURE_SIZE = 1024
const FASTDL = 'https://fastdl.serveme.tf/maps'
const MAP_NAME = /^[a-z0-9_]{1,128}$/

const modelsDir = path.join(repoRoot, 'public/models')
const tempDir = path.join(repoRoot, 'scripts/temp/maps')

// ─── Arguments ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const options = {}
const inputs = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--force') options.force = true
  else if (argv[i].startsWith('--')) options[argv[i].slice(2)] = argv[++i]
  else inputs.push(argv[i])
}
const config = (() => {
  const file = path.join(repoRoot, 'scripts/convert-config.json')
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
})()
const gameDir = options['game-dir'] ?? config['game-dir']
const hl2Dir = options['hl2-dir'] ?? config['hl2-dir']
if (!inputs.length) {
  console.error('usage: build-maps.mjs <map|file.bsp>... [--bsp-dir <dir>] [--force]')
  process.exit(1)
}
if (!gameDir || !fs.existsSync(path.join(gameDir, 'tf2_misc_dir.vpk'))) {
  console.error('TF2 game dir not found: pass --game-dir or set game-dir in scripts/convert-config.json')
  process.exit(1)
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex')
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
}
const mb = bytes => `${(bytes / 2 ** 20).toFixed(1)} MB`

const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.ERROR))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })

/** A map's BSP: a .bsp path, one in --bsp-dir, one downloaded before, or one from FastDL. */
async function findBsp(input) {
  if (input.endsWith('.bsp')) return { name: path.basename(input, '.bsp').toLowerCase(), file: input }
  const name = input.toLowerCase()
  if (!MAP_NAME.test(name)) throw new Error(`not a map name: ${input}`)
  const local = options['bsp-dir'] && path.join(options['bsp-dir'], `${name}.bsp`)
  if (local && fs.existsSync(local)) return { name, file: local }
  const cached = path.join(tempDir, 'bsp', `${name}.bsp`)
  if (!fs.existsSync(cached)) {
    console.log(`  downloading ${FASTDL}/${name}.bsp`)
    const response = await fetch(`${FASTDL}/${name}.bsp`)
    if (!response.ok) throw new Error(`FastDL has no ${name}.bsp (HTTP ${response.status})`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.subarray(0, 4).toString('latin1') !== 'VBSP') throw new Error(`${name}.bsp is not a BSP`)
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    fs.writeFileSync(cached, bytes)
  }
  return { name, file: cached }
}

/** Key/values of an entity from bsp-to-glb's entity graph, keys lowercased. */
const keyValues = entity =>
  Object.fromEntries((entity?.keyValues ?? []).map(({ key, value }) => [key.toLowerCase(), value]))
const numbers = value =>
  typeof value === 'string' ? value.trim().split(/\s+/).map(Number).filter(Number.isFinite) : []

/** Bounds, lighting, sky and 3D sky camera, from the entities. */
function readEnvironment(entities) {
  const byClass = name => entities.find(entity => entity.classname === name)
  const world = keyValues(byClass('worldspawn'))
  const light = keyValues(byClass('light_environment'))
  const skyCamera = keyValues(byClass('sky_camera'))
  const mins = numbers(world.world_mins)
  const maxs = numbers(world.world_maxs)
  const angles = numbers(light.angles)
  const ambient = numbers(light._ambient)
  const sunlight = numbers(light._light)
  return {
    worldBounds: mins.length === 3 && maxs.length === 3 ? { mins, maxs } : null,
    environment: {
      skyName: world.skyname?.toLowerCase() ?? null,
      ambient: ambient.length >= 4 ? ambient.slice(0, 4) : null,
      sunlight: sunlight.length >= 4 ? sunlight.slice(0, 4) : null,
      sunlightAngles:
        angles.length === 3 ? [Number(light.pitch ?? angles[0]), angles[1], angles[2]] : null,
    },
    skyCamera: skyCamera.origin
      ? { origin: numbers(skyCamera.origin), scale: Number(skyCamera.scale) || 16 }
      : null,
  }
}

// ─── Textures, props and sky ───────────────────────────────────────────────────

/** WebP versions of the map's base textures; returns content id -> file name. */
function mapTextures(exportDir, outDir, materials, packageManifest) {
  const sources = packageManifest.sources ?? []
  const wanted = new Map() // package source index -> needs alpha
  for (const material of materials.materials ?? []) {
    const features = material.metadata?.features ?? {}
    const blends = features.translucent || features.alphaTest || features.additive
    for (const texture of material.textures ?? []) {
      const parameter = texture.parameter?.toLowerCase()
      if (texture.packageSourceIndex == null) continue
      if (parameter === '$basetexture')
        wanted.set(texture.packageSourceIndex, wanted.get(texture.packageSourceIndex) || !!blends)
      else if (parameter === '$basetexture2' && !wanted.has(texture.packageSourceIndex))
        wanted.set(texture.packageSourceIndex, false)
    }
  }
  const jobs = []
  const files = new Map()
  for (const [index, alpha] of wanted) {
    const output = sources[index]?.output
    if (!output?.fileName) continue
    const id = output.contentId.replace(/^sha256:/, '').slice(0, 16)
    const file = `textures/${id}${alpha ? 'a' : ''}.webp`
    files.set(index, file)
    if (!jobs.some(job => job.file === file)) {
      jobs.push({
        file,
        png: path.join(exportDir, 'textures', output.fileName),
        out: path.join(outDir, file),
        scale: TEXTURE_SCALE,
        max: TEXTURE_LIMIT,
        alpha,
      })
    }
  }
  const python = spawnSync('python3', ['-I', path.join(repoRoot, 'scripts/maps/textures-to-webp.py')], {
    input: JSON.stringify(jobs),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (python.status !== 0) throw new Error(`texture conversion failed: ${python.stderr}`)
  const results = JSON.parse(python.stdout)
  for (const job of jobs) if (results[job.out]?.error) console.warn(`  ! ${job.png}: ${results[job.out].error}`)
  return files
}

/** Exports each model and skin the map places as a shared prop GLB; returns "asset:skin" -> file. */
async function mapProps(tool, vpks, props) {
  const assets = new Map(props.modelAssets.map(asset => [asset.modelAssetIndex, asset.sourcePath]))
  const pairs = new Set()
  for (const prop of props.staticProps ?? []) pairs.add(`${prop.modelAssetIndex}:${prop.skin ?? 0}`)
  for (const prop of props.dynamicProps ?? []) {
    if (prop.modelAssetIndex == null) continue
    pairs.add(`${prop.modelAssetIndex}:${Number(prop.initialState?.skin ?? 0) || 0}`)
  }
  const files = {}
  const failures = []
  const pending = []
  for (const key of pairs) {
    const [index, skin] = key.split(':').map(Number)
    const mdlPath = assets.get(index)?.toLowerCase()
    try {
      const base = mdlPath.replace(/\.mdl$/, '')
      const sources = { mdl: `${base}.mdl`, vvd: `${base}.vvd`, vtx: `${base}.dx90.vtx` }
      const buffers = Object.values(sources).map(file => vpks.read(file))
      const missing = Object.values(sources).find((file, i) => !buffers[i])
      if (missing) throw new Error(`missing ${missing}`)
      const hash = crypto.createHash('sha256')
      for (const buffer of buffers) hash.update(buffer)
      hash.update(`${skin}:${PIPELINE_VERSION}:${BSP_TO_GLB_REV}:${PROP_TEXTURE_SIZE}`)
      const file = `${hash.digest('hex').slice(0, 16)}.glb`
      files[key] = file
      if (fs.existsSync(path.join(modelsDir, 'props', file))) continue
      const local = {}
      for (const [kind, source] of Object.entries(sources)) {
        local[kind] = path.join(tempDir, 'props/src', source)
        fs.mkdirSync(path.dirname(local[kind]), { recursive: true })
        fs.writeFileSync(local[kind], buffers[Object.keys(sources).indexOf(kind)])
      }
      const tag = file.replace('.glb', '')
      const exported = exportStudioModel(
        tool,
        mdlPath,
        local,
        skin,
        path.join(tempDir, 'props/glb', `${tag}.glb`),
        path.join(tempDir, 'props/glb', `${tag}.json`)
      )
      pending.push({ key, file, exported, plan: materialPlan(vpks, exported.manifest) })
    } catch (error) {
      delete files[key]
      failures.push(`${mdlPath}: ${String(error.message ?? error).replace(`${mdlPath}: `, '')}`)
    }
  }

  const textures = convertTextures(
    vpks,
    pending.map(p => p.plan),
    path.join(tempDir, 'props'),
    PROP_TEXTURE_SIZE
  )
  await MeshoptEncoder.ready
  for (const { file, exported, plan } of pending) {
    const doc = await io.read(exported.glb)
    const root = doc.getRoot()
    keepDefaultLod(root, exported.manifest)
    for (const animation of root.listAnimations()) {
      for (const channel of animation.listChannels()) channel.dispose()
      for (const sampler of animation.listSamplers()) sampler.dispose()
      animation.dispose()
    }
    for (const mesh of root.listMeshes()) mesh.listPrimitives().forEach(flipWinding)
    // Props never animate, and a skinned copy would follow bones left out of the scene. Source
    // keeps a model's vertices in model space, so without the skin they stay where they belong.
    for (const node of root.listNodes()) if (node.getSkin()) node.setSkin(null)
    for (const skin of root.listSkins()) skin.dispose()
    for (const mesh of root.listMeshes())
      for (const primitive of mesh.listPrimitives())
        for (const semantic of primitive.listSemantics())
          if (/^(JOINTS|WEIGHTS)_/.test(semantic)) primitive.setAttribute(semantic, null)
    applyTextures(doc, plan, textures, EXTTextureWebP)
    await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }), prune())
    fs.mkdirSync(path.join(modelsDir, 'props'), { recursive: true })
    await io.write(path.join(modelsDir, 'props', file), doc)
  }
  return { files, failures, built: pending.length }
}

/** Writes the sky's six faces as WebP under skybox/<sky>/, unless they're there already. */
function skyFaces(vpks, skyName) {
  if (!skyName) return null
  const faces = ['lf', 'rt', 'bk', 'ft', 'up', 'dn']
  const outDir = path.join(modelsDir, 'skybox', skyName)
  const target = face => path.join(outDir, `${skyName}_${face}.webp`)
  if (faces.every(face => fs.existsSync(target(face)))) return skyName
  const jobs = []
  for (const face of faces) {
    const params = readMaterial(vpks, `materials/skybox/${skyName}${face}.vmt`)
    const base = params?.$basetexture ?? params?.$hdrcompressedtexture
    const vtf = base && `materials/${base.replace(/\\/g, '/').toLowerCase()}.vtf`
    const bytes = vtf && vpks.read(vtf)
    if (!bytes) {
      console.warn(`  ! sky ${skyName}: no texture for ${face} (custom skies in the BSP aren't read yet)`)
      return null
    }
    const local = path.join(tempDir, 'sky', path.basename(vtf))
    fs.mkdirSync(path.dirname(local), { recursive: true })
    fs.writeFileSync(local, bytes)
    jobs.push({ vtf: local, out: target(face), max: SKY_TEXTURE_SIZE, alpha: false })
  }
  const python = spawnSync('python3', ['-I', path.join(repoRoot, 'scripts/viewmodels/vtf-to-webp.py')], {
    input: JSON.stringify(jobs),
    encoding: 'utf8',
  })
  if (python.status !== 0) throw new Error(`sky conversion failed: ${python.stderr}`)
  const results = JSON.parse(python.stdout)
  const failed = jobs.find(job => results[job.out]?.error)
  if (failed) {
    console.warn(`  ! sky ${skyName}: ${results[failed.out].error}`)
    return null
  }
  return skyName
}

// ─── One map ───────────────────────────────────────────────────────────────────

/** Trims the converter's sidecars to what the viewer reads. */
function viewerMaterials(materials, textureFiles) {
  return {
    materials: (materials.materials ?? []).map(material => ({
      materialIndex: material.materialIndex,
      name: material.name,
      features: material.metadata?.features ?? {},
      textures: (material.textures ?? [])
        .filter(texture => textureFiles.has(texture.packageSourceIndex))
        .map(texture => ({
          parameter: texture.parameter?.toLowerCase(),
          file: textureFiles.get(texture.packageSourceIndex),
        })),
    })),
  }
}

const viewerProps = props => ({
  staticProps: (props.staticProps ?? []).map(prop => ({
    staticPropIndex: prop.staticPropIndex,
    modelAssetIndex: prop.modelAssetIndex,
    skin: prop.skin ?? 0,
  })),
  dynamicProps: (props.dynamicProps ?? [])
    .filter(prop => prop.modelAssetIndex != null)
    .map(prop => ({
      entityIndex: prop.entityIndex,
      modelAssetIndex: prop.modelAssetIndex,
      skin: Number(prop.initialState?.skin ?? 0) || 0,
    })),
})

const viewerDecals = decals => ({
  records: (decals.records ?? [])
    .filter(record => record.status === 'handled')
    .map(record => ({
      materialIndex: record.materialIndex,
      fragments: (record.fragments ?? []).map(fragment => ({
        positions: fragment.positions,
        uvs: fragment.uvs,
        indices: fragment.indices,
      })),
    })),
})

async function buildMap(tool, vpks, input) {
  const started = Date.now()
  const { name, file: bspFile } = await findBsp(input)
  const bsp = fs.readFileSync(bspFile)
  const bspSha256 = sha256(bsp)
  const outDir = path.join(modelsDir, 'maps', name)
  const manifestFile = path.join(outDir, 'map.json')
  const previous = fs.existsSync(manifestFile) ? readJson(manifestFile) : null
  if (
    !options.force &&
    previous?.bspSha256 === bspSha256 &&
    previous?.builtWith?.pipeline === PIPELINE_VERSION &&
    previous?.builtWith?.revision === BSP_TO_GLB_REV
  ) {
    console.log(`${name}: up to date`)
    return previous
  }
  console.log(`${name}: converting`)

  // The world, its materials, lightmaps, props, decals, visibility and entities.
  const exportDir = path.join(tempDir, 'export', name)
  fs.rmSync(exportDir, { recursive: true, force: true })
  fs.mkdirSync(path.join(exportDir, 'textures'), { recursive: true })
  fs.mkdirSync(path.join(exportDir, 'lightmaps'), { recursive: true })
  const mounts = path.join(tempDir, 'mounts.json')
  const vpkMounts = [gameDir, hl2Dir]
    .filter(Boolean)
    .flatMap(dir =>
      ['tf2_misc_dir.vpk', 'tf2_textures_dir.vpk', 'hl2_misc_dir.vpk', 'hl2_textures_dir.vpk']
        .map(file => path.join(dir, file))
        .filter(file => fs.existsSync(file))
    )
  writeJson(mounts, {
    schemaVersion: 1,
    mounts: vpkMounts.map((file, i) => ({ id: `vpk${i}`, kind: 'vpk', path: file })),
  })
  const at = file => path.join(exportDir, file)
  const convert = lightmaps =>
    spawnSync(
      tool,
      [
        '--bsp', bspFile,
        '--out', at('world.glb'),
        ...(lightmaps
          ? ['--lightmap-set', 'auto', '--lightmap-atlas', at('lightmaps/flat.png'), '--lightmap-manifest', at('lightmaps.json')]
          : ['--lightmap-set', 'none']),
        '--material-mount-plan', mounts,
      '--material-manifest', at('materials.json'),
      '--texture-output', at('textures'),
      '--texture-manifest', at('material-textures.json'),
      '--props-out', at('props.json'),
      '--decal-overlays-out', at('decal-overlays.json'),
      '--visibility-out', at('visibility.json'),
        '--entities-out', at('entities.json'),
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
  const failure = run => (run.stderr || run.stdout).trim().split('\n').pop()
  let lightmapGap = null
  let converted = convert(true)
  // bsp-to-glb refuses faces lit by switchable light styles rather than flatten them; such a
  // map is built unlit by its lightmaps (the viewer's scene lights still light it).
  if (converted.status !== 0 && /multiple light styles/.test(failure(converted))) {
    lightmapGap = failure(converted)
    console.warn(`  ! no lightmaps: ${lightmapGap}`)
    converted = convert(false)
  }
  if (converted.status !== 0) throw new Error(failure(converted))
  // With more than one output requested, the render statistics are under `render`.
  const output = JSON.parse(converted.stdout)
  const stats = output.render ?? output

  const { worldBounds, environment, skyCamera } = readEnvironment(readJson(at('entities.json')).entities)
  const materials = readJson(at('materials.json'))
  const props = readJson(at('props.json'))

  // Previous build's files go (content-hashed names change); anything else in the folder stays.
  for (const component of previous?.components ?? []) fs.rmSync(path.join(outDir, component.file), { force: true })
  const staged = path.join(tempDir, 'staged', name)
  fs.rmSync(staged, { recursive: true, force: true })
  fs.mkdirSync(staged, { recursive: true })

  const textureFiles = mapTextures(exportDir, staged, materials, readJson(at('material-textures.json')))
  const { files: propFiles, failures: propFailures, built: propsBuilt } = await mapProps(tool, vpks, props)
  const sky = skyFaces(vpks, environment.skyName)

  // World geometry, meshopt-compressed (FILTER, see scripts/meshopt-map.mjs).
  const meshopt = spawnSync('node', [path.join(repoRoot, 'scripts/meshopt-map.mjs'), at('world.glb'), path.join(staged, 'world.glb')], { encoding: 'utf8' })
  if (meshopt.status !== 0) throw new Error(`meshopt failed: ${meshopt.stderr}`)
  writeJson(path.join(staged, 'materials.json'), viewerMaterials(materials, textureFiles))
  writeJson(path.join(staged, 'props.json'), viewerProps(props))
  writeJson(path.join(staged, 'decal-overlays.json'), viewerDecals(readJson(at('decal-overlays.json'))))
  fs.copyFileSync(at('visibility.json'), path.join(staged, 'visibility.json'))
  // The flat lightmap only: the viewer lights by the brighter of flat and the directional
  // average, which barely differ without bump mapping, and the three directional ones would
  // more than double the lightmap bytes.
  if (fs.existsSync(at('lightmaps/flat.png'))) {
    fs.mkdirSync(path.join(staged, 'lightmaps'), { recursive: true })
    fs.copyFileSync(at('lightmaps/flat.png'), path.join(staged, 'lightmaps/flat.png'))
  }

  // Content-hashed names, then into the map's folder.
  const components = []
  const walk = dir =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
    )
  for (const source of walk(staged)) {
    const role = path.relative(staged, source).split(path.sep).join('/')
    const bytes = fs.readFileSync(source)
    const file = role.replace(/(\.[a-z]+)$/, `.${sha256(bytes).slice(0, 10)}$1`)
    fs.mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true })
    fs.copyFileSync(source, path.join(outDir, file))
    // Optional: only fetched when the viewer uses it (visibility, for chunk culling).
    components.push({ role, file, bytes: bytes.length, ...(role === 'visibility.json' ? { optional: true } : {}) })
  }
  components.sort((a, b) => a.role.localeCompare(b.role))

  const manifest = {
    schema: 'dribble.map',
    version: 1,
    mapName: name,
    bspSha256,
    bspBytes: bsp.length,
    builtAt: new Date().toISOString(),
    builtWith: {
      converter: 'bsp-to-glb',
      revision: BSP_TO_GLB_REV,
      pipeline: PIPELINE_VERSION,
      textureScale: TEXTURE_SCALE,
      textureLimit: TEXTURE_LIMIT,
      propTextureSize: PROP_TEXTURE_SIZE,
    },
    worldBounds,
    environment,
    skybox: sky,
    skyCamera,
    components,
    props: propFiles,
    coverage: {
      materials: stats.materials,
      unresolvedMaterials: stats.unresolvedMaterialAssets,
      lightmaps: lightmapGap ? `none: ${lightmapGap}` : 'flat',
      textures: textureFiles.size,
      staticProps: stats.staticProps,
      dynamicProps: stats.dynamicProps,
      propModels: Object.keys(propFiles).length,
      propFailures,
      triangles: stats.triangles,
    },
  }
  writeJson(manifestFile, manifest)

  const mapBytes = components
    .filter(component => !component.optional)
    .reduce((total, component) => total + component.bytes, 0)
  const propBytes = [...new Set(Object.values(propFiles))].reduce(
    (total, file) => total + fs.statSync(path.join(modelsDir, 'props', file)).size,
    0
  )
  console.log(
    `${name}: done in ${((Date.now() - started) / 1000).toFixed(0)} s — map ${mb(mapBytes)}, ` +
      `${Object.keys(propFiles).length} prop models ${mb(propBytes)} (${propsBuilt} new)` +
      `${sky ? `, sky ${sky}` : ', no sky'}`
  )
  for (const failure of propFailures) console.warn(`  ! ${failure}`)
  return manifest
}

// ─── Build ─────────────────────────────────────────────────────────────────────

const tool = bspToGlb()
const vpks = VpkSet.forGame(gameDir, hl2Dir)
const indexFile = path.join(modelsDir, 'maps/index.json')
const index = fs.existsSync(indexFile) ? readJson(indexFile) : { schema: 'dribble.maps', version: 1, maps: {} }
const failed = []
for (const input of inputs) {
  try {
    const manifest = await buildMap(tool, vpks, input)
    index.maps[manifest.mapName] = {
      bspSha256: manifest.bspSha256,
      builtAt: manifest.builtAt,
      skybox: manifest.skybox,
    }
  } catch (error) {
    console.error(`${input}: failed: ${error.message ?? error}`)
    failed.push(input)
  }
}
index.maps = Object.fromEntries(Object.entries(index.maps).sort(([a], [b]) => a.localeCompare(b)))
writeJson(indexFile, index)

// Prop models no map places any more (an earlier build's) go; the CDN keeps its copies.
const placed = new Set()
for (const name of Object.keys(index.maps)) {
  const file = path.join(modelsDir, 'maps', name, 'map.json')
  if (fs.existsSync(file)) for (const prop of Object.values(readJson(file).props ?? {})) placed.add(prop)
}
const propsDir = path.join(modelsDir, 'props')
const unplaced = fs.existsSync(propsDir)
  ? fs.readdirSync(propsDir).filter(file => file.endsWith('.glb') && !placed.has(file))
  : []
for (const file of unplaced) fs.rmSync(path.join(propsDir, file))
if (unplaced.length) console.log(`Removed ${unplaced.length} prop models no map places`)
vpks.close()
console.log(`\n${Object.keys(index.maps).length} maps in public/models/maps/index.json`)
if (failed.length) {
  console.error(`${failed.length} failed: ${failed.join(', ')}`)
  process.exit(1)
}
