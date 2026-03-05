#!/usr/bin/env node
/**
 * Extract lightmap data from a Source engine BSP file.
 *
 * Reads per-face lightmap samples from LUMP_LIGHTING(_HDR), packs them into
 * atlas page(s), and writes:
 *
 *   <outDir>/lightmap_atlas.bin      - raw RGBA8 pixels (atlasW × atlasH × 4)
 *   <outDir>/lightmap_data.json      - atlas dimensions + per-face vertex data
 *
 * The Blender script loads the .bin into bpy.data.images.new() directly.
 * gltfpack later compresses it to WebP inside the GLB.
 *
 * Usage:
 *   node scripts/extract-bsp-lightmaps.mjs --bsp <path> [--out <dir>] [--atlas-size 4096]
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/* ── BSP lump indices ── */
const LUMP_VERTEXES = 3
const LUMP_EDGES = 12
const LUMP_SURFEDGES = 13
const LUMP_FACES = 7
const LUMP_FACES_HDR = 58
const LUMP_TEXINFO = 6
const LUMP_LIGHTING = 8
const LUMP_LIGHTING_HDR = 53

const MAXLIGHTMAPS = 4
const SURF_BUMPLIGHT = 0x0800
const SURF_SKY = 0x0004
const SURF_NODRAW = 0x0080
const SURF_NOLIGHT = 0x0400

/* ── Arg parsing ── */
const args = new Map()
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) {
    const key = a.slice(2)
    const next = process.argv[i + 1]
    if (next && !next.startsWith('--')) {
      args.set(key, next)
      i++
    } else args.set(key, 'true')
  }
}

const bspPath = args.get('bsp')
const outDir = args.get('out') || '.'
const atlasMaxSize = Number(args.get('atlas-size') || '4096')
const padding = Number(args.get('padding') || '1')

if (!bspPath) {
  console.error(
    'Usage: node extract-bsp-lightmaps.mjs --bsp <path> [--out <dir>] [--atlas-size 4096]'
  )
  process.exit(1)
}

/* ── Read BSP ── */
const data = fs.readFileSync(bspPath)
if (data.length < 1032 || data.toString('utf8', 0, 4) !== 'VBSP') {
  throw new Error(`Not a valid BSP file: ${bspPath}`)
}

const lumps = []
let headerOff = 8
for (let i = 0; i < 64; i++) {
  lumps.push({
    fileOffset: data.readInt32LE(headerOff),
    fileLength: data.readInt32LE(headerOff + 4),
    uncompressedSize: data.readInt32LE(headerOff + 12),
  })
  headerOff += 16
}

/**
 * Decompress a Source BSP LZMA lump.
 * Format: "LZMA" (4) + uncompressedSize (u32) + compressedSize (u32) + props (5) + data
 */
const decompressLzmaLump = buf => {
  if (buf.length < 17 || buf.toString('ascii', 0, 4) !== 'LZMA') return buf

  const uncompSize = buf.readUInt32LE(4)
  const compSize = buf.readUInt32LE(8)
  const props = buf.subarray(12, 17)
  const compressed = buf.subarray(17, 17 + compSize)

  // Build LZMA alone format header: props(5) + uncompressed size as uint64 LE(8) + data
  const header = Buffer.alloc(13)
  props.copy(header, 0)
  header.writeUInt32LE(uncompSize, 5)
  header.writeUInt32LE(0, 9) // high 32 bits of size

  const lzmaData = Buffer.concat([header, compressed])

  // Use Python's lzma module via subprocess (Node.js has no built-in LZMA)
  const result = execSync(
    `python -c "import sys,lzma;sys.stdout.buffer.write(lzma.decompress(sys.stdin.buffer.read(),format=lzma.FORMAT_ALONE))"`,
    { input: lzmaData, maxBuffer: uncompSize + 1024 * 1024 }
  )
  return result
}

const readLump = idx => {
  const l = lumps[idx]
  if (!l || l.fileLength <= 0) return Buffer.alloc(0)
  const s = l.fileOffset
  const e = s + l.fileLength
  if (s < 0 || e > data.length || s >= e) return Buffer.alloc(0)
  const raw = data.subarray(s, e)
  if (raw.length >= 4 && raw.toString('ascii', 0, 4) === 'LZMA') {
    return decompressLzmaLump(raw)
  }
  return raw
}

