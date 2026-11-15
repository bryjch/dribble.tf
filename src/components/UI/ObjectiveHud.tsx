import { CachedPlayer } from '@components/Analyse/Data/PlayerCache'
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

const TEAM_BG: Record<ObjectiveTeam, string> = {
  blue: 'bg-pp-healthbar-blue',
  red: 'bg-pp-healthbar-red',
  spectator: 'bg-[#6b6b6b]',
  none: 'bg-[#6b6b6b]',
}

const TEAM_TEXT: Record<ObjectiveTeam, string> = {
  blue: 'text-pp-killfeed-text-blue',
  red: 'text-pp-killfeed-text-red',
  spectator: '',
  none: '',
}

const TEAM_CSS: Record<ObjectiveTeam, string> = {
  blue: 'rgb(var(--pp-healthbar-blue))',
  red: 'rgb(var(--pp-healthbar-red))',
  spectator: '#6b6b6b',
  none: '#6b6b6b',
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

const Clock = ({ secs, className }: { secs: number; className?: string }) => (
  <span className={cn('tabular-nums', className)}>{formatClock(secs)}</span>
)

/** The round timer, or on King of the Hill each team's. */
const Timers = ({ state }: { state: ObjectiveState }) => {
  const teamTimers = state.timers.filter(t => t.team === 'blue' || t.team === 'red')
  if (teamTimers.length === 2) {
    const [blue, red] = ['blue', 'red'].map(team => teamTimers.find(t => t.team === team)!)
    return (
      <div className="flex gap-3 text-xl">
        <Clock secs={blue.remaining} className={cn(TEAM_TEXT.blue, blue.paused && 'opacity-50')} />
        <Clock secs={red.remaining} className={cn(TEAM_TEXT.red, red.paused && 'opacity-50')} />
      </div>
    )
  }
  const shared = state.timers.find(t => t.setup) ?? state.timers[0]
  const secs = state.stopwatch?.inHud ? state.stopwatch.time : (shared?.remaining ?? state.timeLeft)
  if (secs == null) return null
  return <Clock secs={secs} className="text-xl" />
}

const Point = ({ point }: { point: ControlPoint }) => {
  const progress = point.capping !== 'none' ? point.progress : 0
  const contested = point.red > 0 && point.blue > 0
  const cappers = point.capping === 'red' ? point.red : point.capping === 'blue' ? point.blue : 0
  return (
    <div className="flex flex-col items-center">
      <div
        className={cn(
          'relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-black/40',
          TEAM_BG[point.owner],
          point.locked && 'opacity-40'
        )}
      >
        {progress > 0 && (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `conic-gradient(${TEAM_CSS[point.capping]} ${progress * 360}deg, transparent 0)`,
            }}
          />
        )}
        <span className="relative text-[0.65rem] font-black text-white [text-shadow:0_0_2px_#000]">
          {point.locked ? '🔒' : contested ? '!' : cappers > 0 ? `×${cappers}` : ''}
        </span>
      </div>
    </div>
  )
}

const Cart = ({ cart }: { cart: PayloadCart }) => (
  <div className="flex w-64 items-center gap-2">
    <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-black/50">
      <div
        className={cn('absolute inset-y-0 left-0', TEAM_BG[cart.team])}
        style={{ width: `${cart.progress * 100}%` }}
      />
    </div>
    <span className="w-10 text-left text-xs font-black tabular-nums">
      {cart.speed < 0 ? '◀' : cart.cappers > 0 ? `×${cart.cappers}` : ''}
    </span>
  </div>
)

const FLAG_STATUS = { home: 'Home', carried: 'Taken', dropped: 'Dropped' }

const Flag = ({ flag, carrier }: { flag: Intel; carrier: string | null }) => (
  <div className="flex items-center gap-1 text-xs font-bold">
    <span className={cn('h-3 w-3 rounded-sm', TEAM_BG[flag.team])} />
    <span>{TEAM_LABEL[flag.team]}</span>
    <span className="opacity-70">
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
    <div className="pointer-events-none flex select-none flex-col items-center gap-1.5 font-bold">
      <div className="flex items-stretch overflow-hidden rounded-xl bg-pp-panel/70">
        <div className={cn('flex min-w-10 items-center justify-center px-3 text-xl', TEAM_BG.blue)}>
          {state.score.blue}
        </div>
        <div className="flex min-w-24 flex-col items-center justify-center px-4 py-1">
          <Timers state={state} />
          {label && <div className="text-[0.6rem] uppercase leading-tight opacity-70">{label}</div>}
        </div>
        <div className={cn('flex min-w-10 items-center justify-center px-3 text-xl', TEAM_BG.red)}>
          {state.score.red}
        </div>
      </div>

      {stopwatch && stopwatch.state !== 'unset' && (
        <div className="rounded-lg bg-pp-panel/70 px-3 py-0.5 text-xs">
          <span className={TEAM_TEXT[stopwatch.attackers]}>{TEAM_LABEL[stopwatch.attackers]}</span>{' '}
          {stopwatch.setting ? 'set' : 'to beat'} <Clock secs={stopwatch.time} /> · {stopwatch.points}{' '}
          {stopwatch.points === 1 ? 'point' : 'points'}
        </div>
      )}

      {state.points.length > 0 && (
        <div className="flex gap-1.5 rounded-xl bg-pp-panel/50 px-2 py-1">
          {state.points.map(point => (
            <Point key={point.index} point={point} />
          ))}
        </div>
      )}

      {state.carts.map(cart => (
        <Cart key={cart.id} cart={cart} />
      ))}

      {state.flags.length > 0 && (
        <div className="flex gap-3 rounded-lg bg-pp-panel/50 px-3 py-0.5">
          {state.flags.map(flag => (
            <Flag key={flag.id} flag={flag} carrier={nameOf(flag.carrier)} />
          ))}
          {state.captures && (
            <span className="text-xs">
              <span className={TEAM_TEXT.blue}>{state.captures.blue}</span>
              {' – '}
              <span className={TEAM_TEXT.red}>{state.captures.red}</span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
