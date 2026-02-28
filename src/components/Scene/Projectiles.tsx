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
const EXPLOSION_DURATION_MS = 200
const EXPLOSION_MAX_RADIUS = 40
const EXPLOSION_MAX_OPACITY = 0.4

// Team colors for trails/explosions
const TEAM_COLORS: Record<string, string> = {
  red: '#cf4a2e',
  blue: '#5885a2',
}

const TRAIL_FALLBACK_COLOR = '#999999'
const DEFAULT_EXPLOSION_COLOR = '#cccccc'

// Trail config per projectile type (MeshLine trails — not used for rockets)
const TRAIL_CONFIG: Record<string, { baseWidth: number; length: number; opacity: number }> = {
  pipebomb: { baseWidth: 10, length: 1, opacity: 1 },
  stickybomb: { baseWidth: 10, length: 2, opacity: 1 },
  healingBolt: { baseWidth: 10, length: 2, opacity: 1 },
  default: { baseWidth: 10, length: 2, opacity: 1 },
}

// How long to keep a frozen trail target alive so the trail can decay (ms).
const FROZEN_TRAIL_DURATION_MS = 1500

// All projectile types that should have trails (smoke or MeshLine)
const TRAILABLE_TYPES = new Set(['rocket', ...Object.keys(TRAIL_CONFIG)])

