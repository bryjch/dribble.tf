import { useRef, useState, useEffect, useMemo, useCallback, Suspense } from 'react'

import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Sphere, Trail, useGLTF } from '@react-three/drei'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'

import { CachedProjectile } from '@components/Analyse/Data/ProjectileCache'
import { useStore, useInstance } from '@zus/store'

import { TEAM_MAP } from '@constants/mappings'
import { objCoordsToVector3, eulerizeVector } from '@utils/geometry'
import { getAsset } from '@utils/misc'

//
// ─── CONSTANTS ──────────────────────────────────────────────────────────────────
//

const TELEPORT_LERP_DISTANCE = 4096
const PROJECTILE_POSITION_SMOOTH_SECONDS = 0.05
const PROJECTILE_ROTATION_SMOOTH_SECONDS = 0.08
const EXPLOSION_DURATION_MS = 400
const EXPLOSION_MAX_RADIUS = 50
const EXPLOSION_MAX_OPACITY = 0.4

// Team colors for trails/explosions
const TEAM_COLORS: Record<string, string> = {
  red: '#cf4a2e',
  blue: '#5885a2',
}

const TRAIL_FALLBACK_COLOR = '#999999'
const ROCKET_TRAIL_COLOR = '#999999'
const DEFAULT_EXPLOSION_COLOR = '#cccccc'

//
// ─── INTERPOLATION HELPERS ──────────────────────────────────────────────────────
//

function smoothingAlpha(smoothSeconds: number, delta: number): number {
  return 1 - Math.exp(-delta / Math.max(smoothSeconds, 0.0001))
}

function interpolatePosition(
  current: THREE.Vector3,
  next: THREE.Vector3,
  progress: number,
  out: THREE.Vector3
): THREE.Vector3 {
  if (current.distanceTo(next) > TELEPORT_LERP_DISTANCE) {
    return out.copy(current)
  }
  return out.copy(current).lerp(next, progress)
}

//
// ─── PROJECTILE MODEL ───────────────────────────────────────────────────────────
//

const PROJECTILE_MODEL_KEYS: Record<string, string[]> = {
  rocket: ['rocket_shared'],
  pipebomb: ['pipebomb_red', 'pipebomb_blue'],
  stickybomb: ['stickybomb_red', 'stickybomb_blue'],
}

function normalizeProjectileModelKey(type: string, team: string): string {
  const key = `${type}_${team}`
  const validKeys = PROJECTILE_MODEL_KEYS[type]
  if (validKeys && validKeys.includes(key)) return key
  if (validKeys && validKeys.length > 0) return validKeys[0]
  return key
}

export interface ProjectileModelProps {
  type: 'rocket' | 'pipebomb' | 'stickybomb'
  team: string
  backface?: boolean
}

export const ProjectileModel = (props: ProjectileModelProps) => {
  const [cachedScene, setCachedScene] = useState<any>()

  const modelKey = normalizeProjectileModelKey(props.type, props.team)
  const model = getAsset(`/models/projectiles/${modelKey}.glb`)
  const gltf = useGLTF(model, true)

  if (!cachedScene) {
    const cloned = SkeletonUtils.clone(gltf.scene)
    setCachedScene(cloned)
  }

  return <group>{cachedScene && <primitive object={cachedScene} />}</group>
}

const ProjectileFallback = ({ color = TRAIL_FALLBACK_COLOR }: { color?: string }) => (
  <Sphere args={[4]}>
    <meshBasicMaterial color={color} />
  </Sphere>
)

//
// ─── INTERPOLATED PROJECTILE ────────────────────────────────────────────────────
//

export interface InterpolatedProjectile extends CachedProjectile {
  positionPrev: CachedProjectile['position']
  positionNext: CachedProjectile['position']
  positionNext2: CachedProjectile['position']
  rotationNext: CachedProjectile['rotation']
}

//
// ─── EXPLOSION EFFECT ───────────────────────────────────────────────────────────
//

interface Explosion {
  id: number
  position: THREE.Vector3
  type: string
  teamNumber: number
  startTime: number
}

