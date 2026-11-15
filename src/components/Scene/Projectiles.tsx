import { useRef, useState, useEffect, useMemo, Suspense } from 'react'

import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Trail, useGLTF } from '@react-three/drei'

import type { CachedProjectile } from '@components/Analyse/Data/ProjectileCache'
import { SCENE_PRIORITY, sceneFrame } from '@components/Scene/PlaybackDriver'
import { useStore } from '@zus/store'

import { TEAM_MAP } from '@constants/mappings'
import { degreesToRadians } from '@utils/geometry'
import { getAsset } from '@utils/misc'

//
// ─── PROJECTILES ────────────────────────────────────────────────────────────────
//
// Drawn from sceneFrame in frame callbacks, never by re-rendering React: models are instanced
// (one InstancedMesh per part of each model), rocket smoke and explosions are pools shared by
// every projectile, and the ribbon trails behind pipes, stickies and bolts are the only part
// with a React element per projectile, added and removed as projectiles come and go.
//

const MAX_PROJECTILES = 96
const EXPLOSION_DURATION_MS = 200
const EXPLOSION_MAX_RADIUS = 40
const EXPLOSION_MAX_OPACITY = 0.4
const MAX_EXPLOSIONS = 48

/** Up to this many ticks between frames is playback moving on; more is a seek. */
const MAX_FORWARD_STEP_TICKS = 8

const TEAM_COLORS: Record<string, string> = {
  red: '#cf4a2e',
  blue: '#5885a2',
}
const TRAIL_FALLBACK_COLOR = '#999999'
const DEFAULT_EXPLOSION_COLOR = new THREE.Color('#cccccc')

// Ribbon trails per projectile type (rockets leave smoke instead)
const TRAIL_CONFIG: Record<string, { baseWidth: number; length: number; opacity: number }> = {
  pipebomb: { baseWidth: 10, length: 1, opacity: 1 },
  stickybomb: { baseWidth: 10, length: 2, opacity: 1 },
  healingBolt: { baseWidth: 10, length: 2, opacity: 1 },
}
/** A trail stays this long after its projectile goes, or stops moving, so it can fade. */
const TRAIL_LINGER_MS = 1500

// Rocket smoke
const MAX_SMOKE_PUFFS = 2048
const SMOKE_PUFF_LIFETIME_MS = 800
const SMOKE_SPAWN_INTERVAL = 8 // a puff every N units of travel
const SMOKE_PUFF_START_SCALE = 6
const SMOKE_PUFF_END_SCALE = 4
const SMOKE_PUFF_COLOR_START = new THREE.Color('#c8c8c8')
const SMOKE_PUFF_COLOR_END = new THREE.Color('#707070')

/** How the frame moved playback on: forward a little, a seek, or not at all. */
function playbackStep(): 'forward' | 'seek' | 'still' {
  const delta = sceneFrame.tick - sceneFrame.previousTick
  if (delta === 0) return 'still'
  return delta > 0 && delta <= MAX_FORWARD_STEP_TICKS ? 'forward' : 'seek'
}

const teamOf = (projectile: CachedProjectile) => TEAM_MAP[projectile.teamNumber]

// Shared scratch objects for the frame callbacks below
const _object = new THREE.Object3D()
const _matrix = new THREE.Matrix4()
const _color = new THREE.Color()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()

// Instanced spheres with a colour and an opacity each (smoke puffs, explosions)
const fadingVertexShader = /* glsl */ `
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

const fadingFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    gl_FragColor = vec4(vColor, vOpacity);
  }
`

/** An InstancedMesh of fading spheres, with its per-instance opacity array. */
function useFadingSpheres(count: number, segments: [number, number], blending: THREE.Blending) {
  const pool = useMemo(() => {
    const geometry = new THREE.SphereGeometry(1, segments[0], segments[1])
    const opacity = new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
    opacity.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('instanceOpacity', opacity)
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending,
      vertexShader: fadingVertexShader,
      fragmentShader: fadingFragmentShader,
    })
    const mesh = new THREE.InstancedMesh(geometry, material, count)
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.setColorAt(0, _color.set('#ffffff'))
    return { mesh, opacity }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(
    () => () => {
      pool.mesh.geometry.dispose()
      ;(pool.mesh.material as THREE.Material).dispose()
      pool.mesh.dispose()
    },
    [pool]
  )
  return pool
}

function commit(mesh: THREE.InstancedMesh, opacity: THREE.InstancedBufferAttribute, count: number) {
  mesh.count = count
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  opacity.needsUpdate = true
}

