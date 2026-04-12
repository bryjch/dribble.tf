import {
  SavedSetup,
  SavedSetupCamera,
  SETUP_STORAGE_VERSION,
  StickerAnnotation,
  StickerSymbol,
  StickerTeam,
} from '@constants/types'
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'

const SETUP_HASH_PARAM = 's'

type CameraWire =
  | ['r', [number, number, number], [number, number, number]]
  | ['s', [number, number, number], [number, number, number, number]]

type StickerWire =
  | ['c', number, 'r' | 'b', [number, number, number]]
  | ['s', string, [number, number, number]]

type SharedSetupPayload = {
  v: typeof SETUP_STORAGE_VERSION
  n: string
  m: string
  c: CameraWire
  s: StickerWire[]
}

type SupportedStickerSymbol = typeof StickerSymbol[keyof typeof StickerSymbol]

const TEAM_TO_CODE: Record<StickerTeam, 'r' | 'b'> = {
  red: 'r',
  blue: 'b',
}

const CODE_TO_TEAM: Record<'r' | 'b', StickerTeam> = {
  r: 'red',
  b: 'blue',
}

const SYMBOL_TO_CODE: Record<string, string> = {
  [StickerSymbol.A]: 'a',
  [StickerSymbol.B]: 'b',
  [StickerSymbol.C]: 'c',
  [StickerSymbol.GREEN_TICK]: 'g',
  [StickerSymbol.RED_X]: 'x',
}

const CODE_TO_SYMBOL: Record<string, string> = {
  a: StickerSymbol.A,
  b: StickerSymbol.B,
  c: StickerSymbol.C,
  g: StickerSymbol.GREEN_TICK,
  x: StickerSymbol.RED_X,
}