const ExplosionEffect = ({
  explosion,
  onComplete,
}: {
  explosion: Explosion
  onComplete: (id: number) => void
}) => {
  const meshRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<THREE.MeshBasicMaterial>(null)

  const color = useMemo(() => {
    return DEFAULT_EXPLOSION_COLOR;
    // if (explosion.type === 'rocket') return DEFAULT_EXPLOSION_COLOR
    // const team = TEAM_MAP[explosion.teamNumber]
    // return TEAM_COLORS[team] ?? DEFAULT_EXPLOSION_COLOR
  }, [explosion.type, explosion.teamNumber])

  useFrame(() => {
    if (!meshRef.current || !materialRef.current) return

    const elapsed = performance.now() - explosion.startTime
    const progress = Math.min(elapsed / EXPLOSION_DURATION_MS, 1)

    // Expand: ease-out curve
    const scale = EXPLOSION_MAX_RADIUS * (1 - Math.pow(1 - progress, 3))
    meshRef.current.scale.setScalar(scale)

    // Fade out
    materialRef.current.opacity = EXPLOSION_MAX_OPACITY * (1 - progress)

    if (progress >= 1) {
      onComplete(explosion.id)
    }
  })

  return (
    <mesh ref={meshRef} position={explosion.position}>
      <sphereGeometry args={[1, 12, 8]} />
      <meshBasicMaterial
        ref={materialRef}
        color={color}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        opacity={EXPLOSION_MAX_OPACITY}
      />
    </mesh>
  )
}

//
// ─── PROJECTILES ────────────────────────────────────────────────────────────────
//

export interface ProjectilesProps {
  projectiles: InterpolatedProjectile[]
  tick: number
  intervalPerTick: number
}

let nextExplosionId = 0

export const Projectiles = (props: ProjectilesProps) => {
  const { projectiles = [], tick, intervalPerTick } = props

  // Track previous tick's projectiles for explosion detection
  const prevProjectileIds = useRef<
    Map<number, { position: THREE.Vector3; type: string; teamNumber: number }>
  >(new Map())
  const prevTick = useRef<number>(tick)
  const [explosions, setExplosions] = useState<Explosion[]>([])

  // Detect projectile disappearances → spawn explosions
  useEffect(() => {
    const currentIds = new Set(projectiles.map(p => p.entityId))
    const prev = prevProjectileIds.current

    // Only detect explosions when advancing forward by 1 tick (not scrubbing)
    const isForwardStep = tick === prevTick.current + 1

    if (isForwardStep && prev.size > 0) {
      const newExplosions: Explosion[] = []

      prev.forEach((data, entityId) => {
        if (!currentIds.has(entityId)) {
          // Only explode rockets, stickybombs, and pipebombs (not healing bolts)
          if (data.type === 'rocket' || data.type === 'stickybomb' || data.type === 'pipebomb') {
            newExplosions.push({
              id: nextExplosionId++,
              position: data.position.clone(),
              type: data.type,
              teamNumber: data.teamNumber,
              startTime: performance.now(),
            })
          }
        }
      })

      if (newExplosions.length > 0) {
        setExplosions(prev => [...prev, ...newExplosions])
      }
    }

    // Update tracking map
    const nextMap = new Map<
      number,
      { position: THREE.Vector3; type: string; teamNumber: number }
    >()
    projectiles.forEach(p => {
      nextMap.set(p.entityId, {
        position: objCoordsToVector3(p.position),
        type: p.type,
        teamNumber: p.teamNumber,
      })
    })
    prevProjectileIds.current = nextMap
    prevTick.current = tick

    // Clear explosions on scrub (non-forward-step)
    if (!isForwardStep && tick !== prevTick.current) {
      setExplosions([])
    }
  }, [tick, projectiles])

  const removeExplosion = useCallback((id: number) => {
    setExplosions(prev => prev.filter(e => e.id !== id))
  }, [])

  return (
    <group name="projectiles">
      {projectiles.map(projectile => {
        let Projectile

        if (projectile.type === 'rocket') Projectile = RocketProjectile
        if (projectile.type === 'pipebomb') Projectile = PipebombProjectile
        if (projectile.type === 'stickybomb') Projectile = StickybombProjectile
        if (projectile.type === 'healingBolt') Projectile = HealingBoltProjectile
        if (!Projectile) return null

        return (
          <Projectile
            key={`projectile-${projectile.entityId}`}
            {...projectile}
            renderTick={tick}
            intervalPerTick={intervalPerTick}
          />
        )
      })}

      {explosions.map(explosion => (
        <ExplosionEffect key={explosion.id} explosion={explosion} onComplete={removeExplosion} />
      ))}
    </group>
  )
}