export const Projectiles = () => (
  <group name="projectiles">
    <Suspense fallback={null}>
      <ProjectileModels />
    </Suspense>
    <HealingBolts />
    <RocketSmoke />
    <Explosions />
    <RibbonTrails />
  </group>
)

//
// ─── MODELS ─────────────────────────────────────────────────────────────────────
//

const MODEL_FILES = ['rocket_shared', 'pipebomb_red', 'pipebomb_blue', 'stickybomb_red', 'stickybomb_blue']

/** The model a projectile is drawn with; teams without their own model use RED's. */
function modelKeyOf(projectile: CachedProjectile): string | null {
  if (projectile.type === 'rocket') return 'rocket_shared'
  if (projectile.type !== 'pipebomb' && projectile.type !== 'stickybomb') return null
  return `${projectile.type}_${teamOf(projectile) === 'blue' ? 'blue' : 'red'}`
}

interface ModelPart {
  mesh: THREE.InstancedMesh
  /** The part's place in its model. */
  local: THREE.Matrix4
}

const ProjectileModels = () => {
  const gltfs = useGLTF(MODEL_FILES.map(name => getAsset(`/models/projectiles/${name}.glb`)), true)

  const models = useMemo(() => {
    const byKey = new Map<string, ModelPart[]>()
    MODEL_FILES.forEach((name, i) => {
      const root = gltfs[i].scene
      root.updateMatrixWorld(true)
      const parts: ModelPart[] = []
      root.traverse(node => {
        const source = node as THREE.Mesh
        if (!source.isMesh) return
        const mesh = new THREE.InstancedMesh(source.geometry, source.material, MAX_PROJECTILES)
        mesh.frustumCulled = false
        mesh.count = 0
        parts.push({ mesh, local: source.matrixWorld.clone() })
      })
      byKey.set(name, parts)
    })
    return byKey
  }, [gltfs])

  // The meshes share the cached models' geometry and materials, so only their own buffers go.
  useEffect(() => () => models.forEach(parts => parts.forEach(part => part.mesh.dispose())), [models])

  const previousPositions = useRef(new Map<number, THREE.Vector3>())

  useFrame(() => {
    const counts = new Map<string, number>()
    const { match, tick } = sceneFrame
    // A rocket points along its flight: from where it was a tick before.
    const hasRockets = sceneFrame.projectiles.some(p => p.type === 'rocket')
    const before = hasRockets && match ? match.projectilesAt(tick - 1) : []
    const previous = previousPositions.current
    previous.clear()
    for (const p of before) previous.set(p.entityId, _a.set(p.position.x, p.position.y, p.position.z).clone())

    for (const projectile of sceneFrame.projectiles) {
      const key = modelKeyOf(projectile)
      const parts = key && models.get(key)
      if (!key || !parts) continue
      const index = counts.get(key) ?? 0
      if (index >= MAX_PROJECTILES) continue
      counts.set(key, index + 1)

      const { position, rotation } = projectile
      _object.position.set(position.x, position.y, position.z)
      _object.rotation.set(0, 0, 0)
      _object.quaternion.identity()
      if (projectile.type === 'rocket') {
        const from = previous.get(projectile.entityId)
        if (from && from.distanceToSquared(_object.position) > 1e-6) _object.lookAt(from)
      } else {
        _object.rotation.set(
          degreesToRadians(rotation.x),
          degreesToRadians(rotation.y),
          degreesToRadians(rotation.z)
        )
      }
      _object.updateMatrix()
      for (const part of parts) {
        part.mesh.setMatrixAt(index, _matrix.multiplyMatrices(_object.matrix, part.local))
      }
    }

    models.forEach((parts, key) => {
      const count = counts.get(key) ?? 0
      for (const part of parts) {
        part.mesh.count = count
        part.mesh.instanceMatrix.needsUpdate = true
      }
    })
  }, SCENE_PRIORITY)

  return (
    <>
      {[...models.values()].flat().map(part => (
        <primitive key={part.mesh.uuid} object={part.mesh} />
      ))}
    </>
  )
}

