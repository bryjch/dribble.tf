#!/usr/bin/env node
/**
 * Builds the first-person viewmodels (each class's arms, their animations, and every weapon's
 * model) from TF2's own files into public/models/viewmodels/, with a manifest mapping item
 * definition indexes to models and animation slots. It also builds the engineer's buildings
 * (each sentry, dispenser and teleporter level, per team, and the sapper on them) into
 * public/models/buildings/, rigged so the sentry turret can be turned by its bones.
 *
 * Needs the game's VPKs (see scripts/convert-config.json `game-dir` / `hl2-dir`), Rust (to build
 * the pinned bsp-to-glb that converts models), and Python with vtf2img and Pillow (textures).
 * Models whose sources have not changed since the last build are skipped.
 *
 * Usage:
 *   node scripts/viewmodels/build-viewmodels.mjs [--classes soldier,scout] [--items 18,205]
 *        [--only viewmodels|buildings] [--game-dir <tf>] [--hl2-dir <hl2>]
 *        [--texture-size 512] [--force]
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Logger, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import { parseKeyValues } from './keyvalues.mjs'
import { VpkSet } from './vpk.mjs'
import {
  BSP_TO_GLB_REV,
  applyTextures,
  bspToGlb,
  convertTextures as convertModelTextures,
  exportStudioModel,
  flipWinding,
  keepDefaultLod,
  materialPlan as modelMaterialPlan,
} from '../lib/source-models.mjs'

// Bump to rebuild every model (a change to how they are processed).
const SCRIPT_VERSION = 3

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const tempDir = path.join(repoRoot, 'scripts/temp/viewmodels')
const outDir = path.join(repoRoot, 'public/models/viewmodels')
const buildingsDir = path.join(repoRoot, 'public/models/buildings')

// The buildings as TF2 draws them once built (the `_light` models; the others carry the build
// animations), by the file name the viewer loads, `<key>_<team>.glb`. Skins are per team; the
// mini-sentry is the level 1 sentry in its own skins with its light switched on.
const BUILDINGS = [
  { key: 'sentry1', model: 'models/buildables/sentry1.mdl', skins: { red: 0, blue: 1 } },
  {
    key: 'minisentry',
    model: 'models/buildables/sentry1.mdl',
    skins: { red: 2, blue: 3 },
    bodygroups: { mini_sentry_light: 1 },
  },
  { key: 'sentry2', model: 'models/buildables/sentry2.mdl', skins: { red: 0, blue: 1 } },
  { key: 'sentry3', model: 'models/buildables/sentry3.mdl', skins: { red: 0, blue: 1 } },
  { key: 'dispenser1', model: 'models/buildables/dispenser_light.mdl', skins: { red: 0, blue: 1 } },
  {
    key: 'dispenser2',
    model: 'models/buildables/dispenser_lvl2_light.mdl',
    skins: { red: 0, blue: 1 },
  },
  {
    key: 'dispenser3',
    model: 'models/buildables/dispenser_lvl3_light.mdl',
    skins: { red: 0, blue: 1 },
  },
  {
    key: 'teleporter',
    model: 'models/buildables/teleporter_light.mdl',
    skins: { red: 0, blue: 1 },
  },
  // The per-building sappers (sapper_sentry1.mdl, …) are MDL v47, which bsp-to-glb does not read.
  { key: 'sapper', model: 'models/buildables/sapper_placed.mdl', skins: { shared: 0 } },
]

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
const only = arg('only')

if (only && only !== 'viewmodels' && only !== 'buildings') {
  console.error('--only takes viewmodels or buildings')
  process.exit(1)
}

if (!gameDir || !fs.existsSync(gameDir)) {
  console.error(
    'TF2 game dir not found: pass --game-dir or set game-dir in scripts/convert-config.json'
  )
  process.exit(1)
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
const exportModel = (tool, mdlPath, local, skin, tag) =>
  exportStudioModel(
    tool,
    mdlPath,
    local,
    skin,
    path.join(tempDir, 'glb', `${tag}.glb`),
    path.join(tempDir, 'glb', `${tag}.json`)
  )

const differentSkins = manifest => {
  const families = manifest.skinFamilies ?? []
  return (
    families.length > 1 &&
    JSON.stringify(families[0].textureIndices) !== JSON.stringify(families[1].textureIndices)
  )
}

// ─── Materials ─────────────────────────────────────────────────────────────────

const materialPlan = (vpks, manifest) => modelMaterialPlan(vpks, manifest)
const convertTextures = (vpks, plans) => convertModelTextures(vpks, plans, tempDir, textureSize)

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

/**
 * Keeps each body part's default model (or the one `bodygroups` names for it) at its first LOD,
 * textures it, flips it right side out, and compresses it. `keepAttachments` keeps the model's
 * attachment points (empty nodes named `attachment_<name>`), which pruning would otherwise drop.
 * `pose` (a glTF animation index) sets the bones to that animation's first frame before the
 * animations go: a model's rest pose is not always how the game draws it.
 */
