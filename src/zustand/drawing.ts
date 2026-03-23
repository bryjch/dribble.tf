import { DEFAULT_BRUSH_COLOR, DEFAULT_BRUSH_RADIUS } from '@constants/drawing'
import { DrawingTool, StickerAnnotation, StickerTeam } from '@constants/types'
import { HistoryState, createHistoryState } from '@utils/history'

export type StickerDragKind = 'create' | 'move'

export type StickerDragState = {
  active: boolean
  kind?: StickerDragKind
  stickerId?: string
  stickerClassId?: number
  stickerTeam?: StickerTeam
  screenX: number
  screenY: number
}

export type DrawingState = {
  enabled: boolean
  tool: DrawingTool
  brushColor: string
  brushRadius: number
  stickersPanelOpen: boolean
  selectedStickerId?: string
  stickerHistory: HistoryState<StickerAnnotation[]>
  stickerDrag: StickerDragState
}

export function createInitialStickerDragState(): StickerDragState {
  return {
    active: false,
    kind: undefined,
    stickerId: undefined,
    stickerClassId: undefined,
    stickerTeam: undefined,
    screenX: 0,
    screenY: 0,
  }
}

export function createInitialDrawingState(): DrawingState {
  return {
    enabled: false,
    tool: DrawingTool.BRUSH,
    brushColor: DEFAULT_BRUSH_COLOR,
    brushRadius: DEFAULT_BRUSH_RADIUS,
    stickersPanelOpen: false,
    selectedStickerId: undefined,
    stickerHistory: createHistoryState<StickerAnnotation[]>([]),
    stickerDrag: createInitialStickerDragState(),
  }
}
