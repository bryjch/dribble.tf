import { useRef, useState, useEffect, Suspense } from 'react'

import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Sphere, useGLTF } from '@react-three/drei'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'

import { CachedProjectile } from '@components/Analyse/Data/ProjectileCache'
import { useInstance } from '@zus/store'

import { TEAM_MAP } from '@constants/mappings'
import { objCoordsToVector3, eulerizeVector } from '@utils/geometry'
import { getAsset } from '@utils/misc'

const TELEPORT_LERP_DISTANCE = 4096

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
  const gltf = useGLTF(model, true)

  if (!cachedScene) {
    const cloned = SkeletonUtils.clone(gltf.scene)
    setCachedScene(cloned)
  }

  return <group>{cachedScene && <primitive object={cachedScene} />}</group>
}

//
// ─── INTERPOLATED PROJECTILE ────────────────────────────────────────────────────
//

export interface InterpolatedProjectile extends CachedProjectile {
  positionNext: CachedProjectile['position']
  rotationNext: CachedProjectile['rotation']
}

//
// ─── PROJECTILES ────────────────────────────────────────────────────────────────
//

export interface ProjectilesProps {
  projectiles: InterpolatedProjectile[]
}

export const Projectiles = (props: ProjectilesProps) => {
  const { projectiles = [] } = props

  return (
    <group name="projectiles">
      {projectiles.map(projectile => {
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

export interface BaseProjectileProps extends InterpolatedProjectile {}

//
// ─── ROCKET PROJECTILE ──────────────────────────────────────────────────────────
//

export const RocketProjectile = (props: BaseProjectileProps) => {
  const ref = useRef<THREE.Group>(null)
  const prevPosition = useRef<THREE.Vector3>(objCoordsToVector3(props.position))
  const interpolatedPosition = useRef(new THREE.Vector3())
  const position = objCoordsToVector3(props.position)
  const positionNext = objCoordsToVector3(props.positionNext)
  const hasRenderInit = useRef(false)

  // Use lookAt from prev pos -> current pos for rotation (parser rotation is unreliable)
  useEffect(() => {
    if (!prevPosition.current?.equals(position)) {
      ref.current?.lookAt(prevPosition.current)
      prevPosition.current = objCoordsToVector3(position)
    }
  }, [position])

  useFrame(() => {
    const frameProgress = useInstance.getState().frameProgress
    if (!ref.current) return

    const lerpProgress = Math.min(Math.max(frameProgress, 0), 0.999)
    const didTeleport = position.distanceTo(positionNext) > TELEPORT_LERP_DISTANCE

    if (didTeleport) {
      ref.current.position.copy(position)
    } else {
      interpolatedPosition.current.copy(position).lerp(positionNext, lerpProgress)
      if (!hasRenderInit.current) {
        ref.current.position.copy(interpolatedPosition.current)
        hasRenderInit.current = true
      } else {
        ref.current.position.lerp(interpolatedPosition.current, 0.5)
      }
    }
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
  const ref = useRef<THREE.Group>(null)
  const interpolatedPosition = useRef(new THREE.Vector3())
  const position = objCoordsToVector3(props.position)
  const positionNext = objCoordsToVector3(props.positionNext)
  const rotation = eulerizeVector(props.rotation)
  const rotationNext = eulerizeVector(props.rotationNext)
  const currentQuat = useRef(new THREE.Quaternion())
  const nextQuat = useRef(new THREE.Quaternion())
  const interpolatedQuat = useRef(new THREE.Quaternion())
  const hasRenderInit = useRef(false)

  useFrame(() => {
    const frameProgress = useInstance.getState().frameProgress
    if (!ref.current) return

    const lerpProgress = Math.min(Math.max(frameProgress, 0), 0.999)
    const didTeleport = position.distanceTo(positionNext) > TELEPORT_LERP_DISTANCE

    if (didTeleport) {
      ref.current.position.copy(position)
      ref.current.rotation.copy(rotation)
      hasRenderInit.current = true
      return
    }

    interpolatedPosition.current.copy(position).lerp(positionNext, lerpProgress)
    currentQuat.current.setFromEuler(rotation)
    nextQuat.current.setFromEuler(rotationNext)
    interpolatedQuat.current.copy(currentQuat.current).slerp(nextQuat.current, lerpProgress)

    if (!hasRenderInit.current) {
      ref.current.position.copy(interpolatedPosition.current)
      ref.current.quaternion.copy(interpolatedQuat.current)
      hasRenderInit.current = true
    } else {
      ref.current.position.lerp(interpolatedPosition.current, 0.5)
      ref.current.quaternion.slerp(interpolatedQuat.current, 0.5)
    }
  })

  return (
    <group name="pipebomb" ref={ref} position={position} rotation={rotation}>
      <Suspense fallback={null}>{team && <ProjectileModel type="pipebomb" team={team} />}</Suspense>
    </group>
  )
}

//
// ─── STICKYBOMB PROJECTILE ──────────────────────────────────────────────────────
//

export const StickybombProjectile = (props: BaseProjectileProps) => {
  const team = TEAM_MAP[props.teamNumber]
  const ref = useRef<THREE.Group>(null)
  const interpolatedPosition = useRef(new THREE.Vector3())
  const position = objCoordsToVector3(props.position)
  const positionNext = objCoordsToVector3(props.positionNext)
  const rotation = eulerizeVector(props.rotation)
  const rotationNext = eulerizeVector(props.rotationNext)
  const currentQuat = useRef(new THREE.Quaternion())
  const nextQuat = useRef(new THREE.Quaternion())
  const interpolatedQuat = useRef(new THREE.Quaternion())
  const hasRenderInit = useRef(false)

  useFrame(() => {
    const frameProgress = useInstance.getState().frameProgress
    if (!ref.current) return

    const lerpProgress = Math.min(Math.max(frameProgress, 0), 0.999)
    const didTeleport = position.distanceTo(positionNext) > TELEPORT_LERP_DISTANCE

    if (didTeleport) {
      ref.current.position.copy(position)
      ref.current.rotation.copy(rotation)
      hasRenderInit.current = true
      return
    }

    interpolatedPosition.current.copy(position).lerp(positionNext, lerpProgress)
    currentQuat.current.setFromEuler(rotation)
    nextQuat.current.setFromEuler(rotationNext)
    interpolatedQuat.current.copy(currentQuat.current).slerp(nextQuat.current, lerpProgress)

    if (!hasRenderInit.current) {
      ref.current.position.copy(interpolatedPosition.current)
      ref.current.quaternion.copy(interpolatedQuat.current)
      hasRenderInit.current = true
    } else {
      ref.current.position.lerp(interpolatedPosition.current, 0.5)
      ref.current.quaternion.slerp(interpolatedQuat.current, 0.5)
    }
  })

  return (
    <group name="stickybomb" ref={ref} position={position} rotation={rotation}>
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