// Rocket smoke trail config
const SMOKE_MAX_PUFFS = 64
const SMOKE_PUFF_LIFETIME_MS = 800
const SMOKE_SPAWN_INTERVAL = 8 // spawn a puff every N units of travel
const SMOKE_PUFF_START_SCALE = 6
const SMOKE_PUFF_END_SCALE = 4
const SMOKE_PUFF_START_OPACITY = 1.0
const SMOKE_PUFF_COLOR_START = new THREE.Color('#c8c8c8')
const SMOKE_PUFF_COLOR_END = new THREE.Color('#707070')

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
    return DEFAULT_EXPLOSION_COLOR
  }, [explosion.type, explosion.teamNumber])

  useFrame(() => {
    if (!meshRef.current || !materialRef.current) return

    const elapsed = performance.now() - explosion.startTime
    const progress = Math.min(elapsed / EXPLOSION_DURATION_MS, 1)

    const scale = EXPLOSION_MAX_RADIUS * (1 - Math.pow(1 - progress, 3))
    meshRef.current.scale.setScalar(scale)

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

// Shared interface for trail target data (used by both smoke trails and MeshLine trails)
interface TrailTargetData {
  entityId: number
  type: string
  teamNumber: number
  position: CachedProjectile['position']
  positionNext: CachedProjectile['position']
  frozen: boolean
  frozenAt: number
}

//
// ─── ROCKET SMOKE TRAIL ─────────────────────────────────────────────────────────
//
// Particle-based smoke trail for rockets. Uses InstancedMesh with a ring buffer
// of smoke puffs. Puffs are spawned at intervals along the rocket's path, expand
// over their lifetime, and fade out. When the rocket detonates, existing puffs
// continue their lifecycle naturally.
//

interface SmokePuff {
  position: THREE.Vector3
  spawnTime: number
  alive: boolean
}

const _smokeMatrix = new THREE.Matrix4()
const _smokeScale = new THREE.Vector3()
const _smokeColor = new THREE.Color()

const smokeVertexShader = /* glsl */ `
  attribute float instanceOpacity;
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = vec3(1.0);
    #endif
    vOpacity = instanceOpacity;

    vec4 mvPosition = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      mvPosition = instanceMatrix * mvPosition;
    #endif
    mvPosition = modelViewMatrix * mvPosition;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const smokeFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    gl_FragColor = vec4(vColor, vOpacity);
  }
`

const RocketSmokeTrail = ({ data }: { data: TrailTargetData }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const puffsRef = useRef<SmokePuff[]>([])
  const lastSpawnPos = useRef<THREE.Vector3 | null>(null)
  const interpolatedPos = useRef(new THREE.Vector3())
  const smoothedPos = useRef(new THREE.Vector3())
  const hasInit = useRef(false)
  const opacityArray = useRef(new Float32Array(SMOKE_MAX_PUFFS))
  const opacityAttr = useRef<THREE.InstancedBufferAttribute | null>(null)

  // Keep latest position data in refs
  const posRef = useRef(data.position)
  const posNextRef = useRef(data.positionNext)
  const frozenRef = useRef(data.frozen)
  posRef.current = data.position
  posNextRef.current = data.positionNext
  frozenRef.current = data.frozen

  const geometry = useMemo(() => new THREE.SphereGeometry(1, 6, 4), [])
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: smokeVertexShader,
      fragmentShader: smokeFragmentShader,
    })
  }, [])

  // Attach per-instance opacity attribute and initialize mesh
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.count = 0
      const attr = new THREE.InstancedBufferAttribute(opacityArray.current, 1)
      attr.setUsage(THREE.DynamicDrawUsage)
      meshRef.current.geometry.setAttribute('instanceOpacity', attr)
      opacityAttr.current = attr
    }
  }, [])

  useFrame((_, delta) => {
    if (!meshRef.current || !opacityAttr.current) return

    const now = performance.now()
    const frameProgress = useInstance.getState().frameProgress
    const lerpProgress = Math.min(Math.max(frameProgress, 0), 0.999)
    const alpha = smoothingAlpha(PROJECTILE_POSITION_SMOOTH_SECONDS, delta)

    // Update current position (same logic as TrailTarget)
    if (!frozenRef.current) {
      const pos = objCoordsToVector3(posRef.current)
      const posNext = objCoordsToVector3(posNextRef.current)
      interpolatePosition(pos, posNext, lerpProgress, interpolatedPos.current)

      if (!hasInit.current) {
        smoothedPos.current.copy(interpolatedPos.current)
        hasInit.current = true
      } else {
        smoothedPos.current.lerp(interpolatedPos.current, alpha)
      }

      // Spawn puffs based on travel distance
      const currentPos = smoothedPos.current
      if (lastSpawnPos.current === null) {
        lastSpawnPos.current = currentPos.clone()
      }

      const distSinceLastSpawn = currentPos.distanceTo(lastSpawnPos.current)
      if (distSinceLastSpawn >= SMOKE_SPAWN_INTERVAL) {
        const numPuffs = Math.floor(distSinceLastSpawn / SMOKE_SPAWN_INTERVAL)
        const dir = currentPos.clone().sub(lastSpawnPos.current).normalize()

        for (let i = 0; i < numPuffs && puffsRef.current.length < SMOKE_MAX_PUFFS; i++) {
          const spawnPos = lastSpawnPos.current
            .clone()
            .add(dir.clone().multiplyScalar(SMOKE_SPAWN_INTERVAL * (i + 1)))

          puffsRef.current.push({
            position: spawnPos,
            spawnTime: now,
            alive: true,
          })
        }

        if (puffsRef.current.length >= SMOKE_MAX_PUFFS) {
          puffsRef.current = puffsRef.current.filter(p => p.alive)
        }

        lastSpawnPos.current.copy(currentPos)
      }
    }

    // Update all puffs
    const mesh = meshRef.current
    let visibleCount = 0

    for (let i = 0; i < puffsRef.current.length; i++) {
      const puff = puffsRef.current[i]
      const age = now - puff.spawnTime
      const lifeProgress = age / SMOKE_PUFF_LIFETIME_MS

      if (lifeProgress >= 1) {
        puff.alive = false
        continue
      }

      // Scale: expand over lifetime
      const scale =
        SMOKE_PUFF_START_SCALE +
        (SMOKE_PUFF_END_SCALE - SMOKE_PUFF_START_SCALE) * lifeProgress

      // Opacity: true alpha fade from 1 → 0
      const opacity = SMOKE_PUFF_START_OPACITY * (1 - lifeProgress)

      _smokeScale.setScalar(scale)
      _smokeMatrix.makeScale(_smokeScale.x, _smokeScale.y, _smokeScale.z)
      _smokeMatrix.setPosition(puff.position)

      mesh.setMatrixAt(visibleCount, _smokeMatrix)

      // Color: lerp from light grey → darker grey
      _smokeColor.copy(SMOKE_PUFF_COLOR_START).lerp(SMOKE_PUFF_COLOR_END, lifeProgress)
      mesh.setColorAt(visibleCount, _smokeColor)

      // Per-instance opacity
      opacityArray.current[visibleCount] = opacity

      visibleCount++
    }

    // Clean up dead puffs periodically
    if (puffsRef.current.length > SMOKE_MAX_PUFFS * 0.75) {
      puffsRef.current = puffsRef.current.filter(p => p.alive)
    }

    mesh.count = visibleCount
    if (mesh.instanceMatrix) mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    opacityAttr.current.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, SMOKE_MAX_PUFFS]}
      frustumCulled={false}
    />
  )
}