//
// ─── BASE PROJECTILE ────────────────────────────────────────────────────────────
//

export interface BaseProjectileProps extends InterpolatedProjectile {
  renderTick: number
  intervalPerTick: number
}

//
// ─── TRAIL CONFIG HOOK ──────────────────────────────────────────────────────────
//

function useTrailConfig(baseWidth: number = 10) {
  const controlsMode = useStore(state => state.scene.controls.mode)
  const isPov = controlsMode === 'pov'

  return useMemo(() => {
    const width = isPov ? baseWidth : baseWidth * 0.9
    const attenuation = (t: number) => 0.5 * width * t

    return { width, attenuation, isPov }
  }, [isPov, baseWidth])
}

//
// ─── ROCKET PROJECTILE ──────────────────────────────────────────────────────────
//

export const RocketProjectile = (props: BaseProjectileProps) => {
  const ref = useRef<THREE.Group>(null)
  const trailMeshRef = useRef<any>(null)
  const prevLookAtPosition = useRef<THREE.Vector3>(objCoordsToVector3(props.position))
  const interpolatedPosition = useRef(new THREE.Vector3())
  const smoothedPosition = useRef(new THREE.Vector3())
  const position = objCoordsToVector3(props.position)
  const positionNext = objCoordsToVector3(props.positionNext)
  const hasRenderInit = useRef(false)
  const trailConfig = useTrailConfig(15)

  // Use lookAt from prev pos -> current pos for rotation (parser rotation is unreliable)
  useEffect(() => {
    if (!prevLookAtPosition.current?.equals(position)) {
      ref.current?.lookAt(prevLookAtPosition.current)
      prevLookAtPosition.current = objCoordsToVector3(position)
    }
  }, [position])

  // Customize trail material for gradient effect
  useEffect(() => {
    if (!trailMeshRef.current) return
    const material = trailMeshRef.current.material
    if (!material) return

    if (trailConfig.isPov) {
      material.blending = THREE.AdditiveBlending
      material.depthTest = false
      material.transparent = true
    } else {
      material.blending = THREE.NormalBlending
      material.depthTest = true
      material.transparent = true
      material.opacity = 0.5
    }
  }, [trailConfig.isPov])

  useFrame((_, delta) => {
    const frameProgress = useInstance.getState().frameProgress
    if (!ref.current) return

    const lerpProgress = Math.min(Math.max(frameProgress, 0), 0.999)
    const alpha = smoothingAlpha(PROJECTILE_POSITION_SMOOTH_SECONDS, delta)

    interpolatePosition(position, positionNext, lerpProgress, interpolatedPosition.current)

    if (!hasRenderInit.current) {
      smoothedPosition.current.copy(interpolatedPosition.current)
      ref.current.position.copy(interpolatedPosition.current)
      hasRenderInit.current = true
    } else {
      smoothedPosition.current.lerp(interpolatedPosition.current, alpha)
      ref.current.position.copy(smoothedPosition.current)
    }
  })

  return (
    <Trail
      ref={trailMeshRef}
      width={trailConfig.width}
      length={3}
      color={ROCKET_TRAIL_COLOR}
      attenuation={trailConfig.attenuation}
    >
      <group name="rocket" ref={ref} position={position}>
        <Suspense fallback={<ProjectileFallback />}>
          <ProjectileModel type="rocket" team="shared" />
        </Suspense>
      </group>
    </Trail>
  )
}

//
// ─── PIPEBOMB PROJECTILE ────────────────────────────────────────────────────────
//

