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
import { CLASS_ORDER_MAP } from '@constants/mappings'
import { StickerTeam } from '@constants/types'
import { cn } from '@utils/styling'

const STICKER_CLASS_IDS = Object.entries(CLASS_ORDER_MAP)
  .filter(([classId]) => classId !== '0')
  .sort(([, leftOrder], [, rightOrder]) => leftOrder - rightOrder)
  .map(([classId]) => Number(classId))

const STICKER_TEAM_STYLES: Record<StickerTeam, string> = {
  red: 'bg-[#cf4a2e]/20 border-[#cf4a2e]/70 hover:bg-[#cf4a2e]/30',
  blue: 'bg-[#5885a2]/20 border-[#5885a2]/70 hover:bg-[#5885a2]/30',
}

export const StickerPalette = () => {
  const stickerHistory = useStore(state => state.drawing.stickerHistory)
  const selectedStickerId = useStore(state => state.drawing.selectedStickerId)
  const stickerDrag = useStore(state => state.drawing.stickerDrag)

  const handleStartStickerDrag =
    (classId: number, team: StickerTeam) => (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return

      event.preventDefault()

      startStickerDragAction({
        kind: 'create',
        stickerClassId: classId,
        stickerTeam: team,
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
              const isDraggingThisSticker =
                stickerDrag.active &&
                stickerDrag.kind === 'create' &&
                stickerDrag.stickerClassId === classId &&
                stickerDrag.stickerTeam === team

              return (
                <button
                  key={`sticker-palette-${team}-${classId}`}
                  className={cn(
                    'cursor-grab rounded-full border p-2 transition-all hover:scale-105 active:scale-95',
                    STICKER_TEAM_STYLES[team],
                    isDraggingThisSticker && 'scale-105 cursor-grabbing border-white bg-white/20'
                  )}
                  onPointerDown={handleStartStickerDrag(classId, team)}
                  aria-label={`Drag ${team} class ${classId} sticker`}
                >
                  <ClassIcon classId={classId} size={22} />
                </button>
              )
            })}
          </div>
        ))}
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
