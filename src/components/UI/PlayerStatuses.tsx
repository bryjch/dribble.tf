import { clamp } from 'lodash'

import { CachedPlayer } from '@components/Analyse/Data/PlayerCache'
import { ClassIcon } from '@components/UI/ClassIcon'

import { sortPlayersByClassId, parseClassHealth } from '@utils/players'
import { focusMainCanvas } from '@utils/misc'
import { cn } from '@utils/styling'

import { useInstance } from '@zus/store'
import { jumpToPlayerPOVCamera } from '@zus/actions'

//
// ─── PLAYER STATUSES ────────────────────────────────────────────────────────────
//

export interface PlayerStatusesProps {
  players: CachedPlayer[]
}

export const PlayerStatuses = (props: PlayerStatusesProps) => {
  const bluePlayers: CachedPlayer[] = []
  const redPlayers: CachedPlayer[] = []

  const { players } = props
  const focusedEntityId = useInstance(state => state?.focusedObject?.userData?.entityId)

  for (const player of players) {
    if (player.team === 'blue') bluePlayers.push(player)
    if (player.team === 'red') redPlayers.push(player)
  }

  const blueMedics = bluePlayers.filter(({ classId }) => classId === 5)
  const redMedics = redPlayers.filter(({ classId }) => classId === 5)

  return (
    <>
      <div className="absolute left-0 flex flex-col items-start">
        {bluePlayers.sort(sortPlayersByClassId).map((player, index) => (
          <StatusItem
            key={`blue-player-status-item-${index}`}
            type="player"
            player={player}
            team="blue"
            alignment="left"
            focused={focusedEntityId === player.user.entityId}
          />
        ))}

        {blueMedics.length > 0 ? <div className="separator" /> : null}

        {blueMedics.map((player, index) => (
          <StatusItem
            key={`blue-uber-status-item-${index}`}
            type="uber"
            player={player}
            team="blue"
            alignment="left"
          />
        ))}
      </div>

      <div className="absolute right-0 flex flex-col items-end">
        {redPlayers.sort(sortPlayersByClassId).map((player, index) => (
          <StatusItem
            key={`red-player-status-item-${index}`}
            type="player"
            player={player}
            team="red"
            alignment="right"
            focused={focusedEntityId === player.user.entityId}
          />
        ))}

        {redMedics.length > 0 ? <div className="h-2" /> : null}

        {redMedics.map((player, index) => (
          <StatusItem
            key={`red-uber-status-item-${index}`}
            type="uber"
            player={player}
            team="red"
            alignment="right"
          />
        ))}
      </div>
    </>
  )
}

//
// ─── STATUS ITEM ────────────────────────────────────────────────────────────────
//

const STATUS_ITEM_WIDTH = 'w-52'
const STATUS_ITEM_HEIGHT = 'h-9'

export interface StatusItemProps {
  player: CachedPlayer
  type: 'player' | 'uber'
  team: 'blue' | 'red'
  alignment: 'left' | 'right'
  focused?: boolean
}

export const StatusItem = (props: StatusItemProps) => {
  const { player, type, team, alignment, focused } = props
  let name, health, percentage, icon

  switch (type) {
    case 'player':
      name = player.user.name
      health = player.health
      percentage = parseClassHealth(player.classId, health).percentage
      icon = <ClassIcon classId={player.classId} />
      break

    case 'uber':
      name = 'Charge' // TODO: display medi gun type (requires additional parsing)
      health = player.chargeLevel || 0
      percentage = player.chargeLevel || 0
      break
  }

  const onClickItem = async () => {
    const entityId = player?.user?.entityId || null
    if (entityId) await jumpToPlayerPOVCamera(entityId)
    focusMainCanvas()
  }

  return (
    <>
      <div
        className={cn(
          'my-px flex cursor-pointer items-center bg-pp-panel/40 text-[0.9rem] font-semibold',
          STATUS_ITEM_WIDTH,
          STATUS_ITEM_HEIGHT,
          alignment === 'left' && 'flex-row',
          alignment === 'right' && 'flex-row-reverse',
          focused && 'outline outline-[3px] outline-[#fbff09]',
          health <= 0 && 'opacity-60'
        )}
        onClick={onClickItem}
      >
        {/* Class Icon */}
        {icon && (
          <div
            className={cn(
              'flex aspect-square shrink-0 items-center justify-center bg-pp-panel/20',
              STATUS_ITEM_HEIGHT
            )}
          >
            {icon}
          </div>
        )}

        <div
          className={cn(
            'relative flex h-full w-full items-center overflow-hidden',
            health > 0 && team === 'red' && 'bg-pp-healthbar-red/50',
            health > 0 && team === 'blue' && 'bg-pp-healthbar-blue/50',
            alignment === 'left' && 'flex-row',
            alignment === 'right' && 'flex-row-reverse'
          )}
        >
          {/* Note: fill & overheal widths are manipulated inline for better performance,
            because changing the value in css class directly will continously trigger
            styled-jsx recalculation / DOM reflow (very costly over time)
            https://github.com/vercel/styled-jsx#via-inline-style */}

          {/* Fill */}
          <div
            className={cn(
              'absolute h-full',
              team === 'red' && 'bg-pp-healthbar-red',
              team === 'blue' && 'bg-pp-healthbar-blue'
            )}
            style={{ width: `${percentage}%` }}
          />

          {/* Overheal */}
          <div
            className="absolute h-full bg-white/40"
            style={{ width: `${clamp(percentage - 100, 0, 100)}%` }}
          ></div>

          {/* Name */}
          <div className="relative overflow-hidden text-ellipsis whitespace-nowrap px-2">
            {name}
          </div>

          {/* Spacer */}
          <div className="flex-1"></div>

          {/* Health */}
          <div
            className={cn(
              'relative px-2 text-[1.1rem] font-bold text-white',
              percentage > 100 && 'text-pp-health-overhealed',
              type === 'player' && percentage < 40 && 'text-pp-health-low'
            )}
          >
            {health}
          </div>
        </div>
      </div>
    </>
  )
}
