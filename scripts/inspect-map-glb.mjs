#!/usr/bin/env node

/**
 * Baseline for public/models/maps/cp_snakewater_final1/textured_compressed.glb
 * recorded on 2026-03-03 after Phase 1:
 * - nodes: 11029
 * - meshes: 3817
 * - primitives: 10140
 * - triangles: 390955
 * - materials: 311
 * - textures: 331
 * - chunk roots: 2
 * - static mesh nodes by prefix: worldspawn=0 func_detail=0 func_brush=0 prop_static=0
 * - visibility.json exists: true
 * - chunks with non-empty cluster assignments: 0
 *
 * This script is intentionally read-only and diagnostic only. It inspects GLB
 * JSON and adjacent metadata files without mutating conversion outputs.
 */

import fs from 'node:fs'
import path from 'node:path'

const JSON_CHUNK_TYPE = 0x4e4f534a
const TRIANGLES_MODE = 4
const TRIANGLE_STRIP_MODE = 5
const TRIANGLE_FAN_MODE = 6
const CHUNK_ROOT_PATTERN = /^chunk_\d+_\d+$/
const STATIC_MESH_PREFIXES = ['worldspawn', 'func_detail', 'func_brush', 'prop_static']

const usage = () => {
  console.error('Usage: node scripts/inspect-map-glb.mjs <path-to.glb>')
  process.exit(1)
}

const getPrimitiveVertexCount = (primitive, accessors) => {
  if (primitive.indices != null) {
    return accessors[primitive.indices]?.count ?? 0
  }

  const positionAccessorIndex = primitive.attributes?.POSITION
  if (positionAccessorIndex == null) return 0
  return accessors[positionAccessorIndex]?.count ?? 0
}

const getPrimitiveTriangleCount = (primitive, accessors) => {
  const mode = primitive.mode ?? TRIANGLES_MODE
  const vertexCount = getPrimitiveVertexCount(primitive, accessors)

  if (mode === TRIANGLES_MODE) {
    return Math.floor(vertexCount / 3)
  }

  if (mode === TRIANGLE_STRIP_MODE || mode === TRIANGLE_FAN_MODE) {
    return Math.max(vertexCount - 2, 0)
  }

  return 0
}

const readJsonChunk = glbPath => {
  const buffer = fs.readFileSync(glbPath)
  if (buffer.length < 20) {
    throw new Error(`GLB is too small to contain a valid header: ${glbPath}`)
  }

  const magic = buffer.readUInt32LE(0)
  const version = buffer.readUInt32LE(4)
  const length = buffer.readUInt32LE(8)

  if (magic !== 0x46546c67) {
    throw new Error(`Invalid GLB magic in ${glbPath}`)
  }

  if (version !== 2) {
    throw new Error(`Unsupported GLB version ${version} in ${glbPath}`)
  }

  if (length > buffer.length) {
    throw new Error(`GLB header length ${length} exceeds file length ${buffer.length} in ${glbPath}`)
  }

  let offset = 12
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset)
    const chunkType = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkLength

    if (chunkEnd > buffer.length) {
      throw new Error(`Invalid chunk length ${chunkLength} in ${glbPath}`)
    }

    if (chunkType === JSON_CHUNK_TYPE) {
      const jsonText = new TextDecoder('utf8').decode(buffer.subarray(chunkStart, chunkEnd))
      return JSON.parse(jsonText)
    }

    offset = chunkEnd
  }

  throw new Error(`No JSON chunk found in ${glbPath}`)
}

const getVisibilityDiagnostics = glbPath => {
  const visibilityPath = path.join(path.dirname(glbPath), 'visibility.json')
  if (!fs.existsSync(visibilityPath)) {
    return {
      exists: false,
      version: null,
      chunkAssignments: 0,
      nonEmptyChunkAssignments: 0,
    }
  }

  let metadata = null
  try {
    metadata = JSON.parse(fs.readFileSync(visibilityPath, 'utf8'))
  } catch (error) {
    throw new Error(`Failed to parse ${visibilityPath}: ${error.message}`)
  }

  const chunkAssignments = Array.isArray(metadata.chunkAssignments) ? metadata.chunkAssignments : []
  const nonEmptyChunkAssignments = chunkAssignments.filter(
    assignment => Array.isArray(assignment?.clusters) && assignment.clusters.length > 0
  ).length

  return {
    exists: true,
    version: metadata.version ?? null,
    chunkAssignments: chunkAssignments.length,
    nonEmptyChunkAssignments,
  }
}

const inspectGlb = glbPath => {
  const gltf = readJsonChunk(glbPath)
  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : []
  const meshes = Array.isArray(gltf.meshes) ? gltf.meshes : []
  const materials = Array.isArray(gltf.materials) ? gltf.materials : []
  const textures = Array.isArray(gltf.textures) ? gltf.textures : []
  const accessors = Array.isArray(gltf.accessors) ? gltf.accessors : []

  let primitiveCount = 0
  let triangleCount = 0
  for (const mesh of meshes) {
    const primitives = Array.isArray(mesh.primitives) ? mesh.primitives : []
    primitiveCount += primitives.length
    for (const primitive of primitives) {
      triangleCount += getPrimitiveTriangleCount(primitive, accessors)
    }
  }

  const staticMeshNodesByPrefix = Object.fromEntries(
    STATIC_MESH_PREFIXES.map(prefix => [prefix, 0])
  )

  let chunkRootCount = 0
  for (const node of nodes) {
    const name = typeof node.name === 'string' ? node.name : ''
    const normalizedName = name.toLowerCase()

    if (CHUNK_ROOT_PATTERN.test(name)) {
      chunkRootCount++
    }

    if (node.mesh == null) continue
    for (const prefix of STATIC_MESH_PREFIXES) {
      if (normalizedName.startsWith(prefix)) {
        staticMeshNodesByPrefix[prefix]++
        break
      }
    }
  }

  return {
    glbPath: path.resolve(glbPath),
    nodeCount: nodes.length,
    meshCount: meshes.length,
    primitiveCount,
    triangleCount,
    materialCount: materials.length,
    textureCount: textures.length,
    chunkRootCount,
    staticMeshNodesByPrefix,
    visibility: getVisibilityDiagnostics(glbPath),
  }
}

const formatPrefixCounts = counts =>
  STATIC_MESH_PREFIXES.map(prefix => `${prefix}=${counts[prefix]}`).join(' ')

const main = () => {
  const input = process.argv[2]
  if (!input) usage()

  const glbPath = path.resolve(process.cwd(), input)
  const stats = inspectGlb(glbPath)

  console.log(`GLB: ${stats.glbPath}`)
  console.log(`nodes: ${stats.nodeCount}`)
  console.log(`meshes: ${stats.meshCount}`)
  console.log(`primitives: ${stats.primitiveCount}`)
  console.log(`triangles: ${stats.triangleCount}`)
  console.log(`materials: ${stats.materialCount}`)
  console.log(`textures: ${stats.textureCount}`)
  console.log(`chunk roots: ${stats.chunkRootCount}`)
  console.log(`static mesh nodes by prefix: ${formatPrefixCounts(stats.staticMeshNodesByPrefix)}`)
  console.log(`visibility.json exists: ${stats.visibility.exists}`)
  console.log(`visibility.json version: ${stats.visibility.version ?? 'n/a'}`)
  console.log(`visibility chunk assignments: ${stats.visibility.chunkAssignments}`)
  console.log(
    `chunks with non-empty cluster assignments: ${stats.visibility.nonEmptyChunkAssignments}`
  )
}

main()
