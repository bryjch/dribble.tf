import localforage from 'localforage'

import {
  getMapConversionUrl,
  getMapModelUrls,
  getMapSkyboxUrls,
  getMapVisibilityUrl,
  resolveMapFolderName,
} from '@utils/game'

const MAP_NAME = /^[a-z0-9_]{1,128}$/
const SHA256 = /^[0-9a-f]{64}$/
const MAX_BSP_BYTES = 512 * 1024 * 1024
const MAX_ASSET_BYTES = 256 * 1024 * 1024
const MAX_BUNDLE_BYTES = 512 * 1024 * 1024
const MAX_RESOURCES = 16_384
const MANIFEST_VERSION = 1
const PACKAGE_VERSION = 1
const RESOURCE_BUNDLE_VERSION = 1
const CONVERSION_PROFILE = 'dribble-tf2-v1'
const CONVERTER_VERSION = '0.2.0'
const CONVERTER_REVISION = '65b4931c23ea52d56a69b2c44e03a317c50962dff539e9cdee242864217b0bc1'
const SHARED_ASSET_PACK_VERSION = 'v1'
const CACHE_PREFIX = 'derived-map:v1:'
const SOURCE_PREFIX = 'map-source:v1:'

type JsonObject = Record<string, unknown>

export type ComponentDescriptor = {
  role: string
  mediaType: string
  byteLength: number
  sha256: string
}

export type AssetCoverageDomain = {
  requested: number
  resolved: number
  unavailable: number
  unsupported: number
}

export type DerivedMapManifest = {
  schema: 'bsp-to-glb.derived-map'
  version: 1
  mapName: string
  bspSha256: string
  bspByteLength: number
  converterVersion: string
  converterSourceRevision: string | null
  conversionProfile: string
  sharedAssetPackVersion: string
  worldBounds: { mins: [number, number, number]; maxs: [number, number, number] }
  environment: {
    skyName?: string
    ambient?: [number, number, number, number]
    sunlight?: [number, number, number, number]
    sunlightAngles?: [number, number, number]
    fogController?: Record<string, string>
  }
  dependencies: {
    materials: string[]
    models: string[]
    skybox: string[]
    embedded: string[]
  }
  assetCoverage: Record<string, AssetCoverageDomain>
  degraded: boolean
  components: ComponentDescriptor[]
}

export type SharedAssetDescriptor = {
  logicalPath: string
  kind: string
  byteLength: number
  sha256: string
  objectPath: string
  dependencies: string[]
  unsupported: string[]
}

export type SharedAssetPackIndex = {
  schema: 'bsp-to-glb.shared-asset-pack'
  version: 1
  packVersion: string
  resources: Record<string, SharedAssetDescriptor>
}

export type DerivedMapResult =
  | {
      kind: 'derived'
      source: 'published' | 'cache' | 'generated' | 'localOverride'
      staleSource: boolean
      manifest: DerivedMapManifest
      components: Map<string, Uint8Array>
      sharedIndex: SharedAssetPackIndex
      sharedAssets: Map<string, Uint8Array>
    }
  | {
      kind: 'legacy'
      source: 'legacy'
      staleSource: true
      modelUrl: string
      visibilityUrl?: string
      conversionUrl?: string
      skyboxUrls?: ReturnType<typeof getMapSkyboxUrls>
    }

export type MapLoadStage = {
  name: 'catalog' | 'download' | 'inspect' | 'assets' | 'convert' | 'cache'
  loadedBytes?: number
  totalBytes?: number
}

type CatalogMetadata = {
  etag: string | null
  lastModified: string | null
  byteLength: number | null
}

type SourceRecord = {
  mapName: string
  bspSha256: string
  metadata: CatalogMetadata
  cacheKey: string
}

type CachedMap = {
  manifest: DerivedMapManifest
  components: { role: string; bytes: ArrayBuffer }[]
}

type PublishedDescriptor = {
  manifest: DerivedMapManifest
  components: { role: string; url: string }[]
}

type BspInspection = {
  bspSha256: string
  dependencies: DerivedMapManifest['dependencies']
}

type WorkerResponse =
  | { id: number; kind: 'inspection'; json: string }
  | { id: number; kind: 'converted'; package: ArrayBuffer }
  | { id: number; kind: 'failure'; message: string }

