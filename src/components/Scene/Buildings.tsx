import { useEffect, useMemo, useState } from 'react'

import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'

import { CachedBuilding } from '@components/Analyse/Data/BuildingCache'
import { SCENE_PRIORITY, sceneFrame } from '@components/Scene/PlaybackDriver'

import { useStore } from '@zus/store'
import { degreesToRadians } from '@utils/geometry'
import { getAsset } from '@utils/misc'
import { cn } from '@utils/styling'

//
// ─── BUILDINGS ──────────────────────────────────────────────────────────────────
//
// Engineer buildings in TF2's own models (scripts/viewmodels/build-viewmodels.mjs builds them
// into public/models/buildings/): each sentry, dispenser and teleporter level in its team's
// skin, the turret turned to where the sentry aims, a sapper on a sapped one. Until a model has
// loaded, or if it is missing, the building is drawn as a simple team-coloured shape instead.
//
// A sentry's aim and target are read every frame from PlaybackDriver's sceneFrame, so the turret
// and the line to who it shoots at move smoothly; the rest re-renders with the store's tick.
//

const TEAM_COLORS: Record<number, string> = { 2: '#b8383b', 3: '#5885a2' }
const SAPPED_COLOR = '#9aa3ad'

/** How far a sentry sees and shoots (tf_obj_sentrygun's SENTRY_MAX_RANGE). */
const SENTRY_RANGE = 1100
/** Where a sentry aims on a player: the middle of their hull, above their feet. */
const TARGET_HEIGHT = 41
/** TF2 builds the mini-sentry as the level 1 sentry at this scale. */
const MINI_SCALE = 0.75

/** The bone each sentry level turns to aim (yaw, about its own Y). */
const TURRET_BONE = 'upper_telescope_01'

/** The label TF2's engineer HUD gives a building: S1-S3, MS, D1-D3, T1-T3. */
const buildingLabel = (b: CachedBuilding) => {
  if (b.kind === 'sentry') return b.mini ? 'MS' : `S${b.level}`
  if (b.kind === 'dispenser') return `D${b.level}`
  return `T${b.level}${b.entrance ? '↓' : '↑'}`
}

const levelOf = (b: CachedBuilding) => Math.min(Math.max(b.level, 1), 3)

/** The model a building is drawn with; models/buildings/<key>_<team>.glb. */
const modelKey = (b: CachedBuilding) => {
  if (b.kind === 'sentry') return b.mini ? 'minisentry' : `sentry${levelOf(b)}`
  if (b.kind === 'dispenser') return `dispenser${levelOf(b)}`
  return 'teleporter'
}

/** How tall each model stands, for the label above it. */
const MODEL_HEIGHTS: Record<string, number> = {
  minisentry: 52 * MINI_SCALE,
  sentry1: 52,
  sentry2: 56,
  sentry3: 89,
  dispenser1: 58,
  dispenser2: 58,
  dispenser3: 66,
  teleporter: 15,
}

const teamName = (team: number) => (team === 3 ? 'blue' : 'red')
const modelUrl = (file: string) => getAsset(`/models/buildings/${file}.glb`)
const SAPPER_URL = modelUrl('sapper_shared')

// The models load with plain state rather than Suspense, so a building shows its stand-in shape
// meanwhile rather than nothing. A failed load is forgotten so it can be tried again.
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const requests = new Map<string, Promise<GLTF>>()
const loadModel = (url: string) => {
  let request = requests.get(url)
  if (!request) {
    request = loader.loadAsync(url)
    request.catch(() => requests.delete(url))
    requests.set(url, request)
  }
  return request
}

const useModel = (url: string) => {
  const [loaded, setLoaded] = useState<{ url: string; gltf: GLTF } | null>(null)
  useEffect(() => {
    let live = true
    loadModel(url).then(
      gltf => live && setLoaded({ url, gltf }),
      () => {}
    )
    return () => {
      live = false
    }
  }, [url])
  return loaded?.url === url ? loaded.gltf : null
}

