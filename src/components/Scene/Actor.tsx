import React, { useState, useRef } from 'react'
import * as THREE from 'three'
import 'react-three-fiber'
import { HTML } from 'drei'

import { Nameplate } from './Nameplate'
import { degreesToRadians } from '../../utils/geometry'

// Default TF2 player dimensions as specified in:
// https://developer.valvesoftware.com/wiki/TF2/Team_Fortress_2_Mapper%27s_Reference
export const ActorDimensions = new THREE.Vector3(49, 49, 83)

export const AimLinePoints: THREE.Vector3[] = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(400, 0, 0),
]

export interface ActorProps {
  position: THREE.Vector3 | [number, number, number]
  viewAngle: number
  classId: number
  health: number
  team: string
  user: {
    name: string
  }
}

export const Actor = (props: ActorProps) => {
  const ref = useRef<THREE.Group>()
  const lastViewAngle = useRef<number>(0)
  const { position, classId, health, team, user } = props
  let { viewAngle } = props

  const alive = health > 0
  const color = team || '#cccccc'

  // Hack to deal with the parser's tick data randomly returning
  // zero value for {viewAngle} on certain frames
  if (viewAngle === 0) {
    viewAngle = lastViewAngle.current
  } else {
    lastViewAngle.current = viewAngle
  }

  return (
    <group ref={ref} position={position} rotation={[0, 0, degreesToRadians(viewAngle)]}>
      <mesh visible={alive}>
        <boxGeometry
          attach="geometry"
          args={[ActorDimensions.x, ActorDimensions.y, ActorDimensions.z]}
        />
        <meshLambertMaterial attach="material" color={color} />
      </mesh>

      <mesh visible={alive} position={[100, 0, 0]}>
        <boxGeometry attach="geometry" args={[200, 1, 1]} />
        <meshBasicMaterial attach="material" color={color} />
      </mesh>

      <HTML className="no-select" position={[0, 0, ActorDimensions.z * 1.5]} center>
        {alive && <Nameplate name={user.name} team={team} health={health} classId={classId} />}
      </HTML>
    </group>
  )
}
