import { TogglePanel, TogglePanelButton } from '@components/UI/Shared/TogglePanel'
import { BsBookmarkFillIcon, FaTrashIcon } from '@components/Misc/Icons'

import { useStore } from '@zus/store'
import {
  toggleUIPanelAction,
  goToTickAction,
  removeBookmarkAction,
  clearBookmarksAction,
} from '@zus/actions'
import { getDurationFromTicks } from '@utils/parser'
import { focusMainCanvas } from '@utils/misc'
import { cn } from '@utils/styling'

export const BookmarksPanel = () => {
  const isOpen = useStore(state => state.ui.activePanels.includes('Bookmarks'))
  const bookmarks = useStore(state => state.bookmarks)
  const tick = useStore(state => state.playback.tick)

  const toggleUIPanel = () => {
    toggleUIPanelAction('Settings', false)
    toggleUIPanelAction('About', false)
    toggleUIPanelAction('MatchKillfeed', false)
    toggleUIPanelAction('Bookmarks')
  }

  const seekToTick = (bookmarkTick: number) => {
    goToTickAction(bookmarkTick)
    focusMainCanvas()
  }

  return (
    <div className="flex items-start">
      <TogglePanelButton onClick={toggleUIPanel}>
        <BsBookmarkFillIcon />
      </TogglePanelButton>

      <TogglePanel showCloseButton isOpen={isOpen} onClickClose={toggleUIPanel}>
        <div className="w-[min(280px,calc(100vw-2rem))] px-6 pb-6 pt-6">
          <div className="mb-3 mr-8 flex items-center justify-between">
            <div className="text-sm font-semibold">
              Bookmarks ({bookmarks.length})
            </div>

            {bookmarks.length > 0 && (
              <button
                className="text-xs text-white/50 transition-colors hover:text-white"
                onClick={clearBookmarksAction}
              >
                Clear all
              </button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {bookmarks.length === 0 ? (
              <div className="py-4 text-center text-xs text-white/40">
                No bookmarks yet. Press <kbd className="mx-1">B</kbd> to bookmark current tick.
              </div>
            ) : (
              bookmarks.map(bookmarkTick => (
                <div
                  key={`bookmark-row-${bookmarkTick}`}
                  className={cn(
                    'mb-0.5 flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-white/10 active:bg-white/10',
                    bookmarkTick === tick && 'bg-amber-400/20'
                  )}
                  onClick={() => seekToTick(bookmarkTick)}
                >
                  <div className="flex items-center gap-3">
                    <BsBookmarkFillIcon className="flex-shrink-0 text-amber-400" />
                    <span className="font-mono text-white/50">
                      {getDurationFromTicks(bookmarkTick).formatted}
                    </span>
                    <span>Tick {bookmarkTick}</span>
                  </div>

                  <button
                    className="flex-shrink-0 rounded p-1 text-white/25 transition-colors hover:text-white"
                    onClick={e => {
                      e.stopPropagation()
                      removeBookmarkAction(bookmarkTick)
                    }}
                  >
                    <FaTrashIcon className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </TogglePanel>
    </div>
  )
}
