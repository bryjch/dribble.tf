#!/usr/bin/env node
/**
 * Builds the first-person viewmodels (each class's arms, their animations, and every weapon's
 * model) from TF2's own files into public/models/viewmodels/, with a manifest mapping item
 * definition indexes to models and animation slots.
 *
 * Needs the game's VPKs (see scripts/convert-config.json `game-dir` / `hl2-dir`), Rust (to build
 * the pinned bsp-to-glb that converts models), and Python with vtf2img and Pillow (textures).
 * Models whose sources have not changed since the last build are skipped.
 *
 * Usage:
 *   node scripts/viewmodels/build-viewmodels.mjs [--classes soldier,scout] [--items 18,205]
 *        [--game-dir <tf>] [--hl2-dir <hl2>] [--texture-size 512] [--force]
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Logger, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import { parseKeyValues } from './keyvalues.mjs'
import { VpkSet } from './vpk.mjs'

// Bump to rebuild every model (a change to how they are processed).
const SCRIPT_VERSION = 3
const BSP_TO_GLB_REPO = 'https://github.com/Hona/bsp-to-glb'
const BSP_TO_GLB_REV = '7b7f7fc803b65e53791d3fc6eab04c0a2e355c6c'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const toolDir = path.join(repoRoot, 'scripts/tools/bsp-to-glb')
const tempDir = path.join(repoRoot, 'scripts/temp/viewmodels')
const outDir = path.join(repoRoot, 'public/models/viewmodels')

// The arms and animation models are named for the class, except the demoman's.
const CLASSES = [
  'scout',
  'soldier',
  'pyro',
  'demoman',
  'heavy',
  'engineer',
  'medic',
  'sniper',
  'spy',
]
const ARMS_NAME = { demoman: 'demo' }
// A loadout slot's animations, unless the item names its own `anim_slot`.
const SLOT_ANIMS = {
  primary: 'PRIMARY',
  secondary: 'SECONDARY',
  melee: 'MELEE',
  pda: 'PDA',
  pda2: 'PDA',
  building: 'BUILDING',
}
// Viewmodel activities, ACT_<anim slot>_VM_<what>, by what the viewer plays.
const ACTIVITY_KINDS = {
  IDLE: 'idle',
  DRAW: 'draw',
  PRIMARYATTACK: 'fire',
  HITCENTER: 'fire',
  SWINGHARD: 'fire',
  FIRE: 'fire',
}

// ─── Arguments ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`)
  if (i >= 0 && i + 1 < args.length && !args[i + 1].startsWith('--')) return args[i + 1]
  const eq = args.find(a => a.startsWith(`--${name}=`))
  return eq ? eq.slice(name.length + 3) : fallback
}
const flag = name => args.includes(`--${name}`)
const list = name =>
  arg(name)
    ?.split(',')
    .map(s => s.trim())
    .filter(Boolean) ?? null

const config = (() => {
  const file = path.join(repoRoot, 'scripts/convert-config.json')
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
})()
const gameDir = arg('game-dir', config['game-dir'])
const hl2Dir = arg('hl2-dir', config['hl2-dir'])
const textureSize = Number(arg('texture-size', 512))
const force = flag('force')
const onlyClasses = list('classes')
const onlyItems = list('items')

if (!gameDir || !fs.existsSync(gameDir)) {
  console.error(
    'TF2 game dir not found: pass --game-dir or set game-dir in scripts/convert-config.json'
  )
  process.exit(1)
}

// ─── Tools ─────────────────────────────────────────────────────────────────────

const run = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { stdio: 'pipe', encoding: 'utf8', ...opts })

/** Clones and builds the pinned bsp-to-glb once; returns its binary. */
function bspToGlb() {
  const binary = path.join(toolDir, 'target/release/bsp-to-glb')
  if (!fs.existsSync(path.join(toolDir, '.git'))) {
    console.log(`Cloning bsp-to-glb into ${path.relative(repoRoot, toolDir)}`)
    run('git', ['clone', '--quiet', BSP_TO_GLB_REPO, toolDir])
  }
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: toolDir }).trim()
  if (head !== BSP_TO_GLB_REV) {
    run('git', ['fetch', '--quiet', 'origin'], { cwd: toolDir })
    run('git', ['checkout', '--quiet', BSP_TO_GLB_REV], { cwd: toolDir })
  }
  const stamp = path.join(toolDir, 'target/.built-rev')
  if (
    !fs.existsSync(binary) ||
    !fs.existsSync(stamp) ||
    fs.readFileSync(stamp, 'utf8') !== BSP_TO_GLB_REV
  ) {
    console.log('Building bsp-to-glb (cargo build --release)')
    execFileSync('cargo', ['build', '--release', '--quiet'], { cwd: toolDir, stdio: 'inherit' })
    fs.writeFileSync(stamp, BSP_TO_GLB_REV)
  }
  return binary
}