export class MapResolutionError extends Error {
  constructor(
    readonly code:
      | 'UnsupportedDevice'
      | 'CatalogUnavailable'
      | 'CatalogMiss'
      | 'DownloadFailed'
      | 'IntegrityFailure'
      | 'MissingSharedAsset'
      | 'ConversionFailed'
      | 'Cancelled',
    message: string
  ) {
    super(message)
    this.name = 'MapResolutionError'
  }
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function boundedInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum
}

function finiteVector(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite)
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every(item => typeof item === 'string' && item.length <= 1024)
  )
}

function validateComponent(value: unknown): ComponentDescriptor {
  const item = object(value)
  if (
    !item ||
    typeof item.role !== 'string' ||
    !item.role ||
    item.role.length > 256 ||
    typeof item.mediaType !== 'string' ||
    item.mediaType.length > 128 ||
    !boundedInteger(item.byteLength, MAX_ASSET_BYTES) ||
    typeof item.sha256 !== 'string' ||
    !SHA256.test(item.sha256)
  ) {
    throw new MapResolutionError('IntegrityFailure', 'Derived Map component descriptor is invalid')
  }
  return item as ComponentDescriptor
}

export function validateDerivedMapManifest(value: unknown): DerivedMapManifest {
  const manifest = object(value)
  const bounds = object(manifest?.worldBounds)
  const dependencies = object(manifest?.dependencies)
  if (
    !manifest ||
    manifest.schema !== 'bsp-to-glb.derived-map' ||
    manifest.version !== MANIFEST_VERSION ||
    typeof manifest.mapName !== 'string' ||
    !MAP_NAME.test(manifest.mapName) ||
    typeof manifest.bspSha256 !== 'string' ||
    !SHA256.test(manifest.bspSha256) ||
    !boundedInteger(manifest.bspByteLength, MAX_BSP_BYTES) ||
    manifest.converterVersion !== CONVERTER_VERSION ||
    manifest.converterSourceRevision !== CONVERTER_REVISION ||
    manifest.conversionProfile !== CONVERSION_PROFILE ||
    manifest.sharedAssetPackVersion !== SHARED_ASSET_PACK_VERSION ||
    !bounds ||
    !finiteVector(bounds.mins, 3) ||
    !finiteVector(bounds.maxs, 3) ||
    bounds.mins.some((minimum, index) => minimum > (bounds.maxs as number[])[index]) ||
    !dependencies ||
    !stringArray(dependencies.materials) ||
    !stringArray(dependencies.models) ||
    !stringArray(dependencies.skybox) ||
    !stringArray(dependencies.embedded) ||
    !Array.isArray(manifest.components) ||
    typeof manifest.degraded !== 'boolean'
  ) {
    throw new MapResolutionError(
      'IntegrityFailure',
      'Derived Map Manifest is invalid or incompatible'
    )
  }
  const components = manifest.components.map(validateComponent)
  if (new Set(components.map(component => component.role)).size !== components.length) {
    throw new MapResolutionError('IntegrityFailure', 'Derived Map component roles are duplicated')
  }
  if (!components.some(component => component.role === 'world.glb')) {
    throw new MapResolutionError('IntegrityFailure', 'Derived Map has no world geometry')
  }
  return { ...(manifest as DerivedMapManifest), components }
}

function validateSharedIndex(value: unknown): SharedAssetPackIndex {
  const index = object(value)
  const resources = object(index?.resources)
  if (
    !index ||
    index.schema !== 'bsp-to-glb.shared-asset-pack' ||
    index.version !== 1 ||
    index.packVersion !== SHARED_ASSET_PACK_VERSION ||
    !resources ||
    Object.keys(resources).length > MAX_RESOURCES
  ) {
    throw new MapResolutionError('IntegrityFailure', 'Shared Asset Pack index is invalid')
  }
  for (const [path, raw] of Object.entries(resources)) {
    const descriptor = object(raw)
    if (
      !descriptor ||
      descriptor.logicalPath !== path ||
      typeof descriptor.kind !== 'string' ||
      !boundedInteger(descriptor.byteLength, MAX_ASSET_BYTES) ||
      typeof descriptor.sha256 !== 'string' ||
      !SHA256.test(descriptor.sha256) ||
      typeof descriptor.objectPath !== 'string' ||
      !/^objects\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(descriptor.objectPath) ||
      !stringArray(descriptor.dependencies) ||
      !stringArray(descriptor.unsupported)
    ) {
      throw new MapResolutionError('IntegrityFailure', `Shared asset descriptor ${path} is invalid`)
    }
  }
  return index as SharedAssetPackIndex
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    )
  )
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

