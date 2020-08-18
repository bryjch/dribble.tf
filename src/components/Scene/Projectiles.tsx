import React, { useRef, useEffect } from 'react'

import * as THREE from 'three'
import { useFrame } from 'react-three-fiber'
import { Sphere } from 'drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'
import { CachedProjectile } from '@components/Analyse/Data/ProjectileCache'

import { objCoordsToVector3, eulerizeVector, getMeshes } from '@utils/geometry'
import { TEAM_MAP, ACTOR_TEAM_COLORS } from '@constants/mappings'

const PROJECTILE_RESOURCES = [
  {
    name: 'rocket',
    model: require('../../assets/projectiles/rocket.obj'),
    texture: require('../../assets/projectiles/rocket_texture.png'),
  },
  {
    name: 'stickybomb',
    model: require('../../assets/projectiles/stickybomb.obj'),
    texture: '',
  },
]

const PROJECTILE_OUTLINE_SCALE = 1.5

const STICKYBOMB_OUTLINE_MATERIAL_RED = new THREE.MeshBasicMaterial({
  color: ACTOR_TEAM_COLORS('red').projectileOutlineColor,
  side: THREE.BackSide,
})

const STICKYBOMB_OUTLINE_MATERIAL_BLUE = new THREE.MeshBasicMaterial({
  color: ACTOR_TEAM_COLORS('blue').projectileOutlineColor,
  side: THREE.BackSide,
})

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

  // Load relevant .obj model resources into component so
  // we can reference them later on
  useEffect(() => {
    try {
      const objLoader = new OBJLoader()

      const onLoad = (loadedObj: THREE.Group, name: string, texture: any) => {
        loadedObj.name = `${name}Projectile`

        let outlines: THREE.Mesh[] = []

        loadedObj.traverse((child: THREE.Object3D) => {
          if (child.type === 'Mesh') {
            // Set default mesh materials
            const m = child as THREE.Mesh
            m.material = new THREE.MeshLambertMaterial({ color: '#424242' })
            m.geometry.computeVertexNormals()

            // Create a scaled-up duplicate of the mesh to use as outline
            switch (name) {
              case 'stickybomb':
                const outline = m.clone() as THREE.Mesh
                outline.name = 'stickybombOutline'
                outline.scale.set(
                  PROJECTILE_OUTLINE_SCALE,
                  PROJECTILE_OUTLINE_SCALE,
                  PROJECTILE_OUTLINE_SCALE
                )
                outlines.push(outline)
                break

              default:
                break
            }
          }
        })

        // Append the duplicated outline meshes back to the original mesh
        outlines.forEach(outline => loadedObj.add(outline))

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

        return (
          <Projectile
            key={`projectile-${projectile.entityId}`}
            obj={objs.current.get(projectile.type)?.clone()} // TODO: try not to use clone (it's currently used otherwise projectiles disappear)
            {...projectile}
          />
        )
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
  const ref = useRef<THREE.Group>()
  const prevPosition = useRef<THREE.Vector3>(objCoordsToVector3(props.position))
  const position = objCoordsToVector3(props.position)

  useEffect(() => {
    if (!prevPosition.current?.equals(position)) {
      ref.current?.lookAt(prevPosition.current)

      prevPosition.current = position
    }
  }, [position])

  useFrame(() => {
    // TODO: smoke trails
  })

  return (
    <group name="rocket" ref={ref} position={position}>
      {props.obj ? (
        <primitive object={props.obj} />
      ) : (
        <Sphere args={[10]}>
          <meshLambertMaterial attach="material" color="red" />
        </Sphere>
      )}
    </group>
  )
}

//
// ─── PIPEBOMB PROJECTILE ────────────────────────────────────────────────────────
//

export const PipebombProjectile = (props: BaseProjectileProps) => {
  return (
    <group
      name="pipebomb"
      position={objCoordsToVector3(props.position)}
      rotation={eulerizeVector(props.rotation)}
    >
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
  useEffect(() => {
    try {
      if (props.obj) {
        const outlines = getMeshes([props.obj], 'stickybombOutline')
        outlines.forEach(mesh => {
          switch (TEAM_MAP[props.teamNumber]) {
            case 'red':
              mesh.material = STICKYBOMB_OUTLINE_MATERIAL_RED
              break

            case 'blue':
              mesh.material = STICKYBOMB_OUTLINE_MATERIAL_BLUE
              break

            default:
              break
          }
        })
      }
    } catch (error) {
      console.error(error)
    }
  })

  return (
    <group
      name="stickybomb"
      position={objCoordsToVector3(props.position)}
      rotation={eulerizeVector(props.rotation)}
    >
      {props.obj ? (
        <primitive object={props.obj} />
      ) : (
        <Sphere args={[5]}>
          <meshLambertMaterial attach="material" color="blue" />
        </Sphere>
      )}
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