// ─── Items ─────────────────────────────────────────────────────────────────────

function loadItemsGame(vpks) {
  const loose = path.join(gameDir, 'scripts/items/items_game.txt')
  const text = fs.existsSync(loose)
    ? fs.readFileSync(loose, 'utf8')
    : vpks.read('scripts/items/items_game.txt')?.toString('utf8')
  if (!text) throw new Error('items_game.txt not found')
  return parseKeyValues(text).items_game
}

const isObject = v => v && typeof v === 'object'
const deepMerge = (base, over) => {
  const out = { ...base }
  for (const [k, v] of Object.entries(over))
    out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k], v) : v
  return out
}

/** An item with its prefabs (space separated, nested) applied under it. */
function resolvePrefabs(item, prefabs, seen = new Set()) {
  let base = {}
  for (const name of String(item.prefab ?? '')
    .split(/\s+/)
    .filter(Boolean)) {
    const prefab = prefabs[name.toLowerCase()]
    if (!prefab || seen.has(name)) continue
    base = deepMerge(base, resolvePrefabs(prefab, prefabs, new Set([...seen, name])))
  }
  const { prefab: _, ...own } = item
  return deepMerge(base, own)
}

/** Per weapon item, per class that uses it: the model in hand and its animation slot. */
function weaponItems(itemsGame, vpks) {
  const prefabs = itemsGame.prefabs ?? {}
  const out = new Map()
  const skipped = { notWeapon: 0, noModel: 0, missingModel: new Set() }
  for (const [id, raw] of Object.entries(itemsGame.items ?? {})) {
    if (id === 'default' || (onlyItems && !onlyItems.includes(id))) continue
    const item = resolvePrefabs(raw, prefabs)
    const itemClass = String(item.item_class ?? '')
    if (!/^tf_weapon_|^saxxy$/.test(itemClass)) {
      skipped.notWeapon++
      continue
    }
    const usedBy = isObject(item.used_by_classes) ? item.used_by_classes : {}
    const perClass = isObject(item.model_player_per_class) ? item.model_player_per_class : {}
    const byClass = {}
    for (const [cls, value] of Object.entries(usedBy)) {
      if (!CLASSES.includes(cls) || (onlyClasses && !onlyClasses.includes(cls))) continue
      const slot = value !== '1' ? value : item.item_slot
      let model = perClass[cls] ?? perClass.basename ?? item.model_player
      if (!model) {
        skipped.noModel++
        continue
      }
      model = model.replace(/%s/g, cls).replace(/\\/g, '/').toLowerCase()
      if (!vpks.has(model)) {
        skipped.missingModel.add(model)
        continue
      }
      const anim = String(item.anim_slot ?? SLOT_ANIMS[slot] ?? 'PRIMARY').toUpperCase()
      byClass[cls] = { model, anim }
    }
    if (Object.keys(byClass).length) out.set(id, byClass)
  }
  return { items: out, skipped }
}

// ─── Models ────────────────────────────────────────────────────────────────────

const sha = buffers => {
  const h = crypto.createHash('sha256')
  for (const b of buffers) h.update(b ?? Buffer.alloc(0))
  return h.digest('hex').slice(0, 16)
}

