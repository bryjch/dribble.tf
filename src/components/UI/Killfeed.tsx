import { inRange } from 'lodash'

import { AsyncParser, CachedDeath } from '@components/Analyse/Data/AsyncParser'
import { ACTOR_TEAM_COLORS } from '@constants/mappings'
import { KILL_ICON_ALIASES } from '@constants/killIconAliases'

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

  let iconName = KILL_ICON_ALIASES[weapon] || weapon
  let weaponIcon
  try {
    weaponIcon = new URL(`/src/assets/kill_icons/${iconName}.png`, import.meta.url).href
  } catch (e) {
    console.log(`Missing kill icon: ${iconName}`)
    weaponIcon = new URL(`/src/assets/kill_icons/skull.png`, import.meta.url).href
  }

  return (
    <>
      <div className="killfeed-item">
        {killer && killer !== victim && (
          <div className={`killer ${killer.user.team}`}>{killer.user.name}</div>
        )}
        {assister && <div className={`plus ${assister.user.team}`}>+</div>}
        {assister && <div className={`assister ${assister.user.team}`}>{assister.user.name}</div>}
        <div className="weapon">
          <img src={weaponIcon} className="weapon-icon" alt={`${weapon} Icon`} />
        </div>
        <div className={`victim ${victim.user.team}`}>{victim.user.name}</div>
      </div>

      <style jsx>{`
        .killfeed-item {
          display: flex;
          flex-direction: row nowrap;
          background-color: rgba(30, 30, 30, 0.75);
          color: #ffffff;
          font-weight: bold;
          padding: 0.25rem 1rem;
          margin-bottom: 0.5rem;

          .killer {
          }

          .plus {
            margin: 0 0.5rem;
          }

          .assister {
          }

          .weapon {
            display: inline-flex;
            align-items: center;
            padding: 0 1rem;

            .weapon-icon {
              height: 1.2rem;
              filter: brightness(600%);
            }
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
