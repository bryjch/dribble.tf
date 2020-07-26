import React, { useRef, useEffect } from 'react'

import * as THREE from 'three'
import 'react-three-fiber'
import { Sphere } from 'drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'
import { CachedProjectile } from '@components/Analyse/Data/ProjectileCache'

import { objCoordsToVector3 } from '@utils/geometry'

const PROJECTILE_RESOURCES = [
  {
    name: 'rocket',
    model: require('../../assets/projectiles/rocket.obj'),
    texture: require('../../assets/projectiles/rocket_texture.png'),
  },
]

//
// ─── PROJECTILES ────────────────────────────────────────────────────────────────
//

export interface ProjectilesProps {
  parser: AsyncParser
  playback: any
}

export const Projectiles = (props: ProjectilesProps) => {
  const objs = useRef<Map<string, THREE.Group>>(new Map<string, THREE.Group>())

  const { parser, playback } = props
  const projectilesThisTick = parser ? parser.getProjectilesAtTick(playback.tick) : []

  useEffect(() => {
    try {
      const objLoader = new OBJLoader()

      const onLoad = (loadedObj: THREE.Group, name: string, texture: any) => {
        loadedObj.name = `${name}Projectile`

        loadedObj.traverse((child: THREE.Object3D) => {
          if (child.type === 'Mesh') {
            const m = child as THREE.Mesh
            m.material = new THREE.MeshLambertMaterial({ color: '#424242' })
            m.geometry.computeVertexNormals()
          }
        })

        objs.current.set(name, loadedObj)
      }

      const onProgress = (xhr: ProgressEvent) => {}

      const onError = (error: ErrorEvent) => {
        throw error
      }

      // Load all the available projectile resource types
      for (const { name, model, texture } of PROJECTILE_RESOURCES) {
        objLoader.load(model, obj => onLoad(obj, name, texture), onProgress, onError)
      }
    } catch (error) {
      console.error(error)
    }
  }, [])

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
// ─── ROCKET PROJECTILE ──────────────────────────────────────────────────────────
//

export interface BaseProjectileProps extends CachedProjectile {
  obj?: THREE.Group | THREE.Object3D | undefined
}

export const RocketProjectile = (props: BaseProjectileProps) => {
  return (
    <group name="rocket" position={objCoordsToVector3(props.position)}>
      <Sphere args={[10]}>
        <meshLambertMaterial attach="material" color="red" />
      </Sphere>
    </group>
  )
}

//
// ─── PIPEBOMB PROJECTILE ────────────────────────────────────────────────────────
//

export const PipebombProjectile = (props: BaseProjectileProps) => {
  return (
    <group name="pipebomb" position={objCoordsToVector3(props.position)}>
      <Sphere args={[5]}>
        <meshLambertMaterial attach="material" color="green" />
      </Sphere>
    </group>
  )
}

//
// ─── STICKYBOMB PROJECTILE ──────────────────────────────────────────────────────
//

export const StickybombProjectile = (props: BaseProjectileProps) => {
  return (
    <group name="stickybomb" position={objCoordsToVector3(props.position)}>
      <Sphere args={[5]}>
        <meshLambertMaterial attach="material" color="blue" />
      </Sphere>
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