/** Writes the model's files from the VPKs into the temp dir; returns their paths and a hash. */
function extractModel(vpks, mdlPath, geometry = true) {
  const base = mdlPath.replace(/\.mdl$/, '')
  const files = {
    mdl: `${base}.mdl`,
    ...(geometry ? { vvd: `${base}.vvd`, vtx: `${base}.dx90.vtx` } : {}),
  }
  const local = {}
  const buffers = []
  for (const [kind, file] of Object.entries(files)) {
    const data = vpks.read(file)
    if (!data) throw new Error(`missing ${file}`)
    const dest = path.join(tempDir, 'src', file)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, data)
    local[kind] = dest
    buffers.push(data)
  }
  return {
    local,
    hash: sha([...buffers, Buffer.from(`${SCRIPT_VERSION}:${BSP_TO_GLB_REV}:${textureSize}`)]),
  }
}

/** Runs bsp-to-glb on one model; returns the GLB path and its manifest. */
function exportModel(tool, mdlPath, local, skin, tag) {
  const glb = path.join(tempDir, 'glb', `${tag}.glb`)
  const json = path.join(tempDir, 'glb', `${tag}.json`)
  fs.mkdirSync(path.dirname(glb), { recursive: true })
  const argv = ['--studio-source-path', mdlPath, '--studio-mdl', local.mdl]
  if (local.vvd) argv.push('--studio-vvd', local.vvd, '--studio-vtx', local.vtx)
  if (skin) argv.push('--studio-skin', String(skin))
  argv.push('--studio-out', glb, '--studio-manifest', json)
  const result = spawnSync(tool, argv, { encoding: 'utf8' })
  if (result.status !== 0)
    throw new Error((result.stderr || result.stdout).trim().split('\n').pop())
  return { glb, manifest: JSON.parse(fs.readFileSync(json, 'utf8')) }
}

const differentSkins = manifest => {
  const families = manifest.skinFamilies ?? []
  return (
    families.length > 1 &&
    JSON.stringify(families[0].textureIndices) !== JSON.stringify(families[1].textureIndices)
  )
}

// ─── Materials ─────────────────────────────────────────────────────────────────

/** A VMT's shader parameters, with `patch` materials resolved. */
function readMaterial(vpks, vmtPath, depth = 0) {
  const data = vpks.read(vmtPath)
  if (!data || depth > 4) return null
  const kv = parseKeyValues(data.toString('utf8'))
  const [shader, params] = Object.entries(kv)[0] ?? []
  if (!shader) return null
  if (shader === 'patch') {
    const include = params.include?.replace(/\\/g, '/').toLowerCase()
    const base = include ? readMaterial(vpks, include, depth + 1) : null
    return { ...(base ?? {}), ...(params.insert ?? {}), ...(params.replace ?? {}) }
  }
  return params
}

const texturePath = name =>
  `materials/${name
    .replace(/\\/g, '/')
    .replace(/\.vtf$/i, '')
    .toLowerCase()}.vtf`
