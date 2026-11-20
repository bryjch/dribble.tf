import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { ClassIcon } from '@components/UI/ClassIcon'
import { FaRedoIcon, FaTrashIcon, FaUndoIcon } from '@components/Misc/Icons'

import { useStore } from '@zus/store'
import {
  clearStickersAction,
  deleteSelectedStickerAction,
  redoStickersAction,
  setStickersPanelOpenAction,
  startStickerDragAction,
  undoStickersAction,
} from '@zus/actions'
import { STICKER_CLASS_IDS, isSameStickerDefinition } from '@constants/stickers'
import {
  StickerDefinition,
  StickerSymbol,
  StickerTeam,
  SymbolStickerDefinition,
} from '@constants/types'
import { cn } from '@utils/styling'

const STICKER_TEAM_STYLES: Record<StickerTeam, string> = {
  red: 'bg-[#cf4a2e]/20 border-[#cf4a2e]/70 hover:bg-[#cf4a2e]/30',
  blue: 'bg-[#5885a2]/20 border-[#5885a2]/70 hover:bg-[#5885a2]/30',
}

const SYMBOL_STICKERS: {
  sticker: SymbolStickerDefinition
  buttonClassName: string
  label: string
}[] = [
  {
    sticker: { kind: 'symbol', symbol: StickerSymbol.A },
    buttonClassName: 'bg-[#7b61ff]/20 border-[#7b61ff]/70 hover:bg-[#7b61ff]/30',
    label: 'A',
  },
  {
    sticker: { kind: 'symbol', symbol: StickerSymbol.B },
    buttonClassName: 'bg-[#3b82f6]/20 border-[#3b82f6]/70 hover:bg-[#3b82f6]/30',
    label: 'B',
  },
  {
    sticker: { kind: 'symbol', symbol: StickerSymbol.C },
    buttonClassName: 'bg-[#f59e0b]/20 border-[#f59e0b]/70 hover:bg-[#f59e0b]/30',
    label: 'C',
  },
  {
    sticker: { kind: 'symbol', symbol: StickerSymbol.GREEN_TICK },
    buttonClassName: 'bg-[#2aa65a]/20 border-[#2aa65a]/70 hover:bg-[#2aa65a]/30',
    label: 'green tick',
  },
  {
    sticker: { kind: 'symbol', symbol: StickerSymbol.RED_X },
    buttonClassName: 'bg-[#d84a45]/20 border-[#d84a45]/70 hover:bg-[#d84a45]/30',
    label: 'red X',
  },
]

type Offset = { x: number; y: number }

/** Space kept between a dragged palette and the window's edges, in px. */
const EDGE_MARGIN = 8

/**
 * Where the palette was dragged to, per size, so closing and reopening it keeps the spot. Kept in
 * memory only: the spot is an offset from where the layout puts the palette, which a reload, a
 * resize or another theme can change.
 */
const rememberedOffsets: Record<'full' | 'compact', Offset> = {
  full: { x: 0, y: 0 },
  compact: { x: 0, y: 0 },
}

const clampNumber = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, Math.max(min, max)))

/**
 * The area the palette may be dragged within: the 3D view, so it can't slip under the match events
 * sidebar beside it (which sits above the view). The window when there is no view.
 */
function getDragBounds() {
  const canvas = document.getElementById('main-canvas')
  if (canvas) return canvas.getBoundingClientRect()
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
}

/**
 * Drag the palette by its header. The offset moves it from where the layout puts it, and stays
 * within the 3D view (checked again when the window resizes).
 */
