import { clamp } from 'lodash'

import type { MatchSource, ScoreLine } from '@components/Analyse/Data/MatchSource'
import { CachedPlayer } from '@components/Analyse/Data/PlayerTracks'
import { ClassIcon } from '@components/UI/ClassIcon'
import { MEDIGUN_LABELS, UBERED_LABELS } from '@components/UI/ConditionBadges'

import { sortPlayersByClassId, parseClassHealth } from '@utils/players'
import { focusMainCanvas } from '@utils/misc'
import { useIsMobile } from '@utils/hooks'

import { useInstance, useStore } from '@zus/store'
import { jumpToPlayerPOVCamera } from '@zus/actions'

//
// ─── PLAYER STATUSES ────────────────────────────────────────────────────────────
//

//
// Tab (held), or a click on the score, opens the rosters out into a scoreboard: each row
// widens to the player's name and their kills, deaths, assists, damage and healing, in place
// of their health. The phone's team rails (Mobile/Rails) are these rosters too.
//
// ui.rails (P cycles it) narrows them to class and health ('compact', as the phone's rails
// are), or hides them ('hidden') until the scoreboard is opened.
//

export interface StatColumn {
  key: keyof ScoreLine
  label: string
  title: string
  wide?: boolean
}

const STAT_COLUMNS: (StatColumn & { counted?: boolean })[] = [
  { key: 'kills', label: 'K', title: 'Kills' },
  { key: 'deaths', label: 'D', title: 'Deaths' },
  { key: 'assists', label: 'A', title: 'Assists' },
  // Counted from damage and heal events, which older SourceTV demos do not record.
  { key: 'damage', label: 'DMG', title: 'Damage dealt', wide: true, counted: true },
  { key: 'healing', label: 'HEAL', title: 'Healing given', wide: true, counted: true },
]

export const EMPTY_LINE: ScoreLine = {
  points: 0,
  kills: 0,
  deaths: 0,
  assists: 0,
  damage: 0,
  healing: 0,
  ping: 0,
}

/** Whether the match has any damage or healing by its last tick: older demos have none. */
const hasCountedColumns = (match: MatchSource) => {
  for (const line of match.scoresAt(match.ticks - 1).values()) {
    if (line.damage > 0 || line.healing > 0) return true
  }
  return false
}

/** The columns an opened-out roster shows for this match. */
export const statColumns = (match: MatchSource): StatColumn[] =>
  hasCountedColumns(match) ? STAT_COLUMNS : STAT_COLUMNS.filter(column => !column.counted)

/** The labels over an opened-out roster's columns, in line with its rows. */
export const RosterHead = ({ team, columns }: { team: 'blue' | 'red'; columns: StatColumn[] }) => (
  <div className="hud-roster__head" aria-hidden>
    <span className="hud-roster__team">{team === 'blue' ? 'BLU' : 'RED'}</span>
    <span className="hud-player__stats">
      {columns.map(column => (
        <span
          key={column.key}
          className="hud-player__stat"
          data-col={column.key}
          data-wide={column.wide ? 'true' : undefined}
          title={column.title}
        >
          {column.label}
        </span>
      ))}
    </span>
  </div>
)

export interface PlayerStatusesProps {
  match: MatchSource
  players: CachedPlayer[]
  tick: number
  intervalPerTick: number
}

export const PlayerStatuses = (props: PlayerStatusesProps) => {
  const isMobile = useIsMobile()
  const bluePlayers: CachedPlayer[] = []
  const redPlayers: CachedPlayer[] = []

  const { match, players, tick, intervalPerTick } = props
  const focusedEntityId = useInstance(state => state?.focusedObject?.userData?.entityId)
  const expanded = useStore(state => state.ui.scoreboardOpen)
  const rails = useStore(state => state.settings.ui.rails ?? 'full')
  const columns = expanded ? statColumns(match) : undefined
  const scores = expanded ? match.scoresAt(tick) : null

  // Hidden rails still open out into the scoreboard.
  if (rails === 'hidden' && !expanded) return null

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
              {(team === 'blue' ? bluePlayers : redPlayers)
                .sort(sortPlayersByClassId)
                .map((player, index) => (
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
          <div
            key={team}
            className="hud-roster"
            data-team={team}
            data-expanded={expanded ? 'true' : undefined}
            data-rails={rails}
            aria-label={`${team === 'blue' ? 'BLU' : 'RED'} players`}
          >
            {columns && <RosterHead team={team} columns={columns} />}

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
                columns={columns}
                line={scores?.get(player.user.entityId) ?? EMPTY_LINE}
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
  /** Opened out: these stats from line, in place of the health. */
  columns?: StatColumn[]
  line?: ScoreLine
  /** The class icon's size, px; the theme's default if left out. */
  iconSize?: number
}

export const StatusItem = (props: StatusItemProps) => {
  const { player, type, team, alignment, focused, tick, intervalPerTick, columns, line, iconSize } =
    props
  let name, health, percentage, icon

  switch (type) {
    case 'player':
      name = player.user.name
      health = player.health
      percentage = parseClassHealth(player.classId, health).percentage
      icon = <ClassIcon classId={player.classId} size={iconSize} />
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
  const charged =
    type === 'player' ? player.ubered : player.medigun?.releasing ? player.ubered : null

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
        <div
          className="hud-player__overheal"
          style={{ width: `${clamp(percentage - 100, 0, 100)}%` }}
        />

        <div className="hud-player__name">{name}</div>

        {type === 'player' && charged && (
          <div className="hud-player__tag">{UBERED_LABELS[charged]}</div>
        )}

        <div className="hud-player__spacer" />

        {/* One item, so the columns read left to right on RED's mirrored rows too */}
        {type === 'player' && columns && line && (
          <span className="hud-player__stats">
            {columns.map(column => (
              <span
                key={column.key}
                className="hud-player__stat"
                data-col={column.key}
                data-wide={column.wide ? 'true' : undefined}
              >
                {line[column.key]}
              </span>
            ))}
          </span>
        )}

        <div className="hud-player__hp">
          {health > 0 && (type === 'uber' ? `${Math.floor(health)}%` : health)}
          {health === 0 && type === 'uber' && '0%'}
          {health === 0 && type === 'player' && (
            <span className="hud-player__respawn">
              {respawnSecs != null ? respawnSecs : 'Dead'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
