import { CachedPlayer } from '@components/Analyse/Data/PlayerCache'
import { ClassIcon } from '@components/UI/ClassIcon'

import { useStore, useInstance } from '@zus/store'

import { parseClassHealth } from '@utils/players'
import { cn } from '@utils/styling'

export interface FocusedPlayerProps {
  players: CachedPlayer[]
  tick: number
  intervalPerTick: number
}

export const FocusedPlayer = (props: FocusedPlayerProps) => {
  const controlsMode = useStore(state => state.scene.controls.mode)
  const focusedObject = useInstance(state => state.focusedObject)

  if (controlsMode !== 'pov' || !focusedObject) return null

  const { players, tick, intervalPerTick } = props
  const focused = players.find(player => player.user.entityId === focusedObject?.userData?.entityId)

  if (!focused) return null

  let name, health, percentage, icon
  name = focused.user.name
  health = focused.health
  percentage = parseClassHealth(focused.classId, health).percentage
  icon = <ClassIcon classId={focused.classId} />

  return (
    <div className="flex w-auto flex-col items-center">
      <div className="mb-4 text-3xl">
        {health === 0 && focused.respawnTick != null && (
          <div className="animate-pulse text-xl font-black text-[#fbff09] [text-shadow:0_0_3px_#000000]">
            Respawning in {Math.ceil((focused.respawnTick - tick) * intervalPerTick)}
          </div>
        )}
      </div>

      <div className="flex items-center">
        <div
          className={cn(
            'relative mr-3 flex w-[15px] justify-end text-right font-black text-white [text-shadow:0_0_3px_#000000]'
          )}
        >
          {health > 0 ? (
            <div
              className={cn(
                'text-[2.5rem] leading-10',
                percentage > 100 && 'text-pp-health-overhealed',
                percentage < 40 && 'text-pp-health-low'
              )}
            >
              {health}
            </div>
          ) : (
            <div className="text-xl opacity-60">Dead</div>
          )}
        </div>

        <div
          className={cn(
            'flex max-w-[260px] flex-col overflow-hidden rounded-xl bg-pp-panel/70',
            health === 0 && 'opacity-60'
          )}
        >
          <div className="flex flex-1 items-center px-4 py-2">
            <div className="overflow-hidden text-ellipsis whitespace-nowrap">{name}</div>
            <div className="pl-2">{icon}</div>
          </div>

          <div
            className={cn(
              'h-1 w-full',
              focused.team === 'blue' && 'bg-pp-focused-background-blue',
              focused.team === 'red' && 'bg-pp-focused-background-red'
            )}
          />
        </div>
      </div>
    </div>
  )
}