function cacheKey(manifest: DerivedMapManifest): string {
  return `${CACHE_PREFIX}${manifest.bspSha256}:${manifest.converterVersion}:${manifest.converterSourceRevision}:${manifest.conversionProfile}:${manifest.sharedAssetPackVersion}`
}

function sourceKey(mapName: string): string {
  return `${SOURCE_PREFIX}${mapName}`
}

async function readSourceRecord(mapName: string): Promise<SourceRecord | null> {
  const record = object(await localforage.getItem(sourceKey(mapName)))
  const metadata = object(record?.metadata)
  if (
    !record ||
    record.mapName !== mapName ||
    typeof record.bspSha256 !== 'string' ||
    !SHA256.test(record.bspSha256) ||
    typeof record.cacheKey !== 'string' ||
    !metadata
  ) {
    return null
  }
  return record as SourceRecord
}

async function verifiedComponents(
  manifest: DerivedMapManifest,
  components: { role: string; bytes: Uint8Array }[]
): Promise<Map<string, Uint8Array>> {
  const byRole = new Map(components.map(component => [component.role, component.bytes]))
  if (byRole.size !== components.length || byRole.size !== manifest.components.length) {
    throw new MapResolutionError('IntegrityFailure', 'Derived Map component inventory differs')
  }
  for (const descriptor of manifest.components) {
    const bytes = byRole.get(descriptor.role)
    if (
      !bytes ||
      bytes.byteLength !== descriptor.byteLength ||
      (await sha256(bytes)) !== descriptor.sha256
    ) {
      throw new MapResolutionError(
        'IntegrityFailure',
        `Derived Map component ${descriptor.role} failed verification`
      )
    }
  }
  return byRole
}

async function readCache(
  key: string
): Promise<{ manifest: DerivedMapManifest; components: Map<string, Uint8Array> } | null> {
  try {
    const cached = object(await localforage.getItem(key)) as CachedMap | null
    if (!cached || !Array.isArray(cached.components)) return null
    const manifest = validateDerivedMapManifest(cached.manifest)
    if (cacheKey(manifest) !== key) throw new Error('cache identity differs')
    const components = await verifiedComponents(
      manifest,
      cached.components.map(component => ({
        role: component.role,
        bytes: new Uint8Array(component.bytes),
      }))
    )
    return { manifest, components }
  } catch {
    try {
      await localforage.removeItem(key)
    } catch {
      // An unavailable cache is still a miss.
    }
    return null
  }
}

async function storeCache(manifest: DerivedMapManifest, components: Map<string, Uint8Array>) {
  const cached: CachedMap = {
    manifest,
    components: Array.from(components, ([role, bytes]) => ({
      role,
      bytes: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer,
    })),
  }
  await localforage.setItem(cacheKey(manifest), cached)
}

function catalogUrl(mapName: string): string {
  if (!MAP_NAME.test(mapName)) {
    throw new MapResolutionError('IntegrityFailure', 'Map Name contains unsafe characters')
  }
  return `/serveme/maps/${mapName}.bsp`
}

async function catalogMetadata(mapName: string, signal: AbortSignal): Promise<CatalogMetadata> {
  const response = await fetch(catalogUrl(mapName), { method: 'HEAD', signal, redirect: 'error' })
  if (response.status === 404)
    throw new MapResolutionError('CatalogMiss', `${mapName} is not in Serveme`)
  if (!response.ok)
    throw new MapResolutionError('CatalogUnavailable', `Serveme returned HTTP ${response.status}`)
  const declared = response.headers.get('content-length')
  const byteLength = declared === null ? null : Number(declared)
  if (byteLength !== null && (!boundedInteger(byteLength, MAX_BSP_BYTES) || byteLength < 1036)) {
    throw new MapResolutionError('IntegrityFailure', 'Catalog BSP Content-Length is invalid')
  }
  return {
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
    byteLength,
  }
}

