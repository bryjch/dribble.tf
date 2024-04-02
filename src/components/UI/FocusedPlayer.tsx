import { CachedPlayer } from '@components/Analyse/Data/PlayerCache'
import { ClassIcon } from '@components/UI/ClassIcon'

import { useStore, useInstance } from '@zus/store'

import { parseClassHealth } from '@utils/players'
import { cn } from '@utils/styling'

export interface FocusedPlayerProps {
  players: CachedPlayer[]
}

export const FocusedPlayer = (props: FocusedPlayerProps) => {
  const controlsMode = useStore(state => state.scene.controls.mode)
  const focusedObject = useInstance(state => state.focusedObject)

  if (controlsMode !== 'pov' || !focusedObject) return null

  const { players } = props
  const focused = players.find(player => player.user.entityId === focusedObject?.userData?.entityId)

  if (!focused) return null

  let name, health, percentage, icon
  name = focused.user.name
  health = focused.health
  percentage = parseClassHealth(focused.classId, health).percentage
  icon = <ClassIcon classId={focused.classId} />

  return (
    <div className="flex w-auto flex-col items-center">
      <div className="mb-4">
        {health === 0 && (
          <div className="shadow-[0 0 3px #0a0a0a] animate-dead-pulse text-3xl font-black text-[#fbff09]">
            *RESPAWNING*
          </div>
        )}
      </div>

      <div className="flex">
        <div
          className={cn(
            'relative w-[65px] text-center text-[2.5rem] font-black leading-10 text-white [text-shadow:0_0_3px_#000000]',
            percentage > 100 && 'text-pp-health-overhealed',
            percentage < 40 && 'text-pp-health-low'
          )}
        >
          {health}
        </div>

        <div
          className={cn(
            'flex max-w-[260px] items-center border-b-[6px] bg-pp-panel/30 py-[0.1rem]',
            focused.team === 'blue' && 'border-b-pp-focused-background-blue',
            focused.team === 'red' && 'border-b-pp-focused-background-red'
          )}
        >
          <div className="overflow-hidden text-ellipsis whitespace-nowrap px-1.5">{name}</div>
          <div className="px-1.5">{icon}</div>
        </div>
      </div>
    </div>
  )
}