/* ── Prefer HDR, fall back to LDR ── */
const faceLumpHdr = readLump(LUMP_FACES_HDR)
const lightLumpHdr = readLump(LUMP_LIGHTING_HDR)
const faceLump = faceLumpHdr.length > 0 ? faceLumpHdr : readLump(LUMP_FACES)
const lightLump = lightLumpHdr.length > 0 ? lightLumpHdr : readLump(LUMP_LIGHTING)
const texinfoLump = readLump(LUMP_TEXINFO)
const vertexLump = readLump(LUMP_VERTEXES)
const edgeLump = readLump(LUMP_EDGES)
const surfedgeLump = readLump(LUMP_SURFEDGES)

const isHdr = faceLumpHdr.length > 0
console.log(`Lightmap source: ${isHdr ? 'HDR' : 'LDR'}`)
console.log(`Lighting lump: ${(lightLump.length / 1024 / 1024).toFixed(1)} MB`)

/* ── Counts ── */
const FACE_SIZE = 56
const TEXINFO_SIZE = 72
const faceCount = Math.floor(faceLump.length / FACE_SIZE)
const texinfoCount = Math.floor(texinfoLump.length / TEXINFO_SIZE)
const vertexCount = Math.floor(vertexLump.length / 12)
const surfedgeCount = Math.floor(surfedgeLump.length / 4)

console.log(`Faces: ${faceCount}, Texinfos: ${texinfoCount}, Vertices: ${vertexCount}`)

/* ── Helpers ── */
const getTexinfo = idx => {
  if (idx < 0 || idx >= texinfoCount) return null
  const b = idx * TEXINFO_SIZE
  // lightmapVecsLuxelsPerWorldUnits starts at byte 32 (after textureVecs 2×4 floats = 32 bytes)
  return {
    lmVecs: [
      [
        texinfoLump.readFloatLE(b + 32),
        texinfoLump.readFloatLE(b + 36),
        texinfoLump.readFloatLE(b + 40),
        texinfoLump.readFloatLE(b + 44),
      ],
      [
        texinfoLump.readFloatLE(b + 48),
        texinfoLump.readFloatLE(b + 52),
        texinfoLump.readFloatLE(b + 56),
        texinfoLump.readFloatLE(b + 60),
      ],
    ],
    flags: texinfoLump.readInt32LE(b + 64),
  }
}

const getVertex = idx => {
  const b = idx * 12
  return [vertexLump.readFloatLE(b), vertexLump.readFloatLE(b + 4), vertexLump.readFloatLE(b + 8)]
}

const getFaceVertexIndices = (firstEdge, numEdges) => {
  const out = []
  for (let i = 0; i < numEdges; i++) {
    const seIdx = firstEdge + i
    if (seIdx >= surfedgeCount) break
    const se = surfedgeLump.readInt32LE(seIdx * 4)
    const eBase = Math.abs(se) * 4
    if (eBase + 4 > edgeLump.length) break
    out.push(se >= 0 ? edgeLump.readUInt16LE(eBase) : edgeLump.readUInt16LE(eBase + 2))
  }
  return out
}

/**
 * Decode ColorRGBExp32 → linear HDR RGB.
 * Source stores: linear_irradiance = channel_byte * 2^exponent
 * Typical range: 0-500+ (not [0,1]).
 */
const decodeColor = (buf, off) => {
  const exp = buf.readInt8(off + 3)
  const s = Math.pow(2, exp)
  return [buf[off] * s, buf[off + 1] * s, buf[off + 2] * s]
}

/**
 * Tonemap + gamma-encode a linear HDR value to an sRGB byte.
 * Uses simple exposure + Reinhard tonemapping to preserve colour in bright areas
 * (torch glow, neon) instead of hard-clamping to 1.0.
 */
/**
 * Source lightmap linear values typically range 0-500+.
 * We use exposure + soft clamp to map into [0,1] while preserving
 * bright coloured lights (orange torch ~300, blue neon ~200).
 */
