import { inRange } from 'lodash'

import { AsyncParser, CachedDeath } from '@components/Analyse/Data/AsyncParser'
import { KILL_ICON_ALIASES } from '@constants/killIconAliases'
import { cn } from '@utils/styling'

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
    <div className="flex flex-col items-end text-right">
      {relevantDeaths.map((death, index) => (
        <KillfeedItem key={`killfeed-item-${index}`} death={death} />
      ))}
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

  const teamTextColorMap: { [key: string]: string } = {
    red: 'text-pp-killfeed-text-red',
    blue: 'text-pp-killfeed-text-blue',
  }
  let killerTeamColor = killer ? teamTextColorMap[killer.user.team] : ''
  let victimTeamColor = teamTextColorMap[victim?.user.team]

  return (
    <>
      <div className="mb-2 flex bg-pp-panel/70 px-4 py-1 font-bold">
        {killer && killer !== victim && (
          <div className={cn(killerTeamColor)}>{killer.user.name}</div>
        )}

        {assister && <div className={cn('mx-2', killerTeamColor)}>+</div>}

        {assister && <div className={cn(killerTeamColor)}>{assister.user.name}</div>}

        <div className="inline-flex items-center px-4">
          <img src={weaponIcon} className="h-[1.2rem] brightness-[600%]" alt={`${weapon} Icon`} />
        </div>

        <div className={cn(victimTeamColor)}>{victim.user.name}</div>
      </div>
    </>
  )
}