const HealingBolts = () => {
  const mesh = useMemo(() => {
    const instanced = new THREE.InstancedMesh(
      new THREE.SphereGeometry(5, 32, 16),
      new THREE.MeshLambertMaterial({ color: 'yellow' }),
      MAX_PROJECTILES
    )
    instanced.frustumCulled = false
    instanced.count = 0
    return instanced
  }, [])

  useEffect(
    () => () => {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      mesh.dispose()
    },
    [mesh]
  )

  useFrame(() => {
    let count = 0
    for (const { type, position } of sceneFrame.projectiles) {
      if (type !== 'healingBolt' || count >= MAX_PROJECTILES) continue
      mesh.setMatrixAt(count++, _matrix.makeTranslation(position.x, position.y, position.z))
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  }, SCENE_PRIORITY)

  return <primitive object={mesh} />
}

//
// ─── ROCKET SMOKE ───────────────────────────────────────────────────────────────
//
// Puffs dropped every few units along each rocket's flight, growing paler and fading over
// their lifetime; a puff outlives its rocket. One pool for every rocket.
//

const RocketSmoke = () => {
  const { mesh, opacity } = useFadingSpheres(MAX_SMOKE_PUFFS, [6, 4], THREE.NormalBlending)
  const puffs = useRef({
    positions: new Float32Array(MAX_SMOKE_PUFFS * 3),
    born: new Float64Array(MAX_SMOKE_PUFFS).fill(-Infinity),
    next: 0,
  })
  const lastSpawn = useRef(new Map<number, THREE.Vector3>())

  useFrame(() => {
    const now = performance.now()
    const pool = puffs.current
    const step = playbackStep()

    if (step === 'seek') {
      pool.born.fill(-Infinity)
      lastSpawn.current.clear()
    } else if (step === 'forward') {
      const seen = new Set<number>()
      for (const projectile of sceneFrame.projectiles) {
        if (projectile.type !== 'rocket') continue
        seen.add(projectile.entityId)
        const { x, y, z } = projectile.position
        const current = _a.set(x, y, z)
        const last = lastSpawn.current.get(projectile.entityId)
        if (!last) {
          lastSpawn.current.set(projectile.entityId, current.clone())
          continue
        }
        const distance = current.distanceTo(last)
        const count = Math.floor(distance / SMOKE_SPAWN_INTERVAL)
        if (count === 0) continue
        _b.copy(current).sub(last).normalize()
        for (let i = 1; i <= count; i++) {
          const at = pool.next
          pool.positions[at * 3] = last.x + _b.x * SMOKE_SPAWN_INTERVAL * i
          pool.positions[at * 3 + 1] = last.y + _b.y * SMOKE_SPAWN_INTERVAL * i
          pool.positions[at * 3 + 2] = last.z + _b.z * SMOKE_SPAWN_INTERVAL * i
          pool.born[at] = now
          pool.next = (at + 1) % MAX_SMOKE_PUFFS
        }
        last.copy(current)
      }
      for (const id of lastSpawn.current.keys()) if (!seen.has(id)) lastSpawn.current.delete(id)
    }

    let visible = 0
    for (let i = 0; i < MAX_SMOKE_PUFFS; i++) {
      const life = (now - pool.born[i]) / SMOKE_PUFF_LIFETIME_MS
      if (!(life >= 0 && life < 1)) continue
      const scale = SMOKE_PUFF_START_SCALE + (SMOKE_PUFF_END_SCALE - SMOKE_PUFF_START_SCALE) * life
      _matrix.makeScale(scale, scale, scale)
      _matrix.setPosition(pool.positions[i * 3], pool.positions[i * 3 + 1], pool.positions[i * 3 + 2])
      mesh.setMatrixAt(visible, _matrix)
      mesh.setColorAt(visible, _color.copy(SMOKE_PUFF_COLOR_START).lerp(SMOKE_PUFF_COLOR_END, life))
      opacity.setX(visible, 1 - life)
      visible++
    }
    commit(mesh, opacity, visible)
  }, SCENE_PRIORITY)

  return <primitive object={mesh} />
}

//
// ─── EXPLOSIONS ─────────────────────────────────────────────────────────────────
//
// A quick flash where a rocket, pipe or sticky stops existing while playback moves forward.
//

const EXPLODING = new Set(['rocket', 'pipebomb', 'stickybomb'])

const Explosions = () => {
  const { mesh, opacity } = useFadingSpheres(MAX_EXPLOSIONS, [12, 8], THREE.AdditiveBlending)
  const explosions = useRef<{ x: number; y: number; z: number; born: number }[]>([])
  const last = useRef(new Map<number, CachedProjectile>())

  useFrame(() => {
    const now = performance.now()
    const step = playbackStep()
    const current = new Map(sceneFrame.projectiles.map(p => [p.entityId, p]))

    if (step === 'seek') {
      explosions.current = []
    } else if (step === 'forward') {
      last.current.forEach((projectile, id) => {
        const still = current.get(id)
        if (EXPLODING.has(projectile.type) && (!still || still.type !== projectile.type)) {
          explosions.current.push({ ...projectile.position, born: now })
        }
      })
    }
    if (step !== 'still') last.current = current

    explosions.current = explosions.current.filter(e => now - e.born < EXPLOSION_DURATION_MS)
    let count = 0
    for (const explosion of explosions.current.slice(-MAX_EXPLOSIONS)) {
      const progress = (now - explosion.born) / EXPLOSION_DURATION_MS
      const scale = Math.max(0.001, EXPLOSION_MAX_RADIUS * (1 - Math.pow(1 - progress, 3)))
      _matrix.makeScale(scale, scale, scale)
      _matrix.setPosition(explosion.x, explosion.y, explosion.z)
      mesh.setMatrixAt(count, _matrix)
      mesh.setColorAt(count, DEFAULT_EXPLOSION_COLOR)
      opacity.setX(count, EXPLOSION_MAX_OPACITY * (1 - progress))
      count++
    }
    commit(mesh, opacity, count)
  }, SCENE_PRIORITY)

  return <primitive object={mesh} />
}

//
// ─── RIBBON TRAILS ──────────────────────────────────────────────────────────────
//
// drei's Trail behind each pipe, sticky and healing bolt, following an object moved to the
// projectile every frame. When the projectile goes or comes to rest (a sticky on a wall), its
// trail fades for a moment and is then removed, so resting stickies do not keep a trail going.
//

interface TrailEntry {
  key: string
  entityId: number
  type: string
  color: string
  target: THREE.Object3D
  /** When it last moved, and when its projectile went (0 while it exists). */
  movedAt: number
  goneAt: number
}

function trailColor(projectile: CachedProjectile): string {
  if (projectile.type === 'healingBolt') return '#e8d44d'
  return TEAM_COLORS[teamOf(projectile)] ?? TRAIL_FALLBACK_COLOR
}

let nextTrailKey = 0

const RibbonTrails = () => {
  const entries = useRef(new Map<number, TrailEntry>())
  const [shown, setShown] = useState<TrailEntry[]>([])
  const controlsMode = useStore(state => state.scene.controls.mode)

  useFrame(() => {
    const now = performance.now()
    const step = playbackStep()
    const map = entries.current
    let changed = false

    if (step === 'seek') {
      map.forEach((entry, id) => {
        if (entry.goneAt) {
          map.delete(id)
          changed = true
        }
      })
    }

    const present = new Set<number>()
    for (const projectile of sceneFrame.projectiles) {
      if (!TRAIL_CONFIG[projectile.type]) continue
      present.add(projectile.entityId)
      const { x, y, z } = projectile.position
      let entry = map.get(projectile.entityId)
      if (entry && entry.type !== projectile.type) {
        map.delete(projectile.entityId)
        entry = undefined
      }
      if (!entry) {
        const target = new THREE.Object3D()
        target.position.set(x, y, z)
        entry = {
          key: `trail-${nextTrailKey++}`,
          entityId: projectile.entityId,
          type: projectile.type,
          color: trailColor(projectile),
          target,
          movedAt: now,
          goneAt: 0,
        }
        map.set(projectile.entityId, entry)
        changed = true
      }
      if (entry.target.position.distanceToSquared(_a.set(x, y, z)) > 0.25) entry.movedAt = now
      entry.target.position.set(x, y, z)
      entry.goneAt = 0
    }

    map.forEach((entry, id) => {
      if (!present.has(id) && !entry.goneAt && step === 'forward') entry.goneAt = now
      const resting = now - entry.movedAt >= TRAIL_LINGER_MS
      const faded = entry.goneAt > 0 && now - entry.goneAt >= TRAIL_LINGER_MS
      const stale = !present.has(id) && !entry.goneAt
      if (resting || faded || stale) {
        map.delete(id)
        changed = true
      }
    })

    if (changed) setShown([...map.values()])
  }, SCENE_PRIORITY)

  const isPov = controlsMode === 'pov'
  return (
    <>
      {shown.map(entry => (
        <RibbonTrail key={entry.key} entry={entry} isPov={isPov} />
      ))}
    </>
  )
}

const RibbonTrail = ({ entry, isPov }: { entry: TrailEntry; isPov: boolean }) => {
  const config = TRAIL_CONFIG[entry.type]
  const width = isPov ? config.baseWidth : config.baseWidth * 0.9
  const target = useMemo(() => ({ current: entry.target }), [entry.target])
  const trailRef = useRef<any>(null)

  useEffect(() => {
    const material = trailRef.current?.material
    if (!material) return
    material.transparent = true
    material.opacity = config.opacity
    material.depthWrite = false
  })

  return (
    <>
      <primitive object={entry.target} />
      <Trail
        ref={trailRef}
        target={target as any}
        width={width}
        length={config.length}
        color={entry.color}
        attenuation={(t: number) => 0.5 * width * t}
      />
    </>
  )
}