function metadataMatches(left: CatalogMetadata, right: CatalogMetadata): boolean {
  const comparisons = [
    left.etag && right.etag ? left.etag === right.etag : null,
    left.lastModified && right.lastModified ? left.lastModified === right.lastModified : null,
    left.byteLength !== null && right.byteLength !== null
      ? left.byteLength === right.byteLength
      : null,
  ].filter((value): value is boolean => value !== null)
  return comparisons.length > 0 && comparisons.every(Boolean)
}

async function readResponse(
  response: Response,
  maximum: number,
  signal: AbortSignal,
  progress?: (loaded: number, total?: number) => void
): Promise<Uint8Array> {
  if (!response.body) throw new MapResolutionError('DownloadFailed', 'response has no body')
  const declaredValue = response.headers.get('content-length')
  const declared = declaredValue === null ? undefined : Number(declaredValue)
  if (declared !== undefined && (!boundedInteger(declared, maximum) || declared < 1)) {
    throw new MapResolutionError('IntegrityFailure', 'response Content-Length exceeds its limit')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      if (signal.aborted) throw new MapResolutionError('Cancelled', 'map load cancelled')
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maximum || (declared !== undefined && received > declared)) {
        await reader.cancel()
        throw new MapResolutionError('IntegrityFailure', 'response body exceeds its byte limit')
      }
      chunks.push(value)
      progress?.(received, declared)
    }
  } catch (error) {
    if (error instanceof MapResolutionError) throw error
    throw new MapResolutionError('DownloadFailed', 'response stream failed')
  }
  if (declared !== undefined && received !== declared) {
    throw new MapResolutionError('IntegrityFailure', 'response body differs from Content-Length')
  }
  const output = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

async function downloadBsp(
  mapName: string,
  signal: AbortSignal,
  stage: (stage: MapLoadStage) => void
): Promise<Uint8Array> {
  const response = await fetch(catalogUrl(mapName), { signal, redirect: 'error' })
  if (response.status === 404)
    throw new MapResolutionError('CatalogMiss', `${mapName} is not in Serveme`)
  if (!response.ok)
    throw new MapResolutionError('DownloadFailed', `BSP download returned HTTP ${response.status}`)
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (
    contentType &&
    !['application/octet-stream', 'application/x-bsp', 'binary/octet-stream'].includes(contentType)
  ) {
    throw new MapResolutionError(
      'IntegrityFailure',
      `BSP response has unexpected Content-Type ${contentType}`
    )
  }
  const bytes = await readResponse(response, MAX_BSP_BYTES, signal, (loadedBytes, totalBytes) =>
    stage({ name: 'download', loadedBytes, totalBytes })
  )
  if (bytes.byteLength < 1036 || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'VBSP') {
    throw new MapResolutionError('IntegrityFailure', 'download is not a complete VBSP file')
  }
  return bytes
}

async function publishedDescriptor(
  mapName: string,
  signal: AbortSignal
): Promise<PublishedDescriptor | null> {
  const folder = resolveMapFolderName(mapName)
  const response = await fetch(`/models/maps/${folder}/derived-map.json`, { signal })
  if (response.status === 404) return null
  if (!response.ok)
    throw new MapResolutionError(
      'DownloadFailed',
      `Published descriptor returned HTTP ${response.status}`
    )
  if (response.headers.get('content-type')?.includes('text/html')) return null
  const value = object(await response.json())
  if (!value || !Array.isArray(value.components)) {
    throw new MapResolutionError('IntegrityFailure', 'Published Derived Map descriptor is invalid')
  }
  const manifest = validateDerivedMapManifest(value.manifest)
  const components = value.components.map(raw => {
    const component = object(raw)
    if (!component || typeof component.role !== 'string' || typeof component.url !== 'string') {
      throw new MapResolutionError('IntegrityFailure', 'Published component URL is invalid')
    }
    const url = new URL(component.url, window.location.origin)
    if (
      url.origin !== window.location.origin ||
      !url.pathname.startsWith(`/models/maps/${folder}/`)
    ) {
      throw new MapResolutionError(
        'IntegrityFailure',
        'Published component URL escaped its map folder'
      )
    }
    return { role: component.role, url: url.toString() }
  })
  return { manifest, components }
}

