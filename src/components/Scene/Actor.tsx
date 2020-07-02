import React, { useRef } from 'react'

import * as THREE from 'three'
import 'react-three-fiber'
import { HTML } from 'drei'

import { Nameplate } from '@components/Scene/Nameplate'

import { ACTOR_TEAM_COLORS } from '@constants/mappings'
import { degreesToRadians } from '@utils/geometry'

// Default TF2 player dimensions as specified in:
// https://developer.valvesoftware.com/wiki/TF2/Team_Fortress_2_Mapper%27s_Reference
export const ActorDimensions = new THREE.Vector3(49, 49, 83)

export const AimLineSize = 300

export interface ActorProps {
  position: THREE.Vector3
  viewAngles: THREE.Vector3
  classId: number
  health: number
  team: string
  user: {
    name: string
  }
}

export const Actor = (props: ActorProps) => {
  const ref = useRef<THREE.Group>()
  const lastViewAngleX = useRef<number>(0)
  const lastViewAngleY = useRef<number>(0)

  const { position, classId, health, team, user } = props
  let { viewAngles } = props

  const alive = health > 0
  const color = ACTOR_TEAM_COLORS(team).actorModel

  // Hack for parser's tick data randomly returning 0 / huge value on certain frames
  if (viewAngles.x === 0) {
    viewAngles.x = lastViewAngleX.current
  } else {
    lastViewAngleX.current = viewAngles.x
  }

  // Hack for parser's tick data randomly returning 0 / huge value on certain frames
  if (viewAngles.y === 0 || viewAngles.y > 90) {
    viewAngles.y = lastViewAngleY.current
  } else {
    lastViewAngleY.current = viewAngles.y
  }

  return (
    <group
      name="actor"
      ref={ref}
      position={position}
      rotation={[0, 0, degreesToRadians(viewAngles.x)]}
    >
      {/* Box mesh */}
      <mesh visible={alive}>
        <boxGeometry
          attach="geometry"
          args={[ActorDimensions.x, ActorDimensions.y, ActorDimensions.z]}
        />
        <meshLambertMaterial attach="material" color={color} />
      </mesh>

      {/* Aim line */}
      <group name="aimLineContainer" rotation={[0, degreesToRadians(viewAngles.y), 0]}>
        <mesh visible={alive} position={[AimLineSize * 0.5, 0, 0]}>
          <boxGeometry attach="geometry" args={[AimLineSize, 2, 2]} />
          <meshBasicMaterial attach="material" color={color} />
        </mesh>
      </group>

      {/* Nameplate */}
      <HTML
        className="no-select"
        style={{ bottom: 0, transform: 'translateX(-50%)' }}
        position={[0, 0, ActorDimensions.z * 0.75]}
      >
        {alive && <Nameplate name={user.name} team={team} health={health} classId={classId} />}
      </HTML>
    </group>
  )
}