export const PipebombProjectile = (props: BaseProjectileProps) => {
  const team = TEAM_MAP[props.teamNumber]
  const teamColor = TEAM_COLORS[team] ?? TRAIL_FALLBACK_COLOR
  const ref = useRef<THREE.Group>(null)
  const trailMeshRef = useRef<any>(null)
  const interpolatedPosition = useRef(new THREE.Vector3())
  const smoothedPosition = useRef(new THREE.Vector3())
  const position = objCoordsToVector3(props.position)
  const positionNext = objCoordsToVector3(props.positionNext)
  const rotation = eulerizeVector(props.rotation)
  const rotationNext = eulerizeVector(props.rotationNext)
  const currentQuat = useRef(new THREE.Quaternion())
  const nextQuat = useRef(new THREE.Quaternion())
  const interpolatedQuat = useRef(new THREE.Quaternion())
  const hasRenderInit = useRef(false)
  const trailConfig = useTrailConfig()

  // Customize trail material
  useEffect(() => {
    if (!trailMeshRef.current) return
    const material = trailMeshRef.current.material
    if (!material) return

    if (trailConfig.isPov) {
      material.blending = THREE.AdditiveBlending
      material.depthTest = false
      material.transparent = true
    } else {
      material.blending = THREE.NormalBlending
      material.depthTest = true
      material.transparent = true
      material.opacity = 0.5
    }
  }, [trailConfig.isPov])

  useFrame((_, delta) => {
    const frameProgress = useInstance.getState().frameProgress
    if (!ref.current) return

    const lerpProgress = Math.min(Math.max(frameProgress, 0), 0.999)
    const posAlpha = smoothingAlpha(PROJECTILE_POSITION_SMOOTH_SECONDS, delta)
    const rotAlpha = smoothingAlpha(PROJECTILE_ROTATION_SMOOTH_SECONDS, delta)

    const didTeleport = position.distanceTo(positionNext) > TELEPORT_LERP_DISTANCE

    if (didTeleport) {
      ref.current.position.copy(position)
      ref.current.rotation.copy(rotation)
      smoothedPosition.current.copy(position)
      hasRenderInit.current = true
      return
    }

    interpolatePosition(position, positionNext, lerpProgress, interpolatedPosition.current)
    currentQuat.current.setFromEuler(rotation)
    nextQuat.current.setFromEuler(rotationNext)
    interpolatedQuat.current.copy(currentQuat.current).slerp(nextQuat.current, lerpProgress)

    if (!hasRenderInit.current) {
      smoothedPosition.current.copy(interpolatedPosition.current)
      ref.current.position.copy(interpolatedPosition.current)
      ref.current.quaternion.copy(interpolatedQuat.current)
      hasRenderInit.current = true
    } else {
      smoothedPosition.current.lerp(interpolatedPosition.current, posAlpha)
      ref.current.position.copy(smoothedPosition.current)
      ref.current.quaternion.slerp(interpolatedQuat.current, rotAlpha)
    }
  })

  return (
    <Trail
      ref={trailMeshRef}
      width={trailConfig.width}
      length={1}
      color={teamColor}
      attenuation={trailConfig.attenuation}
    >
      <group name="pipebomb" ref={ref} position={position} rotation={rotation}>
        <Suspense fallback={<ProjectileFallback color={teamColor} />}>
          {team && <ProjectileModel type="pipebomb" team={team} />}
        </Suspense>
      </group>
    </Trail>
  )
}

//
// ─── STICKYBOMB PROJECTILE ──────────────────────────────────────────────────────
//