async function finishModel(exported, plan, textures, outFile, options = {}) {
  const { bodygroups = {}, keepAttachments = false, pose = null } = options
  const doc = await io.read(exported.glb)
  const root = doc.getRoot()
  const nodes = root.listNodes()
  const posed = pose === null ? null : root.listAnimations()[pose]
  for (const channel of posed?.listChannels() ?? []) {
    const node = channel.getTargetNode()
    const values = channel.getSampler()?.getOutput()?.getArray()
    const path = channel.getTargetPath()
    if (!node || !values) continue
    if (path === 'rotation') node.setRotation(Array.from(values.slice(0, 4)))
    else if (path === 'translation') node.setTranslation(Array.from(values.slice(0, 3)))
    else if (path === 'scale') node.setScale(Array.from(values.slice(0, 3)))
  }
  keepDefaultLod(root, exported.manifest, bodygroups)
  for (const animation of root.listAnimations()) disposeAnimation(animation)
  for (const mesh of root.listMeshes()) mesh.listPrimitives().forEach(flipWinding)

  applyTextures(doc, plan, textures, EXTTextureWebP)

  const keep = { keepLeaves: keepAttachments }
  await doc.transform(
    prune(keep),
    dedup(),
    meshopt({ encoder: await encoder(), level: 'medium' }),
    prune(keep)
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

async function buildViewmodels(tool, vpks) {
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

  const bytes = dirSize(outDir)
  console.log(
    `Wrote ${Object.keys(merged.items).length} items, ${Object.keys(merged.models).length} weapon models, ${Object.keys(merged.classes).length} classes (${(bytes / 1048576).toFixed(1)} MB) to ${path.relative(repoRoot, outDir)}`
  )
  return failures
}

/**
 * The animation a building stands in once built: its running sequence, else its reference pose.
 * Their bind poses lack the root bone's turn from the rig's Y up to the game's Z up, so drawn
 * as exported they lie on their side.
 */
function standingPose(manifest) {
  const sequences = manifest.sequences ?? []
  const sequence =
    sequences.find(s => s.activityName === 'ACT_OBJ_RUNNING') ??
    sequences.find(s => s.name === 'ref') ??
    sequences.find(s => /idle/.test(s.name)) ??
    sequences[0]
  const animation = sequence && manifest.animations?.[sequence.animationIndices?.[0]]
  return animation?.gltfAnimation ?? null
}

/** The engineer's buildings, each level a model of its own, and the sapper placed on them. */
async function buildBuildings(tool, vpks) {
  const manifestFile = path.join(buildingsDir, 'manifest.json')
  const previous =
    !force && fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null
  const manifest = { version: 1, models: {} }
  const pending = []
  const failures = []
  for (const job of BUILDINGS) {
    try {
      const { local, hash } = extractModel(vpks, job.model)
      const source = sha([Buffer.from(hash), Buffer.from(JSON.stringify(job))])
      const prev = previous?.models?.[job.key]
      const files = Object.fromEntries(
        Object.keys(job.skins).map(team => [team, `${job.key}_${team}.glb`])
      )
      if (
        prev?.source === source &&
        Object.values(files).every(f => fs.existsSync(path.join(buildingsDir, f)))
      ) {
        manifest.models[job.key] = prev
        continue
      }
      const exports = Object.entries(job.skins).map(([team, skin]) => {
        const exported = exportModel(tool, job.model, local, skin, `buildings__${job.key}_${team}`)
        return { team, exported, plan: materialPlan(vpks, exported.manifest) }
      })
      pending.push({ job, source, files, exports })
    } catch (error) {
      failures.push(`${job.model}: ${error.message}`)
    }
  }

  console.log(
    `${pending.length} building models to build, ${BUILDINGS.length - pending.length - failures.length} up to date`
  )
  const textures = convertTextures(
    vpks,
    pending.flatMap(p => p.exports.map(e => e.plan))
  )
  for (const p of pending) {
    try {
      for (const e of p.exports) {
        await finishModel(e.exported, e.plan, textures, path.join(buildingsDir, p.files[e.team]), {
          bodygroups: p.job.bodygroups,
          keepAttachments: true,
          pose: standingPose(e.exported.manifest),
        })
      }
      manifest.models[p.job.key] = { ...p.files, source: p.source }
      process.stdout.write('.')
    } catch (error) {
      failures.push(`${p.job.model}: ${error.message}`)
    }
  }
  process.stdout.write('\n')

  fs.mkdirSync(buildingsDir, { recursive: true })
  fs.writeFileSync(manifestFile, JSON.stringify(manifest) + '\n')
  const bytes = dirSize(buildingsDir)
  console.log(
    `Wrote ${Object.keys(manifest.models).length} building models (${(bytes / 1048576).toFixed(1)} MB) to ${path.relative(repoRoot, buildingsDir)}`
  )
  return failures
}

async function main() {
  const tool = bspToGlb()
  const vpks = VpkSet.forGame(gameDir, hl2Dir)
  const failures = []
  if (only !== 'buildings') failures.push(...(await buildViewmodels(tool, vpks)))
  // A partial build (--classes / --items) is about weapons, so it leaves the buildings be.
  if (only !== 'viewmodels' && !onlyClasses && !onlyItems)
    failures.push(...(await buildBuildings(tool, vpks)))
  vpks.close()
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