function usePanelDrag(size: 'full' | 'compact') {
  const panelRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState<Offset>(rememberedOffsets[size])
  const offsetRef = useRef(offset)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; from: Offset } | null>(null)
  const [dragging, setDragging] = useState(false)

  const apply = (next: Offset) => {
    const panel = panelRef.current
    if (panel) {
      const rect = panel.getBoundingClientRect()
      // Where the layout puts the panel, without the offset.
      const left = rect.left - offsetRef.current.x
      const top = rect.top - offsetRef.current.y
      const bounds = getDragBounds()
      next = {
        x: clampNumber(
          next.x,
          bounds.left + EDGE_MARGIN - left,
          bounds.right - EDGE_MARGIN - rect.width - left
        ),
        y: clampNumber(
          next.y,
          bounds.top + EDGE_MARGIN - top,
          bounds.bottom - EDGE_MARGIN - rect.height - top
        ),
      }
    }
    offsetRef.current = next
    rememberedOffsets[size] = next
    setOffset(next)
  }

  // A remembered spot may be off screen now (the window shrank since).
  useLayoutEffect(() => apply(offsetRef.current), [])

  useEffect(() => {
    const onResize = () => apply(offsetRef.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const handleProps = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || dragRef.current) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        from: offsetRef.current,
      }
      setDragging(true)
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      apply({ x: drag.from.x + event.clientX - drag.x, y: drag.from.y + event.clientY - drag.y })
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) return
      dragRef.current = null
      setDragging(false)
    },
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) return
      dragRef.current = null
      setDragging(false)
    },
    onDoubleClick: () => apply({ x: 0, y: 0 }),
  }

  return { panelRef, offset, dragging, handleProps }
}

/**
 * The stickers: drag one onto the scene to place it. `compact` is the phone size, narrow enough
 * for a phone held upright. Drag the header to move the palette; double-click it to put it back.
 */