const EXPOSURE = 1.0 / 80
const toSrgb = v => {
  const x = v * EXPOSURE
  // Soft shoulder: linear below 0.8, gentle rolloff above
  const mapped = x <= 0.8 ? x : 0.8 + 0.2 * (1 - Math.exp(-(x - 0.8) / 0.4))
  return Math.min(255, Math.max(0, Math.round(Math.pow(Math.min(1, mapped), 1 / 2.2) * 255)))
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Pass 1 – Parse faces, decode per-face lightmap samples
 * ═══════════════════════════════════════════════════════════════════════════ */
const faces = [] // { w, h, pixels: Uint8Array(w*h*4 RGBA), vertIndices, vertPositions, lmVecs, lmMins }

for (let fi = 0; fi < faceCount; fi++) {
  const b = fi * FACE_SIZE
  const planenum = faceLump.readUInt16LE(b)
  const texinfoIdx = faceLump.readInt16LE(b + 10)
  const lightofs = faceLump.readInt32LE(b + 20)
  const lmMinsS = faceLump.readInt32LE(b + 28)
  const lmMinsT = faceLump.readInt32LE(b + 32)
  const lmSizeS = faceLump.readInt32LE(b + 36)
  const lmSizeT = faceLump.readInt32LE(b + 40)
  const firstEdge = faceLump.readInt32LE(b + 4)
  const numEdges = faceLump.readInt16LE(b + 8)
  const style0 = faceLump[b + 16]

  if (lightofs === -1 || style0 === 255) continue

  const ti = getTexinfo(texinfoIdx)
  if (!ti) continue
  if (ti.flags & (SURF_SKY | SURF_NODRAW | SURF_NOLIGHT)) continue

  const w = lmSizeS + 1
  const h = lmSizeT + 1
  if (w <= 0 || h <= 0 || w > 256 || h > 256) continue

  // Verify data bounds (style-0 flat lightmap only)
  if (lightofs < 0 || lightofs + w * h * 4 > lightLump.length) continue

  // Decode style-0 flat lightmap → sRGB RGBA
  const rgba = new Uint8Array(w * h * 4)
  for (let j = 0; j < w * h; j++) {
    const [r, g, b2] = decodeColor(lightLump, lightofs + j * 4)
    rgba[j * 4] = toSrgb(r)
    rgba[j * 4 + 1] = toSrgb(g)
    rgba[j * 4 + 2] = toSrgb(b2)
    rgba[j * 4 + 3] = 255
  }

  const vertIndices = getFaceVertexIndices(firstEdge, numEdges)
  const vertPositions = vertIndices.map(vi => getVertex(vi))

  faces.push({
    faceIndex: fi,
    w,
    h,
    rgba,
    planenum,
    texinfoIdx,
    vertIndices,
    vertPositions,
    lmVecs: ti.lmVecs,
    lmMinsS,
    lmMinsT,
  })
}

console.log(`Lightmapped faces: ${faces.length} / ${faceCount}`)

/* ═══════════════════════════════════════════════════════════════════════════
 * Pass 1.5 - Merge 3D-touching coplanar faces
 * ═══════════════════════════════════════════════════════════════════════════ */
const texinfos = new Map()
for (const f of faces) {
  if (!texinfos.has(f.texinfoIdx)) texinfos.set(f.texinfoIdx, [])
  texinfos.get(f.texinfoIdx).push(f)
}
const mergedFaces = []
let origArea = 0
let newArea = 0

for (const [tIdx, tf] of texinfos) {
  let groups = []
  for (const f of tf) {
    origArea += f.w * f.h
    const vSet = new Set()
    for (const v of f.vertPositions) {
      vSet.add(Math.round(v[0]) + ',' + Math.round(v[1]) + ',' + Math.round(v[2]))
    }
    groups.push({ minS: f.lmMinsS, minT: f.lmMinsT, maxS: f.lmMinsS + f.w, maxT: f.lmMinsT + f.h, faces: [f], vSet })
  }
  
  // Connected Components via Adjacency List + DFS
  const adj = new Map()
  for (let i=0; i<groups.length; i++) adj.set(i, [])
  
  for (let i=0; i<groups.length; i++) {
    const g1 = groups[i]
    for (let j=i+1; j<groups.length; j++) {
      const g2 = groups[j]
      if (g1.minS <= g2.maxS && g1.maxS >= g2.minS && g1.minT <= g2.maxT && g1.maxT >= g2.minT) {
        if (g1.faces[0].planenum === g2.faces[0].planenum) {
          adj.get(i).push(j)
          adj.get(j).push(i)
        }
      }
    }
  }
  
  const visited = new Set()
  const finalGroups = []
  
  for (let i=0; i<groups.length; i++) {
    if (visited.has(i)) continue
    
    const stack = [i]
    visited.add(i)
    const comp = []
    
    while(stack.length > 0) {
      const curr = stack.pop()
      comp.push(curr)
      for (const neighbor of adj.get(curr)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          stack.push(neighbor)
        }
      }
    }
    
    const m = groups[comp[0]]
    let minS = m.minS, minT = m.minT, maxS = m.maxS, maxT = m.maxT
    const mergedFaces = [...m.faces]
    
    for (let k=1; k<comp.length; k++) {
      const g = groups[comp[k]]
      minS = Math.min(minS, g.minS)
      minT = Math.min(minT, g.minT)
      maxS = Math.max(maxS, g.maxS)
      maxT = Math.max(maxT, g.maxT)
      mergedFaces.push(...g.faces)
    }
    
    finalGroups.push({ minS, minT, maxS, maxT, faces: mergedFaces })
  }
  
  groups = finalGroups
  
  for (const g of groups) {
    const gw = g.maxS - g.minS
    const gh = g.maxT - g.minT
    newArea += gw * gh
    
    const rgba = new Uint8Array(gw * gh * 4)
    
    for (const f of g.faces) {
      const offsetX = f.lmMinsS - g.minS
      const offsetY = f.lmMinsT - g.minT
      for (let y=0; y<f.h; y++) {
        for (let x=0; x<f.w; x++) {
          const srcI = (y * f.w + x) * 4
          const dstI = ((y + offsetY) * gw + (x + offsetX)) * 4
          rgba[dstI] = f.rgba[srcI]
          rgba[dstI+1] = f.rgba[srcI+1]
          rgba[dstI+2] = f.rgba[srcI+2]
          rgba[dstI+3] = 255
        }
      }
    }
    
    const master = g.faces[0]
    const allVerts = []
    const allIndices = []
    let vOffset = 0
    for (const f of g.faces) {
      allVerts.push(...f.vertPositions)
      for (const i of f.vertIndices) allIndices.push(i + vOffset)
      vOffset += f.vertPositions.length
    }
      
    mergedFaces.push({
      ...master,
      w: gw,
      h: gh,
      rgba,
      lmMinsS: g.minS,
      lmMinsT: g.minT,
      vertPositions: allVerts,
      vertIndices: allIndices
    })
  }
}

