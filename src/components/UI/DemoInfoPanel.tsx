import React from 'react'
import moment from 'moment'
import humanizeDuration from 'humanize-duration'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'

export interface DemoInfoPanelProps {
  parser: AsyncParser
  tick: number
}

export const DemoInfoPanel = (props: DemoInfoPanelProps) => {
  const { parser } = props

  return (
    <div className="d-flex flex-column align-items-start">
      <div className="panel">
        <div>{parser.header.server}</div>
        <div>{parser.header.map}</div>
        <div>
          {humanizeDuration(moment.duration(parser.header.duration, 'seconds').asMilliseconds(), {
            round: true,
          })}
          {` (${parser.ticks - 1} ticks)`}
        </div>
      </div>

      <style jsx>{`
        .panel {
          font-size: 1rem;
        }
      `}</style>
    </div>
  )
}