/** What the frame loop moves on a building's model. */
interface Rig {
  turret: THREE.Object3D | null
  turretRest: THREE.Quaternion
  /** Where a sentry's laser (and so its line to its target) starts. */
  laser: THREE.Object3D | null
}

//
// ─── MODELS ─────────────────────────────────────────────────────────────────────
//

interface BuildingModelProps {
  building: CachedBuilding
  gltf: GLTF
  rigs: Map<number, Rig>
}

const BuildingModel = ({ building, gltf, rigs }: BuildingModelProps) => {
  const sapperGltf = useModel(SAPPER_URL)

  // Each building its own copy: its own bones to turn, its own materials to fade.
  const { root, materials, rig } = useMemo(() => {
    const root = cloneSkinned(gltf.scene)
    const materials: THREE.Material[] = []
    root.traverse(node => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const material = (mesh.material as THREE.Material).clone()
      material.userData.translucent = material.transparent
      mesh.material = material
      materials.push(material)
    })
    const turret = root.getObjectByName(TURRET_BONE) ?? null
    const rig: Rig = {
      turret,
      turretRest: turret ? turret.quaternion.clone() : new THREE.Quaternion(),
      laser: root.getObjectByName('attachment_laser_origin') ?? null,
    }
    return { root, materials, rig }
  }, [gltf])

  useEffect(() => () => materials.forEach(m => m.dispose()), [materials])

  useEffect(() => {
    rigs.set(building.entityId, rig)
    return () => {
      if (rigs.get(building.entityId) === rig) rigs.delete(building.entityId)
    }
  }, [rigs, rig, building.entityId])

  // See-through while still being built.
  const ghost = building.constructing
  useEffect(() => {
    for (const material of materials) {
      const translucent = !!material.userData.translucent
      material.transparent = ghost || translucent
      material.opacity = ghost ? 0.45 : 1
      material.depthWrite = !ghost && !translucent
      material.needsUpdate = true
    }
  }, [materials, ghost])

  // A sapper the way TF2 puts one on: merged onto the building's bones (weapon_bone and the
  // hoses), which every building shares with the sapper model.
  const sapped = building.sapped
  useEffect(() => {
    if (!sapped || !sapperGltf) return
    const meshes: THREE.SkinnedMesh[] = []
    cloneSkinned(sapperGltf.scene).traverse(node => {
      const mesh = node as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh) return
      const { bones, boneInverses } = mesh.skeleton
      const merged = bones.map(bone => root.getObjectByName(bone.name))
      // A bone the building lacks would leave that part of the sapper at the map's origin.
      if (merged.some(bone => !bone)) return
      mesh.bind(new THREE.Skeleton(merged as THREE.Bone[], boneInverses), mesh.bindMatrix)
      // Its bounds are where it was modelled, not on the building.
      mesh.frustumCulled = false
      meshes.push(mesh)
    })
    root.add(...meshes)
    return () => {
      root.remove(...meshes)
    }
  }, [sapped, sapperGltf, root])

  return (
    <group scale={building.mini ? MINI_SCALE : 1}>
      {/* glTF is Y up; the scene is Source's Z up. */}
      <primitive object={root} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  )
}

//
// ─── STAND-INS ──────────────────────────────────────────────────────────────────
//
// Simple shapes, roughly the game's sizes in Hammer units, for while a model loads.
//

interface StandInMaterialProps {
  color: string
  ghost: boolean
}

const StandInMaterial = ({ color, ghost }: StandInMaterialProps) => (
  <meshStandardMaterial
    color={color}
    roughness={0.7}
    metalness={0.2}
    transparent={ghost}
    opacity={ghost ? 0.45 : 1}
  />
)

