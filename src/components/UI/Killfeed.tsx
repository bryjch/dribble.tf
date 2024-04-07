import { useState } from 'react'
import { inRange } from 'lodash'

import { AsyncParser, CachedDeath } from '@components/Analyse/Data/AsyncParser'
import { KILL_ICON_ALIASES } from '@constants/killIconAliases'

import { jumpToPlayerPOVCamera } from '@zus/actions'
import { useInstance } from '@zus/store'
import { focusMainCanvas } from '@utils/misc'
import { cn } from '@utils/styling'

const RELEVANT_DEATH_LINGER_TICKS = 200 // Keep death in feed for this many ticks

export interface KillfeedProps {
  parser: AsyncParser
  tick: number
}

export interface KillfeedItemProps {
  death: CachedDeath
  highlighted?: boolean
}

export const Killfeed = (props: KillfeedProps) => {
  const focusedObject = useInstance(state => state.focusedObject)
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
      {relevantDeaths.map(death => {
        let highlighted = false

        if (focusedObject) {
          highlighted = [death.killer?.user.entityId, death.assister?.user.entityId].includes(
            focusedObject.userData.entityId
          )
        }

        return (
          <KillfeedItem
            key={`killfeed-item-${death.tick}-${death.victim.user.entityId}`}
            death={death}
            highlighted={highlighted}
          />
        )
      })}
    </div>
  )
}

export const KillfeedItem = (props: KillfeedItemProps) => {
  const { killer, assister, victim, weapon } = props.death

  let iconName = KILL_ICON_ALIASES[weapon] || weapon
  let [weaponIcon, setWeaponIcon] = useState(
    new URL(`/src/assets/kill_icons/${iconName}.png`, import.meta.url).href
  )

  const teamTextColorMap: { [key: string]: string } = {
    red: 'text-pp-killfeed-text-red',
    blue: 'text-pp-killfeed-text-blue',
  }
  let killerTeamColor = killer ? teamTextColorMap[killer.user.team] : ''
  let victimTeamColor = teamTextColorMap[victim?.user.team]

  const onWeaponIconImgError = () => {
    console.log(`Missing kill icon: ${iconName}`)
    setWeaponIcon(new URL(`/src/assets/kill_icons/skull.png`, import.meta.url).href)
  }

  const onClickPlayerName = (entityId: number) => {
    jumpToPlayerPOVCamera(entityId)
    focusMainCanvas()
  }

  return (
    <div
      className={cn(
        'mb-2 flex rounded-xl bg-pp-panel/70 px-5 py-2 font-bold',
        props.highlighted && 'bg-white/90'
      )}
    >
      {killer && killer !== victim && (
        <div
          className={cn('cursor-pointer hover:underline', killerTeamColor)}
          onClick={onClickPlayerName.bind(this, killer.user.entityId)}
        >
          {killer.user.name}
        </div>
      )}

      {assister && <div className={cn('mx-2', killerTeamColor)}>+</div>}

      {assister && (
        <div
          className={cn('cursor-pointer hover:underline', killerTeamColor)}
          onClick={onClickPlayerName.bind(this, assister.user.entityId)}
        >
          {assister.user.name}
        </div>
      )}

      <div className="inline-flex items-center px-4">
        <img
          src={weaponIcon}
          className={cn('h-[1.2rem] ', props.highlighted ? '' : 'brightness-[600%]')}
          alt={`${weapon} Icon`}
          onError={onWeaponIconImgError}
        />
      </div>

      <div
        className={cn('cursor-pointer hover:underline', victimTeamColor)}
        onClick={onClickPlayerName.bind(this, victim.user.entityId)}
      >
        {victim.user.name}
      </div>
    </div>
  )
}
