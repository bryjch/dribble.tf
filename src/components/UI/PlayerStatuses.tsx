import { clamp } from 'lodash'

import { CachedPlayer } from '@components/Analyse/Data/PlayerTracks'
import { ClassIcon } from '@components/UI/ClassIcon'
import { MEDIGUN_LABELS, UBERED_LABELS } from '@components/UI/ConditionBadges'

import { sortPlayersByClassId, parseClassHealth } from '@utils/players'
import { focusMainCanvas } from '@utils/misc'
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
      <div className="hud-strip">
        {(['blue', 'red'] as const).map((team, teamIndex) => (
          <div key={team} className="contents">
            {teamIndex === 1 && <div className="hud-strip__divider" />}
            <div className="hud-strip__team" data-team={team}>
              {(team === 'blue' ? bluePlayers : redPlayers).sort(sortPlayersByClassId).map((player, index) => (
                <MobileStatusItem
                  key={`${team}-mobile-${index}`}
                  player={player}
                  team={team}
                  focused={focusedEntityId === player.user.entityId}
                  tick={tick}
                  intervalPerTick={intervalPerTick}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const blueMedics = bluePlayers.filter(({ classId }) => classId === 5)
  const redMedics = redPlayers.filter(({ classId }) => classId === 5)

  return (
    <>
      {(['blue', 'red'] as const).map(team => {
        const roster = (team === 'blue' ? bluePlayers : redPlayers).sort(sortPlayersByClassId)
        const medics = team === 'blue' ? blueMedics : redMedics
        return (
          <div key={team} className="hud-roster" data-team={team} aria-label={`${team === 'blue' ? 'BLU' : 'RED'} players`}>
            {roster.map((player, index) => (
              <StatusItem
                key={`${team}-player-status-item-${index}`}
                type="player"
                player={player}
                team={team}
                alignment={team === 'blue' ? 'left' : 'right'}
                focused={focusedEntityId === player.user.entityId}
                tick={tick}
                intervalPerTick={intervalPerTick}
              />
            ))}

            {medics.length > 0 ? <div className="hud-roster__break" /> : null}

            {medics.map((player, index) => (
              <StatusItem
                key={`${team}-uber-status-item-${index}`}
                type="uber"
                player={player}
                team={team}
                alignment={team === 'blue' ? 'left' : 'right'}
                tick={tick}
                intervalPerTick={intervalPerTick}
              />
            ))}
          </div>
        )
      })}
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
      className="hud-mini"
      data-team={team}
      data-dead={health === 0}
      data-focused={focused}
      data-hp={hpState(percentage, health)}
      onClick={onClickItem}
    >
      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
        <ClassIcon classId={player.classId} />
      </div>
      <span>
        {health > 0
          ? health
          : player.respawnTick != null
            ? Math.ceil((player.respawnTick - tick) * intervalPerTick)
            : ''}
      </span>
    </div>
  )
}

/** Overhealed, low, or neither: themes colour the number from this. */
const hpState = (percentage: number, health: number, isPlayer = true) => {
  if (percentage > 100) return 'over'
  if (isPlayer && health > 0 && percentage < 40) return 'low'
  return undefined
}

//
// ─── STATUS ITEM ────────────────────────────────────────────────────────────────
//

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
      // A medic seen before their medigun is known shows a plain 'Charge'.
      name = player.medigun ? MEDIGUN_LABELS[player.medigun.kind] : 'Charge'
      if (player.medigun?.resist) name += ` · ${player.medigun.resist.toUpperCase()}`
      health = player.chargeLevel || 0
      percentage = player.chargeLevel || 0
      break
  }
  // A charge in use: the player's card (and the medic's charge bar while releasing) is striped.
  const charged = type === 'player' ? player.ubered : player.medigun?.releasing ? player.ubered : null

  const onClickItem = async () => {
    const entityId = player?.user?.entityId || null
    if (entityId) await jumpToPlayerPOVCamera(entityId)
    focusMainCanvas()
  }

  const respawnSecs =
    player.respawnTick != null ? Math.ceil((player.respawnTick - tick) * intervalPerTick) : null

  return (
    <div
      className="hud-player"
      data-kind={type === 'uber' ? 'charge' : 'player'}
      data-team={team}
      data-side={alignment}
      data-dead={health === 0 && type === 'player'}
      data-focused={focused ? 'true' : undefined}
      data-charged={charged ? 'true' : undefined}
      data-hp={hpState(percentage, health, type === 'player')}
      onClick={onClickItem}
      title={type === 'player' ? `Watch ${player.user.name}'s POV` : undefined}
    >
      {icon && <div className="hud-player__class">{icon}</div>}

      <div className="hud-player__bar">
        <div className="hud-player__fill" style={{ width: `${clamp(percentage, 0, 100)}%` }} />
        {charged && <div className="hud-player__stripes" />}
        <div className="hud-player__overheal" style={{ width: `${clamp(percentage - 100, 0, 100)}%` }} />

        <div className="hud-player__name">{name}</div>

        {type === 'player' && charged && <div className="hud-player__tag">{UBERED_LABELS[charged]}</div>}

        <div className="hud-player__spacer" />

        <div className="hud-player__hp">
          {health > 0 && (type === 'uber' ? `${Math.floor(health)}%` : health)}
          {health === 0 && type === 'uber' && '0%'}
          {health === 0 && type === 'player' && (
            <span className="hud-player__respawn">{respawnSecs != null ? respawnSecs : 'Dead'}</span>
          )}
        </div>
      </div>
    </div>
  )
}