async function loadPublished(
  descriptor: PublishedDescriptor,
  signal: AbortSignal
): Promise<Map<string, Uint8Array>> {
  const components = await Promise.all(
    descriptor.components.map(async component => {
      const expected = descriptor.manifest.components.find(item => item.role === component.role)
      if (!expected)
        throw new MapResolutionError(
          'IntegrityFailure',
          `Unknown published component ${component.role}`
        )
      const response = await fetch(component.url, { signal })
      if (!response.ok)
        throw new MapResolutionError(
          'DownloadFailed',
          `Published component ${component.role} returned HTTP ${response.status}`
        )
      return {
        role: component.role,
        bytes: await readResponse(response, expected.byteLength, signal),
      }
    })
  )
  return verifiedComponents(descriptor.manifest, components)
}

function legacyResult(mapName: string): DerivedMapResult | null {
  const model = getMapModelUrls(mapName)
  if (!model) return null
  return {
    kind: 'legacy',
    source: 'legacy',
    staleSource: true,
    modelUrl: model.textured,
    visibilityUrl: getMapVisibilityUrl(mapName),
    conversionUrl: getMapConversionUrl(mapName),
    skyboxUrls: getMapSkyboxUrls(mapName),
  }
}

async function loadSharedAssets(
  manifest: Pick<DerivedMapManifest, 'dependencies'> | BspInspection,
  signal: AbortSignal,
  stage: (stage: MapLoadStage) => void
): Promise<{ index: SharedAssetPackIndex; assets: Map<string, Uint8Array> }> {
  const indexResponse = await fetch(`/shared-assets/${SHARED_ASSET_PACK_VERSION}/index.json`, {
    signal,
  })
  if (!indexResponse.ok) {
    throw new MapResolutionError(
      'MissingSharedAsset',
      `Shared Asset Pack index returned HTTP ${indexResponse.status}`
    )
  }
  let index: SharedAssetPackIndex
  try {
    index = validateSharedIndex(await indexResponse.json())
  } catch (error) {
    if (error instanceof MapResolutionError) throw error
    throw new MapResolutionError('MissingSharedAsset', 'Shared Asset Pack index is unavailable')
  }
  const dependencies = 'dependencies' in manifest ? manifest.dependencies : manifest
  const embedded = new Set(dependencies.embedded)
  const pending = [
    ...dependencies.materials,
    ...dependencies.models,
    ...dependencies.skybox,
  ].filter(path => !embedded.has(path))
  const closure = new Set<string>()
  while (pending.length > 0) {
    const path = pending.pop()!
    if (closure.has(path)) continue
    if (closure.size >= MAX_RESOURCES)
      throw new MapResolutionError(
        'IntegrityFailure',
        'Shared asset closure exceeds its resource limit'
      )
    const descriptor = index.resources[path]
    if (!descriptor)
      throw new MapResolutionError('MissingSharedAsset', `Shared Asset Pack is missing ${path}`)
    closure.add(path)
    pending.push(...descriptor.dependencies)
  }
  let loadedBytes = 0
  const assets = new Map<string, Uint8Array>()
  for (const path of Array.from(closure).sort()) {
    const descriptor = index.resources[path]
    const response = await fetch(
      `/shared-assets/${SHARED_ASSET_PACK_VERSION}/${descriptor.objectPath}`,
      { signal }
    )
    if (!response.ok)
      throw new MapResolutionError(
        'MissingSharedAsset',
        `Shared asset ${path} returned HTTP ${response.status}`
      )
    const bytes = await readResponse(response, descriptor.byteLength, signal)
    if (bytes.byteLength !== descriptor.byteLength || (await sha256(bytes)) !== descriptor.sha256) {
      throw new MapResolutionError('IntegrityFailure', `Shared asset ${path} failed verification`)
    }
    loadedBytes += bytes.byteLength
    if (loadedBytes > MAX_BUNDLE_BYTES)
      throw new MapResolutionError(
        'IntegrityFailure',
        'Shared asset closure exceeds its byte limit'
      )
    assets.set(path, bytes)
    stage({ name: 'assets', loadedBytes })
  }
  return { index, assets }
}

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g) ?? [], pair => Number.parseInt(pair, 16))
}

