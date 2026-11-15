import { useEffect, useMemo, useState } from 'react'

import { TogglePanel, TogglePanelButton } from '@components/UI/Shared/TogglePanel'
import { SetupsIcon, FaTrashIcon } from '@components/Misc/Icons'

import { useStore } from '@zus/store'
import {
  applySetupByIdAction,
  copySetupShareUrlAction,
  deleteSetupAction,
  renameSetupAction,
  saveCurrentSetupAction,
  setSetupDraftNameAction,
  toggleOnlyUIPanelAction,
  updateSetupFromCurrentAction,
} from '@zus/actions'
import { focusMainCanvas } from '@utils/misc'

const ALL_SETUP_MAPS = '__all_setup_maps__'

export const SetupsPanel = () => {
  const isOpen = useStore(state => state.ui.activePanels.includes('Setups'))
  const draftName = useStore(state => state.setups.draftName)
  const setups = useStore(state => state.setups.items)
  const [editingSetupId, setEditingSetupId] = useState<string>()
  const [editingName, setEditingName] = useState('')
  const [selectedMap, setSelectedMap] = useState(ALL_SETUP_MAPS)

  const setupMapOptions = useMemo(() => {
    const setupCountsByMap = new Map<string, number>()

    setups.forEach(setup => {
      setupCountsByMap.set(setup.map, (setupCountsByMap.get(setup.map) ?? 0) + 1)
    })

    return Array.from(setupCountsByMap.entries()).sort(([leftMap], [rightMap]) =>
      leftMap.localeCompare(rightMap)
    )
  }, [setups])

  const filteredSetups = useMemo(() => {
    if (selectedMap === ALL_SETUP_MAPS) return setups
    return setups.filter(setup => setup.map === selectedMap)
  }, [selectedMap, setups])

  const setupCountLabel =
    selectedMap === ALL_SETUP_MAPS ? setups.length : `${filteredSetups.length}/${setups.length}`

  useEffect(() => {
    if (!editingSetupId) return
    if (!setups.some(setup => setup.id === editingSetupId)) {
      setEditingSetupId(undefined)
      setEditingName('')
    }
  }, [editingSetupId, setups])

  useEffect(() => {
    if (selectedMap === ALL_SETUP_MAPS) return
    if (setupMapOptions.some(([map]) => map === selectedMap)) return

    setSelectedMap(ALL_SETUP_MAPS)
  }, [selectedMap, setupMapOptions])

  const toggleUIPanel = () => toggleOnlyUIPanelAction('Setups')

  const saveSetup = async () => {
    const setup = await saveCurrentSetupAction(draftName)
    if (!setup) return
    if (selectedMap !== ALL_SETUP_MAPS && selectedMap !== setup.map) {
      setSelectedMap(setup.map)
    }
    setSetupDraftNameAction('')
    focusMainCanvas()
  }

  const loadSetup = async (setupId: string) => {
    const didApply = await applySetupByIdAction(setupId)
    if (!didApply) return
    focusMainCanvas()
  }

  const updateSetup = async (setupId: string) => {
    const setup = await updateSetupFromCurrentAction(setupId)
    if (!setup) return
    if (selectedMap !== ALL_SETUP_MAPS && selectedMap !== setup.map) {
      setSelectedMap(setup.map)
    }
  }

  // What the last Copy link press did, shown on that button for a moment.
  const [copyResult, setCopyResult] = useState<{ id: string; ok: boolean }>()

  const copySetupLink = async (setupId: string) => {
    const url = await copySetupShareUrlAction(setupId)
    setCopyResult({ id: setupId, ok: !!url })
    setTimeout(() => setCopyResult(result => (result?.id === setupId ? undefined : result)), 2000)
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
      <TogglePanelButton onClick={toggleUIPanel} active={isOpen} label="Setups">
        <SetupsIcon />
      </TogglePanelButton>

      <TogglePanel
        className="w-[min(400px,calc(100vw-5rem))]"
        title="Setups"
        count={setupCountLabel}
        showCloseButton
        isOpen={isOpen}
        onClickClose={toggleUIPanel}
      >
        <div>

          <div className="mb-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={draftName}
                placeholder="Name this setup, e.g. holding mid 5v6"
                aria-label="Setup name"
                className="ui-input flex-1"
                onChange={event => setSetupDraftNameAction(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    saveSetup()
                  }
                }}
              />

              <button
                className="ui-btn ui-btn--primary"
                disabled={!draftName.trim()}
                onClick={saveSetup}
              >
                Save
              </button>
            </div>
          </div>

          {setups.length > 0 && (
            <label className="-mt-1 mb-5 block">
              <select
                value={selectedMap}
                className="ui-input w-full"
                aria-label="Show setups for map"
                onChange={event => {
                  setSelectedMap(event.target.value)
                  setEditingSetupId(undefined)
                  setEditingName('')
                }}
              >
                <option value={ALL_SETUP_MAPS}>All maps ({setups.length})</option>
                {setupMapOptions.map(([map, count]) => (
                  <option key={map} value={map}>
                    {map} ({count})
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex flex-col gap-2">
            {setups.length === 0 ? (
              <div className="ui-empty-note">
                No setups yet. Save the camera and stickers on this map to come back to them or share them.
              </div>
            ) : filteredSetups.length === 0 ? (
              <div className="ui-empty-note">
                No setups saved for {selectedMap}.
              </div>
            ) : (
              filteredSetups.map(setup => {
                const isEditing = editingSetupId === setup.id

                return (
                  <div
                    key={setup.id}
                    className="ui-card"
                  >
                    {isEditing ? (
                      <div className="mb-3">
                        <input
                          autoFocus
                          type="text"
                          value={editingName}
                          aria-label="Setup name"
                          className="ui-input w-full"
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
                        <div className="font-semibold">{setup.name}</div>
                        <div className="ui-muted mt-0.5 text-xs">
                          {setup.map} · {setup.stickers.length} sticker
                          {setup.stickers.length === 1 ? '' : 's'}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-1.5">
                      {isEditing ? (
                        <>
                          <button
                            className="ui-btn ui-btn--primary ui-btn--small"
                            onClick={commitRename}
                          >
                            Save name
                          </button>
                          <button
                            className="ui-btn ui-btn--small"
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
                            className="ui-btn ui-btn--primary ui-btn--small"
                            onClick={() => loadSetup(setup.id)}
                          >
                            Load
                          </button>
                          <button
                            className="ui-btn ui-btn--small"
                            onClick={() => updateSetup(setup.id)}
                          >
                            Update
                          </button>
                          <button
                            className="ui-btn ui-btn--small"
                            onClick={() => copySetupLink(setup.id)}
                            aria-live="polite"
                          >
                            {copyResult?.id !== setup.id
                              ? 'Copy link'
                              : copyResult.ok
                                ? 'Copied'
                                : "Couldn't copy"}
                          </button>
                          <button
                            className="ui-btn ui-btn--small"
                            onClick={() => {
                              setEditingSetupId(setup.id)
                              setEditingName(setup.name)
                            }}
                          >
                            Rename
                          </button>
                          <button
                            className="ui-btn ui-btn--small ui-btn--danger"
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
