import { useEffect, useState } from 'react'
import { clamp } from 'lodash'

import type { MatchSource } from '@components/Analyse/Data/MatchSource'
import { isScenePlayer } from '@components/Scene/PlaybackDriver'
import { EMPTY_LINE, RosterHead, StatusItem, statColumns } from '@components/UI/PlayerStatuses'

import { useInstance, useStore } from '@zus/store'
import { sortPlayersByClassId } from '@utils/players'

//
// ─── TEAM RAILS ─────────────────────────────────────────────────────────────────
//
// Each team down its own side of the screen, BLU left and RED right, whichever way the phone is
// held. These are the desktop's rosters (PlayerStatuses' rows and head), narrowed to class and
// health. Opened out (the score tapped, ui.scoreboardOpen) they are the scoreboard, as on
// desktop: names and K / D / A / damage in place of health. Tap a row to watch that player.
//

type RailsProps = {
  match: MatchSource
  /** Space kept clear above and below the rails, px. */
  top: number
  bottom: number
}

const GAP = 3

export const Rails = ({ match, top, bottom }: RailsProps) => {
  const tick = useStore(state => state.playback.tick)
  const expanded = useStore(state => state.ui.scoreboardOpen)
  // Already class and health only, so compact and full look alike here; hidden hides them.
  const hidden = useStore(state => state.settings.ui.rails === 'hidden')
  const focusedId = useInstance(state => state?.focusedObject?.userData?.entityId)
  const height = useWindowHeight()

  const players = match.playersAt(tick).filter(isScenePlayer)
  const teams = {
    blue: players.filter(p => p.team === 'blue').sort(sortPlayersByClassId),
    red: players.filter(p => p.team === 'red').sort(sortPlayersByClassId),
  }
  const columns = expanded ? statColumns(match) : undefined
  const scores = expanded ? match.scoresAt(tick) : null

  // One row height for both rails, so they line up: as tall as fits, between 24 and 38px.
  const rows = Math.max(
    ...(['blue', 'red'] as const).map(team => {
      const medics = teams[team].filter(p => p.classId === 5).length
      return teams[team].length + medics * 0.6 + (expanded ? 1 : 0) + (medics ? 0.4 : 0)
    }),
    1
  )
  const rowHeight = clamp(Math.floor((height - top - bottom) / rows - GAP), 24, 38)

  if (hidden && !expanded) return null

  return (
    <>
      {(['blue', 'red'] as const).map(team => {
        const roster = teams[team]
        const medics = roster.filter(p => p.classId === 5)
        const side = team === 'blue' ? 'left' : 'right'
        return (
          <div
            key={team}
            className="hud-roster m-rail"
            data-team={team}
            data-expanded={expanded ? 'true' : undefined}
            aria-label={`${team === 'blue' ? 'BLU' : 'RED'} players`}
            style={
              {
                top,
                bottom,
                '--ui-roster-height': `${rowHeight}px`,
                '--ui-roster-gap': `${GAP}px`,
              } as React.CSSProperties
            }
          >
            {columns && <RosterHead team={team} columns={columns} />}

            {roster.map(player => (
              <StatusItem
                key={player.user.entityId}
                type="player"
                player={player}
                team={team}
                alignment={side}
                focused={focusedId === player.user.entityId}
                tick={tick}
                intervalPerTick={match.intervalPerTick}
                columns={columns}
                line={scores?.get(player.user.entityId) ?? EMPTY_LINE}
                iconSize={Math.round(rowHeight * 0.62)}
              />
            ))}

            {medics.length > 0 && <div className="hud-roster__break m-rail__break" />}
            {medics.map(player => (
              <StatusItem
                key={`charge-${player.user.entityId}`}
                type="uber"
                player={player}
                team={team}
                alignment={side}
                tick={tick}
                intervalPerTick={match.intervalPerTick}
              />
            ))}
          </div>
        )
      })}
    </>
  )
}

const useWindowHeight = () => {
  const [height, setHeight] = useState(window.innerHeight)
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return height
}