function resourceBundle(assets: Map<string, Uint8Array>, index: SharedAssetPackIndex): ArrayBuffer {
  const entries = Array.from(assets)
    .filter(([path]) => !path.endsWith('.png') && !path.endsWith('.glb') && !path.endsWith('.json'))
    .sort(([left], [right]) => left.localeCompare(right))
  const encoder = new TextEncoder()
  const encoded = entries.map(([path, bytes]) => ({
    path: encoder.encode(path),
    bytes,
    hash: hexBytes(index.resources[path].sha256),
  }))
  const length =
    12 +
    encoded.reduce((total, entry) => total + 38 + entry.path.byteLength + entry.bytes.byteLength, 0)
  if (entries.length > MAX_RESOURCES || length > MAX_BUNDLE_BYTES) {
    throw new MapResolutionError('IntegrityFailure', 'resource bundle exceeds its limit')
  }
  const output = new Uint8Array(length)
  const view = new DataView(output.buffer)
  output.set(new TextEncoder().encode('RBND'), 0)
  view.setUint32(4, RESOURCE_BUNDLE_VERSION, true)
  view.setUint32(8, entries.length, true)
  let offset = 12
  for (const entry of encoded) {
    view.setUint16(offset, entry.path.byteLength, true)
    view.setUint32(offset + 2, entry.bytes.byteLength, true)
    output.set(entry.hash, offset + 6)
    output.set(entry.path, offset + 38)
    output.set(entry.bytes, offset + 38 + entry.path.byteLength)
    offset += 38 + entry.path.byteLength + entry.bytes.byteLength
  }
  return output.buffer
}

function parsePackage(bytes: ArrayBuffer): {
  manifest: DerivedMapManifest
  components: Map<string, Uint8Array>
} {
  const data = new Uint8Array(bytes)
  const view = new DataView(bytes)
  if (
    data.byteLength < 16 ||
    new TextDecoder().decode(data.subarray(0, 4)) !== 'DMAP' ||
    view.getUint32(4, true) !== PACKAGE_VERSION
  ) {
    throw new MapResolutionError(
      'IntegrityFailure',
      'worker returned an invalid Derived Map package'
    )
  }
  const manifestLength = view.getUint32(8, true)
  const count = view.getUint32(12, true)
  if (count > MAX_RESOURCES || 16 + manifestLength > data.byteLength) {
    throw new MapResolutionError(
      'IntegrityFailure',
      'Derived Map package header exceeds its limits'
    )
  }
  const manifest = validateDerivedMapManifest(
    JSON.parse(new TextDecoder().decode(data.subarray(16, 16 + manifestLength)))
  )
  const components = new Map<string, Uint8Array>()
  let offset = 16 + manifestLength
  for (let index = 0; index < count; index += 1) {
    if (offset + 8 > data.byteLength)
      throw new MapResolutionError('IntegrityFailure', 'Derived Map component header is truncated')
    const roleLength = view.getUint16(offset, true)
    const mediaLength = view.getUint16(offset + 2, true)
    const byteLength = view.getUint32(offset + 4, true)
    const end = offset + 8 + roleLength + mediaLength + byteLength
    if (end > data.byteLength)
      throw new MapResolutionError('IntegrityFailure', 'Derived Map component is truncated')
    const role = new TextDecoder().decode(data.subarray(offset + 8, offset + 8 + roleLength))
    if (components.has(role))
      throw new MapResolutionError('IntegrityFailure', `Duplicate Derived Map component ${role}`)
    components.set(role, data.slice(offset + 8 + roleLength + mediaLength, end))
    offset = end
  }
  if (offset !== data.byteLength)
    throw new MapResolutionError('IntegrityFailure', 'Derived Map package has trailing bytes')
  return { manifest, components }
}

class ConverterWorker {
  private readonly worker = new Worker(new URL('./mapConversion.worker.ts', import.meta.url), {
    type: 'module',
  })
  private nextId = 1

