import { getMapBoundariesKey } from '@components/Analyse/MapBoundaries'
import { ControlsMode } from '@constants/types'
import { toggleMapCenterPickerAction } from '@zus/actions'
import { useStore, useInstance } from '@zus/store'
import { cn } from '@utils/styling'

const formatOffset = (value: { x: number; y: number; z: number }) =>
  `{ x: ${Math.round(value.x)}, y: ${Math.round(value.y)}, z: ${Math.round(value.z)} }`

export const MapOffsetDebugPanel = () => {
  const map = useStore(state => state.scene.map)
  const rtsCenter = useStore(state => state.scene.bounds.defaultRtsCenter)
  const controlsMode = useStore(state => state.scene.controls.mode)
  const mapOffsetDebug = useInstance(state => state.mapOffsetDebug)
  const mapCenterPickerActive = useInstance(state => state.mapCenterPickerActive)

  const mapEntry = getMapBoundariesKey(map) ?? map
  const rtsCenterSnippet = `rtsCenter: ${formatOffset(rtsCenter)},`

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(`${mapEntry}: {\n  ${rtsCenterSnippet}\n},`)
    } catch (error) {
      console.error(error)
    }
  }

  return (
    <div className="pointer-events-auto rounded-2xl bg-pp-panel/80 px-4 py-3 text-xs text-white shadow-lg backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-black uppercase opacity-60">
        <span>RTS Center</span>
        <span>{mapEntry}</span>
      </div>

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          className={cn(
            'rounded-xl border px-2 py-1 text-[11px] font-semibold transition-colors hover:border-white/70',
            mapCenterPickerActive && 'border-[#37ff5f] bg-[#37ff5f] text-black'
          )}
          onClick={() => toggleMapCenterPickerAction()}
        >
          {mapCenterPickerActive ? 'Cancel Pick' : 'Pick Center'}
        </button>

        <button
          type="button"
          className="rounded-xl border px-2 py-1 text-[11px] font-semibold transition-colors hover:border-white/70"
          onClick={copySnippet}
        >
          Copy Snippet
        </button>
      </div>

      {mapCenterPickerActive && (
        <div className="mb-2 max-w-[280px] text-[11px] opacity-80">
          Click visible map geometry to set the RTS orbit center. The picked value is saved locally
          for this map.
        </div>
      )}

      {controlsMode !== ControlsMode.RTS && (
        <div className="mb-2 max-w-[260px] opacity-60">
          Switch to RTS camera to update these values live.
        </div>
      )}

      <div className="font-mono text-[11px] leading-5">
        <div>rtsCenter: {formatOffset(rtsCenter)}</div>
        <div>cameraOffset: {formatOffset(mapOffsetDebug.cameraOffset)}</div>
      </div>
    </div>
  )
}
