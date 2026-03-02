#!/usr/bin/env node
/**
 * Inject BSP lightmap data into a Plumber-exported GLB.
 *
 * Reads lightmap_data.json + lightmap_atlas.bin produced by extract-bsp-lightmaps.mjs,
 * matches GLB mesh primitives to BSP faces by vertex centroid proximity, adds
 * TEXCOORD_1 (lightmap UVs) to every matched primitive, and embeds the atlas
 * as a PNG image in the GLB.
 *
 * Usage:
 *   node scripts/inject-glb-lightmaps.mjs \
 *     --glb <input.glb> --out <output.glb> --lightmap-dir <dir>
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

/* ── Args ── */
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

const glbPath = args.get('glb')
const outPath = args.get('out') || glbPath.replace(/\.glb$/i, '_lm.glb')
const lmDir = args.get('lightmap-dir')
// Spatial match tolerance in GLTF world units.
// Vertex matching is typically exact (or near-exact), so keep this tight to
// avoid cross-face false matches that cause atlas streak artifacts.
const tolerance = Number(args.get('tolerance') || '0.5')
const debugMeshPattern = process.env.DEBUG_MESH_NAME || ''

if (!glbPath || !lmDir) {
  console.error(
    'Usage: inject-glb-lightmaps.mjs --glb <in.glb> --out <out.glb> --lightmap-dir <dir>'
  )
  process.exit(1)
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. Read inputs
 * ═══════════════════════════════════════════════════════════════════════════ */

// GLB
const glb = fs.readFileSync(glbPath)
if (glb.toString('utf8', 0, 4) !== 'glTF') throw new Error('Not a GLB file')
const jsonChunkLen = glb.readUInt32LE(12)
const jsonChunkType = glb.readUInt32LE(16)
if (jsonChunkType !== 0x4e4f534a) throw new Error('First chunk is not JSON') // "JSON"
const gltf = JSON.parse(glb.toString('utf8', 20, 20 + jsonChunkLen))

// Binary chunk follows JSON chunk (padded to 4 bytes)
const binChunkOffset = 20 + jsonChunkLen
const binChunkLen = glb.readUInt32LE(binChunkOffset)
const binChunkType = glb.readUInt32LE(binChunkOffset + 4)
if (binChunkType !== 0x004e4942) throw new Error('Second chunk is not BIN') // "BIN\0"
const binData = glb.subarray(binChunkOffset + 8, binChunkOffset + 8 + binChunkLen)

console.log(
  `GLB: ${gltf.meshes.length} meshes, ${gltf.accessors.length} accessors, ${binData.length} bytes bin`
)

// Lightmap data
const lmMeta = JSON.parse(fs.readFileSync(path.join(lmDir, 'lightmap_data.json'), 'utf8'))
const lmAtlasRaw = fs.readFileSync(path.join(lmDir, 'lightmap_atlas.bin'))
console.log(
  `Lightmap: ${lmMeta.placedFaces} faces, atlas ${lmMeta.atlasWidth}x${lmMeta.atlasHeight}`
)

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. Build face-aware spatial hash + face projection lookup
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Source → GLTF coordinate conversion (empirically verified).
 * GLTF(gx,gy,gz) → Source(gx, -gz, gy).  Inverse: Source(sx,sy,sz) → GLTF(sx, sz, -sy).
 */
const srcToGltf = (sx, sy, sz) => [sx, sz, -sy]
const gltfToSrc = (gx, gy, gz) => [gx, -gz, gy]

/**
 * Build a spatial hash mapping BSP vertex positions (in GLTF space) → face indices.
 * Stores the face index with each entry so we can resolve shared vertices
 * (vertices at face edges/corners that belong to multiple BSP faces with
 * different lightmap UVs).
 *
 * Also build a face-data lookup for computing atlas UVs from lmVecs projection,
 * which handles vertices that aren't exact BSP vertex matches.
 */
const CELL = 4
const hashKey = (x, y, z) =>
  `${Math.round(x / CELL)},${Math.round(y / CELL)},${Math.round(z / CELL)}`

// Face data lookup: faceArrayIdx → face projection info
const faceData = [] // [{lmVecs, lmMinsS, lmMinsT, w, h, atlasX, atlasY}]
const faceIdxMap = new Map() // BSP faceIndex → faceData array index

const vertHash = new Map() // key → [{gx, gy, gz, fi}]  (fi = index into faceData)
let totalBspVerts = 0

for (let i = 0; i < lmMeta.faces.length; i++) {
  const face = lmMeta.faces[i]
  if (!face.verts?.length) continue

  const fi = faceData.length
  faceIdxMap.set(face.faceIndex, fi)
  // Compute face AABB + centroid in Source space for spatial matching.
  let fMinX = Infinity,
    fMinY = Infinity,
    fMinZ = Infinity
  let fMaxX = -Infinity,
    fMaxY = -Infinity,
    fMaxZ = -Infinity
  let fcx = 0,
    fcy = 0,
    fcz = 0
  for (const v of face.verts) {
    if (v[0] < fMinX) fMinX = v[0]
    if (v[0] > fMaxX) fMaxX = v[0]
    if (v[1] < fMinY) fMinY = v[1]
    if (v[1] > fMaxY) fMaxY = v[1]
    if (v[2] < fMinZ) fMinZ = v[2]
    if (v[2] > fMaxZ) fMaxZ = v[2]
    fcx += v[0]
    fcy += v[1]
    fcz += v[2]
  }
  const fn = face.verts.length

  faceData.push({
    lmVecs: face.lmVecs,
    lmMinsS: face.lmMinsS,
    lmMinsT: face.lmMinsT,
    w: face.w,
    h: face.h,
    atlasX: face.atlasX,
    atlasY: face.atlasY,
    vertsSrc: face.verts,
    refVert: face.verts[0],
    aabbMin: [fMinX, fMinY, fMinZ],
    aabbMax: [fMaxX, fMaxY, fMaxZ],
    centerSrc: [fcx / fn, fcy / fn, fcz / fn],
  })

  for (let vi = 0; vi < face.verts.length; vi++) {
    const sv = face.verts[vi]
    const [gx, gy, gz] = srcToGltf(sv[0], sv[1], sv[2])
    const key = hashKey(gx, gy, gz)
    if (!vertHash.has(key)) vertHash.set(key, [])
    vertHash.get(key).push({ gx, gy, gz, fi })
    totalBspVerts++
  }
}
console.log(`Vertex hash: ${totalBspVerts} BSP vertices in ${vertHash.size} cells`)
console.log(`Face data: ${faceData.length} faces with projection info`)

// Compute face planes from lmVecs cross product + reference vertex.
// The two lightmap vectors span the face's plane, so their cross product
// gives the face normal direction.  This lets us reject points that are
// far from the face's plane before checking lightmap bounds — without it,
// a wall centroid can pass the bounds test for a floor face (because the
// floor's lmVecs ignore the Z dimension the wall centroid differs in).
let planesComputed = 0
for (const fd of faceData) {
  if (!fd.lmVecs || !fd.refVert) continue
  const sv = fd.lmVecs[0],
    tv = fd.lmVecs[1]
  const nx = sv[1] * tv[2] - sv[2] * tv[1]
  const ny = sv[2] * tv[0] - sv[0] * tv[2]
  const nz = sv[0] * tv[1] - sv[1] * tv[0]
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
  if (len > 1e-8) {
    fd.planeNormal = [nx / len, ny / len, nz / len]
    fd.planeDist =
      fd.planeNormal[0] * fd.refVert[0] +
      fd.planeNormal[1] * fd.refVert[1] +
      fd.planeNormal[2] * fd.refVert[2]

    // Displacements are not perfectly planar, but they still inherit a single
    // lightmap face/projection. Track how far the BSP face vertices deviate from
    // the lmVec plane so point tests can use a data-driven tolerance instead of a
    // hard-coded planar threshold.
    let maxPlaneOffset = 0
    if (fd.vertsSrc) {
      for (const v of fd.vertsSrc) {
        const dist = Math.abs(
          fd.planeNormal[0] * v[0] + fd.planeNormal[1] * v[1] + fd.planeNormal[2] * v[2] - fd.planeDist
        )
        if (dist > maxPlaneOffset) maxPlaneOffset = dist
      }
    }
    fd.maxPlaneOffset = maxPlaneOffset
    planesComputed++
  }
}
console.log(`Face planes: ${planesComputed}/${faceData.length} computed from lmVecs cross product`)

// Pre-project each face polygon to 2D (dominant axis drop) for a cheap
// point-in-polygon gate. This avoids matching triangle centroids to distant
// coplanar faces that pass lightmap bounds/AABB checks.
let polysProjected = 0
for (const fd of faceData) {
  const verts = fd.vertsSrc
  if (!fd.planeNormal || !verts || verts.length < 3) continue

  const ax = Math.abs(fd.planeNormal[0])
  const ay = Math.abs(fd.planeNormal[1])
  const az = Math.abs(fd.planeNormal[2])

  // Drop the dominant normal axis: best-conditioned 3D→2D projection.
  const dropAxis = ax >= ay && ax >= az ? 0 : ay >= ax && ay >= az ? 1 : 2
  fd.polyDropAxis = dropAxis
  fd.poly2d = verts.map(v => {
    if (dropAxis === 0) return [v[1], v[2]] // yz
    if (dropAxis === 1) return [v[0], v[2]] // xz
    return [v[0], v[1]] // xy
  })
  let area2 = 0
  for (let p = 0, q = fd.poly2d.length - 1; p < fd.poly2d.length; q = p++) {
    area2 += fd.poly2d[q][0] * fd.poly2d[p][1] - fd.poly2d[p][0] * fd.poly2d[q][1]
  }
  fd.polyOrient = area2 >= 0 ? 1 : -1
  polysProjected++
}
console.log(`Face polygons: ${polysProjected}/${faceData.length} projected for containment checks`)

const pointInPolygon2D = (px, py, poly) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0],
      yi = poly[i][1]
    const xj = poly[j][0],
      yj = poly[j][1]
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