  private request(message: object, transfer: Transferable[]): Promise<WorkerResponse> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.id !== id) return
        this.worker.removeEventListener('message', onMessage)
        this.worker.removeEventListener('error', onError)
        event.data.kind === 'failure'
          ? reject(new MapResolutionError('ConversionFailed', event.data.message))
          : resolve(event.data)
      }
      const onError = () => {
        this.worker.removeEventListener('message', onMessage)
        reject(new MapResolutionError('ConversionFailed', 'conversion worker failed'))
      }
      this.worker.addEventListener('message', onMessage)
      this.worker.addEventListener('error', onError, { once: true })
      this.worker.postMessage({ ...message, id }, transfer)
    })
  }

  async inspect(bytes: Uint8Array): Promise<BspInspection> {
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
    const response = await this.request({ kind: 'inspect', bsp: buffer }, [buffer])
    if (response.kind !== 'inspection')
      throw new MapResolutionError('ConversionFailed', 'worker inspection response is invalid')
    const inspection = object(JSON.parse(response.json))
    const dependencies = object(inspection?.dependencies)
    if (
      !inspection ||
      typeof inspection.bspSha256 !== 'string' ||
      !SHA256.test(inspection.bspSha256) ||
      !dependencies
    ) {
      throw new MapResolutionError('IntegrityFailure', 'worker inspection is invalid')
    }
    return inspection as BspInspection
  }

  async convert(bundle: ArrayBuffer, mapName: string): Promise<ArrayBuffer> {
    const response = await this.request(
      {
        kind: 'convert',
        bundle,
        request: JSON.stringify({ mapName, sharedAssetPackVersion: SHARED_ASSET_PACK_VERSION }),
      },
      [bundle]
    )
    if (response.kind !== 'converted')
      throw new MapResolutionError('ConversionFailed', 'worker conversion response is invalid')
    return response.package
  }

  terminate() {
    this.worker.terminate()
  }
}

function conversionCapable(): boolean {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return (
    typeof Worker !== 'undefined' &&
    typeof WebAssembly !== 'undefined' &&
    !!crypto.subtle &&
    (memory === undefined || memory >= 4)
  )
}

let active:
  | {
      mapName: string
      generation: number
      abort: AbortController
      worker?: ConverterWorker
      promise: Promise<DerivedMapResult>
    }
  | undefined
let generation = 0

async function withSharedAssets(
  source: 'published' | 'cache',
  staleSource: boolean,
  manifest: DerivedMapManifest,
  components: Map<string, Uint8Array>,
  signal: AbortSignal,
  stage: (stage: MapLoadStage) => void
): Promise<DerivedMapResult> {
  const shared = await loadSharedAssets(manifest, signal, stage)
  return {
    kind: 'derived',
    source,
    staleSource,
    manifest,
    components,
    sharedIndex: shared.index,
    sharedAssets: shared.assets,
  }
}

