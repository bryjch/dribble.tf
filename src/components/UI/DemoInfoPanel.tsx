import React, { useCallback } from 'react'
import moment from 'moment'
import humanizeDuration from 'humanize-duration'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'

import { useStore, dispatch } from '@redux/store'
import { goToTickAction } from '@redux/actions'

import { ACTOR_TEAM_COLORS } from '@constants/mappings'

// Since parser only returns round ends (not round starts) we need to
// account for the humiliation period before it resets
const ROUND_HUMILIATION_BUFFER_TICKS = 150

export interface DemoInfoPanelProps {
  parser: AsyncParser
}

export const DemoInfoPanel = (props: DemoInfoPanelProps) => {
  const { parser } = props

  const playback = useStore((state: any) => state.playback)
  const { tick } = playback

  const goToTick = useCallback(tick => dispatch(goToTickAction(tick)), [dispatch])

  const rounds = [
    {
      tick: ROUND_HUMILIATION_BUFFER_TICKS,
      winningTeam: parser.rounds[0]?.winner || 'none',
      duration: parser.rounds[0]?.length,
    },
  ]

  parser.rounds.forEach((round, index) => {
    rounds.push({
      tick: round.endTick + ROUND_HUMILIATION_BUFFER_TICKS,
      winningTeam: parser.rounds[index + 1]?.winner || 'none',
      duration: parser.rounds[index + 1]?.length,
    })
  })

  return (
    <div className="d-flex flex-column align-items-start">
      <div className="panel">
        <div>{parser.header.server}</div>
        <div>{parser.header.map}</div>
        <div>
          {humanizeDuration(moment.duration(parser.header.duration, 'seconds').asMilliseconds(), {
            round: true,
          })}
          {` (${parser.ticks - 1} ticks)`}
        </div>

        <div className="round-title">Rounds</div>

        <div className="rounds">
          {rounds.map((round, index) => {
            const roundCls = round.tick <= tick ? 'active' : ''
            const winnerCls = round.winningTeam

            return (
              <div
                key={`jump-to-round-${index}`}
                className={`round ${roundCls}`}
                onClick={goToTick.bind(null, round.tick)}
              >
                <span>{index + 1}</span>
                <div className={`winner ${winnerCls}`} />
              </div>
            )
          })}
        </div>
      </div>

      <style jsx>{`
        .panel {
          font-size: 1rem;

          .round-title {
            font-weight: bold;
            margin: 1rem 0 0 0;
          }

          .rounds {
            display: flex;
            flex-flow: row nowrap;

            .round {
              position: relative;
              width: 1.7rem;
              height: 1.7rem;
              display: flex;
              justify-content: center;
              align-items: center;
              font-size: 0.9rem;
              color: #ffffff;
              background-color: rgba(30, 30, 30, 0.75);
              margin-right: 0.5rem;
              cursor: pointer;

              &:hover {
                opacity: 0.8;
              }

              &.active {
                color: #000000;
                background-color: #ffffff;
                box-shadow: 0 0 2px #484848;
              }

              .winner {
                position: absolute;
                bottom: 0;
                right: 0;
                border-left: 8px solid transparent;

                &.red {
                  border-bottom: 8px solid ${ACTOR_TEAM_COLORS('red').killfeedText};
                }

                &.blue {
                  border-bottom: 8px solid ${ACTOR_TEAM_COLORS('blue').killfeedText};
                }
              }
            }
          }
        }
      `}</style>
    </div>
  )
}
