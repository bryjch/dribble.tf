import { ClassIcon } from '@components/UI/ClassIcon'
import { ROLES, Role } from '@utils/matchEventFilter'
import type { MatchPlayerLine } from '@utils/matchEvents'

/**
 * The picked player: who, and chips for their kills, deaths, übers and drops that narrow the
 * list to one of those (or, with none on, everything they were in).
 */
export const PlayerCard = ({
  player,
  counts,
  role,
  onRole,
  onClose,
}: {
  player: MatchPlayerLine
  counts: Record<Role, number>
  role: Role | null
  onRole: (role: Role | null) => void
  onClose: () => void
}) => {
  // Übers only mean something for a medic; drops only once there are some.
  const shown = ROLES.filter(({ key }) =>
    key === 'ubers'
      ? player.classId === 5 || counts.ubers > 0
      : key === 'drops'
        ? counts.drops > 0
        : true
  )
  return (
    <div className="ui-player-card" data-team={player.team}>
      <div className="flex items-center gap-2">
        <ClassIcon classId={player.classId} size={22} />
        <div className="hud-team-ink min-w-0 flex-1 truncate text-sm font-extrabold">
          {player.name}
        </div>
        <span className="ui-muted text-[0.7rem]">{player.assists} assists</span>
        <button
          type="button"
          className="ui-icon-btn"
          onClick={onClose}
          aria-label={`Stop showing only ${player.name}`}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {shown.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className="ui-chip"
            data-team={player.team || undefined}
            aria-pressed={role === key}
            onClick={() => onRole(role === key ? null : key)}
          >
            {label}
            <span className="ui-chip__count">{counts[key]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