const distPointSeg2D2 = (px, py, ax, ay, bx, by) => {
  const abx = bx - ax,
    aby = by - ay
  const apx = px - ax,
    apy = py - ay
  const ab2 = abx * abx + aby * aby
  const t = ab2 > 1e-12 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0
  const qx = ax + abx * t
  const qy = ay + aby * t
  const dx = px - qx,
    dy = py - qy
  return dx * dx + dy * dy
}

const pointNearPolygon2D = (px, py, poly, margin) => {
  const m2 = margin * margin
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (distPointSeg2D2(px, py, poly[j][0], poly[j][1], poly[i][0], poly[i][1]) <= m2) {
      return true
    }
  }
  return false
}

const projectSrcForDropAxis = (sx, sy, sz, dropAxis) => {
  if (dropAxis === 0) return [sy, sz] // yz
  if (dropAxis === 1) return [sx, sz] // xz
  return [sx, sy] // xy
}

const lerpClippedVertex = (a, b, t) => ({
  src: [
    a.src[0] + (b.src[0] - a.src[0]) * t,
    a.src[1] + (b.src[1] - a.src[1]) * t,
    a.src[2] + (b.src[2] - a.src[2]) * t,
  ],
  bary: [
    a.bary[0] + (b.bary[0] - a.bary[0]) * t,
    a.bary[1] + (b.bary[1] - a.bary[1]) * t,
    a.bary[2] + (b.bary[2] - a.bary[2]) * t,
  ],
})

const clipPolygonAgainstFace = (subjectVerts, fi) => {
  const fd = faceData[fi]
  if (!fd?.poly2d || fd.polyDropAxis == null || fd.poly2d.length < 3) return []

  const clipPoly = fd.poly2d
  const orient = fd.polyOrient || 1
  let output = subjectVerts

  for (let i = 0, j = clipPoly.length - 1; i < clipPoly.length; j = i++) {
    const ax = clipPoly[j][0],
      ay = clipPoly[j][1]
    const bx = clipPoly[i][0],
      by = clipPoly[i][1]
    const input = output
    output = []
    if (input.length === 0) break

    const isInside = v => {
      const [px, py] = projectSrcForDropAxis(v.src[0], v.src[1], v.src[2], fd.polyDropAxis)
      const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
      return orient > 0 ? cross >= -1e-6 : cross <= 1e-6
    }

    const intersect = (s, e) => {
      const [sx, sy] = projectSrcForDropAxis(s.src[0], s.src[1], s.src[2], fd.polyDropAxis)
      const [ex, ey] = projectSrcForDropAxis(e.src[0], e.src[1], e.src[2], fd.polyDropAxis)
      const sd = (bx - ax) * (sy - ay) - (by - ay) * (sx - ax)
      const ed = (bx - ax) * (ey - ay) - (by - ay) * (ex - ax)
      const denom = sd - ed
      let t = 0.5
      if (Math.abs(denom) > 1e-12) t = sd / denom
      t = Math.max(0, Math.min(1, t))
      return lerpClippedVertex(s, e, t)
    }

    let prev = input[input.length - 1]
    let prevInside = isInside(prev)
    for (const curr of input) {
      const currInside = isInside(curr)

      if (currInside) {
        if (!prevInside) output.push(intersect(prev, curr))
        output.push(curr)
      } else if (prevInside) {
        output.push(intersect(prev, curr))
      }

      prev = curr
      prevInside = currInside
    }
  }

  return output
}

const polygonArea3D = poly => {
  if (!poly || poly.length < 3) return 0
  const p0 = poly[0].src
  let area = 0
  for (let i = 1; i + 1 < poly.length; i++) {
    const p1 = poly[i].src
    const p2 = poly[i + 1].src
    const e1x = p1[0] - p0[0],
      e1y = p1[1] - p0[1],
      e1z = p1[2] - p0[2]
    const e2x = p2[0] - p0[0],
      e2y = p2[1] - p0[1],
      e2z = p2[2] - p0[2]
    const cx = e1y * e2z - e1z * e2y
    const cy = e1z * e2x - e1x * e2z
    const cz = e1x * e2y - e1y * e2x
    area += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz)
  }
  return area
}

const testPointAgainstFacePolygon = (sx, sy, sz, fi, margin = 6.0) => {
  const fd = faceData[fi]
  if (!fd?.poly2d || fd.polyDropAxis == null) return true

  const px = fd.polyDropAxis === 0 ? sy : sx
  const py = fd.polyDropAxis === 2 ? sy : sz

  // Keep a small edge margin to tolerate VMF vs BSP geometric drift.
  return pointInPolygon2D(px, py, fd.poly2d) || pointNearPolygon2D(px, py, fd.poly2d, margin)
}

/**
 * Source-engine `TestPointAgainstSurface`: project a Source-space point through
 * a face's lmVecs and test whether it falls within the face's lightmap bounds.
 * Returns {ds, dt} (face-local luxel coords) if inside, or null if outside.
 * Tolerance parameter allows a small margin beyond the lightmap rectangle
 * (needed because Plumber's VMF geometry doesn't exactly match BSP vertices).
 */
const testPointAgainstFace = (sx, sy, sz, fi, margin = 1.0) => {
  const fd = faceData[fi]
  if (!fd || !fd.lmVecs) return null

  // Spatial AABB check: reject points outside the face's world-space bounding
  // box.  This prevents matching a triangle to a distant coplanar face — e.g.
  // a neon strip 100 units away on the same wall plane passes the plane-distance
  // and normal checks but is physically far from the triangle.
  if (fd.aabbMin) {
    const m = Math.min(512, Math.max(64, Math.max(fd.w || 0, fd.h || 0) * 2))
    if (
      sx < fd.aabbMin[0] - m ||
      sx > fd.aabbMax[0] + m ||
      sy < fd.aabbMin[1] - m ||
      sy > fd.aabbMax[1] + m ||
      sz < fd.aabbMin[2] - m ||
      sz > fd.aabbMax[2] + m
    ) {
      return null
    }
  }

  // Plane distance check: verify the point is near this face's geometric plane.
  if (fd.planeNormal) {
    const d = Math.abs(
      sx * fd.planeNormal[0] + sy * fd.planeNormal[1] + sz * fd.planeNormal[2] - fd.planeDist
    )
    const planeTol = Math.min(
      192,
      Math.max(8.0, Number(fd.maxPlaneOffset || 0) + 6.0, Math.max(fd.w || 0, fd.h || 0) * 0.35)
    )
    if (d > planeTol) return null
  }

  // Polygon containment check: avoids false positives from nearby/distant
  // coplanar faces that overlap in AABB + lightmap-rect space.
  // Disabled because groups contain unordered vertices, making poly2d checks invalid!
  // if (!testPointAgainstFacePolygon(sx, sy, sz, fi, 6.0)) return null

  const s = sx * fd.lmVecs[0][0] + sy * fd.lmVecs[0][1] + sz * fd.lmVecs[0][2] + fd.lmVecs[0][3]
  const t = sx * fd.lmVecs[1][0] + sy * fd.lmVecs[1][1] + sz * fd.lmVecs[1][2] + fd.lmVecs[1][3]

  const ds = s - fd.lmMinsS
  const dt = t - fd.lmMinsT

  // w = lightmapSizeInLuxels + 1, so the valid range is [0, w-1] i.e. [0, size]
  if (ds < -margin || ds > fd.w - 1 + margin) return null
  if (dt < -margin || dt > fd.h - 1 + margin) return null

  return { ds, dt }
}

