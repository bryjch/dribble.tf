// What the viewmodel and map builds share: the pinned bsp-to-glb converter, Source materials
// read from TF2's VPKs, and fixing up the models bsp-to-glb exports.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseKeyValues } from '../viewmodels/keyvalues.mjs'

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const BSP_TO_GLB_REPO = 'https://github.com/Hona/bsp-to-glb'
export const BSP_TO_GLB_REV = '7b7f7fc803b65e53791d3fc6eab04c0a2e355c6c'
/**
 * Our changes on top of the pinned revision, applied in order after checkout:
 * - light-styles: faces lit by several light styles (switchable lights) sum their styles'
 *   lightmaps, where upstream refuses the map's lightmaps altogether.
 */
export const BSP_TO_GLB_PATCHES = ['bsp-to-glb-light-styles.patch'].map(file =>
  path.join(repoRoot, 'scripts/lib', file)
)
const toolDir = path.join(repoRoot, 'scripts/tools/bsp-to-glb')

const run = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { stdio: 'pipe', encoding: 'utf8', ...opts })

/** The pinned revision plus our patches, as recorded beside what it builds. */
export const bspToGlbBuild = () =>
  [
    BSP_TO_GLB_REV,
    ...BSP_TO_GLB_PATCHES.map(file =>
      createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10)
    ),
  ].join('+')

/** Clones, patches and builds the pinned bsp-to-glb once; returns its binary. */
export function bspToGlb() {
  const binary = path.join(toolDir, 'target/release/bsp-to-glb')
  if (!fs.existsSync(path.join(toolDir, '.git'))) {
    console.log(`Cloning bsp-to-glb into ${path.relative(repoRoot, toolDir)}`)
    run('git', ['clone', '--quiet', BSP_TO_GLB_REPO, toolDir])
  }
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: toolDir }).trim()
  const build = bspToGlbBuild()
  const stamp = path.join(toolDir, 'target/.built-rev')
  const built = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8') : null
  if (head !== BSP_TO_GLB_REV || built !== build) {
    // Back to the pinned revision as it was, then our patches on top.
    run('git', ['checkout', '--quiet', '--', '.'], { cwd: toolDir })
    if (head !== BSP_TO_GLB_REV) {
      run('git', ['fetch', '--quiet', 'origin'], { cwd: toolDir })
      run('git', ['checkout', '--quiet', BSP_TO_GLB_REV], { cwd: toolDir })
    }
    for (const patch of BSP_TO_GLB_PATCHES) run('git', ['apply', patch], { cwd: toolDir })
  }
  if (!fs.existsSync(binary) || built !== build) {
    console.log('Building bsp-to-glb (cargo build --release)')
    execFileSync('cargo', ['build', '--release', '--quiet'], { cwd: toolDir, stdio: 'inherit' })
    fs.writeFileSync(stamp, build)
  }
  return binary
}

/** Runs bsp-to-glb on one model (local copies of its .mdl/.vvd/.vtx); returns GLB and manifest. */
export function exportStudioModel(tool, mdlPath, local, skin, glb, json) {
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

/** A VMT's shader parameters, with `patch` materials resolved. */
export function readMaterial(vpks, vmtPath, depth = 0) {
  const data = vpks.read(vmtPath)
  if (!data || depth > 4) return null
  const kv = parseKeyValues(data.toString('utf8'))
  const [shader, params] = Object.entries(kv)[0] ?? []
  if (!shader) return null
  if (shader.toLowerCase() === 'patch') {
    const include = params.include?.replace(/\\/g, '/').toLowerCase()
    const base = include ? readMaterial(vpks, include, depth + 1) : null
    return { ...(base ?? {}), ...(params.insert ?? {}), ...(params.replace ?? {}) }
  }
  return params
}

export const texturePath = name =>
  `materials/${name
    .replace(/\\/g, '/')
    .replace(/\.vtf$/i, '')
    .toLowerCase()}.vtf`

export const slug = file =>
  file
    .replace(/^materials\//, '')
    .replace(/\.vtf$/, '')
    .replace(/[^a-z0-9]+/gi, '_')

/** What each glTF material in an exported model needs: its base texture and how it blends. */
export function materialPlan(vpks, manifest) {
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
      additive: params?.$additive === '1',
      doubleSided: params?.$nocull === '1',
    }
  }
  return plan
}

// Source (Direct3D) faces are clockwise and bsp-to-glb's models keep them so; glTF's are
// counter-clockwise, so as exported every model renders inside out. Swaps each triangle's
// last two corners.
export const flipWinding = primitive => {
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

/**
 * Converts every texture the plans name to WebP no larger than `size`, in one Python run, into
 * `dir`; returns per VTF path its WebP file and whether it kept an alpha channel.
 */
export function convertTextures(vpks, plans, dir, size) {
  // TF2 mostly keeps a specular mask in the alpha channel; only blended materials need it.
  const needsAlpha = new Set()
  for (const plan of plans)
    for (const m of Object.values(plan))
      if (m.vtf && (m.translucent || m.alphaTest)) needsAlpha.add(m.vtf)
  const jobs = new Map()
  for (const plan of plans) {
    for (const m of Object.values(plan)) {
      if (!m.vtf || jobs.has(m.vtf)) continue
      const vtfLocal = path.join(dir, 'src', m.vtf)
      fs.mkdirSync(path.dirname(vtfLocal), { recursive: true })
      fs.writeFileSync(vtfLocal, vpks.read(m.vtf))
      const alpha = needsAlpha.has(m.vtf)
      const out = path.join(dir, 'textures', String(size), `${slug(m.vtf)}${alpha ? '_a' : ''}.webp`)
      jobs.set(m.vtf, { vtf: vtfLocal, out, max: size, alpha })
    }
  }
  if (!jobs.size) return new Map()
  const python = spawnSync(
    'python3',
    ['-I', path.join(repoRoot, 'scripts/viewmodels/vtf-to-webp.py')],
    { input: JSON.stringify([...jobs.values()]), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
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

/** Gives a model's glTF materials their WebP base textures and blending, from its plan. */
export function applyTextures(doc, plan, textures, EXTTextureWebP) {
  let webp = null
  for (const material of doc.getRoot().listMaterials()) {
    const m = plan[material.getName()]
    // Glows (light cones, sprites) add their light; the viewer blends them so (material extras).
    if (m?.additive) {
      material.setAlphaMode('BLEND').setExtras({ ...material.getExtras(), additive: true })
    }
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
}

/**
 * Keeps each body part's default model (or the one `bodygroups` names for it) at its first LOD;
 * drops the rest.
 */
export function keepDefaultLod(root, manifest, bodygroups = {}) {
  const nodes = root.listNodes()
  for (const part of manifest.bodyParts ?? []) {
    const chosen = bodygroups[part.name] ?? part.defaultModel ?? 0
    for (const model of part.models ?? []) {
      for (const lod of model.meshLods ?? []) {
        if (lod.lod > 0 || model.index !== chosen) nodes[lod.gltfNode]?.dispose()
      }
    }
  }
}
