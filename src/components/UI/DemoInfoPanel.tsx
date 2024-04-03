import moment from 'moment'
import humanizeDuration from 'humanize-duration'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'

import { useStore } from '@zus/store'
import { goToTickAction } from '@zus/actions'

import { focusMainCanvas } from '@utils/misc'
import { cn } from '@utils/styling'

// Since parser only returns round ends (not round starts) we need to
// account for the humiliation period before it resets
const ROUND_HUMILIATION_BUFFER_TICKS = 150

export interface DemoInfoPanelProps {
  parser: AsyncParser
}

export const DemoInfoPanel = (props: DemoInfoPanelProps) => {
  const { parser } = props

  const tick = useStore(state => state.playback.tick)

  const rounds = [
    {
      tick: ROUND_HUMILIATION_BUFFER_TICKS,
      winningTeam: parser.rounds[0]?.winner || 'none',
      duration: parser.rounds[0]?.length,
    },
  ]

  parser.rounds.forEach((round, index) => {
    rounds.push({
      tick: round.endTick + ROUND_HUMILIATION_BUFFER_TICKS,
      winningTeam: parser.rounds[index + 1]?.winner || 'none',
      duration: parser.rounds[index + 1]?.length,
    })
  })

  const onClickRound = async (round: any) => {
    await goToTickAction(round.tick)
    focusMainCanvas()
  }

  return (
    <div className="d-flex flex-column align-items-start">
      <div>{parser.header.server}</div>
      <div>{parser.header.map}</div>
      <div>
        {humanizeDuration(moment.duration(parser.header.duration, 'seconds').asMilliseconds(), {
          round: true,
        })}
        {` (${parser.ticks * 2 - 1} ticks)`}
      </div>

      <div className="mt-4 font-bold">Rounds</div>

      <div className="flex">
        {rounds.map((round, index) => (
          <div
            key={`jump-to-round-${index}`}
            className={cn(
              'bg-pp-panel/80 relative mr-2 flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden text-sm hover:opacity-80',
              round.tick <= tick && 'bg-white text-black'
            )}
            onClick={onClickRound.bind(null, round)}
          >
            <span>{index + 1}</span>
            <div
              className={cn(
                'absolute -bottom-2 -right-2 h-4 w-4 rotate-45',
                round.winningTeam === 'red' && 'bg-pp-killfeed-text-red',
                round.winningTeam === 'blue' && 'bg-pp-killfeed-text-blue'
              )}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
