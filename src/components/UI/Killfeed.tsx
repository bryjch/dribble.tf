import { inRange } from 'lodash'

import type { CachedDeath, MatchSource } from '@components/Analyse/Data/MatchSource'

import { jumpToPlayerPOVCamera } from '@zus/actions'
import { useInstance } from '@zus/store'
import { focusMainCanvas } from '@utils/misc'
import { killIconUrl } from '@utils/killIcons'
import { cn } from '@utils/styling'
import { useIsMobile } from '@utils/hooks'

const RELEVANT_DEATH_LINGER_TICKS = 200 // Keep death in feed for this many ticks

export interface KillfeedProps {
  parser: MatchSource
  tick: number
}

export interface KillfeedItemProps {
  death: CachedDeath
  highlighted?: boolean
}

export const Killfeed = (props: KillfeedProps) => {
  const focusedObject = useInstance(state => state.focusedObject)
  const isMobile = useIsMobile()
  const { parser, tick } = props
  const { deaths } = parser

  let relevantDeaths: CachedDeath[] = []

  for (const deathTickKey in deaths) {
    const deathTick = Number(deathTickKey)
    if (inRange(tick, deathTick, deathTick + RELEVANT_DEATH_LINGER_TICKS)) {
      relevantDeaths = relevantDeaths.concat(deaths[deathTickKey])
    }
  }

  // Limit to 3 kills on mobile to save space
  if (isMobile) {
    relevantDeaths = relevantDeaths.slice(-3)
  }

  return (
    <div className={cn('hud-killfeed', isMobile && 'text-xs')} aria-live="off">
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

  const weaponIcon = killIconUrl(weapon)

  const killerTeam = killer?.user.team

  const onClickPlayerName = (entityId: number) => {
    jumpToPlayerPOVCamera(entityId)
    focusMainCanvas()
  }

  return (
    <div className="hud-kill" data-highlighted={props.highlighted ? 'true' : undefined}>
      {killer && killer !== victim && (
        <span
          className="hud-kill__name"
          data-team={killerTeam}
          onClick={onClickPlayerName.bind(this, killer.user.entityId)}
        >
          {killer.user.name}
        </span>
      )}

      {assister && (
        <>
          <span className="hud-kill__plus" data-team={killerTeam}>
            +
          </span>
          <span
            className="hud-kill__name"
            data-team={killerTeam}
            onClick={onClickPlayerName.bind(this, assister.user.entityId)}
          >
            {assister.user.name}
          </span>
        </>
      )}

      <span className="hud-kill__weapon">
        <img src={weaponIcon} className="hud-kill__icon" alt={weapon} />
      </span>

      <span
        className="hud-kill__name"
        data-team={victim?.user.team}
        onClick={onClickPlayerName.bind(this, victim.user.entityId)}
      >
        {victim.user.name}
      </span>
    </div>
  )
}
