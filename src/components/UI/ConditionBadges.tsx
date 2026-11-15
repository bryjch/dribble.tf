import { ConditionFlag, MedigunState, UberedKind, hasCondition } from '@components/Analyse/Data/StreamEvents'

import { cn } from '@utils/styling'

//
// ─── CONDITION BADGES ───────────────────────────────────────────────────────────
//
// What a player is under, as small labelled pills: the charge first, then what was done to
// them, then their own buffs. Overheal, blast jumping, zooming and taunting are left out: the
// health bar and the model already say them.
//

/** How TF2's HUD names a charge. */
export const UBERED_LABELS: Record<UberedKind, string> = {
  uber: 'ÜBER',
  kritz: 'KRITZ',
  quickfix: 'QUICK-FIX',
  vaccinator_bullet: 'VACC · BULLET',
  vaccinator_blast: 'VACC · BLAST',
  vaccinator_fire: 'VACC · FIRE',
}

export const MEDIGUN_LABELS: Record<MedigunState['kind'], string> = {
  medigun: 'MEDI GUN',
  kritzkrieg: 'KRITZKRIEG',
  quickfix: 'QUICK-FIX',
  vaccinator: 'VACCINATOR',
}

const BADGES: { flag: ConditionFlag; label: string; className: string }[] = [
  { flag: 'crits', label: 'CRITS', className: 'bg-[#f4f0dc] text-black' },
  { flag: 'minicrits', label: 'MINI-CRITS', className: 'bg-[#f4f0dc]/70 text-black' },
  { flag: 'burning', label: 'BURNING', className: 'bg-[#e8681c] text-white' },
  { flag: 'jarate', label: 'JARATE', className: 'bg-[#d9b82b] text-black' },
  { flag: 'milk', label: 'MILK', className: 'bg-[#f2f2f2] text-black' },
  { flag: 'bleeding', label: 'BLEEDING', className: 'bg-[#a3162a] text-white' },
  { flag: 'marked', label: 'MARKED', className: 'bg-[#5b2a86] text-white' },
  { flag: 'stunned', label: 'STUNNED', className: 'bg-[#6b6b6b] text-white' },
  { flag: 'bonk', label: 'BONK', className: 'bg-[#e6c200] text-black' },
  { flag: 'defense', label: 'BATTALION', className: 'bg-[#3d4a5a] text-white' },
  { flag: 'regen', label: 'CONCH', className: 'bg-[#3d5a44] text-white' },
  { flag: 'speed', label: 'SPEED', className: 'bg-[#3d5a5a] text-white' },
  { flag: 'cloaked', label: 'CLOAKED', className: 'bg-black/70 text-white' },
  { flag: 'disguised', label: 'DISGUISED', className: 'bg-black/70 text-white' },
]

export interface ConditionBadgesProps {
  conditions: number
  ubered: UberedKind | null
  team: string
  className?: string
}

export const ConditionBadges = ({ conditions, ubered, team, className }: ConditionBadgesProps) => {
  const badges = BADGES.filter(({ flag }) => hasCondition(conditions, flag))
  if (!ubered && badges.length === 0) return null

  return (
    <div className={cn('flex max-w-32 flex-wrap justify-center gap-[2px]', className)}>
      {ubered && (
        <span
          className={cn(
            'rounded-sm px-1 text-[0.6rem] font-bold leading-[0.9rem] text-white',
            team === 'red' ? 'bg-pp-healthbar-red' : 'bg-pp-healthbar-blue'
          )}
        >
          {UBERED_LABELS[ubered]}
        </span>
      )}
      {badges.map(({ flag, label, className }) => (
        <span
          key={flag}
          className={cn('rounded-sm px-1 text-[0.6rem] font-bold leading-[0.9rem]', className)}
        >
          {label}
        </span>
      ))}
    </div>
  )
}
