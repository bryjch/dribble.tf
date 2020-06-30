import React from 'react'
import 'react-three-fiber'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'
import { Actor } from '@components/Scene/Actor'

import { arrayToVector3 } from '@utils/geometry'

export interface ActorsProps {
  parser: AsyncParser
  playback: any
}

export const Actors = (props: ActorsProps) => {
  const { parser, playback } = props

  const playersThisTick = parser ? parser.getPlayersAtTick(playback.tick) : []

  return (
    <group name="actors">
      {playersThisTick.map((player, index) => {
        // This position conversion is necessary due to parser
        //using Point type instead of Vector3
        // TODO: update the parser data structures to be three.js comptable
        const position = arrayToVector3([player.position.x, player.position.y, player.position.z])
        return <Actor key={`actor-${index}`} {...player} position={position} />
      })}
    </group>
  )
}
