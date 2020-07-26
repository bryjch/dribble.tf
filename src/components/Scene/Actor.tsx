import React, { useRef, useEffect } from 'react'
import { useSelector } from 'react-redux'

import * as THREE from 'three'
import { useThree } from 'react-three-fiber'
import { HTML, MeshWobbleMaterial } from 'drei'

import { Nameplate } from '@components/Scene/Nameplate'
import { CachedPlayer } from '@components/Analyse/Data/PlayerCache'

import { ACTOR_TEAM_COLORS } from '@constants/mappings'
import { objCoordsToVector3, radianizeVector } from '@utils/geometry'

// Default TF2 player dimensions as specified in:
// https://developer.valvesoftware.com/wiki/TF2/Team_Fortress_2_Mapper%27s_Reference
export const ActorDimensions = new THREE.Vector3(49, 49, 83)

export const AimLineSize = 300

export const Actor = (props: CachedPlayer) => {
  const ref = useRef<THREE.Group>()
  const lastViewAngleX = useRef<number>(0)
  const lastViewAngleY = useRef<number>(0)
  const { scene } = useThree()

  const nameplatesActive = useSelector((state: any) => state.settings.ui.nameplates.active)

  const { classId, health, team, user, healTarget } = props
  let { position, viewAngles } = props

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

  // Conversion needed because parser uses different Vector type
  const positionVec3: THREE.Vector3 = objCoordsToVector3(position)
  const viewAnglesVec3: THREE.Vector3 = radianizeVector(objCoordsToVector3(viewAngles))
  const healTargetVec3: THREE.Vector3 | undefined = healTarget
    ? scene
        .getObjectByName('actors')
        ?.children.find(({ userData }) => userData.entityId === healTarget)?.position
    : undefined

  return (
    <group
      name="actor"
      ref={ref}
      position={positionVec3}
      rotation={[0, 0, viewAnglesVec3.x]}
      userData={user}
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
      <group
        name="aimLineContainer"
        position={[ActorDimensions.x * 0.4, 0, ActorDimensions.z * 0.4]}
        rotation={[0, viewAnglesVec3.y, 0]}
      >
        <mesh visible={alive} position={[AimLineSize * 0.5, 0, 0]}>
          <boxGeometry attach="geometry" args={[AimLineSize, 2, 2]} />
          <meshBasicMaterial attach="material" color={color} />
        </mesh>

        <POVCamera />
      </group>

      {/* Medic heal beam */}
      {healTargetVec3 && (
        <group rotation={[0, 0, -viewAnglesVec3.x]}>
          <HealBeam
            origin={positionVec3}
            target={healTargetVec3}
            control={new THREE.Vector3(100, 0, 0).applyAxisAngle(
              new THREE.Vector3(0, 1, 0),
              viewAnglesVec3.x
            )}
            color={color}
          />
        </group>
      )}

      {/* Nameplate */}
      {nameplatesActive && (
        <HTML
          name="html"
          className="no-select"
          style={{ bottom: 0, transform: 'translateX(-50%)', textAlign: 'center' }}
          position={[0, 0, ActorDimensions.z * 0.75]}
        >
          {alive && <Nameplate name={user.name} team={team} health={health} classId={classId} />}
        </HTML>
      )}
    </group>
  )
}

// TODO: This implementation is quite sketchy (it relies on being parented to the Actor
// and does weird stuff with vectors / angles). It might be worth trying to rewrite
// this so it's rendered completely in world space.

export interface HealBeamProps {
  origin: THREE.Vector3
  target: THREE.Vector3
  control: THREE.Vector3
  color?: string
}

export const HealBeam = (props: HealBeamProps) => {
  const targetPos = new THREE.Vector3()
  targetPos.subVectors(props.target, props.origin)

  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0),
    props.control,
    targetPos
  )

  const geometry = new THREE.TubeBufferGeometry(curve, 10, 5, 5)

  return (
    <group name="healBeam">
      <mesh geometry={geometry}>
        <MeshWobbleMaterial
          attach="material"
          factor={0.15}
          speed={8}
          time={1}
          color={props.color || '#ffffff'}
          opacity={0.7}
          transparent
        />
      </mesh>
    </group>
  )
}

export interface POVCameraProps {}

export const POVCamera = (props: POVCameraProps) => {
  const ref = useRef<THREE.PerspectiveCamera>()

  const settings = useSelector((state: any) => state.settings)

  // // Un-comment this to render camera helpers for debugging
  // const { scene } = useThree()

  // const cameraHelper = useRef<THREE.CameraHelper>()

  // if (ref.current && !cameraHelper.current) {
  //   cameraHelper.current = new THREE.CameraHelper(ref.current)
  //   scene.add(cameraHelper.current)
  // }

  useEffect(() => {
    ref.current?.updateProjectionMatrix()
    // cameraHelper.current?.update()
  }, [settings])

  return (
    <perspectiveCamera
      name="povCamera"
      attach="camera"
      ref={ref}
      {...settings?.camera}
      position={[0, 0, 0]}
      rotation={[Math.PI * 0.5, Math.PI * -0.5, 0]}
    />
  )
}
