import { CLASS_ORDER_MAP } from './mappings'
import { StickerDefinition } from './types'

export const STICKER_CLASS_IDS = Object.entries(CLASS_ORDER_MAP)
  .filter(([classId]) => classId !== '0')
  .sort(([, leftOrder], [, rightOrder]) => leftOrder - rightOrder)
  .map(([classId]) => Number(classId))

export function isSameStickerDefinition(
  left?: StickerDefinition,
  right?: StickerDefinition
): boolean {
  if (!left || !right || left.kind !== right.kind) return false

  if (left.kind === 'class' && right.kind === 'class') {
    return left.classId === right.classId && left.team === right.team
  }

  return left.kind === 'symbol' && right.kind === 'symbol' && left.symbol === right.symbol
}
