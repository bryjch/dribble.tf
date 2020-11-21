import React, { useRef, useState, useEffect, Suspense } from 'react'

import * as THREE from 'three'
import { useFrame } from 'react-three-fiber'
import { Sphere, useGLTF } from '@react-three/drei'
import { GLTF } from 'three/examples/jsm/loaders/GLTFLoader'
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'
import { CachedProjectile } from '@components/Analyse/Data/ProjectileCache'

import { TEAM_MAP } from '@constants/mappings'
import { objCoordsToVector3, eulerizeVector } from '@utils/geometry'
import { getAsset } from '@utils/misc'

//
// ─── PROJECTILE MODEL ───────────────────────────────────────────────────────────
//

export interface ProjectileModelProps {
  type: 'rocket' | 'pipebomb' | 'stickybomb'
  team: string
  backface?: boolean
}

export const ProjectileModel = (props: ProjectileModelProps) => {
  const [cachedScene, setCachedScene] = useState<any>()

  const model = getAsset(`/models/projectiles/${props.type}_${props.team}.glb`)
  const gltf: GLTF = useGLTF(model, true)

  if (!cachedScene) {
    const cloned = SkeletonUtils.clone(gltf.scene)
    setCachedScene(cloned)
  }

  return <group>{cachedScene && <primitive object={cachedScene} />}</group>
}

//
// ─── PROJECTILES ────────────────────────────────────────────────────────────────
//

export interface ProjectilesProps {
  parser: AsyncParser
  playback: any
}

export const Projectiles = (props: ProjectilesProps) => {
  const { parser, playback } = props
  const projectilesThisTick = parser ? parser.getProjectilesAtTick(playback.tick) : []

  return (
    <group name="projectiles">
      {projectilesThisTick.map(projectile => {
        let Projectile

        if (projectile.type === 'rocket') Projectile = RocketProjectile
        if (projectile.type === 'pipebomb') Projectile = PipebombProjectile
        if (projectile.type === 'stickybomb') Projectile = StickybombProjectile
        if (projectile.type === 'healingBolt') Projectile = HealingBoltProjectile
        if (!Projectile) return null

        return <Projectile key={`projectile-${projectile.entityId}`} {...projectile} />
      })}
    </group>
  )
}

//
// ─── BASE PROJECTILE ────────────────────────────────────────────────────────────
//

export interface BaseProjectileProps extends CachedProjectile {}

//
// ─── ROCKET PROJECTILE ──────────────────────────────────────────────────────────
//

export const RocketProjectile = (props: BaseProjectileProps) => {
  const ref = useRef<THREE.Group>()
  const prevPosition = useRef<THREE.Vector3>(objCoordsToVector3(props.position))
  const position = objCoordsToVector3(props.position)

  // Seem to have a lot of difficulty using the projectile rotation values from
  // parser -- so instead we use a lookAt function from prev pos -> current pos
  // (which is pretty sketchy and renders incorrectly for initial spawn --
  // this can definitely be improved!)
  useEffect(() => {
    if (!prevPosition.current?.equals(position)) {
      ref.current?.lookAt(prevPosition.current)

      prevPosition.current = objCoordsToVector3(position)
    }
  }, [position])

  useFrame(() => {
    // TODO: smoke trails
  })

  return (
    <group name="rocket" ref={ref} position={position}>
      <Suspense fallback={null}>
        <ProjectileModel type="rocket" team="shared" />
      </Suspense>
    </group>
  )
}

//
// ─── PIPEBOMB PROJECTILE ────────────────────────────────────────────────────────
//

export const PipebombProjectile = (props: BaseProjectileProps) => {
  const team = TEAM_MAP[props.teamNumber]

  return (
    <group
      name="pipebomb"
      position={objCoordsToVector3(props.position)}
      rotation={eulerizeVector(props.rotation)}
    >
      <Suspense fallback={null}>{team && <ProjectileModel type="pipebomb" team={team} />}</Suspense>
    </group>
  )
}

//
// ─── STICKYBOMB PROJECTILE ──────────────────────────────────────────────────────
//

export const StickybombProjectile = (props: BaseProjectileProps) => {
  const team = TEAM_MAP[props.teamNumber]

  return (
    <group
      name="stickybomb"
      position={objCoordsToVector3(props.position)}
      rotation={eulerizeVector(props.rotation)}
    >
      <Suspense fallback={null}>
        {team && <ProjectileModel type="stickybomb" team={team} />}
      </Suspense>
    </group>
  )
}

//
// ─── HEALING BOLT PROJECTILE ────────────────────────────────────────────────────
//

export const HealingBoltProjectile = (props: BaseProjectileProps) => {
  return (
    <group name="healingBolt" position={objCoordsToVector3(props.position)}>
      <Sphere args={[5]}>
        <meshLambertMaterial attach="material" color="yellow" />
      </Sphere>
    </group>
  )
}
