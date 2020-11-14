import React, { useRef, useEffect } from 'react'

import * as THREE from 'three'
import { useFrame } from 'react-three-fiber'
import { Sphere } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'

import { AsyncParser } from '@components/Analyse/Data/AsyncParser'
import { CachedProjectile } from '@components/Analyse/Data/ProjectileCache'

import { objCoordsToVector3, eulerizeVector, getMeshes } from '@utils/geometry'
import { TEAM_MAP } from '@constants/mappings'

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

const BASE_PROJECTILE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#111111', metalness: 1 })

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
            const base = child as THREE.Mesh
            base.material = BASE_PROJECTILE_MATERIAL
            base.geometry.computeVertexNormals()

            // Create a scaled-up duplicate of the mesh to use as outline
            switch (name) {
              case 'stickybomb':
                const outline = base.clone() as THREE.Mesh
                outline.name = 'stickybombOutline'
                outlines.push(outline)
                break

              default:
                break
            }
          }
        })

        // Append the duplicated outline meshes back to the base mesh
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

const getPipebombMaterial = (team: string) => {
  switch (team) {
    case 'red':
      return { color: '#ff2525', transparent: true, opacity: 1 }

    case 'blue':
      return { color: '#142bff', transparent: true, opacity: 1 }
  }

  return { color: 'white' }
}

export const PipebombProjectile = (props: BaseProjectileProps) => {
  const team = TEAM_MAP[props.teamNumber]
  const material = getPipebombMaterial(team)

  return (
    <group
      name="pipebomb"
      position={objCoordsToVector3(props.position)}
      rotation={eulerizeVector(props.rotation)}
    >
      <Sphere args={[5]}>
        <meshStandardMaterial attach="material" {...material} />
      </Sphere>
    </group>
  )
}

//
// ─── STICKYBOMB PROJECTILE ──────────────────────────────────────────────────────
//

const STICKYBOMB_FALLBACK_MATERIAL = new THREE.MeshLambertMaterial({ color: '#424242' })
const STICKYBOMB_BASE_MATERIAL_RED = new THREE.MeshLambertMaterial({ color: 'red' })
const STICKYBOMB_BASE_MATERIAL_BLUE = new THREE.MeshLambertMaterial({ color: 'blue' })

const STICKYBOMB_OUTLINE_MATERIAL_RED = new THREE.MeshLambertMaterial({
  color: 'red',
  transparent: true,
  depthFunc: THREE.GreaterEqualDepth,
})

const STICKYBOMB_OUTLINE_MATERIAL_BLUE = new THREE.MeshLambertMaterial({
  color: 'blue',
  transparent: true,
  depthFunc: THREE.GreaterEqualDepth,
})

const getStickybombMaterial = (team: string, isOutline: Boolean) => {
  switch (team) {
    case 'red':
      return isOutline ? STICKYBOMB_OUTLINE_MATERIAL_RED : STICKYBOMB_BASE_MATERIAL_RED

    case 'blue':
      return isOutline ? STICKYBOMB_OUTLINE_MATERIAL_BLUE : STICKYBOMB_BASE_MATERIAL_BLUE
  }

  return STICKYBOMB_FALLBACK_MATERIAL
}

export const StickybombProjectile = (props: BaseProjectileProps) => {
  const team = TEAM_MAP[props.teamNumber]

  useEffect(() => {
    try {
      if (props.obj) {
        const meshes = getMeshes([props.obj])

        meshes.forEach(mesh => {
          const isOutline = mesh.name === 'stickybombOutline'
          mesh.material = getStickybombMaterial(team, isOutline)
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
          <meshLambertMaterial attach="material" color={team} />
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