const slug = file =>
  file
    .replace(/^materials\//, '')
    .replace(/\.vtf$/, '')
    .replace(/[^a-z0-9]+/gi, '_')

/** What each glTF material in an exported model needs: its base texture and how it blends. */
function materialPlan(vpks, manifest) {
  const plan = {}
  for (const material of manifest.materials ?? []) {
    const vmt = (material.candidates ?? []).find(c => vpks.has(c))
    const params = vmt ? readMaterial(vpks, vmt) : null
    const base = params?.$basetexture
    const vtf = base ? texturePath(base) : null
    plan[material.name] = {
      vtf: vtf && vpks.has(vtf) ? vtf : null,
      translucent: params?.$translucent === '1',
      alphaTest: params?.$alphatest === '1',
      doubleSided: params?.$nocull === '1',
    }
  }
  return plan
}

/** Converts every texture the plans name, in one Python run; returns per texture its WebP. */
function convertTextures(vpks, plans) {
  // TF2 mostly keeps a specular mask in the alpha channel; only blended materials need it.
  const needsAlpha = new Set()
  for (const plan of plans)
    for (const m of Object.values(plan))
      if (m.vtf && (m.translucent || m.alphaTest)) needsAlpha.add(m.vtf)
  const jobs = new Map()
  for (const plan of plans) {
    for (const m of Object.values(plan)) {
      if (!m.vtf || jobs.has(m.vtf)) continue
      const vtfLocal = path.join(tempDir, 'src', m.vtf)
      fs.mkdirSync(path.dirname(vtfLocal), { recursive: true })
      fs.writeFileSync(vtfLocal, vpks.read(m.vtf))
      const alpha = needsAlpha.has(m.vtf)
      const out = path.join(
        tempDir,
        'textures',
        String(textureSize),
        `${slug(m.vtf)}${alpha ? '_a' : ''}.webp`
      )
      jobs.set(m.vtf, { vtf: vtfLocal, out, max: textureSize, alpha })
    }
  }
  if (!jobs.size) return new Map()
  const python = spawnSync('python3', ['-I', path.join(here, 'vtf-to-webp.py')], {
    input: JSON.stringify([...jobs.values()]),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (python.status !== 0) throw new Error(`texture conversion failed: ${python.stderr}`)
  const results = JSON.parse(python.stdout)
  const out = new Map()
  for (const [vtf, job] of jobs) {
    const r = results[job.out]
    if (r?.error) console.warn(`  ! ${vtf}: ${r.error}`)
    else out.set(vtf, { file: job.out, alpha: r.alpha })
  }
  return out
}

// ─── Post-processing ───────────────────────────────────────────────────────────

const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.ERROR))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
const encoder = async () => {
  await MeshoptEncoder.ready
  return MeshoptEncoder
}

// Disposing an animation leaves its samplers holding their accessors, so prune keeps them.
const disposeAnimation = animation => {
  for (const channel of animation.listChannels()) channel.dispose()
  for (const sampler of animation.listSamplers()) sampler.dispose()
  animation.dispose()
}

// Source (Direct3D) faces are clockwise and bsp-to-glb's models keep them so; glTF's are
// counter-clockwise, so as exported every model renders inside out. Swaps each triangle's
// last two corners.
const flipWinding = primitive => {
  const indices = primitive.getIndices()
  if (primitive.getMode() !== 4 || !indices) return
  const array = indices.getArray().slice()
  for (let i = 0; i + 2 < array.length; i += 3) {
    const b = array[i + 1]
    array[i + 1] = array[i + 2]
    array[i + 2] = b
  }
  indices.setArray(array)
}

/** Keeps the default model's first LOD, textures it, flips it right side out, and compresses it. */
async function finishModel(exported, plan, textures, outFile) {
  const doc = await io.read(exported.glb)
  const root = doc.getRoot()
  const nodes = root.listNodes()
  for (const part of exported.manifest.bodyParts ?? []) {
    for (const model of part.models ?? []) {
      for (const lod of model.meshLods ?? []) {
        if (lod.lod > 0 || model.index !== (part.defaultModel ?? 0)) nodes[lod.gltfNode]?.dispose()
      }
    }
  }
  for (const animation of root.listAnimations()) disposeAnimation(animation)
  for (const mesh of root.listMeshes()) mesh.listPrimitives().forEach(flipWinding)

  let webp = null
  for (const material of root.listMaterials()) {
    const m = plan[material.getName()]
    const texture = m?.vtf ? textures.get(m.vtf) : null
    if (!texture) continue
    webp ??= doc.createExtension(EXTTextureWebP).setRequired(true)
    const image = doc
      .createTexture(path.basename(texture.file, '.webp'))
      .setImage(fs.readFileSync(texture.file))
      .setMimeType('image/webp')
    material.setBaseColorTexture(image).setMetallicFactor(0).setRoughnessFactor(1)
    if (texture.alpha && m.translucent) material.setAlphaMode('BLEND')
    else if (texture.alpha && m.alphaTest) material.setAlphaMode('MASK').setAlphaCutoff(0.5)
    material.setDoubleSided(m.doubleSided)
  }

  await doc.transform(
    prune(),
    dedup(),
    meshopt({ encoder: await encoder(), level: 'medium' }),
    prune()
  )
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  await io.write(outFile, doc)
}

/** Keeps only the viewmodel clips for the given animation slots; returns them by slot. */
async function finishAnimations(exported, slots, outFile) {
  const doc = await io.read(exported.glb)
  const animations = doc.getRoot().listAnimations()
  const clips = {}
  const keep = new Set()
  for (const sequence of exported.manifest.sequences ?? []) {
    const match = /^ACT_(.+)_VM_([A-Z]+)$/.exec(sequence.activityName ?? '')
    const kind = match && ACTIVITY_KINDS[match[2]]
    if (!kind || !slots.has(match[1])) continue
    const info = exported.manifest.animations[sequence.animationIndices?.[0]]
    const animation = info && animations[info.gltfAnimation]
    if (!animation) continue
    keep.add(animation)
    const bySlot = (clips[match[1]] ??= {})
    ;(bySlot[kind] ??= []).push(animation.getName())
  }
  for (const animation of animations) if (!keep.has(animation)) disposeAnimation(animation)
  await doc.transform(
    resample(),
    prune(),
    dedup(),
    meshopt({ encoder: await encoder(), level: 'medium' }),
    prune()
  )
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  await io.write(outFile, doc)
  return clips
}

// ─── Build ─────────────────────────────────────────────────────────────────────

async function main() {
  const tool = bspToGlb()
  const vpks = VpkSet.forGame(gameDir, hl2Dir)
  const manifestFile = path.join(outDir, 'manifest.json')
  const previous =
    !force && fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null

  const { items, skipped } = weaponItems(loadItemsGame(vpks), vpks)
  console.log(
    `${items.size} weapon items (skipped ${skipped.notWeapon} non-weapons, ${skipped.noModel} without a model, ${skipped.missingModel.size} missing models)`
  )

  // Weapon models by key (the file name, or the path when two share a name).
  const keys = new Map()
  const names = new Map()
  for (const byClass of items.values()) {
    for (const { model } of Object.values(byClass)) {
      if (keys.has(model)) continue
      const name = path.basename(model, '.mdl')
      const key =
        names.has(name) && names.get(name) !== model
          ? model.replace(/\.mdl$/, '').replace(/[^a-z0-9]+/g, '_')
          : name
      names.set(name, names.get(name) ?? model)
      keys.set(model, key)
    }
  }
  const classes = [...new Set([...items.values()].flatMap(byClass => Object.keys(byClass)))]
  const slotsByClass = new Map(classes.map(c => [c, new Set()]))
  for (const byClass of items.values())
    for (const [c, { anim }] of Object.entries(byClass)) slotsByClass.get(c).add(anim)

  // Models to (re)build: arms per class, then weapons; each one's skins and sources.
  const jobs = []
  for (const cls of classes) {
    const arms = `models/weapons/c_models/c_${ARMS_NAME[cls] ?? cls}_arms.mdl`
    jobs.push({ kind: 'arms', key: cls, model: arms, out: `arms/${cls}` })
  }
  for (const [model, key] of keys) jobs.push({ kind: 'weapon', key, model, out: `weapons/${key}` })

  const manifest = { version: 1, classes: {}, models: {}, items: {} }
  const pending = []
  const failures = []
  for (const job of jobs) {
    try {
      const { local, hash } = extractModel(vpks, job.model)
      const before =
        job.kind === 'arms' ? previous?.classes?.[job.key]?.armsSource : previous?.models?.[job.key]
      const prevFiles =
        job.kind === 'arms' ? previous?.classes?.[job.key]?.arms : previous?.models?.[job.key]
      const upToDate =
        before &&
        (before.source ?? before) === hash &&
        Object.values(prevFiles ?? {})
          .filter(v => typeof v === 'string' && v.endsWith('.glb'))
          .every(f => fs.existsSync(path.join(outDir, f)))
      if (upToDate) {
        job.result = prevFiles
        job.hash = hash
        continue
      }
      const tag = job.out.replace(/\//g, '__')
      const red = exportModel(tool, job.model, local, 0, `${tag}_0`)
      const blue = differentSkins(red.manifest)
        ? exportModel(tool, job.model, local, 1, `${tag}_1`)
        : null
      pending.push({
        job,
        hash,
        red,
        blue,
        plan: materialPlan(vpks, red.manifest),
        bluePlan: blue && materialPlan(vpks, blue.manifest),
      })
    } catch (error) {
      failures.push(`${job.model}: ${error.message}`)
    }
  }

  console.log(
    `${pending.length} models to build, ${jobs.length - pending.length - failures.length} up to date`
  )
  const textures = convertTextures(
    vpks,
    pending.flatMap(p => [p.plan, p.bluePlan].filter(Boolean))
  )
  for (const p of pending) {
    try {
      const files = { red: `${p.job.out}.glb` }
      if (p.blue) files.blue = `${p.job.out}_blue.glb`
      await finishModel(p.red, p.plan, textures, path.join(outDir, files.red))
      if (p.blue) await finishModel(p.blue, p.bluePlan, textures, path.join(outDir, files.blue))
      p.job.result = { ...files, source: p.hash }
      p.job.hash = p.hash
      process.stdout.write('.')
    } catch (error) {
      failures.push(`${p.job.model}: ${error.message}`)
    }
  }
  process.stdout.write('\n')

  for (const job of jobs) {
    if (!job.result) continue
    const files = { red: job.result.red, ...(job.result.blue ? { blue: job.result.blue } : {}) }
    if (job.kind === 'arms') manifest.classes[job.key] = { arms: files, armsSource: job.hash }
    else manifest.models[job.key] = { ...files, source: job.hash }
  }

  // Each class's animations, cut down to the slots its weapons use.
  for (const cls of classes) {
    if (!manifest.classes[cls]) continue
    const model = `models/weapons/c_models/c_${ARMS_NAME[cls] ?? cls}_animations.mdl`
    try {
      const { local, hash } = extractModel(vpks, model, false)
      const slots = [...slotsByClass.get(cls)].sort()
      const animHash = sha([Buffer.from(hash), Buffer.from(slots.join(','))])
      const prev = previous?.classes?.[cls]
      const file = `anims/${cls}.glb`
      let clips = prev?.clips
      if (!(prev?.animsSource === animHash && clips && fs.existsSync(path.join(outDir, file)))) {
        const exported = exportModel(tool, model, local, 0, `anims__${cls}`)
        clips = await finishAnimations(exported, new Set(slots), path.join(outDir, file))
      }
      Object.assign(manifest.classes[cls], { anims: file, animsSource: animHash, clips })
    } catch (error) {
      failures.push(`${model}: ${error.message}`)
    }
  }

  for (const [id, byClass] of items) {
    const entry = {}
    for (const [cls, { model, anim }] of Object.entries(byClass)) {
      const key = keys.get(model)
      if (manifest.models[key] && manifest.classes[cls]) entry[cls] = [key, anim]
    }
    if (Object.keys(entry).length) manifest.items[id] = entry
  }

  // A partial build (--classes / --items) adds to the previous manifest instead of replacing it.
  const partial = onlyClasses || onlyItems
  const merged =
    partial && previous
      ? {
          version: 1,
          classes: { ...previous.classes, ...manifest.classes },
          models: { ...previous.models, ...manifest.models },
          items: { ...previous.items, ...manifest.items },
        }
      : manifest
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(manifestFile, JSON.stringify(merged) + '\n')
  vpks.close()

  const bytes = dirSize(outDir)
  console.log(
    `Wrote ${Object.keys(merged.items).length} items, ${Object.keys(merged.models).length} weapon models, ${Object.keys(merged.classes).length} classes (${(bytes / 1048576).toFixed(1)} MB) to ${path.relative(repoRoot, outDir)}`
  )
  if (failures.length) {
    console.warn(`${failures.length} failed:`)
    for (const f of failures) console.warn(`  ${f}`)
  }
}

function dirSize(dir) {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size
  }
  return total
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