export function createSetupId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `setup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function cloneSetupCamera(camera: SavedSetupCamera): SavedSetupCamera {
  if (camera.mode === 'rts') {
    return {
      mode: 'rts',
      position: [...camera.position] as [number, number, number],
      target: [...camera.target] as [number, number, number],
    }
  }

  return {
    mode: 'spectator',
    position: [...camera.position] as [number, number, number],
    quaternion: [...camera.quaternion] as [number, number, number, number],
  }
}

export function cloneSetupStickers(stickers: StickerAnnotation[]): StickerAnnotation[] {
  return stickers.map(sticker => ({
    ...sticker,
    position: [...sticker.position] as [number, number, number],
  }))
}

export function parseSetupHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const token = params.get(SETUP_HASH_PARAM)
  return token && token.length > 0 ? token : null
}

export function buildSetupShareUrl(setup: SavedSetup): string {
  const token = serializeSetupToShareToken(setup)
  const url = new URL(window.location.origin + window.location.pathname)
  url.hash = `${SETUP_HASH_PARAM}=${token}`
  return url.toString()
}

export function serializeSetupToShareToken(setup: SavedSetup): string {
  const payload: SharedSetupPayload = {
    v: SETUP_STORAGE_VERSION,
    n: setup.name,
    m: setup.map,
    c: encodeCamera(setup.camera),
    s: setup.stickers.map(encodeSticker),
  }

  return compressToEncodedURIComponent(JSON.stringify(payload))
}

export function deserializeSetupFromShareToken(token: string): SavedSetup | null {
  try {
    const json = decompressFromEncodedURIComponent(token)
    if (!json) return null

    const payload = JSON.parse(json) as SharedSetupPayload

    if (payload?.v !== SETUP_STORAGE_VERSION) {
      return null
    }

    if (!isNonEmptyString(payload.n) || !isNonEmptyString(payload.m) || !Array.isArray(payload.s)) {
      return null
    }

    const camera = decodeCamera(payload.c)
    if (!camera) return null

    const stickers = payload.s
      .map(decodeSticker)
      .filter((sticker): sticker is StickerAnnotation => sticker !== null)

    const timestamp = Date.now()

    return {
      id: createSetupId(),
      version: SETUP_STORAGE_VERSION,
      name: payload.n,
      map: payload.m,
      camera,
      stickers,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  } catch (error) {
    console.warn('Failed to decode shared setup from URL hash.', error)
    return null
  }
}

export function normalizeStoredSetups(rawValue: unknown): SavedSetup[] {
  if (!Array.isArray(rawValue)) {
    return []
  }

  return rawValue
    .map(normalizeStoredSetup)
    .filter((setup): setup is SavedSetup => setup !== null)
}

function normalizeStoredSetup(rawValue: unknown): SavedSetup | null {
  if (!rawValue || typeof rawValue !== 'object') {
    return null
  }

  const candidate = rawValue as Partial<SavedSetup>
  const camera = normalizeStoredCamera(candidate.camera)

  if (
    candidate.version !== SETUP_STORAGE_VERSION ||
    !isNonEmptyString(candidate.id) ||
    !isNonEmptyString(candidate.name) ||
    !isNonEmptyString(candidate.map) ||
    !camera ||
    !Array.isArray(candidate.stickers) ||
    typeof candidate.createdAt !== 'number' ||
    typeof candidate.updatedAt !== 'number'
  ) {
    return null
  }

  const stickers = candidate.stickers
    .map(normalizeStoredSticker)
    .filter((sticker): sticker is StickerAnnotation => sticker !== null)

  return {
    id: candidate.id,
    version: SETUP_STORAGE_VERSION,
    name: candidate.name,
    map: candidate.map,
    camera,
    stickers,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  }
}

function normalizeStoredCamera(rawValue: unknown): SavedSetupCamera | null {
  if (!rawValue || typeof rawValue !== 'object') {
    return null
  }

  const candidate = rawValue as SavedSetupCamera

  if (candidate.mode === 'rts') {
    return isNumberTuple(candidate.position, 3) && isNumberTuple(candidate.target, 3)
      ? {
          mode: 'rts',
          position: [...candidate.position] as [number, number, number],
          target: [...candidate.target] as [number, number, number],
        }
      : null
  }

  if (candidate.mode === 'spectator') {
    return isNumberTuple(candidate.position, 3) && isNumberTuple(candidate.quaternion, 4)
      ? {
          mode: 'spectator',
          position: [...candidate.position] as [number, number, number],
          quaternion: [...candidate.quaternion] as [number, number, number, number],
        }
      : null
  }

  return null
}

function normalizeStoredSticker(rawValue: unknown): StickerAnnotation | null {
  if (!rawValue || typeof rawValue !== 'object') {
    return null
  }

  const candidate = rawValue as Partial<StickerAnnotation>
  if (!isNumberTuple(candidate.position, 3)) {
    return null
  }

  if (candidate.kind === 'class') {
    if (
      typeof candidate.classId !== 'number' ||
      (candidate.team !== 'red' && candidate.team !== 'blue')
    ) {
      return null
    }

    return {
      id: isNonEmptyString(candidate.id) ? candidate.id : createSetupId(),
      kind: 'class',
      classId: candidate.classId,
      team: candidate.team,
      position: [...candidate.position] as [number, number, number],
    }
  }

  if (candidate.kind === 'symbol') {
    if (!isNonEmptyString(candidate.symbol) || !isSupportedStickerSymbol(candidate.symbol)) {
      return null
    }

    return {
      id: isNonEmptyString(candidate.id) ? candidate.id : createSetupId(),
      kind: 'symbol',
      symbol: candidate.symbol,
      position: [...candidate.position] as [number, number, number],
    }
  }

  return null
}

function encodeCamera(camera: SavedSetupCamera): CameraWire {
  if (camera.mode === 'rts') {
    return [
      'r',
      roundTuple(camera.position, 1, 3) as [number, number, number],
      roundTuple(camera.target, 1, 3) as [number, number, number],
    ]
  }

  return [
    's',
    roundTuple(camera.position, 1, 3) as [number, number, number],
    roundTuple(camera.quaternion, 4, 4) as [number, number, number, number],
  ]
}

function decodeCamera(rawValue: unknown): SavedSetupCamera | null {
  if (!Array.isArray(rawValue) || rawValue.length !== 3) {
    return null
  }

  const [mode, position, extra] = rawValue

  if (mode === 'r' && isNumberTuple(position, 3) && isNumberTuple(extra, 3)) {
    return {
      mode: 'rts',
      position: [...position] as [number, number, number],
      target: [...extra] as [number, number, number],
    }
  }

  if (mode === 's' && isNumberTuple(position, 3) && isNumberTuple(extra, 4)) {
    return {
      mode: 'spectator',
      position: [...position] as [number, number, number],
      quaternion: [...extra] as [number, number, number, number],
    }
  }

  return null
}

function encodeSticker(sticker: StickerAnnotation): StickerWire {
  if (sticker.kind === 'class') {
    return [
      'c',
      sticker.classId,
      TEAM_TO_CODE[sticker.team],
      roundTuple(sticker.position, 1, 3) as [number, number, number],
    ]
  }

  return [
    's',
    SYMBOL_TO_CODE[sticker.symbol] ?? sticker.symbol,
    roundTuple(sticker.position, 1, 3) as [number, number, number],
  ]
}

function decodeSticker(rawValue: unknown): StickerAnnotation | null {
  if (!Array.isArray(rawValue)) {
    return null
  }

  if (
    rawValue[0] === 'c' &&
    typeof rawValue[1] === 'number' &&
    (rawValue[2] === 'r' || rawValue[2] === 'b') &&
    isNumberTuple(rawValue[3], 3)
  ) {
    return {
      id: createSetupId(),
      kind: 'class',
      classId: rawValue[1],
      team: CODE_TO_TEAM[rawValue[2] as 'r' | 'b'],
      position: [...rawValue[3]] as [number, number, number],
    }
  }

  if (
    rawValue[0] === 's' &&
    isNonEmptyString(rawValue[1]) &&
    isNumberTuple(rawValue[2], 3) &&
    CODE_TO_SYMBOL[rawValue[1]]
  ) {
    return {
      id: createSetupId(),
      kind: 'symbol',
      symbol: CODE_TO_SYMBOL[rawValue[1]] as SupportedStickerSymbol,
      position: [...rawValue[2]] as [number, number, number],
    }
  }

  return null
}

function roundTuple(values: number[], decimals: number, size: number): number[] {
  return values.slice(0, size).map(value => roundNumber(value, decimals))
}

function roundNumber(value: number, decimals: number): number {
  const multiplier = 10 ** decimals
  return Math.round(value * multiplier) / multiplier
}

function isNumberTuple(value: unknown, size: number): value is number[] {
  return Array.isArray(value) && value.length === size && value.every(item => typeof item === 'number')
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSupportedStickerSymbol(value: string): boolean {
  return Object.values(StickerSymbol).includes(value as SupportedStickerSymbol)
}
