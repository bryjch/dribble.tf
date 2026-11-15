import { CachedPlayer } from '@components/Analyse/Data/PlayerTracks'
import {
  ControlPoint,
  Intel,
  ObjectiveState,
  ObjectiveTeam,
  PayloadCart,
  RoundTimer,
} from '@components/Analyse/Data/ObjectiveTimeline'

import { cn } from '@utils/styling'

//
// ─── OBJECTIVE HUD ──────────────────────────────────────────────────────────────
//
// The top of TF2's HUD: rounds won either side of the round timer, then the control points,
// the payload cart's progress and where the flags are. BLU is on the left, as in game.
//

const TEAM_CSS: Record<ObjectiveTeam, string> = {
  blue: 'rgb(var(--ui-blu))',
  red: 'rgb(var(--ui-red))',
  spectator: 'rgb(var(--ui-neutral))',
  none: 'rgb(var(--ui-neutral))',
}

const TEAM_LABEL: Record<ObjectiveTeam, string> = { blue: 'BLU', red: 'RED', spectator: '', none: '' }

export const formatClock = (secs: number) => {
  const whole = Math.ceil(Math.max(0, secs))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** What the HUD says under the timer, if anything. */
function roundLabel(state: ObjectiveState, timer: RoundTimer | undefined) {
  switch (state.round) {
    case 'pregame':
      return 'Waiting for players'
    case 'preround':
      return 'Round starting'
    case 'team_win':
      return 'Round over'
    case 'stalemate':
      return 'Sudden death'
    case 'game_over':
      return 'Game over'
  }
  if (timer?.setup) return 'Setup'
  if (state.stopwatch?.state === 'overtime') return 'Overtime'
  return null
}

const Clock = ({ secs, className, ...rest }: { secs: number; className?: string; [key: string]: any }) => (
  <span className={cn('tabular-nums', className)} {...rest}>
    {formatClock(secs)}
  </span>
)

/** The round timer, or on King of the Hill each team's. */
const Timers = ({ state }: { state: ObjectiveState }) => {
  const teamTimers = state.timers.filter(t => t.team === 'blue' || t.team === 'red')
  if (teamTimers.length === 2) {
    const [blue, red] = ['blue', 'red'].map(team => teamTimers.find(t => t.team === team)!)
    return (
      <div className="flex gap-3">
        <Clock secs={blue.remaining} className="hud-timer hud-team-ink" data-team="blue" data-paused={blue.paused} />
        <Clock secs={red.remaining} className="hud-timer hud-team-ink" data-team="red" data-paused={red.paused} />
      </div>
    )
  }
  const shared = state.timers.find(t => t.setup) ?? state.timers[0]
  const secs = state.stopwatch?.inHud ? state.stopwatch.time : (shared?.remaining ?? state.timeLeft)
  if (secs == null) return null
  return <Clock secs={secs} className="hud-timer" />
}

const Point = ({ point }: { point: ControlPoint }) => {
  const progress = point.capping !== 'none' ? point.progress : 0
  const contested = point.red > 0 && point.blue > 0
  const cappers = point.capping === 'red' ? point.red : point.capping === 'blue' ? point.blue : 0
  return (
    <div className="hud-point" data-owner={point.owner} data-locked={point.locked} data-contested={contested}>
      {progress > 0 && (
        <div
          className="hud-point__progress"
          style={{ background: `conic-gradient(${TEAM_CSS[point.capping]} ${progress * 360}deg, transparent 0)` }}
        />
      )}
      <span className="hud-point__label">
        {point.locked ? <LockIcon /> : contested ? '!' : cappers > 0 ? `×${cappers}` : ''}
      </span>
    </div>
  )
}

const LockIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-label="Locked">
    <path d="M5 7V5a3 3 0 0 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-5A1.5 1.5 0 0 1 4.5 7H5zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2z" />
  </svg>
)

const Cart = ({ cart }: { cart: PayloadCart }) => (
  <div className="hud-cart" data-team={cart.team}>
    <div className="hud-cart__track">
      <div className="hud-cart__fill" style={{ width: `${cart.progress * 100}%` }} />
    </div>
    <span className="hud-cart__note">{cart.speed < 0 ? 'Back' : cart.cappers > 0 ? `×${cart.cappers}` : ''}</span>
  </div>
)

const FLAG_STATUS = { home: 'Home', carried: 'Taken', dropped: 'Dropped' }

const Flag = ({ flag, carrier }: { flag: Intel; carrier: string | null }) => (
  <div className="hud-flag" data-team={flag.team}>
    <span className="hud-flag__swatch" />
    <span>{TEAM_LABEL[flag.team]}</span>
    <span className="ui-muted">
      {FLAG_STATUS[flag.status]}
      {flag.status === 'carried' && carrier && ` · ${carrier}`}
      {flag.status === 'dropped' && flag.returnsIn != null && ` · ${formatClock(flag.returnsIn)}`}
    </span>
  </div>
)

export interface ObjectiveHudProps {
  state: ObjectiveState
  players: CachedPlayer[]
}

export const ObjectiveHud = ({ state, players }: ObjectiveHudProps) => {
  const shared = state.timers.find(t => t.setup) ?? state.timers[0]
  const label = roundLabel(state, shared)
  const nameOf = (entityId: number | null) =>
    entityId ? (players.find(p => p.user.entityId === entityId)?.user.name ?? null) : null
  const { stopwatch } = state

  return (
    <div className="hud-objective">
      <div className="hud-scorebar">
        <div className="hud-score" data-team="blue">
          <span className="hud-score__team">BLU</span>
          {state.score.blue}
        </div>
        <div className="hud-timer-block">
          <Timers state={state} />
          {label && <div className="hud-round-label">{label}</div>}
        </div>
        <div className="hud-score" data-team="red">
          {state.score.red}
          <span className="hud-score__team">RED</span>
        </div>
      </div>

      {stopwatch && stopwatch.state !== 'unset' && (
        <div className="hud-subchip">
          <span>
            <span className="hud-team-ink" data-team={stopwatch.attackers}>
              {TEAM_LABEL[stopwatch.attackers]}
            </span>{' '}
            {stopwatch.setting ? 'set' : 'to beat'} <Clock secs={stopwatch.time} /> · {stopwatch.points}{' '}
            {stopwatch.points === 1 ? 'point' : 'points'}
          </span>
        </div>
      )}

      {state.points.length > 0 && (
        <div className="hud-points">
          {state.points.map(point => (
            <Point key={point.index} point={point} />
          ))}
        </div>
      )}

      {state.carts.map(cart => (
        <Cart key={cart.id} cart={cart} />
      ))}

      {state.flags.length > 0 && (
        <div className="hud-subchip">
          {state.flags.map(flag => (
            <Flag key={flag.id} flag={flag} carrier={nameOf(flag.carrier)} />
          ))}
          {state.captures && (
            <span>
              <span className="hud-team-ink" data-team="blue">{state.captures.blue}</span>
              {' – '}
              <span className="hud-team-ink" data-team="red">{state.captures.red}</span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
