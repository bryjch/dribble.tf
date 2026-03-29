import { ClassIcon } from '@components/UI/ClassIcon'
import { FaRedoIcon, FaTrashIcon, FaUndoIcon } from '@components/Misc/Icons'

import { useStore } from '@zus/store'
import {
  clearStickersAction,
  deleteSelectedStickerAction,
  redoStickersAction,
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

export const StickerPalette = () => {
  const stickerHistory = useStore(state => state.drawing.stickerHistory)
  const selectedStickerId = useStore(state => state.drawing.selectedStickerId)
  const stickerDrag = useStore(state => state.drawing.stickerDrag)

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
      'inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition-all',
      enabled ? 'hover:scale-105 hover:bg-white/20' : 'cursor-default opacity-40'
    )

  return (
    <div
      data-sticker-panel="true"
      className="w-auto rounded-[28px] border border-white/10 bg-black/75 p-4 text-white shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur"
    >
      <div className="grid gap-3">
        {(['blue', 'red'] as StickerTeam[]).map(team => (
          <div key={`sticker-palette-${team}`} className="flex flex-nowrap gap-2">
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
                    'cursor-grab rounded-full border p-2 transition-all hover:scale-105 active:scale-95',
                    STICKER_TEAM_STYLES[team],
                    isDraggingThisSticker && 'scale-105 cursor-grabbing border-white bg-white/20'
                  )}
                  onPointerDown={handleStartStickerDrag(sticker)}
                  aria-label={`Drag ${team} class ${classId} sticker`}
                >
                  <ClassIcon classId={classId} size={22} />
                </button>
              )
            })}
          </div>
        ))}

        <div className="flex flex-nowrap justify-start gap-2 border-t border-white/10 pt-3">
          {SYMBOL_STICKERS.map(({ sticker, buttonClassName, label }) => {
            const isDraggingThisSticker =
              stickerDrag.active &&
              stickerDrag.kind === 'create' &&
              isSameStickerDefinition(stickerDrag.sticker, sticker)

            return (
              <button
                key={`sticker-palette-${sticker.symbol}`}
                className={cn(
                  'inline-flex h-[38px] w-[38px] cursor-grab items-center justify-center self-start rounded-full border p-2 transition-all hover:scale-105 active:scale-95',
                  buttonClassName,
                  isDraggingThisSticker && 'scale-105 cursor-grabbing border-white bg-white/20'
                )}
                onPointerDown={handleStartStickerDrag(sticker)}
                aria-label={`Drag ${label} sticker`}
              >
                <StickerSymbolIcon symbol={sticker.symbol} className="h-[22px] w-[22px]" />
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-left text-xs uppercase tracking-[0.1em] text-white/60">
          Drag & drop onto scene
        </div>

        <div className="flex items-center gap-2">
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
              'rounded-full border border-white/10 px-4 py-2 text-sm font-semibold transition-all',
              stickerHistory.present.length > 0
                ? 'bg-white/10 hover:bg-white/20'
                : 'cursor-default bg-white/5 opacity-40'
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