//
// ─── TRAIL TARGET ───────────────────────────────────────────────────────────────
//
// Trail targets are decoupled from projectile model components. Each trail target
// is an invisible Object3D whose position is updated to match its projectile.
// The Trail component uses the `target` prop to follow this Object3D.
// When a projectile disappears, its trail target freezes in place (stops moving)
// and the Trail naturally decays. The trail target component is never unmounted
// during this transition, so the Trail's internal point buffer is preserved.
//

function resolveTrailColor(type: string, teamNumber: number): string {
  if (type === 'healingBolt') return '#e8d44d'
  const team = TEAM_MAP[teamNumber]
  return TEAM_COLORS[team] ?? TRAIL_FALLBACK_COLOR
}

function useTrailConfig(baseWidth: number = 10) {
  const controlsMode = useStore(state => state.scene.controls.mode)
  const isPov = controlsMode === 'pov'

  return useMemo(() => {
    const width = isPov ? baseWidth : baseWidth * 0.9
    const attenuation = (t: number) => 0.5 * width * t

    return { width, attenuation, isPov }
  }, [isPov, baseWidth])
}

const TrailTarget = ({ data }: { data: TrailTargetData }) => {
  const targetRef = useRef<THREE.Object3D>(null)
  const trailRef = useRef<any>(null)
  const interpolatedPos = useRef(new THREE.Vector3())
  const smoothedPos = useRef(new THREE.Vector3())
  const hasInit = useRef(false)

  // Keep latest position data in refs so useFrame always has current values
  const posRef = useRef(data.position)
  const posNextRef = useRef(data.positionNext)
  posRef.current = data.position
  posNextRef.current = data.positionNext

  const config = TRAIL_CONFIG[data.type] ?? TRAIL_CONFIG.default
  const trailConfig = useTrailConfig(config.baseWidth)
  const color = resolveTrailColor(data.type, data.teamNumber)

  // Make trail semi-transparent
  useEffect(() => {
    if (!trailRef.current?.material) return
    const mat = trailRef.current.material
    mat.transparent = true
    mat.opacity = config.opacity
    mat.depthWrite = false
  }, [])

  useFrame((_, delta) => {
    if (!targetRef.current) return

    const frameProgress = useInstance.getState().frameProgress
    const lerpProgress = Math.min(Math.max(frameProgress, 0), 0.999)
    const alpha = smoothingAlpha(PROJECTILE_POSITION_SMOOTH_SECONDS, delta)

    const pos = objCoordsToVector3(posRef.current)
    const posNext = objCoordsToVector3(posNextRef.current)

    interpolatePosition(pos, posNext, lerpProgress, interpolatedPos.current)

    if (!hasInit.current) {
      smoothedPos.current.copy(interpolatedPos.current)
      targetRef.current.position.copy(interpolatedPos.current)
      hasInit.current = true
    } else {
      smoothedPos.current.lerp(interpolatedPos.current, alpha)
      targetRef.current.position.copy(smoothedPos.current)
    }
  })

  const initialPos = objCoordsToVector3(data.position)

  return (
    <>
      <group ref={targetRef as any} position={initialPos} />
      <Trail
        ref={trailRef}
        target={targetRef as any}
        width={trailConfig.width}
        length={config.length}
        color={color}
        attenuation={trailConfig.attenuation}
      />
    </>
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

let nextEffectId = 0

export const Projectiles = (props: ProjectilesProps) => {
  const { projectiles = [], tick, intervalPerTick } = props

  const prevTick = useRef<number>(tick)
  const prevProjectileData = useRef<Map<number, InterpolatedProjectile>>(new Map())
  const [trailTargets, setTrailTargets] = useState<Map<number, TrailTargetData>>(new Map())
  const [explosions, setExplosions] = useState<Explosion[]>([])

  useEffect(() => {
    const currentIds = new Set(projectiles.map(p => p.entityId))
    const tickChanged = tick !== prevTick.current
    const tickDelta = tick - prevTick.current
    const isForwardStep = tickChanged && tickDelta >= 1 && tickDelta <= 3
    const isScrubbedOrJumped = tickChanged && !isForwardStep
    const now = performance.now()

    setTrailTargets(prev => {
      const next = new Map(prev)
      let changed = false

      // Update/create trail targets for live projectiles
      // Rockets use smoke trails, others use MeshLine trails — both managed here
      projectiles.forEach(p => {
        if (!TRAILABLE_TYPES.has(p.type)) return // skip types without any trail
        const existing = next.get(p.entityId)
        if (!existing) {
          next.set(p.entityId, {
            entityId: p.entityId,
            type: p.type,
            teamNumber: p.teamNumber,
            position: p.position,
            positionNext: p.positionNext,
            frozen: false,
            frozenAt: 0,
          })
          changed = true
        } else {
          next.set(p.entityId, {
            ...existing,
            type: p.type, // update type in case entityId was reused by a different projectile
            teamNumber: p.teamNumber,
            position: p.position,
            positionNext: p.positionNext,
            // Unfreeze if entityId reappeared
            frozen: false,
            frozenAt: 0,
          })
          changed = true
        }
      })

      // Freeze trail targets for disappeared projectiles (forward step only)
      if (isForwardStep) {
        next.forEach((data, entityId) => {
          if (!currentIds.has(entityId) && !data.frozen) {
            next.set(entityId, {
              ...data,
              positionNext: data.position, // freeze in place
              frozen: true,
              frozenAt: now,
            })
            changed = true
          }
        })
      }

      // Expire old frozen trail targets
      next.forEach((data, entityId) => {
        if (data.frozen && now - data.frozenAt >= FROZEN_TRAIL_DURATION_MS) {
          next.delete(entityId)
          changed = true
        }
      })

      // Clear frozen targets on scrub/jump (tick changed but not a single forward step)
      if (isScrubbedOrJumped) {
        next.forEach((data, entityId) => {
          if (data.frozen) {
            next.delete(entityId)
            changed = true
          }
        })
      }

      return changed ? next : prev
    })

    // Detect explosions
    if (isForwardStep && prevProjectileData.current.size > 0) {
      const newExplosions: Explosion[] = []
      prevProjectileData.current.forEach((lastData, entityId) => {
        if (!currentIds.has(entityId)) {
          if (
            lastData.type === 'rocket' ||
            lastData.type === 'stickybomb' ||
            lastData.type === 'pipebomb'
          ) {
            newExplosions.push({
              id: nextEffectId++,
              position: objCoordsToVector3(lastData.position),
              type: lastData.type,
              teamNumber: lastData.teamNumber,
              startTime: now,
            })
          }
        }
      })
      if (newExplosions.length > 0) {
        setExplosions(prev => [...prev, ...newExplosions])
      }
    }

    // Clear explosions on scrub
    if (isScrubbedOrJumped) {
      setExplosions([])
    }

    // Update tracking refs only when tick actually changes
    if (tickChanged) {
      const nextMap = new Map<number, InterpolatedProjectile>()
      projectiles.forEach(p => nextMap.set(p.entityId, p))
      prevProjectileData.current = nextMap
      prevTick.current = tick
    }
  }, [tick, projectiles])

  const removeExplosion = useCallback((id: number) => {
    setExplosions(prev => prev.filter(e => e.id !== id))
  }, [])

  // Collect trail targets into an array for rendering
  const trailTargetArray = useMemo(
    () => Array.from(trailTargets.values()),
    [trailTargets]
  )

  return (
    <group name="projectiles">
      {/* Projectile models */}
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

      {/* Trail targets (decoupled from projectile models) */}
      {trailTargetArray.map(data =>
        data.type === 'rocket' ? (
          <RocketSmokeTrail key={`smoke-${data.entityId}`} data={data} />
        ) : (
          <TrailTarget key={`trail-${data.entityId}`} data={data} />
        )
      )}

      {/* Explosions */}
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
// ─── ROCKET PROJECTILE ──────────────────────────────────────────────────────────
//

export const RocketProjectile = (props: BaseProjectileProps) => {
  const ref = useRef<THREE.Group>(null)
  const prevLookAtPosition = useRef<THREE.Vector3>(objCoordsToVector3(props.position))
  const interpolatedPosition = useRef(new THREE.Vector3())
  const smoothedPosition = useRef(new THREE.Vector3())
  const position = objCoordsToVector3(props.position)
  const positionNext = objCoordsToVector3(props.positionNext)
  const hasRenderInit = useRef(false)

  useEffect(() => {
    if (!prevLookAtPosition.current?.equals(position)) {
      ref.current?.lookAt(prevLookAtPosition.current)
      prevLookAtPosition.current = objCoordsToVector3(position)
    }
  }, [position])

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
    <group name="rocket" ref={ref} position={position}>
      <Suspense fallback={<ProjectileFallback />}>
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
  const teamColor = TEAM_COLORS[team] ?? TRAIL_FALLBACK_COLOR
  const ref = useRef<THREE.Group>(null)
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
    <group name="pipebomb" ref={ref} position={position} rotation={rotation}>
      <Suspense fallback={<ProjectileFallback color={teamColor} />}>
        {team && <ProjectileModel type="pipebomb" team={team} />}
      </Suspense>
    </group>
  )
}

//
// ─── STICKYBOMB PROJECTILE ──────────────────────────────────────────────────────
//

export const StickybombProjectile = (props: BaseProjectileProps) => {
  const team = TEAM_MAP[props.teamNumber]
  const teamColor = TEAM_COLORS[team] ?? TRAIL_FALLBACK_COLOR
  const ref = useRef<THREE.Group>(null)
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
    <group name="stickybomb" ref={ref} position={position} rotation={rotation}>
      <Suspense fallback={<ProjectileFallback color={teamColor} />}>
        {team && <ProjectileModel type="stickybomb" team={team} />}
      </Suspense>
    </group>
  )
}

//
// ─── HEALING BOLT PROJECTILE ────────────────────────────────────────────────────
//

export const HealingBoltProjectile = (props: BaseProjectileProps) => {
  const ref = useRef<THREE.Group>(null)
  const interpolatedPosition = useRef(new THREE.Vector3())
  const smoothedPosition = useRef(new THREE.Vector3())
  const position = objCoordsToVector3(props.position)
  const positionNext = objCoordsToVector3(props.positionNext)
  const hasRenderInit = useRef(false)

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
    <group name="healingBolt" ref={ref} position={position}>
      <Sphere args={[5]}>
        <meshLambertMaterial attach="material" color="yellow" />
      </Sphere>
    </group>
  )
}
