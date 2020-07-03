import React from 'react'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'
import { CachedPlayer } from '@components/Analyse/Data/PlayerCache'
import { ClassIcon } from '@components/UI/ClassIcon'

import { ACTOR_TEAM_COLORS } from '@constants/mappings'
import { sortPlayersByClassId, parseClassHealth } from '@utils/players'

//
// ─── PLAYER STATUSES ────────────────────────────────────────────────────────────
//

export interface PlayerStatusesProps {
  parser: AsyncParser
  tick: number
}

export const PlayerStatuses = (props: PlayerStatusesProps) => {
  const { parser, tick } = props

  const playersThisTick = parser
    ? parser.getPlayersAtTick(tick).filter(({ connected }) => connected)
    : []

  const bluePlayers = []
  const redPlayers = []

  for (const player of playersThisTick) {
    if (player.team === 'blue') bluePlayers.push(player)
    if (player.team === 'red') redPlayers.push(player)
  }

  return (
    <>
      <div className="panel blue">
        {bluePlayers.sort(sortPlayersByClassId).map((player, index) => (
          <PlayerStatusItem
            key={`blue-player-status-item-${index}`}
            player={player}
            team="blue"
            alignment="left"
          />
        ))}
      </div>

      <div className="panel red">
        {redPlayers.sort(sortPlayersByClassId).map((player, index) => (
          <PlayerStatusItem
            key={`blue-player-status-item-${index}`}
            player={player}
            team="red"
            alignment="right"
          />
        ))}
      </div>

      <style jsx>{`
        .panel {
          position: absolute;
          display: flex;
          flex-flow: column nowrap;
          font-family: monospace;
          font-size: 1rem;

          &.blue {
            left: 0;
            align-items: flex-start;
          }

          &.red {
            right: 0;
            align-items: flex-end;
          }
        }
      `}</style>
    </>
  )
}

//
// ─── PLAYER STATUS ITEM ─────────────────────────────────────────────────────────
//

const ITEM_WIDTH = '12rem'
const ITEM_HEIGHT = '2rem'

export interface PlayerStatusItemProps {
  player: CachedPlayer
  team: 'blue' | 'red'
  alignment: 'left' | 'right'
}

export const PlayerStatusItem = (props: PlayerStatusItemProps) => {
  const { player, team, alignment } = props
  const { user, health, classId } = player

  const { percentage } = parseClassHealth(classId, health)
  const healthCls = percentage > 100 ? 'buffed' : percentage < 40 ? 'low' : ''

  return (
    <>
      <div className={`player-status-item align-${alignment}`}>
        <div className="class-icon-container">
          <ClassIcon classId={classId} />
        </div>
        <div className="details-container">
          <div className="fill"></div>
          <div className="overheal"></div>
          <div className="name">{user.name}</div>
          <div className="spacer"></div>
          <div className={`health ${healthCls}`}>{health}</div>
          <div className="respawn-timer"></div>
        </div>
      </div>

      <style jsx>{`
        .player-status-item {
          display: flex;
          align-items: center;
          background: rgba(0, 0, 0, 0.7);
          margin-bottom: 1px;
          color: #ffffff;
          font-size: 1rem;
          font-weight: bold;
          width: ${ITEM_WIDTH};
          height: ${ITEM_HEIGHT};

          .class-icon-container {
            display: flex;
            justify-content: center;
            align-items: center;
            flex-shrink: 0;
            width: ${ITEM_HEIGHT};
            height: ${ITEM_HEIGHT};
            background: rgba(0, 0, 0, 0.2);
          }

          .details-container {
            position: relative;
            display: flex;
            align-items: center;
            width: 100%;
            height: 100%;
            overflow: hidden;

            .fill {
              position: absolute;
              width: ${percentage + '%'};
              height: 100%;
              background: ${ACTOR_TEAM_COLORS(team).healthBar};
            }

            .overheal {
              position: absolute;
              width: ${percentage - 100 + '%'};
              height: 100%;
              background: rgba(255, 255, 255, 0.4);
            }

            .name {
              position: relative;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              padding: 0 0.3rem;
            }

            .spacer {
              flex: 1;
            }

            .health {
              position: relative;
              color: #ffffff;
              font-weight: bold;
              padding: 0 0.3rem;

              &.buffed {
                color: ${ACTOR_TEAM_COLORS(team).healthBuffed};
              }

              &.low {
                color: ${ACTOR_TEAM_COLORS(team).healthLow};
              }
            }
          }

          &.align-left {
            flex-flow: row nowrap;

            .details-container {
              flex-flow: row nowrap;
            }

            .fill {
              left: 0;
            }
          }

          &.align-right {
            flex-flow: row-reverse nowrap;

            .details-container {
              flex-flow: row-reverse nowrap;
            }

            .fill {
              right: 0;
            }
          }
        }
      `}</style>
    </>
  )
}