const StandIn = ({ building }: { building: CachedBuilding }) => {
  const color = building.sapped ? SAPPED_COLOR : (TEAM_COLORS[building.team] ?? '#888888')
  const ghost = building.constructing
  if (building.kind === 'sentry') {
    return (
      <group scale={building.mini ? MINI_SCALE : 0.85 + building.level * 0.1}>
        <mesh position={[0, 0, 10]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[6, 16, 20, 3]} />
          <StandInMaterial color={color} ghost={ghost} />
        </mesh>
        <mesh position={[0, 0, 30]}>
          <boxGeometry args={[26, 18, 18]} />
          <StandInMaterial color={color} ghost={ghost} />
        </mesh>
      </group>
    )
  }
  if (building.kind === 'dispenser') {
    return (
      <mesh position={[0, 0, 25]}>
        <boxGeometry args={[24, 30, 50]} />
        <StandInMaterial color={color} ghost={ghost} />
      </mesh>
    )
  }
  return (
    <mesh position={[0, 0, 3]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[24, 26, 6, 24]} />
      <StandInMaterial color={color} ghost={ghost} />
    </mesh>
  )
}

//
// ─── SENTRY RANGE ───────────────────────────────────────────────────────────────
//

const rangeOutline: [number, number, number][] = Array.from({ length: 129 }, (_, i) => {
  const a = (i / 128) * Math.PI * 2
  return [Math.cos(a) * SENTRY_RANGE, Math.sin(a) * SENTRY_RANGE, 0]
})
const rangeFill = new THREE.CircleGeometry(SENTRY_RANGE, 96)

/**
 * The ground a sentry covers: a ring at its range, lightly filled, flat at the sentry's feet.
 * Drawn over the world, since higher ground around it would otherwise hide most of it.
 */
const SentryRange = ({ color }: { color: string }) => (
  <group position={[0, 0, 2]}>
    <Line
      points={rangeOutline}
      color={color}
      lineWidth={2}
      transparent
      opacity={0.75}
      depthTest={false}
      depthWrite={false}
      renderOrder={2}
    />
    <mesh geometry={rangeFill} renderOrder={2}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.05}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  </group>
)

//
// ─── SENTRY TARGETS ─────────────────────────────────────────────────────────────
//

const MAX_TARGET_LINES = 32
/** The target line's width, in pixels, so it reads from far off too. */
const TARGET_LINE_WIDTH = 2.5

/**
 * One line per sentry shooting at someone, from its laser to their middle, in its team's colour.
 * The buffers are made once at their largest and written in place each frame.
 */