console.log(`Merged ${faces.length} faces into ${mergedFaces.length} contiguous 3D groups.`)
console.log(`Area: ${origArea} -> ${newArea} (${(newArea / origArea).toFixed(2)}x blowup)`)

faces.length = 0
faces.push(...mergedFaces)

/* ═══════════════════════════════════════════════════════════════════════════
 * Pass 2 – Shelf-pack face lightmaps into atlas pages
 * ═══════════════════════════════════════════════════════════════════════════ */

// Sort by height descending (shelf packing heuristic)
faces.sort((a, b) => b.h - a.h || b.w - a.w)

const atlasW = atlasMaxSize
let atlasH = atlasMaxSize // will trim later
const atlasRGBA = new Uint8Array(atlasW * atlasH * 4)

let shelfX = 0
let shelfY = 0
let shelfH = 0
let placed = 0

for (const face of faces) {
  const pw = face.w + padding
  const ph = face.h + padding

  if (shelfX + pw > atlasW) {
    shelfY += shelfH + padding
    shelfX = 0
    shelfH = 0
  }

  if (shelfY + ph > atlasH) break // overflow

  face.atlasX = shelfX
  face.atlasY = shelfY

  // Blit face pixels into atlas
  for (let y = 0; y < face.h; y++) {
    const srcOff = y * face.w * 4
    const dstOff = ((shelfY + y) * atlasW + shelfX) * 4
    atlasRGBA.set(face.rgba.subarray(srcOff, srcOff + face.w * 4), dstOff)
  }

  shelfX += pw
  if (ph > shelfH) shelfH = ph
  placed++
}

