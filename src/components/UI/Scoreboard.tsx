import type { MatchSource, ScoreLine } from '@components/Analyse/Data/MatchSource'
import type { CachedPlayer } from '@components/Analyse/Data/PlayerTracks'
import { ClassIcon } from '@components/UI/ClassIcon'

import { useInstance, useStore } from '@zus/store'
import { setScoreboardOpenAction } from '@zus/actions'

//
// ─── SCOREBOARD ─────────────────────────────────────────────────────────────────
//
// Held open with Tab (CanvasKeyHandler / GlobalKeyHandler). TF2's scoreboard as stv.tf shows
// it: each team's rounds won and players, with their points, kills, deaths, assists, damage,
// healing and ping at the tick being watched (MatchSource.scoresAt).
//

const TEAMS = [
  { team: 'blue', label: 'BLU' },
  { team: 'red', label: 'RED' },
] as const

interface Column {
  key: keyof ScoreLine
  label: string
  title: string
  wide?: boolean
  /** Counted from damage and heal events, which older SourceTV demos do not record. */
  counted?: boolean
}

const COLUMNS: Column[] = [
  { key: 'points', label: 'Points', title: 'Points', wide: true },
  { key: 'kills', label: 'K', title: 'Kills' },
  { key: 'deaths', label: 'D', title: 'Deaths' },
  { key: 'assists', label: 'A', title: 'Assists' },
  { key: 'damage', label: 'Damage', title: 'Damage dealt', wide: true, counted: true },
  { key: 'healing', label: 'Healing', title: 'Healing given', wide: true, counted: true },
  { key: 'ping', label: 'Ping', title: 'Ping (ms)', wide: true },
]

const EMPTY_LINE: ScoreLine = { points: 0, kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, ping: 0 }

export const Scoreboard = ({ match, players }: { match: MatchSource; players: CachedPlayer[] }) => {
  const open = useStore(state => state.ui.scoreboardOpen)
  const tick = useStore(state => state.playback.tick)
  const focusedEntityId = useInstance(state => state?.focusedObject?.userData?.entityId)
  if (!open) return null

  const scores = match.scoresAt(tick)
  const lineOf = (player: CachedPlayer) => scores.get(player.user.entityId) ?? EMPTY_LINE
  const teamScore = match.objectivesAt(tick)?.score ?? roundsWon(match, tick)
  const columns = hasCountedColumns(match) ? COLUMNS : COLUMNS.filter(column => !column.counted)

  return (
    <div
      className="hud-scoreboard"
      role="dialog"
      aria-label="Scoreboard"
      onClick={() => setScoreboardOpenAction(false)}
    >
      <div className="hud-scoreboard__card" onClick={event => event.stopPropagation()}>
        {TEAMS.map(({ team, label }) => {
          const roster = players
            .filter(p => p.team === team)
            .sort((a, b) => lineOf(b).points - lineOf(a).points)
          return (
            <section key={team} className="hud-scoreboard__team" data-team={team}>
              <header className="hud-scoreboard__team-head">
                <span className="hud-scoreboard__team-name">{label}</span>
                <span className="hud-scoreboard__team-score">{teamScore[team]}</span>
                <span className="hud-scoreboard__team-count">
                  {roster.length} {roster.length === 1 ? 'player' : 'players'}
                </span>
              </header>

              <table className="hud-scoreboard__table">
                <thead>
                  <tr>
                    <th className="hud-scoreboard__class" aria-label="Class" />
                    <th className="hud-scoreboard__name">Name</th>
                    {columns.map(column => (
                      <th
                        key={column.key}
                        title={column.title}
                        className="hud-scoreboard__stat"
                        data-wide={column.wide ? 'true' : undefined}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roster.map(player => {
                    const line = lineOf(player)
                    return (
                      <tr
                        key={player.user.entityId}
                        className="hud-scoreboard__row"
                        data-dead={player.health <= 0 ? 'true' : undefined}
                        data-focused={focusedEntityId === player.user.entityId ? 'true' : undefined}
                      >
                        <td className="hud-scoreboard__class">
                          <ClassIcon classId={player.classId} size={16} />
                        </td>
                        <td className="hud-scoreboard__name">{player.user.name}</td>
                        {columns.map(column => (
                          <td
                            key={column.key}
                            className="hud-scoreboard__stat"
                            data-wide={column.wide ? 'true' : undefined}
                          >
                            {line[column.key]}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** Whether the match has any damage or healing by its last tick: older demos have none. */
function hasCountedColumns(match: MatchSource) {
  for (const line of match.scoresAt(match.ticks - 1).values()) {
    if (line.damage > 0 || line.healing > 0) return true
  }
  return false
}

/** Rounds each team has won by a tick, for a match whose round state is not known. */
function roundsWon(match: MatchSource, tick: number) {
  const won = { red: 0, blue: 0 }
  for (const round of match.rounds) {
    if (round.endTick <= tick && (round.winner === 'red' || round.winner === 'blue')) won[round.winner]++
  }
  return won
}
