import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { ViewerPage } from '@pages/ViewerPage'
import { toggleUIPanelAction } from '@zus/actions'

import { DebugPanel } from './DebugPanel'
import { usePovId } from './edit'
import type { DebugView } from './scenario'
import { applyView, select, useDebug } from './session'

//
// ─── /debug ─────────────────────────────────────────────────────────────────────
//
// The real viewer, playing a made-up match the panel edits (see ./session.ts), for testing
// rendering: players with any class, weapon or condition, projectiles and buildings, seen in the
// world or in POV. Loaded only on /debug (App.tsx), and not linked from anywhere.
//

const DebugPage = ({ view }: { view?: DebugView }) => {
  // The panel goes inside the viewer's .ui-root, for its theme variables (the playback bar's
  // --ui-dock-clearance is set there).
  const [viewerRoot, setViewerRoot] = useState<HTMLElement | null>(null)
  useEffect(() => setViewerRoot(document.querySelector<HTMLElement>('.ui-root')), [])

  useEffect(() => {
    // The About panel opens on a first visit; here it would only be in the way.
    void toggleUIPanelAction('About', false)
    void applyView(view)
    // Once, for the view the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Entering a player's POV, however (the panel, the 1 key, the rosters), selects them here.
  const povId = usePovId()
  useEffect(() => {
    if (povId == null) return
    const { selected, scenario } = useDebug.getState()
    if (selected?.kind === 'player' && selected.id === povId) return
    if (scenario.players.some(p => p.id === povId)) select({ kind: 'player', id: povId })
  }, [povId])

  return (
    <>
      <ViewerPage />
      {viewerRoot && createPortal(<DebugPanel />, viewerRoot)}
    </>
  )
}

export default DebugPage