async function resolve(
  mapName: string,
  currentGeneration: number,
  abort: AbortController,
  stage: (stage: MapLoadStage) => void,
  localOverride?: File
): Promise<DerivedMapResult> {
  if (!MAP_NAME.test(mapName))
    throw new MapResolutionError('IntegrityFailure', 'Map Name is invalid')
  const signal = abort.signal
  const source = localOverride ? null : await readSourceRecord(mapName)
  // With no source record, a map with a legacy GLB resolves to it whatever the descriptor and
  // the catalog say (below), so neither request is made: a slow or failing Serveme or
  // descriptor lookup cannot hold up or break a published map.
  if (!localOverride && !source && legacyResult(mapName)) return legacyResult(mapName)!
  const published = localOverride ? null : await publishedDescriptor(mapName, signal)
  let metadata: CatalogMetadata | null = null
  let catalogFailure: MapResolutionError | null = null
  if (!localOverride) {
    stage({ name: 'catalog' })
    try {
      metadata = await catalogMetadata(mapName, signal)
    } catch (error) {
      catalogFailure =
        error instanceof MapResolutionError
          ? error
          : new MapResolutionError('CatalogUnavailable', 'Serveme is unavailable')
    }
    if (!metadata && source) {
      if (published?.manifest.bspSha256 === source.bspSha256) {
        return withSharedAssets(
          'published',
          true,
          published.manifest,
          await loadPublished(published, signal),
          signal,
          stage
        )
      }
      const cached = await readCache(source.cacheKey)
      if (cached?.manifest.bspSha256 === source.bspSha256) {
        return withSharedAssets('cache', true, cached.manifest, cached.components, signal, stage)
      }
    }
    if (!metadata && legacyResult(mapName)) return legacyResult(mapName)!
    if (!metadata) throw catalogFailure!
    if (source && metadataMatches(source.metadata, metadata)) {
      if (published?.manifest.bspSha256 === source.bspSha256) {
        return withSharedAssets(
          'published',
          false,
          published.manifest,
          await loadPublished(published, signal),
          signal,
          stage
        )
      }
      const cached = await readCache(source.cacheKey)
      if (cached?.manifest.bspSha256 === source.bspSha256) {
        return withSharedAssets('cache', false, cached.manifest, cached.components, signal, stage)
      }
    }
    if (legacyResult(mapName)) return legacyResult(mapName)!
  }
  if (!conversionCapable())
    throw new MapResolutionError(
      'UnsupportedDevice',
      'This browser requires a Published Derived Map'
    )

  const bsp = localOverride
    ? new Uint8Array(await localOverride.arrayBuffer())
    : await downloadBsp(mapName, signal, stage)
  if (
    bsp.byteLength > MAX_BSP_BYTES ||
    bsp.byteLength < 1036 ||
    new TextDecoder().decode(bsp.subarray(0, 4)) !== 'VBSP'
  ) {
    throw new MapResolutionError('IntegrityFailure', 'Local Override is not a bounded VBSP file')
  }
  const bspHash = await sha256(bsp)
  if (published?.manifest.bspSha256 === bspHash) {
    return withSharedAssets(
      'published',
      false,
      published.manifest,
      await loadPublished(published, signal),
      signal,
      stage
    )
  }
  const knownCache = source?.bspSha256 === bspHash ? await readCache(source.cacheKey) : null
  if (knownCache)
    return withSharedAssets(
      'cache',
      false,
      knownCache.manifest,
      knownCache.components,
      signal,
      stage
    )

  stage({ name: 'inspect' })
  const worker = new ConverterWorker()
  if (!active || active.generation !== currentGeneration) {
    worker.terminate()
    throw new MapResolutionError('Cancelled', 'map load was superseded')
  }
  active.worker = worker
  try {
    const inspection = await worker.inspect(bsp)
    if (inspection.bspSha256 !== bspHash)
      throw new MapResolutionError(
        'IntegrityFailure',
        'native browser hash and converter hash differ'
      )
    const shared = await loadSharedAssets(inspection, signal, stage)
    stage({ name: 'convert' })
    const converted = parsePackage(
      await worker.convert(resourceBundle(shared.assets, shared.index), mapName)
    )
    if (converted.manifest.bspSha256 !== bspHash || converted.manifest.mapName !== mapName) {
      throw new MapResolutionError('IntegrityFailure', 'Derived Map identity differs from its BSP')
    }
    await verifiedComponents(
      converted.manifest,
      Array.from(converted.components, ([role, bytes]) => ({ role, bytes }))
    )
    if (!active || active.generation !== currentGeneration)
      throw new MapResolutionError('Cancelled', 'map load was superseded')
    stage({ name: 'cache' })
    try {
      await storeCache(converted.manifest, converted.components)
      if (!localOverride && metadata) {
        await localforage.setItem(sourceKey(mapName), {
          mapName,
          bspSha256: bspHash,
          metadata,
          cacheKey: cacheKey(converted.manifest),
        } satisfies SourceRecord)
      }
    } catch {
      // Cache is best-effort; the verified in-memory result remains usable.
    }
    return {
      kind: 'derived',
      source: localOverride ? 'localOverride' : 'generated',
      staleSource: false,
      manifest: converted.manifest,
      components: converted.components,
      sharedIndex: shared.index,
      sharedAssets: shared.assets,
    }
  } finally {
    worker.terminate()
  }
}

export function resolveDerivedMap(
  mapName: string,
  stage: (stage: MapLoadStage) => void = () => undefined,
  localOverride?: File
): Promise<DerivedMapResult> {
  if (!localOverride && active?.mapName === mapName) return active.promise
  active?.abort.abort()
  active?.worker?.terminate()
  const abort = new AbortController()
  const currentGeneration = ++generation
  const promise = resolve(mapName, currentGeneration, abort, stage, localOverride)
  active = { mapName, generation: currentGeneration, abort, promise }
  return promise
}

export function cancelDerivedMapResolution() {
  active?.abort.abort()
  active?.worker?.terminate()
  active = undefined
}

export function textComponent(
  result: Extract<DerivedMapResult, { kind: 'derived' }>,
  role: string
): unknown {
  const bytes = result.components.get(role)
  return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null
}
