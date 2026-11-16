import { memo } from 'react'

import { killIconUrl } from '@utils/killIcons'
import { getDurationFromTicks } from '@utils/parser'
import { summarize } from '@utils/matchEventFilter'
import type { EventPlayer, MatchEvent, MatchEvents, MatchRound } from '@utils/matchEvents'

export const teamLabel = (team: string) => (team === 'blue' ? 'BLU' : team === 'red' ? 'RED' : '')

/** A time in the match, as the playback bar reads it. */
export const clock = (ticks: number, tickRate: number) =>
  getDurationFromTicks(Math.max(0, ticks), tickRate).formatted

const Name = ({
  player,
  onClick,
}: {
  player: EventPlayer
  onClick: (entityId: number) => void
}) => (
  <button
    type="button"
    className="ui-event-row__name max-w-[42%]"
    data-team={player.team || undefined}
    title={`Only ${player.name}'s events`}
    onClick={event => {
      event.stopPropagation()
      onClick(player.entityId)
    }}
  >
    {player.name}
  </button>
)

export interface EventRowProps {
  event: MatchEvent
  data: MatchEvents
  /** The event at the playhead. */
  now: boolean
  /** After the playhead. */
  future: boolean
  onSeek: (tick: number, entityId?: number) => void
  onPlayer: (entityId: number) => void
}

/** One moment of the match. Clicking it seeks there (watching whoever did it); a name picks that player. */
export const EventRow = memo(function EventRow({
  event: e,
  data,
  now,
  future,
  onSeek,
  onPlayer,
}: EventRowProps) {
  const rowProps = {
    'data-event-id': e.id,
    'data-now': now || undefined,
    'data-future': future || undefined,
  }
  const time = (
    <span className="ui-time w-[2.75rem] shrink-0 whitespace-nowrap">
      {clock(e.tick, data.tickRate)}
    </span>
  )

  if (e.kind === 'roundStart' || e.kind === 'roundWin' || e.kind === 'capture') {
    const team = e.kind === 'roundWin' ? e.winner : e.kind === 'capture' ? e.team : undefined
    const label =
      e.kind === 'roundStart'
        ? `Round ${e.round}`
        : e.kind === 'roundWin'
          ? `${teamLabel(e.winner)} wins · BLU ${e.score.blue} – ${e.score.red} RED`
          : `${teamLabel(e.team)} captured ${e.label}`
    return (
      <button
        type="button"
        className="ui-event-row w-full text-left"
        data-moment={e.kind}
        data-team={team}
        onClick={() => onSeek(e.tick)}
        {...rowProps}
      >
        {time}
        <span className="truncate">{label}</span>
      </button>
    )
  }

  if (e.kind === 'uber' || e.kind === 'uberReady') {
    return (
      <div
        className="ui-event-row cursor-pointer"
        onClick={() => onSeek(e.tick, e.medic.entityId)}
        {...rowProps}
      >
        {time}
        <Name player={e.medic} onClick={onPlayer} />
        {e.kind === 'uber' ? (
          <>
            <span className="ui-tag" data-tone="uber" title={e.medigun}>
              Über
            </span>
            {e.target && (
              <>
                <span className="ui-muted">→</span>
                <Name player={e.target} onClick={onPlayer} />
              </>
            )}
          </>
        ) : (
          <span className="ui-muted truncate text-xs">{e.medigun} charge ready</span>
        )}
      </div>
    )
  }

  return (
    <div
      className="ui-event-row cursor-pointer"
      data-streak={e.streak && e.streak >= 3 ? Math.min(4, e.streak) : undefined}
      onClick={() => onSeek(e.tick, e.killer?.entityId ?? e.victim.entityId)}
      {...rowProps}
    >
      {time}
      <div className="flex min-w-0 flex-1 items-center">
        {e.killer && <Name player={e.killer} onClick={onPlayer} />}
        {e.assister && (
          <span
            className="ui-muted ml-0.5 shrink-0 text-[0.65rem]"
            title={`Assist: ${e.assister.name}`}
          >
            +1
          </span>
        )}
        <span className="ui-event-row__weapon">
          <img src={killIconUrl(e.weapon)} alt={e.weapon} title={e.weapon} />
        </span>
        <Name player={e.victim} onClick={onPlayer} />
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {e.streak && (
          <span className="ui-tag" data-tone="streak">
            {e.streak}K
          </span>
        )}
        {e.airshot && (
          <span className="ui-tag" data-tone="airshot">
            Airshot
          </span>
        )}
        {e.medicDrop && (
          <span className="ui-tag" data-tone="drop">
            Drop
          </span>
        )}
      </div>
    </div>
  )
})

/** A round on one line: winner, length, and kills and übers per side. */
export const RoundSummary = memo(function RoundSummary({
  round,
  events,
  data,
  current,
}: {
  round: MatchRound
  events: MatchEvent[]
  data: MatchEvents
  current: boolean
}) {
  const s = summarize(events)
  const side = (team: 'blue' | 'red', n: number) => (
    <b data-team={team} className="hud-team-ink">
      {n}
    </b>
  )
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
      <span className="font-extrabold">R{round.round}</span>
      {round.winner ? (
        <span className="ui-tag" data-tone="team" data-team={round.winner}>
          {teamLabel(round.winner)}
        </span>
      ) : (
        <span className="ui-muted">—</span>
      )}
      {current && (
        <span className="ui-tag" data-tone="muted">
          Now
        </span>
      )}
      {round.lengthSeconds != null && (
        <span className="ui-time">{clock(round.lengthSeconds * data.tickRate, data.tickRate)}</span>
      )}
      <span className="ml-auto flex items-center gap-2 font-mono text-[0.7rem]">
        <span title="Kills, BLU–RED">
          {side('blue', s.blue.kills)}
          <span className="ui-muted">–</span>
          {side('red', s.red.kills)}
        </span>
        <span title="Übers, BLU–RED">
          <span className="ui-muted">Ü </span>
          {side('blue', s.blue.ubers)}
          <span className="ui-muted">–</span>
          {side('red', s.red.ubers)}
        </span>
      </span>
    </div>
  )
})
