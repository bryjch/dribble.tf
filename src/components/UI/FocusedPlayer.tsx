import { CachedPlayer } from '@components/Analyse/Data/PlayerTracks'
import { ClassIcon } from '@components/UI/ClassIcon'

import { useStore, useInstance } from '@zus/store'

import { parseClassHealth } from '@utils/players'

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

  const hp = percentage > 100 ? 'over' : health > 0 && percentage < 40 ? 'low' : undefined

  return (
    <div className="hud-focused" data-team={focused.team} data-dead={health === 0} data-hp={hp}>
      <div className="h-12">
        {health === 0 && focused.respawnTick != null && (
          <div className="hud-focused__respawn">
            Respawning in {Math.ceil((focused.respawnTick - tick) * intervalPerTick)}
          </div>
        )}
      </div>

      {/* The card is centred; the health number hangs off its left edge. */}
      <div className="relative flex items-center">
        <div className="absolute right-full top-1/2 -translate-y-1/2 whitespace-nowrap">
          {health > 0 ? (
            <div className="hud-focused__hp">{health}</div>
          ) : (
            <div className="hud-focused__hp hud-focused__hp--dead">Dead</div>
          )}
        </div>

        <div className="hud-focused__card">
          <div className="hud-focused__name">
            <span className="truncate">{name}</span>
            {icon}
          </div>
          <div className="hud-focused__team" />
        </div>
      </div>
    </div>
  )
}
