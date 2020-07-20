import React from 'react'
import { inRange } from 'lodash'

import { AsyncParser, CachedDeath } from '@components/Analyse/Data/AsyncParser'
import { ACTOR_TEAM_COLORS } from '@constants/mappings'

const RELEVANT_DEATH_LINGER_TICKS = 200 // Keep death in feed for this many ticks

export interface KillfeedProps {
  parser: AsyncParser
  tick: number
}

export interface KillfeedItemProps {
  death: CachedDeath
}

export const Killfeed = (props: KillfeedProps) => {
  const { parser, tick } = props
  const { deaths } = parser

  let relevantDeaths: CachedDeath[] = []

  for (const deathTickKey in deaths) {
    const deathTick = Number(deathTickKey)
    if (inRange(tick, deathTick, deathTick + RELEVANT_DEATH_LINGER_TICKS)) {
      relevantDeaths = relevantDeaths.concat(deaths[deathTickKey])
    }
  }

  return (
    <div className="panel">
      {relevantDeaths.map((death, index) => (
        <KillfeedItem key={`killfeed-item-${index}`} death={death} />
      ))}

      <style jsx>{`
        .panel {
          display: flex;
          flex-flow: column nowrap;
          align-items: flex-end;
          font-size: 1rem;
          text-align: right;
        }
      `}</style>
    </div>
  )
}

export const KillfeedItem = (props: KillfeedItemProps) => {
  const { killer, assister, victim, weapon } = props.death

  return (
    <>
      <div className="killfeed-item">
        {killer && killer !== victim && (
          <div className={`killer ${killer.user.team}`}>{killer.user.name}</div>
        )}
        {assister && <div className={`plus ${assister.user.team}`}>+</div>}
        {assister && <div className={`assister ${assister.user.team}`}>{assister.user.name}</div>}
        <div className="weapon">{weapon}</div>
        <div className={`victim ${victim.user.team}`}>{victim.user.name}</div>
      </div>

      <style jsx>{`
        .killfeed-item {
          display: flex;
          flex-direction: row nowrap;
          background-color: rgba(0, 0, 0, 0.8);
          color: #ffffff;
          padding: 0.25rem 0.5rem;
          margin-bottom: 0.5rem;

          .killer {
          }

          .plus {
            margin: 0 0.5rem;
          }

          .assister {
          }

          .weapon {
            padding: 0 1rem;
          }

          .victim {
          }

          .red {
            color: ${ACTOR_TEAM_COLORS('red').killfeedText};
          }

          .blue {
            color: ${ACTOR_TEAM_COLORS('blue').killfeedText};
          }
        }
      `}</style>
    </>
  )
}