const useTargetLines = () =>
  useMemo(() => {
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(new Float32Array(MAX_TARGET_LINES * 6))
    geometry.setColors(new Float32Array(MAX_TARGET_LINES * 6))
    geometry.instanceCount = 0
    const positions = (geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute).data
    const colors = (geometry.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data
    const material = new LineMaterial({
      vertexColors: true,
      linewidth: TARGET_LINE_WIDTH,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    })
    const lines = new LineSegments2(geometry, material)
    lines.frustumCulled = false
    lines.renderOrder = 1
    return { lines, material, positions, colors }
  }, [])

const _quaternion = new THREE.Quaternion()
const _up = new THREE.Vector3(0, 1, 0)
const _start = new THREE.Vector3()
const _color = new THREE.Color()

//
// ─── TAG ────────────────────────────────────────────────────────────────────────
//

interface BuildingTagProps {
  building: CachedBuilding
}

/** The label and health bar above a building, like a player's nameplate. */
const BuildingTag = ({ building }: BuildingTagProps) => {
  const percentage = building.maxHealth ? (building.health / building.maxHealth) * 100 : 0
  return (
    <div className="pointer-events-none flex select-none flex-col items-center">
      <div
        className={cn(
          'text-[0.75rem] font-bold leading-none',
          '[text-shadow:0_0_2px_#000000,0_0_2px_#000000,0_0_2px_#000000]',
          building.constructing && 'opacity-60'
        )}
      >
        {buildingLabel(building)}
        {building.sapped && <span className="ml-1 text-[#c9d6e3]">SAPPED</span>}
      </div>
      <div className="relative mt-[2px] h-[4px] w-10 overflow-hidden bg-[#8f7b89]">
        <div
          className={cn(
            'absolute inset-0 right-auto',
            building.team === 2 && 'bg-pp-healthbar-red',
            building.team === 3 && 'bg-pp-healthbar-blue'
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

//
// ─── BUILDINGS ──────────────────────────────────────────────────────────────────
//

interface BuildingProps {
  building: CachedBuilding
  rigs: Map<number, Rig>
  showRange: boolean
  showTag: boolean
}

const Building = ({ building, rigs, showRange, showTag }: BuildingProps) => {
  const key = modelKey(building)
  const gltf = useModel(modelUrl(`${key}_${teamName(building.team)}`))
  const { x, y, z } = building.position
  return (
    <group position={[x, y, z]}>
      <group rotation={[0, 0, degreesToRadians(building.yaw)]}>
        {gltf ? (
          <BuildingModel building={building} gltf={gltf} rigs={rigs} />
        ) : (
          <StandIn building={building} />
        )}
      </group>
      {showRange && building.kind === 'sentry' && !building.constructing && (
        <SentryRange color={TEAM_COLORS[building.team] ?? '#888888'} />
      )}
      {showTag && (
        <Html
          className="pointer-events-none select-none text-white"
          style={{ bottom: 0, transform: 'translateX(-50%)', textAlign: 'center' }}
          position={[0, 0, (MODEL_HEIGHTS[key] ?? 50) + 10]}
        >
          <BuildingTag building={building} />
        </Html>
      )}
    </group>
  )
}

export interface BuildingsProps {
  buildings: CachedBuilding[]
}

export const Buildings = ({ buildings }: BuildingsProps) => {
  const nameplates = useStore(state => state.settings.ui.nameplate)
  const { sentryTargets, sentryRange } = useStore(state => state.settings.ui.buildings)
  const rigs = useMemo(() => new Map<number, Rig>(), [])
  const target = useTargetLines()
  const hasSentries = buildings.some(b => b.kind === 'sentry')

  useEffect(
    () => () => {
      target.lines.geometry.dispose()
      target.material.dispose()
    },
    [target]
  )

  useFrame(({ size }) => {
    const { match, tick, playersByEntity } = sceneFrame
    let lines = 0
    if (match && hasSentries) {
      for (const b of match.buildingsAt(tick)) {
        if (b.kind !== 'sentry') continue
        const rig = rigs.get(b.entityId)
        if (rig?.turret && b.aim !== null) {
          _quaternion.setFromAxisAngle(_up, degreesToRadians(b.aim - b.yaw))
          rig.turret.quaternion.copy(rig.turretRest).multiply(_quaternion)
        }
        if (!sentryTargets || !b.target || lines >= MAX_TARGET_LINES) continue
        const player = playersByEntity.get(b.target)
        if (!player || player.health <= 0) continue
        if (rig?.laser) {
          rig.laser.updateWorldMatrix(true, false)
          rig.laser.getWorldPosition(_start)
        } else {
          _start.set(b.position.x, b.position.y, b.position.z + 32)
        }
        const o = lines * 6
        target.positions.array.set(
          [
            _start.x,
            _start.y,
            _start.z,
            player.position.x,
            player.position.y,
            player.position.z + TARGET_HEIGHT,
          ],
          o
        )
        _color.set(TEAM_COLORS[b.team] ?? '#ffffff')
        target.colors.array.set([_color.r, _color.g, _color.b, _color.r, _color.g, _color.b], o)
        lines++
      }
    }
    target.lines.geometry.instanceCount = lines
    target.lines.visible = lines > 0
    if (lines) {
      target.positions.needsUpdate = true
      target.colors.needsUpdate = true
      target.material.resolution.set(size.width, size.height)
    }
  }, SCENE_PRIORITY)

  return (
    <group name="buildings">
      {buildings.map(building => (
        <Building
          key={`building-${building.entityId}`}
          building={building}
          rigs={rigs}
          showRange={sentryRange}
          showTag={!!nameplates?.enabled}
        />
      ))}
      <primitive object={target.lines} />
    </group>
  )
}