export const StickerPalette = ({ compact = false }: { compact?: boolean }) => {
  const stickerHistory = useStore(state => state.drawing.stickerHistory)
  const selectedStickerId = useStore(state => state.drawing.selectedStickerId)
  const stickerDrag = useStore(state => state.drawing.stickerDrag)
  const { panelRef, offset, dragging, handleProps } = usePanelDrag(compact ? 'compact' : 'full')

  const handleStartStickerDrag =
    (sticker: StickerDefinition) => (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return

      event.preventDefault()

      startStickerDragAction({
        kind: 'create',
        sticker,
        screenX: event.clientX,
        screenY: event.clientY,
      })
    }

  const actionButtonClass = (enabled: boolean = true) =>
    cn(
      'ui-btn !p-0',
      compact ? 'h-[34px] w-[34px]' : 'h-9 w-9',
      !enabled && 'cursor-default opacity-40'
    )

  // touch-none: a touch that starts on a sticker drags it, rather than scrolling the page.
  const stickerButtonClass = cn(
    'inline-flex shrink-0 cursor-grab touch-none items-center justify-center rounded-full border transition-all hover:scale-105 active:scale-95',
    compact ? 'h-[33px] w-[33px]' : 'h-[38px] w-[38px]'
  )
  const iconSize = compact ? 20 : 22

  return (
    <div
      ref={panelRef}
      data-sticker-panel="true"
      className={cn('hud-palette w-auto', compact ? 'p-[12px]' : 'p-4')}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <div
        className={cn(
          'hud-palette__handle -mt-1 mb-2 flex touch-none select-none items-center gap-2',
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        )}
        title="Drag to move. Double-click to put it back"
        {...handleProps}
      >
        <GripGlyph />
        <span className="ui-section-title !m-0 text-left">Stickers</span>
        {/* No room for the hint beside the buttons below on a phone: it goes up here */}
        <span className="ui-muted flex-1 truncate text-left text-[11px]">
          {compact && 'Drag onto the scene'}
        </span>
        <button
          type="button"
          className={cn('ui-btn !p-0', compact ? 'h-[30px] w-[30px]' : 'h-7 w-7')}
          onPointerDown={event => event.stopPropagation()}
          onClick={() => setStickersPanelOpenAction(false)}
          aria-label="Close stickers"
        >
          <CloseGlyph />
        </button>
      </div>

      <div className={cn('grid', compact ? 'gap-[8px]' : 'gap-3')}>
        {(['blue', 'red'] as StickerTeam[]).map(team => (
          <div
            key={`sticker-palette-${team}`}
            className={cn('flex flex-nowrap', compact ? 'gap-[3px]' : 'gap-2')}
          >
            {STICKER_CLASS_IDS.map(classId => {
              const sticker: StickerDefinition = { kind: 'class', classId, team }
              const isDraggingThisSticker =
                stickerDrag.active &&
                stickerDrag.kind === 'create' &&
                isSameStickerDefinition(stickerDrag.sticker, sticker)

              return (
                <button
                  key={`sticker-palette-${team}-${classId}`}
                  className={cn(
                    stickerButtonClass,
                    STICKER_TEAM_STYLES[team],
                    isDraggingThisSticker && 'scale-105 cursor-grabbing border-white bg-white/20'
                  )}
                  onPointerDown={handleStartStickerDrag(sticker)}
                  aria-label={`Drag ${team} class ${classId} sticker`}
                >
                  <ClassIcon classId={classId} size={iconSize} />
                </button>
              )
            })}
          </div>
        ))}

        <div
          className={cn(
            'flex flex-nowrap justify-start border-t border-ui-line/15',
            compact ? 'gap-[3px] pt-[8px]' : 'gap-2 pt-3'
          )}
        >
          {SYMBOL_STICKERS.map(({ sticker, buttonClassName, label }) => {
            const isDraggingThisSticker =
              stickerDrag.active &&
              stickerDrag.kind === 'create' &&
              isSameStickerDefinition(stickerDrag.sticker, sticker)

            return (
              <button
                key={`sticker-palette-${sticker.symbol}`}
                className={cn(
                  stickerButtonClass,
                  'self-start p-2',
                  buttonClassName,
                  isDraggingThisSticker && 'scale-105 cursor-grabbing border-white bg-white/20'
                )}
                onPointerDown={handleStartStickerDrag(sticker)}
                aria-label={`Drag ${label} sticker`}
              >
                <StickerSymbolIcon
                  symbol={sticker.symbol}
                  className={compact ? 'h-[18px] w-[18px]' : 'h-[22px] w-[22px]'}
                />
              </button>
            )
          })}
        </div>
      </div>

      <div
        className={cn(
          'flex items-center gap-3',
          compact ? 'mt-[12px] justify-end' : 'mt-4 justify-between'
        )}
      >
        {!compact && <div className="ui-section-title !m-0 text-left">Drag & drop onto scene</div>}

        <div className={cn('flex items-center', compact ? 'gap-[6px]' : 'gap-2')}>
          <button
            className={actionButtonClass(stickerHistory.past.length > 0)}
            onClick={() => undoStickersAction()}
            disabled={stickerHistory.past.length === 0}
            aria-label="Undo sticker action"
          >
            <FaUndoIcon />
          </button>

          <button
            className={actionButtonClass(stickerHistory.future.length > 0)}
            onClick={() => redoStickersAction()}
            disabled={stickerHistory.future.length === 0}
            aria-label="Redo sticker action"
          >
            <FaRedoIcon />
          </button>

          <button
            className={actionButtonClass(!!selectedStickerId)}
            onClick={() => deleteSelectedStickerAction()}
            disabled={!selectedStickerId}
            aria-label="Delete selected sticker"
          >
            <FaTrashIcon className="h-4 w-4" />
          </button>

          <button
            className={cn(
              'ui-btn',
              compact && 'h-[34px] !px-[10px]',
              stickerHistory.present.length === 0 && 'cursor-default opacity-40'
            )}
            onClick={() => clearStickersAction()}
            disabled={stickerHistory.present.length === 0}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}

const GripGlyph = () => (
  <svg
    viewBox="0 0 10 16"
    width="10"
    height="16"
    className="shrink-0 opacity-50"
    aria-hidden="true"
  >
    {[3, 8, 13].map(y => (
      <g key={y} fill="currentColor">
        <circle cx="2.5" cy={y} r="1.4" />
        <circle cx="7.5" cy={y} r="1.4" />
      </g>
    ))}
  </svg>
)

const CloseGlyph = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
    <path d="M6 6 18 18M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
)

const StickerSymbolIcon = ({
  symbol,
  className,
}: {
  symbol: StickerSymbol
  className?: string
}) => {
  if (symbol === StickerSymbol.A || symbol === StickerSymbol.B || symbol === StickerSymbol.C) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <text
          x="12"
          y="16"
          fill="currentColor"
          fontSize="13"
          fontWeight="700"
          textAnchor="middle"
          fontFamily="Arial, sans-serif"
        >
          {symbol.toUpperCase()}
        </text>
      </svg>
    )
  }

  if (symbol === StickerSymbol.GREEN_TICK) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path
          d="M5 12.5 9.5 17 19 7.5"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
