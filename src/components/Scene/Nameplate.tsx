import { clamp } from 'lodash'

import { ClassIcon } from '@components/UI/ClassIcon'
import { ConditionBadges } from '@components/UI/ConditionBadges'
import { UberedKind } from '@components/Analyse/Data/StreamEvents'

import { parseClassHealth } from '@utils/players'
import { cn } from '@utils/styling'

export interface NameplateProps {
  health: number
  classId: number
  name: string
  team: string
  conditions?: number
  ubered?: UberedKind | null
  settings: Object | any
}

export const Nameplate = (props: NameplateProps) => {
  const { health, classId, name, team, conditions = 0, ubered = null, settings } = props

  const { percentage } = parseClassHealth(classId, health)

  if (!settings.enabled) return null

  return (
    <>
      <div className="pointer-events-none bottom-0 flex select-none flex-col items-center text-center">
        {settings.showName && (
          <div
            className={cn(
              'max-w-40 overflow-hidden text-ellipsis whitespace-nowrap px-[0.1rem] text-[0.9rem] font-bold leading-none',
              // Far from the camera (see Actors' sizePlate): class and health only.
              'group-data-[compact=true]/plate:hidden',
              '[text-shadow:0_0_2px_#000000,0_0_2px_#000000,0_0_2px_#000000,0_0_2px_#000000]'
            )}
          >
            {name}
          </div>
        )}

        {settings.showHealth && (
          <div className="relative mt-1 h-[6px] w-20 overflow-hidden bg-[#8f7b89]">
            <div
              className={cn(
                'absolute inset-0 right-auto',
                team === 'red' && 'bg-pp-healthbar-red',
                team === 'blue' && 'bg-pp-healthbar-blue'
              )}
              style={{ width: `${percentage}%` }}
            />

            <div
              className="absolute inset-0 right-auto bg-[#eeeeee]"
              style={{ width: `${clamp(percentage - 100, 0, 100)}%` }}
            />
          </div>
        )}

        {settings.showConditions !== false && (
          <ConditionBadges className="mt-1" conditions={conditions} ubered={ubered} team={team} />
        )}

        {settings.showClass && (
          <div
            className={cn(
              'mt-1 rounded-full border-[3px] border-black/20',
              team === 'red' && 'bg-pp-healthbar-red',
              team === 'blue' && 'bg-pp-healthbar-blue'
            )}
          >
            <ClassIcon classId={classId} size={16} />
          </div>
        )}
      </div>
    </>
  )
}