/**
 * Find the BSP face that contains a Source-space point by projecting through
 * ALL faces' lmVecs and checking lightmap bounds (Source's TestPointAgainstSurface).
 * Returns the face index or -1 if no face contains the point.
 */
const findFaceForPoint = (sx, sy, sz, expectedNormal = null) => {
  const scan = margin => {
    let bestFi = -1
    let bestD2 = Infinity

    for (let fi = 0; fi < faceData.length; fi++) {
      const result = testPointAgainstFace(sx, sy, sz, fi, margin)
      if (!result) continue

      if (expectedNormal && faceData[fi].planeNormal) {
        const dot = Math.abs(
          expectedNormal[0] * faceData[fi].planeNormal[0] +
            expectedNormal[1] * faceData[fi].planeNormal[1] +
            expectedNormal[2] * faceData[fi].planeNormal[2]
        )
        if (dot < 0.5) continue
      }

      const fd = faceData[fi]
      const dx = sx - fd.centerSrc[0]
      const dy = sy - fd.centerSrc[1]
      const dz = sz - fd.centerSrc[2]
      const d2 = dx * dx + dy * dy + dz * dz

      if (d2 < bestD2) {
        bestD2 = d2
        bestFi = fi
      }
    }

    return bestFi
  }

  const strict = scan(1.0)
  if (strict >= 0) return strict
  return scan(3.0)
}

/**
 * Find ALL candidate BSP face indices for a vertex position via spatial hash.
 * Returns array of {fi, d2} sorted by distance ascending.
 * (Kept as fallback for the fast path when centroid lookup fails.)
 */
const findVertexFaces = (wx, wy, wz) => {
  const tol2 = tolerance * tolerance
  const hits = new Map() // fi → bestD2
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = `${Math.round(wx / CELL) + dx},${Math.round(wy / CELL) + dy},${Math.round(wz / CELL) + dz}`
        const bucket = vertHash.get(key)
        if (!bucket) continue
        for (const entry of bucket) {
          const d2 = (entry.gx - wx) ** 2 + (entry.gy - wy) ** 2 + (entry.gz - wz) ** 2
          if (d2 < tol2) {
            const prev = hits.get(entry.fi)
            if (prev === undefined || d2 < prev) {
              hits.set(entry.fi, d2)
            }
          }
        }
      }
    }
  }
  const result = []
  for (const [fi, d2] of hits) result.push({ fi, d2 })
  result.sort((a, b) => a.d2 - b.d2)
  return result
}

/**
 * Compute atlas UV for a vertex position using a face's lmVecs projection.
 * Input is in GLTF space; converts to Source space for projection.
 */