export const StickybombProjectile = (props: BaseProjectileProps) => {
  const team = TEAM_MAP[props.teamNumber]
  const teamColor = TEAM_COLORS[team] ?? TRAIL_FALLBACK_COLOR
  const ref = useRef<THREE.Group>(null)
  const trailMeshRef = useRef<any>(null)
  const interpolatedPosition = useRef(new THREE.Vector3())
  const smoothedPosition = useRef(new THREE.Vector3())
  const position = objCoordsToVector3(props.position)
  const positionNext = objCoordsToVector3(props.positionNext)
  const rotation = eulerizeVector(props.rotation)
  const rotationNext = eulerizeVector(props.rotationNext)
  const currentQuat = useRef(new THREE.Quaternion())
  const nextQuat = useRef(new THREE.Quaternion())
  const interpolatedQuat = useRef(new THREE.Quaternion())
  const hasRenderInit = useRef(false)
  const trailConfig = useTrailConfig()

  // Customize trail material
  useEffect(() => {
    if (!trailMeshRef.current) return
    const material = trailMeshRef.current.material
    if (!material) return

    if (trailConfig.isPov) {
      material.blending = THREE.AdditiveBlending
      material.depthTest = false
      material.transparent = true
    } else {
      material.blending = THREE.NormalBlending
      material.depthTest = true
      material.transparent = true
      material.opacity = 0.5
    }
  }, [trailConfig.isPov])

  useFrame((_, delta) => {
    const frameProgress = useInstance.getState().frameProgress
    if (!ref.current) return

    const lerpProgress = Math.min(Math.max(frameProgress, 0), 0.999)
    const posAlpha = smoothingAlpha(PROJECTILE_POSITION_SMOOTH_SECONDS, delta)
    const rotAlpha = smoothingAlpha(PROJECTILE_ROTATION_SMOOTH_SECONDS, delta)

    const didTeleport = position.distanceTo(positionNext) > TELEPORT_LERP_DISTANCE

    if (didTeleport) {
      ref.current.position.copy(position)
      ref.current.rotation.copy(rotation)
      smoothedPosition.current.copy(position)
      hasRenderInit.current = true
      return
    }

    interpolatePosition(position, positionNext, lerpProgress, interpolatedPosition.current)
    currentQuat.current.setFromEuler(rotation)
    nextQuat.current.setFromEuler(rotationNext)
    interpolatedQuat.current.copy(currentQuat.current).slerp(nextQuat.current, lerpProgress)

    if (!hasRenderInit.current) {
      smoothedPosition.current.copy(interpolatedPosition.current)
      ref.current.position.copy(interpolatedPosition.current)
      ref.current.quaternion.copy(interpolatedQuat.current)
      hasRenderInit.current = true
    } else {
      smoothedPosition.current.lerp(interpolatedPosition.current, posAlpha)
      ref.current.position.copy(smoothedPosition.current)
      ref.current.quaternion.slerp(interpolatedQuat.current, rotAlpha)
    }
  })

  return (
    <Trail
      ref={trailMeshRef}
      width={trailConfig.width}
      length={2}
      color={teamColor}
      attenuation={trailConfig.attenuation}
    >
      <group name="stickybomb" ref={ref} position={position} rotation={rotation}>
        <Suspense fallback={<ProjectileFallback color={teamColor} />}>
          {team && <ProjectileModel type="stickybomb" team={team} />}
        </Suspense>
      </group>
    </Trail>
  )
}

//
// ─── HEALING BOLT PROJECTILE ────────────────────────────────────────────────────
//

export const HealingBoltProjectile = (props: BaseProjectileProps) => {
  const ref = useRef<THREE.Group>(null)
  const trailMeshRef = useRef<any>(null)
  const interpolatedPosition = useRef(new THREE.Vector3())
  const smoothedPosition = useRef(new THREE.Vector3())
  const position = objCoordsToVector3(props.position)
  const positionNext = objCoordsToVector3(props.positionNext)
  const hasRenderInit = useRef(false)
  const trailConfig = useTrailConfig()

  // Customize trail material
  useEffect(() => {
    if (!trailMeshRef.current) return
    const material = trailMeshRef.current.material
    if (!material) return

    if (trailConfig.isPov) {
      material.blending = THREE.AdditiveBlending
      material.depthTest = false
      material.transparent = true
    } else {
      material.blending = THREE.NormalBlending
      material.depthTest = true
      material.transparent = true
      material.opacity = 0.5
    }
  }, [trailConfig.isPov])

  useFrame((_, delta) => {
    const frameProgress = useInstance.getState().frameProgress
    if (!ref.current) return

    const lerpProgress = Math.min(Math.max(frameProgress, 0), 0.999)
    const alpha = smoothingAlpha(PROJECTILE_POSITION_SMOOTH_SECONDS, delta)

    interpolatePosition(position, positionNext, lerpProgress, interpolatedPosition.current)

    if (!hasRenderInit.current) {
      smoothedPosition.current.copy(interpolatedPosition.current)
      ref.current.position.copy(interpolatedPosition.current)
      hasRenderInit.current = true
    } else {
      smoothedPosition.current.lerp(interpolatedPosition.current, alpha)
      ref.current.position.copy(smoothedPosition.current)
    }
  })

  return (
    <Trail
      ref={trailMeshRef}
      width={trailConfig.width}
      length={2}
      color="#e8d44d"
      attenuation={trailConfig.attenuation}
    >
      <group name="healingBolt" ref={ref} position={position}>
        <Sphere args={[5]}>
          <meshLambertMaterial attach="material" color="yellow" />
        </Sphere>
      </group>
    </Trail>
  )
}
