import React from 'react'
import 'react-three-fiber'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'
import { Actor } from '@components/Scene/Actor'

export interface ActorsProps {
  parser: AsyncParser
  tick: any
}

export const Actors = (props: ActorsProps) => {
  const { parser, tick } = props

  const playersThisTick = parser
    ? parser.getPlayersAtTick(tick).filter(({ connected }) => connected)
    : []

  return (
    <group name="actors">
      {playersThisTick.map((player, index) => (
        <Actor key={`actor-${index}`} {...player} />
      ))}
    </group>
  )
}