const computeAtlasUV = (gx, gy, gz, fi) => {
  const fd = faceData[fi]
  if (!fd || !fd.lmVecs) return null

  // Convert GLTF → Source
  const [sx, sy, sz] = gltfToSrc(gx, gy, gz)

  // Project through lightmap vectors (Source space)
  const lu = sx * fd.lmVecs[0][0] + sy * fd.lmVecs[0][1] + sz * fd.lmVecs[0][2] + fd.lmVecs[0][3]
  const lv = sx * fd.lmVecs[1][0] + sy * fd.lmVecs[1][1] + sz * fd.lmVecs[1][2] + fd.lmVecs[1][3]

  // Face-local [0..1] (luxel-center convention)
  let faceU = (lu - fd.lmMinsS + 0.5) / fd.w
  let faceV = (lv - fd.lmMinsT + 0.5) / fd.h

  // Clamp to valid texel-center range for this face to avoid atlas-edge clamp
  // artifacts when projected vertices land slightly outside due quantization/
  // triangulation differences.
  const minFaceU = 0.5 / fd.w
  const maxFaceU = 1 - 0.5 / fd.w
  const minFaceV = 0.5 / fd.h
  const maxFaceV = 1 - 0.5 / fd.h
  faceU = Math.max(minFaceU, Math.min(maxFaceU, faceU))
  faceV = Math.max(minFaceV, Math.min(maxFaceV, faceV))

  // Atlas [0..1]
  const atlasU = (fd.atlasX + faceU * fd.w) / lmMeta.atlasWidth
  const atlasV = (fd.atlasY + faceV * fd.h) / lmMeta.atlasHeight

  return [atlasU, atlasV]
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. Helper: read accessor data from GLB binary
 * ═══════════════════════════════════════════════════════════════════════════ */

const readAccessorVec3 = accIdx => {
  const acc = gltf.accessors[accIdx]
  const bv = gltf.bufferViews[acc.bufferView]
  const offset = (bv.byteOffset || 0) + (acc.byteOffset || 0)
  const stride = bv.byteStride || 12 // vec3 float = 12 bytes
  const out = new Float32Array(acc.count * 3)
  for (let i = 0; i < acc.count; i++) {
    const o = offset + i * stride
    out[i * 3] = binData.readFloatLE(o)
    out[i * 3 + 1] = binData.readFloatLE(o + 4)
    out[i * 3 + 2] = binData.readFloatLE(o + 8)
  }
  return out
}

const readAccessorScalarU16 = accIdx => {
  const acc = gltf.accessors[accIdx]
  const bv = gltf.bufferViews[acc.bufferView]
  const offset = (bv.byteOffset || 0) + (acc.byteOffset || 0)
  const out = new Uint16Array(acc.count)
  for (let i = 0; i < acc.count; i++) {
    out[i] = binData.readUInt16LE(offset + i * 2)
  }
  return out
}

const readAccessorScalarU32 = accIdx => {
  const acc = gltf.accessors[accIdx]
  const bv = gltf.bufferViews[acc.bufferView]
  const offset = (bv.byteOffset || 0) + (acc.byteOffset || 0)
  const out = new Uint32Array(acc.count)
  for (let i = 0; i < acc.count; i++) {
    out[i] = binData.readUInt32LE(offset + i * 4)
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. Match primitives to BSP faces per-triangle, compute lightmap UVs
 *
 * For each GLB primitive:
 *   1. Read index buffer to get triangles
 *   2. For each vertex, find candidate BSP faces from spatial hash
 *   3. For each triangle, vote among its 3 vertices' face candidates
 *   4. Project all 3 vertex positions through the winning face's lmVecs
 *      to compute correct atlas UVs (handles shared vertices properly)
 * ═══════════════════════════════════════════════════════════════════════════ */

// Build mesh→node lookup (for node translations)
const meshToNode = new Map()
for (let ni = 0; ni < (gltf.nodes || []).length; ni++) {
  const node = gltf.nodes[ni]
  if (node.mesh != null) meshToNode.set(node.mesh, node)
}

/**
 * Read index buffer for a primitive. Returns Uint32Array of indices,
 * or null if no index buffer (sequential vertices).
 */
const readIndices = prim => {
  if (prim.indices == null) return null
  const acc = gltf.accessors[prim.indices]
  if (acc.componentType === 5123) return new Uint32Array(readAccessorScalarU16(prim.indices))
  if (acc.componentType === 5125) return readAccessorScalarU32(prim.indices)
  // 5121 = UNSIGNED_BYTE
  if (acc.componentType === 5121) {
    const bv = gltf.bufferViews[acc.bufferView]
    const offset = (bv.byteOffset || 0) + (acc.byteOffset || 0)
    const out = new Uint32Array(acc.count)
    for (let i = 0; i < acc.count; i++) out[i] = binData[offset + i]
    return out
  }
  return null
}

const primUVs = [] // { meshIdx, primIdx, uvData: Float32Array(count*2) }
const primRejectDiagnostics = []
const primPartialDiagnostics = []
let matchedVerts = 0,
  unmatchedVerts = 0,
  matchedPrims = 0,
  unmatchedPrims = 0,
  projectedVerts = 0,
  clippedTriangles = 0,
  clippedTrianglePieces = 0,
  splitCandidates = 0,
  splitAccepted = 0,
  splitAcceptedUnder95 = 0,
  splitAcceptedUnder90 = 0,
  splitAcceptedOver110 = 0,
  outOfRangeUVs = 0,
  fallbackCopiedUVs = 0

for (let mi = 0; mi < gltf.meshes.length; mi++) {
  const mesh = gltf.meshes[mi]
  const node = meshToNode.get(mi)
  const tx = node?.translation?.[0] || 0
  const ty = node?.translation?.[1] || 0
  const tz = node?.translation?.[2] || 0

  for (let pi = 0; pi < mesh.primitives.length; pi++) {
    const prim = mesh.primitives[pi]
    if (prim.attributes.POSITION == null) continue

    const debugPrim =
      !!debugMeshPattern &&
      ((mesh.name && mesh.name.includes(debugMeshPattern)) ||
        (node?.name && node.name.includes(debugMeshPattern)))
    const debugPrefix = `  [debug mesh ${mi} prim ${pi} \"${mesh.name || node?.name || ''}\""]`
    const materialName =
      prim.material != null && gltf.materials?.[prim.material]?.name
        ? String(gltf.materials[prim.material].name)
        : ''
    const meshName = String(mesh.name || node?.name || '')
    const isBrushLike =
      meshName.startsWith('worldspawn') ||
      meshName.startsWith('func_detail') ||
      meshName.startsWith('func_brush') ||
      meshName.startsWith('func_illusionary')

    const positions = readAccessorVec3(prim.attributes.POSITION)
    const vertCount = positions.length / 3

    // Read index buffer (or generate sequential indices)
    let indices = readIndices(prim)
    if (!indices) {
      indices = new Uint32Array(vertCount)
      for (let i = 0; i < vertCount; i++) indices[i] = i
    }

    // Step 1+2: Source-correct per-TRIANGLE face lookup via centroid projection.
    //
    // For each triangle, compute its centroid in Source space and find the BSP
    // face whose lightmap bounds contain it (mirroring Source's TestPointAgainstSurface).
    // If centroid lookup fails, fall back to vertex-based spatial hash matching.
    // Then split shared vertices at face boundaries so each triangle's 3 verts
    // get consistent atlas UVs (no cross-face interpolation).

    let triCount = Math.floor(indices.length / 3)
    let projectedHitsPrim = 0
    let centroidHits = 0
    let probeHits = 0
    let vertexVoteHits = 0
    let harmonizedAdjPairs = 0

    // Phase A: determine BSP face per triangle via centroid lookup.
    let triFace = new Int32Array(triCount).fill(-1)
    const triCentroidSrc = new Array(triCount)
    const triNormalSrc = new Array(triCount)
    for (let t = 0; t < triCount; t++) {
      const i0 = indices[t * 3],
        i1 = indices[t * 3 + 1],
        i2 = indices[t * 3 + 2]

      // Centroid in GLTF world space → Source space
      const cx = (positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3 + tx
      const cy = (positions[i0 * 3 + 1] + positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 3 + ty
      const cz = (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3 + tz
      const [sx, sy, sz] = gltfToSrc(cx, cy, cz)
      triCentroidSrc[t] = [sx, sy, sz]

      // Compute triangle normal in Source space for face-normal alignment.
      // Prevents matching a wall triangle to a parallel neon/ceiling face.
      const ax = positions[i0 * 3] + tx,
        ay = positions[i0 * 3 + 1] + ty,
        az = positions[i0 * 3 + 2] + tz
      const bx = positions[i1 * 3] + tx,
        by = positions[i1 * 3 + 1] + ty,
        bz = positions[i1 * 3 + 2] + tz
      const px = positions[i2 * 3] + tx,
        py = positions[i2 * 3 + 1] + ty,
        pz = positions[i2 * 3 + 2] + tz
      const e1x = bx - ax,
        e1y = by - ay,
        e1z = bz - az
      const e2x = px - ax,
        e2y = py - ay,
        e2z = pz - az
      const gnx = e1y * e2z - e1z * e2y // GLTF-space cross product
      const gny = e1z * e2x - e1x * e2z
      const gnz = e1x * e2y - e1y * e2x
      // GLTF→Source direction: (gx, gy, gz) → (gx, -gz, gy)
      const snx = gnx,
        sny = -gnz,
        snz = gny
      const nlen = Math.sqrt(snx * snx + sny * sny + snz * snz)
      const triNormal = nlen > 1e-8 ? [snx / nlen, sny / nlen, snz / nlen] : null
      triNormalSrc[t] = triNormal

      const [sax, say, saz] = gltfToSrc(ax, ay, az)
      const [sbx, sby, sbz] = gltfToSrc(bx, by, bz)
      const [spx, spy, spz] = gltfToSrc(px, py, pz)

      // Primary: Source-engine centroid-to-face bounds test
      const fi = findFaceForPoint(sx, sy, sz, triNormal)
      if (fi >= 0) {
        triFace[t] = fi
        centroidHits++
        continue
      }

      // Exact fallback: probe multiple points on the same triangle against BSP
      // faces using the same Source-space surface test. This improves coverage
      // when a centroid lands just outside a face due VMF/BSP drift.
      const probePoints = [
        [sax, say, saz],
        [sbx, sby, sbz],
        [spx, spy, spz],
        [sx, sy, sz],
        [(sax + sbx) * 0.5, (say + sby) * 0.5, (saz + sbz) * 0.5],
        [(sbx + spx) * 0.5, (sby + spy) * 0.5, (sbz + spz) * 0.5],
        [(spx + sax) * 0.5, (spy + say) * 0.5, (spz + saz) * 0.5],
        [sax * 0.6 + sbx * 0.2 + spx * 0.2, say * 0.6 + sby * 0.2 + spy * 0.2, saz * 0.6 + sbz * 0.2 + spz * 0.2],
        [sax * 0.2 + sbx * 0.6 + spx * 0.2, say * 0.2 + sby * 0.6 + spy * 0.2, saz * 0.2 + sbz * 0.6 + spz * 0.2],
        [sax * 0.2 + sbx * 0.2 + spx * 0.6, say * 0.2 + sby * 0.2 + spy * 0.6, saz * 0.2 + sbz * 0.2 + spz * 0.6],
      ]
      const probeVotes = new Map()
      for (const probe of probePoints) {
        const pfi = findFaceForPoint(probe[0], probe[1], probe[2], triNormal)
        if (pfi < 0) continue
        probeVotes.set(pfi, (probeVotes.get(pfi) || 0) + 1)
      }
      if (probeVotes.size > 0) {
        let bestProbeFi = -1
        let bestProbeCount = -1
        for (const [pfi, count] of probeVotes) {
          if (count > bestProbeCount) {
            bestProbeFi = pfi
            bestProbeCount = count
          }
        }
        triFace[t] = bestProbeFi
        probeHits++
        continue
      }

      // Fallback: vertex spatial hash voting (for geometry not matching BSP exactly)
      const votes = new Map()
      for (const vi of [i0, i1, i2]) {
        const wx = positions[vi * 3] + tx
        const wy = positions[vi * 3 + 1] + ty
        const wz = positions[vi * 3 + 2] + tz
        for (const { fi: vfi, d2 } of findVertexFaces(wx, wy, wz)) {
          // Normal alignment filter: skip faces with wrong orientation
          if (triNormal && faceData[vfi]?.planeNormal) {
            const dot = Math.abs(
              triNormal[0] * faceData[vfi].planeNormal[0] +
                triNormal[1] * faceData[vfi].planeNormal[1] +
                triNormal[2] * faceData[vfi].planeNormal[2]
            )
            if (dot < 0.5) continue
          }
          const prev = votes.get(vfi) || { count: 0, sumD2: 0 }
          prev.count += 1
          prev.sumD2 += d2
          votes.set(vfi, prev)
        }
      }
      if (votes.size > 0) {
        let bestFi = -1,
          bestCount = -1,
          bestSumD2 = Infinity
        for (const [vfi, stat] of votes) {
          if (stat.count > bestCount || (stat.count === bestCount && stat.sumD2 < bestSumD2)) {
            bestFi = vfi
            bestCount = stat.count
            bestSumD2 = stat.sumD2
          }
        }
        triFace[t] = bestFi
        vertexVoteHits++
      }
    }

    if (debugPrim) {
      let triMatched = 0
      for (let t = 0; t < triFace.length; t++) if (triFace[t] >= 0) triMatched++
      console.log(
        `${debugPrefix} phaseA centroidHits=${centroidHits}, probeHits=${probeHits}, vertexVoteHits=${vertexVoteHits}, triMatched=${triMatched}/${triCount}, triUnmatched=${triCount - triMatched}`
      )
    }

    // Phase A2: harmonize adjacent coplanar triangles that got different faces.
    // This reduces visible "checkerboard" seams on what should be a single wall/
    // floor patch when one triangle's centroid lands in a neighboring face due
    // VMF vs BSP reconstruction drift.
    const edgeToTri = new Map()
    const addEdge = (a, b, triIdx) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`
      if (!edgeToTri.has(key)) edgeToTri.set(key, [])
      edgeToTri.get(key).push(triIdx)
    }
    for (let t = 0; t < triCount; t++) {
      const i0 = indices[t * 3],
        i1 = indices[t * 3 + 1],
        i2 = indices[t * 3 + 2]
      addEdge(i0, i1, t)
      addEdge(i1, i2, t)
      addEdge(i2, i0, t)
    }

    // A small number of relax iterations is enough for local consistency.
    for (let iter = 0; iter < 2; iter++) {
      let changed = false
      for (const pair of edgeToTri.values()) {
        if (pair.length !== 2) continue
        const ta = pair[0],
          tb = pair[1]
        const fia = triFace[ta],
          fib = triFace[tb]
        if (fia < 0 || fib < 0 || fia === fib) continue

        const na = triNormalSrc[ta],
          nb = triNormalSrc[tb]
        if (!na || !nb) continue
        const dot = Math.abs(na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2])
        if (dot < 0.98) continue

        const ca = triCentroidSrc[ta],
          cb = triCentroidSrc[tb]
        const aContainsA = !!testPointAgainstFace(ca[0], ca[1], ca[2], fia, 1.5)
        const aContainsB = !!testPointAgainstFace(cb[0], cb[1], cb[2], fia, 1.5)
        const bContainsA = !!testPointAgainstFace(ca[0], ca[1], ca[2], fib, 1.5)
        const bContainsB = !!testPointAgainstFace(cb[0], cb[1], cb[2], fib, 1.5)

        if (aContainsA && aContainsB && !(bContainsA && bContainsB)) {
          triFace[tb] = fia
          harmonizedAdjPairs++
          changed = true
          continue
        }
        if (bContainsA && bContainsB && !(aContainsA && aContainsB)) {
          triFace[ta] = fib
          harmonizedAdjPairs++
          changed = true
          continue
        }

        // If both faces can explain both centroids, pick the face whose centroid
        // is closer to BOTH triangles in world space.
        if (aContainsA && aContainsB && bContainsA && bContainsB) {
          const cfa = faceData[fia].centerSrc
          const cfb = faceData[fib].centerSrc
          const da =
            (ca[0] - cfa[0]) ** 2 +
            (ca[1] - cfa[1]) ** 2 +
            (ca[2] - cfa[2]) ** 2 +
            (cb[0] - cfa[0]) ** 2 +
            (cb[1] - cfa[1]) ** 2 +
            (cb[2] - cfa[2]) ** 2
          const db =
            (ca[0] - cfb[0]) ** 2 +
            (ca[1] - cfb[1]) ** 2 +
            (ca[2] - cfb[2]) ** 2 +
            (cb[0] - cfb[0]) ** 2 +
            (cb[1] - cfb[1]) ** 2 +
            (cb[2] - cfb[2]) ** 2
          const bestFi = da <= db ? fia : fib
          if (triFace[ta] !== bestFi || triFace[tb] !== bestFi) {
            triFace[ta] = bestFi
            triFace[tb] = bestFi
            harmonizedAdjPairs++
            changed = true
          }
        }
      }
      if (!changed) break
    }

    // Phase A3: split triangles that span multiple BSP faces.
    //
    // Centroid assignment is correct for most triangles, but some VMF-derived
    // triangles are huge and cross real BSP face boundaries. A single face for
    // the whole triangle creates hard color wedges. We clip such triangles
    // against candidate BSP face polygons and generate per-face sub-triangles.
    const generatedVerts = [] // [{ i0, i1, i2, w:[w0,w1,w2], local:[x,y,z] }]
    const expandedIndices = []
    const expandedFaces = []

    const appendOriginalTriangle = (i0, i1, i2, fi) => {
      expandedIndices.push(i0, i1, i2)
      expandedFaces.push(fi)
    }

    const resolveCornerIndex = (corner, i0, i1, i2) => {
      const w0 = corner.bary[0],
        w1 = corner.bary[1],
        w2 = corner.bary[2]
      const eps = 1e-5

      if (Math.abs(w0 - 1) < eps && Math.abs(w1) < eps && Math.abs(w2) < eps) return i0
      if (Math.abs(w1 - 1) < eps && Math.abs(w0) < eps && Math.abs(w2) < eps) return i1
      if (Math.abs(w2 - 1) < eps && Math.abs(w0) < eps && Math.abs(w1) < eps) return i2

      const lx = positions[i0 * 3] * w0 + positions[i1 * 3] * w1 + positions[i2 * 3] * w2
      const ly =
        positions[i0 * 3 + 1] * w0 + positions[i1 * 3 + 1] * w1 + positions[i2 * 3 + 1] * w2
      const lz =
        positions[i0 * 3 + 2] * w0 + positions[i1 * 3 + 2] * w1 + positions[i2 * 3 + 2] * w2

      const newIdx = vertCount + generatedVerts.length
      generatedVerts.push({ i0, i1, i2, w: [w0, w1, w2], local: [lx, ly, lz] })
      return newIdx
    }

    for (let t = 0; t < triCount; t++) {
      const i0 = indices[t * 3],
        i1 = indices[t * 3 + 1],
        i2 = indices[t * 3 + 2]
      const fi = triFace[t]
      if (fi < 0) {
        appendOriginalTriangle(i0, i1, i2, fi)
        continue
      }

      const p0 = [positions[i0 * 3] + tx, positions[i0 * 3 + 1] + ty, positions[i0 * 3 + 2] + tz]
      const p1 = [positions[i1 * 3] + tx, positions[i1 * 3 + 1] + ty, positions[i1 * 3 + 2] + tz]
      const p2 = [positions[i2 * 3] + tx, positions[i2 * 3 + 1] + ty, positions[i2 * 3 + 2] + tz]
      const s0 = gltfToSrc(p0[0], p0[1], p0[2])
      const s1 = gltfToSrc(p1[0], p1[1], p1[2])
      const s2 = gltfToSrc(p2[0], p2[1], p2[2])

      const in0 = !!testPointAgainstFace(s0[0], s0[1], s0[2], fi, 0.5)
      const in1 = !!testPointAgainstFace(s1[0], s1[1], s1[2], fi, 0.5)
      const in2 = !!testPointAgainstFace(s2[0], s2[1], s2[2], fi, 0.5)
      if (in0 && in1 && in2) {
        appendOriginalTriangle(i0, i1, i2, fi)
        continue
      }

      const generatedVertsStart = generatedVerts.length
      const triNormal = triNormalSrc[t]
      const candidateFaces = new Set([fi])
      const addCandidateFace = (sx, sy, sz) => {
        const cfi = findFaceForPoint(sx, sy, sz, triNormal)
        if (cfi >= 0) candidateFaces.add(cfi)
      }

      addCandidateFace(s0[0], s0[1], s0[2])
      addCandidateFace(s1[0], s1[1], s1[2])
      addCandidateFace(s2[0], s2[1], s2[2])

      // Edge-midpoint probes help discover neighboring faces when only one
      // endpoint lies in a different face due triangulation drift.
      addCandidateFace((s0[0] + s1[0]) * 0.5, (s0[1] + s1[1]) * 0.5, (s0[2] + s1[2]) * 0.5)
      addCandidateFace((s1[0] + s2[0]) * 0.5, (s1[1] + s2[1]) * 0.5, (s1[2] + s2[2]) * 0.5)
      addCandidateFace((s2[0] + s0[0]) * 0.5, (s2[1] + s0[1]) * 0.5, (s2[2] + s0[2]) * 0.5)


      const triPoly = [
        { src: s0, bary: [1, 0, 0] },
        { src: s1, bary: [0, 1, 0] },
        { src: s2, bary: [0, 0, 1] },
      ]
      const origArea = polygonArea3D(triPoly)

      let coveredArea = 0
      let pieceCount = 0
      const triIndicesTemp = []
      const triFacesTemp = []

      for (const cfi of candidateFaces) {
        if (cfi < 0) continue
        if (!faceData[cfi]?.poly2d || faceData[cfi].polyDropAxis == null) continue

        if (triNormal && faceData[cfi]?.planeNormal) {
          const dot = Math.abs(
            triNormal[0] * faceData[cfi].planeNormal[0] +
              triNormal[1] * faceData[cfi].planeNormal[1] +
              triNormal[2] * faceData[cfi].planeNormal[2]
          )
          if (dot < 0.98) continue
        }

        const clipped = clipPolygonAgainstFace(triPoly, cfi)
        if (!clipped || clipped.length < 3) continue

        for (let i = 1; i + 1 < clipped.length; i++) {
          const cornerA = clipped[0]
          const cornerB = clipped[i]
          const cornerC = clipped[i + 1]
          const triPiece = [cornerA, cornerB, cornerC]
          const area = polygonArea3D(triPiece)
          if (area < 1e-4) continue

          const aIdx = resolveCornerIndex(cornerA, i0, i1, i2)
          const bIdx = resolveCornerIndex(cornerB, i0, i1, i2)
          const cIdx = resolveCornerIndex(cornerC, i0, i1, i2)
          triIndicesTemp.push(aIdx, bIdx, cIdx)
          triFacesTemp.push(cfi)
          coveredArea += area
          pieceCount++
        }
      }

      const coverage = origArea > 1e-6 ? coveredArea / origArea : 0
      const uncoveredArea = Math.max(0, origArea - coveredArea)
      if (pieceCount >= 2) splitCandidates++
      // Keep a strict lower bound so clipping never drops large portions of
      // source triangles (which manifests as visible holes in-world), but
      // allow moderate overlap from VMF-vs-BSP drift on the upper side.
      //
      // If coverage is slightly low, only accept when the uncovered area is
      // tiny in absolute world units (small triangles near face edges).
      const validSplit =
        pieceCount >= 2 &&
        coverage <= 1.45 &&
        (coverage >= 0.95 || (coverage >= 0.85 && uncoveredArea <= 48))

      if (validSplit) {
        expandedIndices.push(...triIndicesTemp)
        expandedFaces.push(...triFacesTemp)
        clippedTriangles++
        clippedTrianglePieces += pieceCount
        splitAccepted++
        if (coverage < 0.95) splitAcceptedUnder95++
        if (coverage < 0.9) splitAcceptedUnder90++
        if (coverage > 1.1) splitAcceptedOver110++
      } else {
        generatedVerts.length = generatedVertsStart
        appendOriginalTriangle(i0, i1, i2, fi)
      }
    }

    indices = new Uint32Array(expandedIndices)
    triFace = Int32Array.from(expandedFaces)
    triCount = triFace.length
    const baseVertCount = vertCount + generatedVerts.length

    // Phase B: detect vertices that need splitting (shared by triangles on different faces).
    // IMPORTANT: include unmatched triangles (fi=-1) so vertices shared between matched
    // and unmatched triangles get split — otherwise the unmatched triangle inherits the
    // matched triangle's atlas UV, causing blue/wrong-color artifacts.
    const vertFaceFirst = new Int32Array(baseVertCount).fill(-2) // -2 = unvisited
    const vertNeedsSplit = new Uint8Array(baseVertCount)
    for (let t = 0; t < triCount; t++) {
      const fi = triFace[t] // -1 (unmatched) or >= 0 (matched)
      for (let k = 0; k < 3; k++) {
        const vi = indices[t * 3 + k]
        if (vertFaceFirst[vi] === -2) vertFaceFirst[vi] = fi
        else if (vertFaceFirst[vi] !== fi) vertNeedsSplit[vi] = 1
      }
    }

    // Phase C: build split vertex map.
    const splitMap = new Map()
    const splitCopySource = new Map() // split vertex idx -> source vertex idx (base space)
    let nextNewVert = baseVertCount
    for (let v = 0; v < baseVertCount; v++) {
      if (!vertNeedsSplit[v]) continue
      splitMap.set(v, new Map())
    }
    for (let t = 0; t < triCount; t++) {
      const fi = triFace[t] // allow -1 (unmatched) so they get own split copies
      for (let k = 0; k < 3; k++) {
        const vi = indices[t * 3 + k]
        if (!vertNeedsSplit[vi]) continue
        const m = splitMap.get(vi)
        if (!m.has(fi)) {
          const mapped = m.size === 0 ? vi : nextNewVert++
          m.set(fi, mapped)
          if (mapped !== vi) splitCopySource.set(mapped, vi)
        }
      }
    }
    const totalVerts = nextNewVert

    const getBaseLocalPos = vi => {
      if (vi < vertCount) {
        return [positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]]
      }
      const gv = generatedVerts[vi - vertCount]
      if (gv) return gv.local
      return [0, 0, 0]
    }

    // Phase D: compute UVs and build the new index buffer.
    const uvs = new Float32Array(totalVerts * 2)
    const vertAssigned = new Uint8Array(totalVerts)
    const vertFaceFi = new Int32Array(totalVerts).fill(-1)
    const newIndices = new Uint32Array(indices.length)

    for (let t = 0; t < triCount; t++) {
      const fi = triFace[t]
      for (let k = 0; k < 3; k++) {
        const origVi = indices[t * 3 + k]
        let vi = origVi
        if (vertNeedsSplit[origVi]) {
          vi = splitMap.get(origVi)?.get(fi) ?? origVi
        }
        newIndices[t * 3 + k] = vi

        if (fi >= 0 && !vertAssigned[vi]) {
          const [lx, ly, lz] = getBaseLocalPos(origVi)
          const wx = lx + tx
          const wy = ly + ty
          const wz = lz + tz
          const uv = computeAtlasUV(wx, wy, wz, fi)
          if (uv) {
            if (uv[0] < 0 || uv[0] > 1 || uv[1] < 0 || uv[1] > 1) outOfRangeUVs++
            uvs[vi * 2] = uv[0]
            uvs[vi * 2 + 1] = uv[1]
            vertAssigned[vi] = 1
            vertFaceFi[vi] = fi
            projectedHitsPrim++
            projectedVerts++
          }
        }
      }
    }

    for (let i = 0; i < indices.length; i++) indices[i] = newIndices[i]

    // Step 4: Strict mode: do NOT copy UVs from nearby vertices.
    // We keep only triangles with exact face matches and preserve unmatched
    // triangles as a separate primitive without TEXCOORD_1.
    // Helper: get local position for any vertex index (original, generated, split).
    const getPos = vi => {
      if (vi < baseVertCount) return getBaseLocalPos(vi)
      const srcVi = splitCopySource.get(vi)
      if (srcVi != null) return getBaseLocalPos(srcVi)
      return [0, 0, 0]
    }

    // Build exact matched/unmatched triangle index sets. This avoids assigning a
    // lightmap UV stream to triangles that never matched a BSP face.
    const matchedIndicesList = []
    const unmatchedIndicesList = []
    for (let t = 0; t < triCount; t++) {
      const dst = triFace[t] >= 0 ? matchedIndicesList : unmatchedIndicesList
      dst.push(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2])
    }
    if (matchedIndicesList.length === 0) {
      primRejectDiagnostics.push({
        mesh: meshName,
        material: materialName,
        reason: 'no_matched_triangles',
        triCount,
        centroidHits,
        probeHits,
        vertexVoteHits,
        brushLike: isBrushLike,
      })
      unmatchedPrims++
      unmatchedVerts += baseVertCount
      continue
    }

    if (unmatchedIndicesList.length > 0 && isBrushLike) {
      primPartialDiagnostics.push({
        mesh: meshName,
        material: materialName,
        triCount,
        matchedTris: matchedIndicesList.length / 3,
        unmatchedTris: unmatchedIndicesList.length / 3,
        centroidHits,
        probeHits,
        vertexVoteHits,
      })
    }

    // Count hits for accepted primitive (count across all verts incl. splits)
    let primHits = 0
    for (let v = 0; v < totalVerts; v++) {
      if (vertAssigned[v]) {
        matchedVerts++
        primHits++
      } else if (v < baseVertCount) {
        unmatchedVerts++
      }
    }

    // Build definitions for every extra vertex (>= orig vert count), including
    // generated intersection verts and split duplicates. Writer uses this to
    // synthesize full attribute data for new vertices.
    const extraVertexDefs = new Map() // newIdx -> def
    for (let gi = 0; gi < generatedVerts.length; gi++) {
      const g = generatedVerts[gi]
      const newIdx = vertCount + gi
      extraVertexDefs.set(newIdx, {
        newIdx,
        kind: 'bary',
        i0: g.i0,
        i1: g.i1,
        i2: g.i2,
        w0: g.w[0],
        w1: g.w[1],
        w2: g.w[2],
      })
    }

    for (const [newIdx, srcIdx] of splitCopySource) {
      if (srcIdx < vertCount) {
        extraVertexDefs.set(newIdx, {
          newIdx,
          kind: 'copyOrig',
          origIdx: srcIdx,
        })
      } else {
        const g = generatedVerts[srcIdx - vertCount]
        if (g) {
          extraVertexDefs.set(newIdx, {
            newIdx,
            kind: 'bary',
            i0: g.i0,
            i1: g.i1,
            i2: g.i2,
            w0: g.w[0],
            w1: g.w[1],
            w2: g.w[2],
          })
        }
      }
    }

    const extraVertexDefsSorted = [...extraVertexDefs.values()].sort((a, b) => a.newIdx - b.newIdx)

    primUVs.push({
      meshIdx: mi,
      primIdx: pi,
      uvData: uvs,
      newVertCount: totalVerts,
      origVertCount: vertCount,
      extraVertexDefs: extraVertexDefsSorted,
      matchedIndices: Uint32Array.from(matchedIndicesList),
      unmatchedIndices:
        unmatchedIndicesList.length > 0 ? Uint32Array.from(unmatchedIndicesList) : null,
    })
    if (harmonizedAdjPairs > 0) {
      console.log(
        `  [mesh ${mi} prim ${pi}] harmonized adjacent tri-face pairs: ${harmonizedAdjPairs}`
      )
    }
    if (debugPrim) {
      let zeroPairs = 0
      for (let v = 0; v < totalVerts; v++) if (uvs[v * 2] === 0 && uvs[v * 2 + 1] === 0) zeroPairs++
      console.log(
        `${debugPrefix} ACCEPT totalVerts=${totalVerts} projectedHits=${projectedHitsPrim} zeroPairs=${zeroPairs} unmatchedTris=${unmatchedIndicesList.length / 3}`
      )
    }
    matchedPrims++
  }
}

const totalVerts = matchedVerts + unmatchedVerts
const totalPrims = matchedPrims + unmatchedPrims
console.log(
  `Vertices: ${matchedVerts}/${totalVerts} matched (${((matchedVerts / totalVerts) * 100).toFixed(1)}%), ${projectedVerts} via lmVecs projection`
)
console.log(
  `Primitives: ${matchedPrims}/${totalPrims} with lightmap (${((matchedPrims / totalPrims) * 100).toFixed(1)}%)`
)
console.log(`Centroid-based face hits: ${matchedPrims > 0 ? 'see per-prim logs' : '(accumulated)'}`)
console.log(
  `Boundary-clipped triangles: ${clippedTriangles} (pieces generated: ${clippedTrianglePieces})`
)
console.log(
  `Split coverage stats: candidates=${splitCandidates}, accepted=${splitAccepted}, under0.95=${splitAcceptedUnder95}, under0.90=${splitAcceptedUnder90}, over1.10=${splitAcceptedOver110}`
)
console.log(`Projected UVs out of range [0,1]: ${outOfRangeUVs}`)
console.log(`Fallback-copied UVs from neighbors: ${fallbackCopiedUVs} (strict mode target: 0)`)
if (primRejectDiagnostics.length > 0) {
  const byReason = new Map()
  for (const item of primRejectDiagnostics) byReason.set(item.reason, (byReason.get(item.reason) || 0) + 1)
  console.log('Primitive rejects by reason:', Object.fromEntries(byReason))
}
if (primPartialDiagnostics.length > 0) {
  const topPartial = [...primPartialDiagnostics]
    .sort((a, b) => b.unmatchedTris - a.unmatchedTris)
    .slice(0, 25)
  console.log('Top partial unmatched brush primitives:')
  for (const item of topPartial) {
    console.log(
      `  ${item.mesh} | ${item.material || '(no material)'} | unmatched=${item.unmatchedTris}/${item.triCount} | matched=${item.matchedTris} | centroid=${item.centroidHits} probe=${item.probeHits} vertex=${item.vertexVoteHits}`
    )
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. Encode atlas as PNG
 * ═══════════════════════════════════════════════════════════════════════════ */

function encodePNG(width, height, rgbaData) {
  // Minimal PNG encoder (RGBA)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  function crc32(buf) {
    let c = 0xffffffff
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let v = n
      for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1
      table[n] = v
    }
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(typeAndData))
    return Buffer.concat([len, typeAndData, crc])
  }

  // IHDR
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  // Raw scanlines with filter byte 0 (none) per row
  const rowSize = width * 4 + 1
  const rawBuf = Buffer.alloc(rowSize * height)
  for (let y = 0; y < height; y++) {
    rawBuf[y * rowSize] = 0 // filter: none
    rgbaData.copy(rawBuf, y * rowSize + 1, y * width * 4, (y + 1) * width * 4)
  }

  const compressed = zlib.deflateSync(rawBuf, { level: 6 })

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ])
}

const atlasPng = encodePNG(lmMeta.atlasWidth, lmMeta.atlasHeight, Buffer.from(lmAtlasRaw))
console.log(`Atlas PNG: ${(atlasPng.length / 1024 / 1024).toFixed(1)} MB`)

// Also save the atlas PNG as a standalone file for Three.js to load separately
const atlasPngPath = path.join(lmDir, 'lightmap_atlas.png')
fs.writeFileSync(atlasPngPath, atlasPng)
console.log(`Saved atlas: ${atlasPngPath}`)

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. Build new GLB with injected TEXCOORD_1 + atlas
 * ═══════════════════════════════════════════════════════════════════════════ */

// We'll append new data to the binary chunk
const newBufferParts = [binData]
let appendOffset = binData.length

// Pad to 4-byte alignment
const pad4 = n => (4 - (n % 4)) % 4

// Add atlas image as a buffer view
const atlasBvOffset = appendOffset + pad4(appendOffset)
if (atlasBvOffset > appendOffset) {
  newBufferParts.push(Buffer.alloc(atlasBvOffset - appendOffset))
  appendOffset = atlasBvOffset
}
newBufferParts.push(atlasPng)
const atlasBvIdx = gltf.bufferViews.length
gltf.bufferViews.push({
  buffer: 0,
  byteOffset: atlasBvOffset,
  byteLength: atlasPng.length,
})
appendOffset += atlasPng.length

// Add image
const imageIdx = (gltf.images || []).length
if (!gltf.images) gltf.images = []
gltf.images.push({
  bufferView: atlasBvIdx,
  mimeType: 'image/png',
  name: 'LightmapAtlas',
})

// Add sampler (linear filtering, clamp)
if (!gltf.samplers) gltf.samplers = []
const samplerIdx = gltf.samplers.length
gltf.samplers.push({
  magFilter: 9729, // LINEAR
  minFilter: 9987, // LINEAR_MIPMAP_LINEAR
  wrapS: 33071, // CLAMP_TO_EDGE
  wrapT: 33071,
})

// Add texture
if (!gltf.textures) gltf.textures = []
const textureIdx = gltf.textures.length
gltf.textures.push({
  source: imageIdx,
  sampler: samplerIdx,
  name: 'LightmapAtlas',
})

const componentSizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const typeCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }

// Helper: read raw accessor bytes (for duplicating/extending vertex attributes)
const readAccessorRawBytes = accIdx => {
  const acc = gltf.accessors[accIdx]
  const bv = gltf.bufferViews[acc.bufferView]
  const baseOff = (bv.byteOffset || 0) + (acc.byteOffset || 0)
  const elemSize = (componentSizes[acc.componentType] || 4) * (typeCounts[acc.type] || 1)
  const stride = bv.byteStride || elemSize
  return { baseOff, stride, elemSize, count: acc.count }
}

const readRawComponent = (buf, offset, componentType) => {
  if (componentType === 5120) return buf.readInt8(offset)
  if (componentType === 5121) return buf.readUInt8(offset)
  if (componentType === 5122) return buf.readInt16LE(offset)
  if (componentType === 5123) return buf.readUInt16LE(offset)
  if (componentType === 5125) return buf.readUInt32LE(offset)
  return buf.readFloatLE(offset)
}

const writeRawComponent = (buf, offset, componentType, value) => {
  if (componentType === 5120) return buf.writeInt8(value, offset)
  if (componentType === 5121) return buf.writeUInt8(value, offset)
  if (componentType === 5122) return buf.writeInt16LE(value, offset)
  if (componentType === 5123) return buf.writeUInt16LE(value, offset)
  if (componentType === 5125) return buf.writeUInt32LE(value, offset)
  return buf.writeFloatLE(value, offset)
}

const decodeNormalizedComponent = (raw, componentType, normalized) => {
  if (!normalized) return raw

  if (componentType === 5120) return Math.max(raw / 127, -1)
  if (componentType === 5121) return raw / 255
  if (componentType === 5122) return Math.max(raw / 32767, -1)
  if (componentType === 5123) return raw / 65535
  return raw
}

const encodeNormalizedComponent = (value, componentType, normalized) => {
  if (!normalized) {
    if (componentType === 5126) return value
    if (componentType === 5120) return Math.max(-128, Math.min(127, Math.round(value)))
    if (componentType === 5121) return Math.max(0, Math.min(255, Math.round(value)))
    if (componentType === 5122) return Math.max(-32768, Math.min(32767, Math.round(value)))
    if (componentType === 5123) return Math.max(0, Math.min(65535, Math.round(value)))
    if (componentType === 5125) return Math.max(0, Math.min(0xffffffff, Math.round(value)))
    return value
  }

  if (componentType === 5120) {
    if (value <= -1) return -128
    return Math.max(-128, Math.min(127, Math.round(Math.max(-1, Math.min(1, value)) * 127)))
  }
  if (componentType === 5121) {
    return Math.max(0, Math.min(255, Math.round(Math.max(0, Math.min(1, value)) * 255)))
  }
  if (componentType === 5122) {
    if (value <= -1) return -32768
    return Math.max(-32768, Math.min(32767, Math.round(Math.max(-1, Math.min(1, value)) * 32767)))
  }
  if (componentType === 5123) {
    return Math.max(0, Math.min(65535, Math.round(Math.max(0, Math.min(1, value)) * 65535)))
  }
  return value
}

// Add UV buffer views and accessors for each matched primitive
for (const {
  meshIdx,
  primIdx,
  uvData,
  newVertCount,
  origVertCount,
  extraVertexDefs,
  matchedIndices,
  unmatchedIndices,
} of primUVs) {
  const mesh = gltf.meshes[meshIdx]
  const prim = mesh.primitives[primIdx]

  // Helper: append a buffer part with 4-byte alignment
  const appendAligned = buf => {
    const padLen = pad4(appendOffset)
    if (padLen > 0) {
      newBufferParts.push(Buffer.alloc(padLen))
      appendOffset += padLen
    }
    const off = appendOffset
    newBufferParts.push(buf)
    appendOffset += buf.length
    return off
  }

  // If vertices were added (generated intersections and/or split copies),
  // extend all vertex attributes and rewrite indices.
  if (newVertCount > origVertCount) {
    for (const [attrName, attrAccIdx] of Object.entries(prim.attributes)) {
      if (attrName === 'TEXCOORD_1') continue

      const origAcc = gltf.accessors[attrAccIdx]
      const { baseOff, stride, elemSize, count } = readAccessorRawBytes(attrAccIdx)
      const componentType = origAcc.componentType
      const componentSize = componentSizes[componentType] || 4
      const componentCount = typeCounts[origAcc.type] || 1
      const normalized = !!origAcc.normalized

      // Build full buffer: copy original data (de-strided) + synthesize extras.
      const fullBuf = Buffer.alloc(newVertCount * elemSize)
      for (let i = 0; i < count; i++) {
        binData.copy(fullBuf, i * elemSize, baseOff + i * stride, baseOff + i * stride + elemSize)
      }

      const readDecodedComponent = (vertexIdx, compIdx) => {
        const safeVi = Math.max(0, Math.min(count - 1, vertexIdx))
        const off = baseOff + safeVi * stride + compIdx * componentSize
        const raw = readRawComponent(binData, off, componentType)
        return decodeNormalizedComponent(raw, componentType, normalized)
      }

      for (const def of extraVertexDefs) {
        const dstOff = def.newIdx * elemSize

        if (def.kind === 'copyOrig') {
          const safeOrig = Math.max(0, Math.min(count - 1, def.origIdx))
          binData.copy(
            fullBuf,
            dstOff,
            baseOff + safeOrig * stride,
            baseOff + safeOrig * stride + elemSize
          )
          continue
        }

        if (def.kind === 'bary') {
          const compVals = new Array(componentCount).fill(0)
          for (let c = 0; c < componentCount; c++) {
            const v0 = readDecodedComponent(def.i0, c)
            const v1 = readDecodedComponent(def.i1, c)
            const v2 = readDecodedComponent(def.i2, c)
            compVals[c] = v0 * def.w0 + v1 * def.w1 + v2 * def.w2
          }

          // Keep interpolated normals unit-length.
          if (attrName === 'NORMAL' && componentCount >= 3) {
            const nx = compVals[0],
              ny = compVals[1],
              nz = compVals[2]
            const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz)
            if (nLen > 1e-8) {
              compVals[0] = nx / nLen
              compVals[1] = ny / nLen
              compVals[2] = nz / nLen
            }
          }

          for (let c = 0; c < componentCount; c++) {
            const raw = encodeNormalizedComponent(compVals[c], componentType, normalized)
            writeRawComponent(fullBuf, dstOff + c * componentSize, componentType, raw)
          }
        }
      }

      const fullBufOffset = appendAligned(fullBuf)
      const fullBvIdx = gltf.bufferViews.length
      gltf.bufferViews.push({
        buffer: 0,
        byteOffset: fullBufOffset,
        byteLength: fullBuf.length,
        byteStride: elemSize,
        target: 34962,
      })

      const fullAccIdx = gltf.accessors.length
      gltf.accessors.push({
        bufferView: fullBvIdx,
        componentType: origAcc.componentType,
        count: newVertCount,
        type: origAcc.type,
        ...(origAcc.max ? { max: origAcc.max } : {}),
        ...(origAcc.min ? { min: origAcc.min } : {}),
        ...(origAcc.normalized ? { normalized: origAcc.normalized } : {}),
      })
      prim.attributes[attrName] = fullAccIdx
    }

  }

  const writeIndexAccessor = indicesData => {
    const idxBuf = Buffer.alloc(indicesData.length * 4)
    for (let i = 0; i < indicesData.length; i++) idxBuf.writeUInt32LE(indicesData[i], i * 4)
    const idxOffset = appendAligned(idxBuf)
    const idxBvIdx = gltf.bufferViews.length
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: idxOffset,
      byteLength: idxBuf.length,
      target: 34963,
    })
    const idxAccIdx = gltf.accessors.length
    gltf.accessors.push({
      bufferView: idxBvIdx,
      componentType: 5125,
      count: indicesData.length,
      type: 'SCALAR',
    })
    return idxAccIdx
  }

  prim.indices = writeIndexAccessor(matchedIndices)

  // Write TEXCOORD_1 data (for all vertices including splits)
  const uvOffset = appendOffset + pad4(appendOffset)
  if (uvOffset > appendOffset) {
    newBufferParts.push(Buffer.alloc(uvOffset - appendOffset))
    appendOffset = uvOffset
  }

  const uvBuf = Buffer.alloc(uvData.length * 4)
  for (let i = 0; i < uvData.length; i++) {
    uvBuf.writeFloatLE(uvData[i], i * 4)
  }
  newBufferParts.push(uvBuf)

  const bvIdx = gltf.bufferViews.length
  gltf.bufferViews.push({
    buffer: 0,
    byteOffset: uvOffset,
    byteLength: uvBuf.length,
    byteStride: 8,
    target: 34962,
  })

  const accIdx = gltf.accessors.length
  gltf.accessors.push({
    bufferView: bvIdx,
    componentType: 5126,
    count: uvData.length / 2,
    type: 'VEC2',
    max: [1, 1],
    min: [0, 0],
  })

  prim.attributes.TEXCOORD_1 = accIdx
  appendOffset += uvBuf.length

  if (unmatchedIndices && unmatchedIndices.length > 0) {
    const unmatchedPrim = {
      ...prim,
      attributes: { ...prim.attributes },
    }
    delete unmatchedPrim.attributes.TEXCOORD_1
    unmatchedPrim.indices = writeIndexAccessor(unmatchedIndices)
    mesh.primitives.push(unmatchedPrim)
  }
}

// Update buffer size
gltf.buffers[0].byteLength = appendOffset

// Concatenate all buffer parts
const newBin = Buffer.concat(newBufferParts)

// Build new GLB
const newJsonStr = JSON.stringify(gltf)
// Pad JSON to 4-byte alignment with spaces
const jsonPadLen = (4 - (newJsonStr.length % 4)) % 4
const paddedJson = newJsonStr + ' '.repeat(jsonPadLen)
const jsonBuf = Buffer.from(paddedJson, 'utf8')

// Pad binary to 4-byte alignment with zeros
const binPadLen = (4 - (newBin.length % 4)) % 4
const paddedBin = binPadLen > 0 ? Buffer.concat([newBin, Buffer.alloc(binPadLen)]) : newBin

const totalLength = 12 + 8 + jsonBuf.length + 8 + paddedBin.length
const header = Buffer.alloc(12)
header.write('glTF', 0, 4, 'ascii')
header.writeUInt32LE(2, 4) // version
header.writeUInt32LE(totalLength, 8)

const jsonChunkHeader = Buffer.alloc(8)
jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0)
jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4) // "JSON"

const binChunkHeader = Buffer.alloc(8)
binChunkHeader.writeUInt32LE(paddedBin.length, 0)
binChunkHeader.writeUInt32LE(0x004e4942, 4) // "BIN\0"

const outBuf = Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, paddedBin])
fs.writeFileSync(outPath, outBuf)
console.log(`Output: ${outPath} (${(outBuf.length / 1024 / 1024).toFixed(1)} MB)`)
