import { useEffect, useState } from 'react'

import { useMobileLayout } from '@components/Mobile/useMobileLayout'

import { Btn, HelpToggle } from './controls'
import { InspectorBody, InspectorTitle } from './Inspector'
import { SceneWindowBody } from './SceneWindow'
import { useDebug } from './session'
import { Window } from './Window'

/**
 * The debug tools over the viewer, and over its HUD (.ui-layer and the phone's .m-shell sit at
 * z-index 2000000000, above drei's nameplates). On a desktop, two windows: Inspector (whatever is selected)
 * against the left, beside the toolbar, and Scene (what's in it, the map, presets, the link)
 * against the right; both drag and fold. The Inspector is on the left so the weapon in POV,
 * drawn bottom right, stays in view. On the touch layout, one sheet from the bottom with the two as tabs.
 */
export const DebugPanel = () => {
  const mobile = useMobileLayout()
  const [sheet, setSheet] = useState<'scene' | 'inspector' | null>(null)
  const selected = useDebug(s => s.selected)

  // The touch layout starts with the sheet closed, so the scene is seen first.
  useEffect(() => setSheet(null), [mobile.active])
  // Picking something while the sheet is open shows it.
  useEffect(() => {
    if (selected) setSheet(open => (open ? 'inspector' : open))
  }, [selected])

  if (mobile.active) {
    return (
      <div className="pointer-events-none fixed inset-0 z-[2000000001] flex flex-col items-start font-mono text-[12px] text-[#d8dde6]">
        {!sheet && (
          // Under the phone interface's menu button.
          <button
            type="button"
            className="pointer-events-auto ml-3 mt-[calc(max(0.5rem,env(safe-area-inset-top))+3.5rem)] rounded-[3px] border border-white/20 bg-[#121418]/95 px-2.5 py-1 font-semibold uppercase tracking-wider"
            onClick={() => setSheet(selected ? 'inspector' : 'scene')}
          >
            Debug
          </button>
        )}
        {sheet && (
          <div
            className="pointer-events-auto mt-auto flex max-h-[70dvh] w-full flex-col rounded-t-[6px] border-t border-white/15 bg-[#121418] shadow-2xl"
            role="dialog"
            aria-label="Debug tools"
          >
            <div className="flex items-center gap-1 border-b border-white/10 bg-[#1d2129] px-2 py-1.5">
              {(['scene', 'inspector'] as const).map(tab => (
                <Btn
                  key={tab}
                  active={sheet === tab}
                  onClick={() => setSheet(tab)}
                  className="uppercase tracking-wider"
                >
                  {tab}
                </Btn>
              ))}
              <span className="ml-auto" />
              <HelpToggle />
              <Btn onClick={() => setSheet(null)}>close</Btn>
            </div>
            <div className="overflow-y-auto overscroll-contain p-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {sheet === 'scene' ? <SceneWindowBody /> : <InspectorBody />}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[2000000001]">
      <Window
        title="Scene"
        side="right"
        offset={{ x: 16, y: 16 }}
        width={270}
        right={<HelpToggle />}
      >
        <SceneWindowBody />
      </Window>
      <Window
        title={<InspectorTitle />}
        side="left"
        offset={{ x: 72, y: 16 }}
        width={310}
        right={<HelpToggle />}
      >
        <InspectorBody />
      </Window>
    </div>
  )
}
