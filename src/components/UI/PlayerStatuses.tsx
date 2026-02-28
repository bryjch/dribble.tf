import { clamp } from 'lodash'

import { CachedPlayer } from '@components/Analyse/Data/PlayerCache'
import { ClassIcon } from '@components/UI/ClassIcon'

import { sortPlayersByClassId, parseClassHealth } from '@utils/players'
import { focusMainCanvas } from '@utils/misc'
import { cn } from '@utils/styling'
import { useIsMobile } from '@utils/hooks'

import { useInstance } from '@zus/store'
import { jumpToPlayerPOVCamera } from '@zus/actions'

//
// ─── PLAYER STATUSES ────────────────────────────────────────────────────────────
//

export interface PlayerStatusesProps {
  players: CachedPlayer[]
  tick: number
  intervalPerTick: number
}

export const PlayerStatuses = (props: PlayerStatusesProps) => {
  const isMobile = useIsMobile()
  const bluePlayers: CachedPlayer[] = []
  const redPlayers: CachedPlayer[] = []

  const { players, tick, intervalPerTick } = props
  const focusedEntityId = useInstance(state => state?.focusedObject?.userData?.entityId)

  for (const player of players) {
    if (player.team === 'blue') bluePlayers.push(player)
    if (player.team === 'red') redPlayers.push(player)
  }

  if (isMobile) {
    return (
      <div className="absolute inset-x-0 bottom-0 flex h-8 items-stretch">
        {/* Blue team - left half */}
        <div className="flex flex-1 items-stretch gap-px">
          {bluePlayers.sort(sortPlayersByClassId).map((player, index) => (
            <MobileStatusItem
              key={`blue-mobile-${index}`}
              player={player}
              team="blue"
              focused={focusedEntityId === player.user.entityId}
              tick={tick}
              intervalPerTick={intervalPerTick}
            />
          ))}
        </div>

        {/* Divider */}
        <div className="w-px bg-white/20" />

        {/* Red team - right half */}
        <div className="flex flex-1 items-stretch gap-px">
          {redPlayers.sort(sortPlayersByClassId).map((player, index) => (
            <MobileStatusItem
              key={`red-mobile-${index}`}
              player={player}
              team="red"
              focused={focusedEntityId === player.user.entityId}
              tick={tick}
              intervalPerTick={intervalPerTick}
            />
          ))}
        </div>
      </div>
    )
  }

  const blueMedics = bluePlayers.filter(({ classId }) => classId === 5)
  const redMedics = redPlayers.filter(({ classId }) => classId === 5)

  return (
    <>
      <div className="absolute left-0 mx-[1.5px] flex flex-col items-start gap-[1.5px]">
        {bluePlayers.sort(sortPlayersByClassId).map((player, index) => (
          <StatusItem
            key={`blue-player-status-item-${index}`}
            type="player"
            player={player}
            team="blue"
            alignment="left"
            focused={focusedEntityId === player.user.entityId}
            tick={tick}
            intervalPerTick={intervalPerTick}
          />
        ))}

        {blueMedics.length > 0 ? <div className="h-2" /> : null}

        {blueMedics.map((player, index) => (
          <StatusItem
            key={`blue-uber-status-item-${index}`}
            type="uber"
            player={player}
            team="blue"
            alignment="left"
            tick={tick}
            intervalPerTick={intervalPerTick}
          />
        ))}
      </div>

      <div className="absolute right-0 mx-[1.5px] flex flex-col items-end gap-[1.5px]">
        {redPlayers.sort(sortPlayersByClassId).map((player, index) => (
          <StatusItem
            key={`red-player-status-item-${index}`}
            type="player"
            player={player}
            team="red"
            alignment="right"
            focused={focusedEntityId === player.user.entityId}
            tick={tick}
            intervalPerTick={intervalPerTick}
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
            tick={tick}
            intervalPerTick={intervalPerTick}
          />
        ))}
      </div>
    </>
  )
}

//
// ─── MOBILE STATUS ITEM ─────────────────────────────────────────────────────────
//

interface MobileStatusItemProps {
  player: CachedPlayer
  team: 'blue' | 'red'
  focused?: boolean
  tick: number
  intervalPerTick: number
}

const MobileStatusItem = (props: MobileStatusItemProps) => {
  const { player, team, focused, tick, intervalPerTick } = props
  const health = player.health
  const { percentage } = parseClassHealth(player.classId, health)

  const onClickItem = async () => {
    const entityId = player?.user?.entityId || null
    if (entityId) await jumpToPlayerPOVCamera(entityId)
    focusMainCanvas()
  }

  return (
    <div
      className={cn(
        'flex flex-1 cursor-pointer items-center justify-center gap-0.5 text-xs font-semibold',
        team === 'blue' && 'bg-pp-healthbar-blue/40',
        team === 'red' && 'bg-pp-healthbar-red/40',
        health === 0 && 'opacity-40',
        focused && 'outline outline-1 outline-white'
      )}
      onClick={onClickItem}
    >
      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
        <ClassIcon classId={player.classId} />
      </div>
      <span
        className={cn(
          'font-bold',
          percentage > 100 && 'text-pp-health-overhealed',
          percentage < 40 && health > 0 && 'text-pp-health-low'
        )}
      >
        {health > 0 ? health : (
          player.respawnTick != null
            ? Math.ceil((player.respawnTick - tick) * intervalPerTick)
            : ''
        )}
      </span>
    </div>
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
  tick: number
  intervalPerTick: number
}

export const StatusItem = (props: StatusItemProps) => {
  const { player, type, team, alignment, focused, tick, intervalPerTick } = props
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
          'flex cursor-pointer items-center bg-pp-panel/40 text-[0.9rem] font-semibold',
          'overflow-hidden rounded-xl transition-all',
          STATUS_ITEM_WIDTH,
          STATUS_ITEM_HEIGHT,
          alignment === 'left' && 'flex-row',
          alignment === 'right' && 'flex-row-reverse',
          focused && 'z-10 outline outline-[3px] outline-white',
          focused && alignment === 'left' && 'translate-x-3',
          focused && alignment === 'right' && '-translate-x-3',
          health === 0 && 'opacity-60'
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
              'relative w-8 flex-shrink-0 text-center text-[1.1rem] font-bold text-white',
              percentage > 100 && 'text-pp-health-overhealed',
              type === 'player' && percentage < 40 && 'text-pp-health-low'
            )}
          >
            {health > 0 && health}
            {health === 0 && type === 'player' && (
              player.respawnTick != null ? (
                <span className="text-xs text-white opacity-70">
                  {Math.ceil((player.respawnTick - tick) * intervalPerTick)}
                </span>
              ) : (
                <span className="text-xs text-white opacity-70">Dead</span>
              )
            )}
          </div>

          {/* Spacer */}
          <div className="w-1.5" />
        </div>
      </div>
    </>
  )
}
