import '@react-three/fiber'

import { CachedPlayer } from '@components/Analyse/Data/PlayerCache'
import { Actor } from '@components/Scene/Actor'

export interface ActorsProps {
  players: CachedPlayer[]
}

export const Actors = (props: ActorsProps) => {
  const { players = [] } = props

  return (
    <group name="actors">
      {players.map((player, index) => (
        <Actor key={`actor-${index}`} {...player} />
      ))}
    </group>
  )
}
