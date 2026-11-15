import { TogglePanel, TogglePanelButton } from '@components/UI/Shared/TogglePanel'
import { BsBookmarkFillIcon, FaTrashIcon } from '@components/Misc/Icons'

import { useStore } from '@zus/store'
import {
  toggleOnlyUIPanelAction,
  goToTickAction,
  removeBookmarkAction,
  clearBookmarksAction,
} from '@zus/actions'
import { getDurationFromTicks } from '@utils/parser'
import { focusMainCanvas } from '@utils/misc'

export const BookmarksPanel = () => {
  const isOpen = useStore(state => state.ui.activePanels.includes('Bookmarks'))
  const bookmarks = useStore(state => state.bookmarks)

  const toggleUIPanel = () => toggleOnlyUIPanelAction('Bookmarks')

  return (
    <div className="flex items-start">
      <TogglePanelButton onClick={toggleUIPanel} active={isOpen} label="Bookmarks">
        <BsBookmarkFillIcon />
      </TogglePanelButton>

      <TogglePanel
        className="w-[min(300px,calc(100vw-5rem))]"
        title="Bookmarks"
        count={bookmarks.length}
        actions={
          bookmarks.length > 0 && (
            <button className="ui-btn ui-btn--ghost ui-btn--small" onClick={clearBookmarksAction}>
              Clear all
            </button>
          )
        }
        showCloseButton
        isOpen={isOpen}
        onClickClose={toggleUIPanel}
      >
        <BookmarksContent />
      </TogglePanel>
    </div>
  )
}

/** The bookmarks list, shared by the desktop panel and the phone sheets. */
export const BookmarksContent = () => {
  const bookmarks = useStore(state => state.bookmarks)
  const tick = useStore(state => state.playback.tick)

  const seekToTick = (bookmarkTick: number) => {
    goToTickAction(bookmarkTick)
    focusMainCanvas()
  }

  return (
    <>
      {bookmarks.length === 0 ? (
        <div className="ui-empty-note">
          No bookmarks yet. Press <kbd className="mx-0.5">B</kbd> to mark the current tick.
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {bookmarks.map(bookmarkTick => (
            <div
              key={`bookmark-row-${bookmarkTick}`}
              className="ui-list-row"
              data-active={bookmarkTick === tick}
              onClick={() => seekToTick(bookmarkTick)}
            >
              <BsBookmarkFillIcon className="flex-shrink-0 text-ui-warn" />
              <span className="ui-time">{getDurationFromTicks(bookmarkTick).formatted}</span>
              <span className="flex-1">Tick {bookmarkTick}</span>

              <button
                className="ui-icon-btn"
                aria-label={`Remove bookmark at tick ${bookmarkTick}`}
                onClick={e => {
                  e.stopPropagation()
                  removeBookmarkAction(bookmarkTick)
                }}
              >
                <FaTrashIcon className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