const usedH = shelfY + shelfH
const overflow = faces.length - placed
if (overflow > 0)
  console.warn(`Atlas overflow: ${overflow} faces didn't fit in ${atlasW}x${atlasW}`)
console.log(
  `Atlas: ${atlasW}×${usedH} (${placed}/${faces.length} faces placed, ${((placed / faces.length) * 100).toFixed(1)}%)`
)

/* ═══════════════════════════════════════════════════════════════════════════
 * Pass 3 – Build per-face vertex lightmap UVs in atlas space
 * ═══════════════════════════════════════════════════════════════════════════ */
const faceMappings = []

for (const face of faces) {
  if (face.atlasX == null) continue

  // Per-vertex: project world pos → face-local luxel UV → atlas UV
  const atlasUVs = face.vertPositions.map(pos => {
    const lu =
      pos[0] * face.lmVecs[0][0] +
      pos[1] * face.lmVecs[0][1] +
      pos[2] * face.lmVecs[0][2] +
      face.lmVecs[0][3]
    const lv =
      pos[0] * face.lmVecs[1][0] +
      pos[1] * face.lmVecs[1][1] +
      pos[2] * face.lmVecs[1][2] +
      face.lmVecs[1][3]

    // face-local [0..1]
    const faceU = (lu - face.lmMinsS + 0.5) / face.w
    const faceV = (lv - face.lmMinsT + 0.5) / face.h

    // atlas [0..1]
    return [(face.atlasX + faceU * face.w) / atlasW, (face.atlasY + faceV * face.h) / usedH]
  })

  faceMappings.push({
    faceIndex: face.faceIndex,
    w: face.w,
    h: face.h,
    atlasX: face.atlasX,
    atlasY: face.atlasY,
    // Lightmap projection vectors (Source space) so the injector can compute atlas
    // UVs for arbitrary vertex positions without relying on pre-matched vertices.
    lmVecs: face.lmVecs,
    lmMinsS: face.lmMinsS,
    lmMinsT: face.lmMinsT,
    // Store rounded vertex positions for matching in Blender (3 decimal places ≈ 0.001 uu)
    verts: face.vertPositions.map(p => [
      Math.round(p[0] * 1000) / 1000,
      Math.round(p[1] * 1000) / 1000,
      Math.round(p[2] * 1000) / 1000,
    ]),
    uvs: atlasUVs.map(uv => [Math.round(uv[0] * 65535) / 65535, Math.round(uv[1] * 65535) / 65535]),
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Output
 * ═══════════════════════════════════════════════════════════════════════════ */
fs.mkdirSync(outDir, { recursive: true })

// Write raw RGBA atlas pixels (trimmed to usedH rows)
const binPath = path.join(outDir, 'lightmap_atlas.bin')
const trimmed = Buffer.from(atlasRGBA.buffer, 0, atlasW * usedH * 4)
fs.writeFileSync(binPath, trimmed)
console.log(`Atlas binary: ${binPath} (${(trimmed.length / 1024 / 1024).toFixed(1)} MB)`)

// Write face mapping JSON
const jsonPath = path.join(outDir, 'lightmap_data.json')
const jsonData = {
  atlasWidth: atlasW,
  atlasHeight: usedH,
  atlasFile: 'lightmap_atlas.bin',
  placedFaces: faceMappings.length,
  totalFaces: faces.length,
  faces: faceMappings,
}
fs.writeFileSync(jsonPath, JSON.stringify(jsonData))
console.log(
  `Mapping JSON: ${jsonPath} (${faceMappings.length} faces, ${(fs.statSync(jsonPath).size / 1024 / 1024).toFixed(1)} MB)`
)
