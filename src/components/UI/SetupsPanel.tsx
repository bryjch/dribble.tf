import { useEffect, useState } from 'react'

import { TogglePanel, TogglePanelButton } from '@components/UI/Shared/TogglePanel'
import { HiListBulletIcon, FaTrashIcon } from '@components/Misc/Icons'

import { useStore } from '@zus/store'
import {
  applySetupByIdAction,
  copySetupShareUrlAction,
  deleteSetupAction,
  renameSetupAction,
  saveCurrentSetupAction,
  setSetupDraftNameAction,
  toggleUIPanelAction,
  updateSetupFromCurrentAction,
} from '@zus/actions'
import { focusMainCanvas } from '@utils/misc'
import { cn } from '@utils/styling'

export const SetupsPanel = () => {
  const isOpen = useStore(state => state.ui.activePanels.includes('Setups'))
  const draftName = useStore(state => state.setups.draftName)
  const setups = useStore(state => state.setups.items)
  const [editingSetupId, setEditingSetupId] = useState<string>()
  const [editingName, setEditingName] = useState('')

  useEffect(() => {
    if (!editingSetupId) return
    if (!setups.some(setup => setup.id === editingSetupId)) {
      setEditingSetupId(undefined)
      setEditingName('')
    }
  }, [editingSetupId, setups])

  const toggleUIPanel = () => {
    toggleUIPanelAction('Settings', false)
    toggleUIPanelAction('About', false)
    toggleUIPanelAction('MatchKillfeed', false)
    toggleUIPanelAction('Bookmarks', false)
    toggleUIPanelAction('Setups')
  }

  const saveSetup = async () => {
    const setup = await saveCurrentSetupAction(draftName)
    if (!setup) return
    focusMainCanvas()
  }

  const loadSetup = async (setupId: string) => {
    const didApply = await applySetupByIdAction(setupId)
    if (!didApply) return
    focusMainCanvas()
  }

  const updateSetup = async (setupId: string) => {
    await updateSetupFromCurrentAction(setupId)
  }

  const copySetupLink = async (setupId: string) => {
    await copySetupShareUrlAction(setupId)
  }

  const commitRename = async () => {
    if (!editingSetupId) return
    const nextName = await renameSetupAction(editingSetupId, editingName)
    if (!nextName) return
    setEditingSetupId(undefined)
    setEditingName('')
  }

  return (
    <div className="flex items-start">
      <TogglePanelButton onClick={toggleUIPanel}>
        <HiListBulletIcon />
      </TogglePanelButton>

      <TogglePanel showCloseButton isOpen={isOpen} onClickClose={toggleUIPanel}>
        <div className="w-[min(360px,calc(100vw-2rem))] px-6 pb-6 pt-6">
          <div className="mb-4 mr-8 flex items-center justify-between">
            <div className="text-sm font-semibold">
              Setups ({setups.length})
            </div>
          </div>

          <div className="mb-5 rounded-xl bg-white/5 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">
              Save current board
            </div>

            <input
              type="text"
              value={draftName}
              placeholder="defending mid with disadvantage"
              className="mb-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none transition-colors focus:border-white/30"
              onChange={event => setSetupDraftNameAction(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  saveSetup()
                }
              }}
            />

            <button
              className={cn(
                'w-full rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                draftName.trim()
                  ? 'bg-white text-black hover:bg-white/90'
                  : 'cursor-not-allowed bg-white/10 text-white/40'
              )}
              disabled={!draftName.trim()}
              onClick={saveSetup}
            >
              Save current setup
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {setups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-xs text-white/40">
                No setups yet. Save the current map board to reuse or share it later.
              </div>
            ) : (
              setups.map(setup => {
                const isEditing = editingSetupId === setup.id

                return (
                  <div
                    key={setup.id}
                    className="mb-2 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                  >
                    {isEditing ? (
                      <div className="mb-3">
                        <input
                          autoFocus
                          type="text"
                          value={editingName}
                          className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none transition-colors focus:border-white/30"
                          onChange={event => setEditingName(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') {
                              commitRename()
                            }
                            if (event.key === 'Escape') {
                              setEditingSetupId(undefined)
                              setEditingName('')
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <div className="mb-3">
                        <div className="font-medium">{setup.name}</div>
                        <div className="mt-1 text-xs text-white/45">
                          {setup.map} · {setup.stickers.length} sticker
                          {setup.stickers.length === 1 ? '' : 's'}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 text-xs">
                      {isEditing ? (
                        <>
                          <button
                            className="rounded-md bg-white px-2.5 py-1.5 font-medium text-black transition-colors hover:bg-white/90"
                            onClick={commitRename}
                          >
                            Save name
                          </button>
                          <button
                            className="rounded-md bg-white/10 px-2.5 py-1.5 transition-colors hover:bg-white/15"
                            onClick={() => {
                              setEditingSetupId(undefined)
                              setEditingName('')
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="rounded-md bg-white px-2.5 py-1.5 font-medium text-black transition-colors hover:bg-white/90"
                            onClick={() => loadSetup(setup.id)}
                          >
                            Load
                          </button>
                          <button
                            className="rounded-md bg-white/10 px-2.5 py-1.5 transition-colors hover:bg-white/15"
                            onClick={() => updateSetup(setup.id)}
                          >
                            Update
                          </button>
                          <button
                            className="rounded-md bg-white/10 px-2.5 py-1.5 transition-colors hover:bg-white/15"
                            onClick={() => copySetupLink(setup.id)}
                          >
                            Copy link
                          </button>
                          <button
                            className="rounded-md bg-white/10 px-2.5 py-1.5 transition-colors hover:bg-white/15"
                            onClick={() => {
                              setEditingSetupId(setup.id)
                              setEditingName(setup.name)
                            }}
                          >
                            Rename
                          </button>
                          <button
                            className="rounded-md bg-red-500/15 px-2.5 py-1.5 text-red-200 transition-colors hover:bg-red-500/25"
                            onClick={() => deleteSetupAction(setup.id)}
                            aria-label={`Delete setup ${setup.name}`}
                          >
                            <span className="flex items-center gap-1.5">
                              <FaTrashIcon className="h-3 w-3" />
                              Delete
                            </span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </TogglePanel>
    </div>
  )
}
