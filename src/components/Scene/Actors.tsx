import React from 'react'
import 'react-three-fiber'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'
import { Actor } from '@components/Scene/Actor'

import { objCoordsToVector3 } from '@utils/geometry'

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
        // TODO: update the parser data structures to be three.js compatible
        const position = objCoordsToVector3(player.position)
        const viewAngles = objCoordsToVector3(player.viewAngles)
        return (
          <Actor key={`actor-${index}`} {...player} position={position} viewAngles={viewAngles} />
        )
      })}
    </group>
  )
}
