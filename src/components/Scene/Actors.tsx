import { useRef, useEffect, useLayoutEffect, useMemo, useCallback, memo, Suspense } from 'react'

import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Select } from '@react-three/postprocessing'
import { Html, useGLTF, Clone } from '@react-three/drei'

import { HealBeam } from '@components/Scene/HealBeam'
import { Nameplate } from '@components/Scene/Nameplate'
import { SCENE_PRIORITY, isScenePlayer, sceneFrame } from '@components/Scene/PlaybackDriver'
import type { MatchSource } from '@components/Analyse/Data/MatchSource'
import { CachedPlayer } from '@components/Analyse/Data/PlayerTracks'
import { hasCondition } from '@components/Analyse/Data/StreamEvents'

import { useInstance, useStore } from '@zus/store'
import { CLASS_MAP, PLAYER_DIMENSIONS } from '@constants/mappings'
import { cameraQuaternionFromSourceAnglesDeg, yawQuaternionFromDegrees } from '@utils/geometry'
import { getAsset } from '@utils/misc'
import { useEventListener } from '@utils/hooks'

export const ActorDimensions = new THREE.Vector3(
  PLAYER_DIMENSIONS.x,
  PLAYER_DIMENSIONS.y,
  PLAYER_DIMENSIONS.z
)



//
// ─── PLAYER MODEL ───────────────────────────────────────────────────────────────
//

export interface PlayerModelProps {
  team: string
  classId: number
  visible?: boolean
  backface?: boolean
  /** A cloaked spy: drawn faintly. */
  cloaked?: boolean
  /** A glow over the model, such as an über's team colour. */
  tint?: string | null
}

const CLOAKED_OPACITY = 0.2
const TINT_INTENSITY = 0.55

type EffectMaterial = THREE.Material & { emissive?: THREE.Color; emissiveIntensity?: number }

/** Sets a model's own materials (cloned per model) for its cloak and tint, keeping the originals. */
function applyModelEffects(root: THREE.Object3D, cloaked: boolean, tint: string | null) {
  root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as EffectMaterial[]
    for (const material of materials) {
      const original = (material.userData.original ??= {
        transparent: material.transparent,
        opacity: material.opacity,
        depthWrite: material.depthWrite,
        emissive: material.emissive?.clone(),
        emissiveIntensity: material.emissiveIntensity,
      })
      material.transparent = cloaked || original.transparent
      material.opacity = cloaked ? CLOAKED_OPACITY : original.opacity
      material.depthWrite = cloaked ? false : original.depthWrite
      if (material.emissive && original.emissive) {
        if (tint) material.emissive.set(tint)
        else material.emissive.copy(original.emissive)
        material.emissiveIntensity = tint ? TINT_INTENSITY : original.emissiveIntensity
      }
      material.needsUpdate = true
    }
  })
}

export const PlayerModel = (props: PlayerModelProps) => {
  // Note: currently RED and BLU models are separate GLTF files.
  // It would be awesome if we could use a single GLTF and swap the material/textures.
  // I tried doing that but dual materials wouldn't export from Blender.
  // The models have been hugely optimized by removing bones/animations and baking the pose,
  // so it's no longer as huge a deal. They're are also cached by the GLTF loader.
  const modelUrl = getAsset(`/models/players/${CLASS_MAP[props.classId]}_${props.team}.glb`)
  const gltf = useGLTF(modelUrl, true, false)
  const ref = useRef<THREE.Group>(null)
  const { cloaked = false, tint = null, visible } = props

  useLayoutEffect(() => {
    if (ref.current) applyModelEffects(ref.current, cloaked, tint)
  }, [cloaked, tint, gltf.scene])

  return (
    <group ref={ref} visible={visible} rotation={[Math.PI * 0.5, Math.PI * 0.5, 0]}>
      <Select enabled={!!gltf.scene}>
        {/* Each model its own materials, so one's cloak or tint is not everyone's. */}
        <Clone object={gltf.scene} deep="materialsOnly" />
      </Select>
    </group>
  )
}

// ─── ACTORS ──────────────────────────────────────────────────────────────────
//
// Players are drawn in two halves. Where each player is and where they look changes every
// frame: Actors' frame callback sets that on the objects directly from sceneFrame. What a
// player looks like (class, team, alive, health on the nameplate, conditions, heal target)
// changes far less often: that is React state, rendered from the store's tick a few times a
// second, and each Actor re-renders only when its own look changes.
//

/** The objects an Actor hands Actors to move every frame. */
interface ActorHandles {
  group: THREE.Group
  body: THREE.Group
  aim: THREE.Group
}

export interface ActorsProps {
  match?: MatchSource
}

export const Actors = ({ match }: ActorsProps) => {
  const tick = useStore(state => state.playback.tick)
  const handles = useRef(new Map<number, ActorHandles>())

  const players = useMemo(
    () => (match ? match.playersAt(tick).filter(isScenePlayer) : []),
    [match, tick]
  )

  useFrame(() => {
    for (const player of sceneFrame.players) {
      const actor = handles.current.get(player.user.entityId)
      if (actor) placeActor(actor, player)
    }
  }, SCENE_PRIORITY)

  const register = useCallback((entityId: number, actor: ActorHandles | null) => {
    if (actor) handles.current.set(entityId, actor)
    else handles.current.delete(entityId)
  }, [])

  const positionOf = useCallback(
    (entityId: number) => handles.current.get(entityId)?.group.position,
    []
  )

  return (
    <group name="actors">
      {/* Keyed by player: a list position changes hands when anyone joins, leaves or swaps team. */}
      {players.map(player => (
        <Actor
          key={`actor-${player.user.entityId}`}
          player={player}
          register={register}
          positionOf={positionOf}
        />
      ))}
    </group>
  )
}

function placeActor(actor: ActorHandles, player: CachedPlayer) {
  const { position, viewAngles } = player
  actor.group.position.set(position.x, position.y, position.z)
  actor.group.quaternion.identity()
  // Source QAngle convention (degrees): x=pitch, y=yaw, z=roll. The body turns with the yaw
  // only; the aim (and the POV camera on it) has the full view angles.
  actor.body.quaternion.copy(yawQuaternionFromDegrees(viewAngles.y))
  actor.aim.quaternion.copy(
    cameraQuaternionFromSourceAnglesDeg({ pitch: viewAngles.x, yaw: viewAngles.y, roll: viewAngles.z })
  )
}

//
// ─── ACTOR ──────────────────────────────────────────────────────────────────────
//

interface ActorProps {
  /** The player at the store's tick: what they look like, not where they are. */
  player: CachedPlayer
  register: (entityId: number, actor: ActorHandles | null) => void
  positionOf: (entityId: number) => THREE.Vector3 | undefined
}

/** Whether two states of a player look the same (where they are does not count). */
const sameLook = (a: ActorProps, b: ActorProps) => {
  const p = a.player
  const q = b.player
  return (
    p.user.entityId === q.user.entityId &&
    p.user.name === q.user.name &&
    p.team === q.team &&
    p.classId === q.classId &&
    p.health === q.health &&
    p.conditions === q.conditions &&
    p.ubered === q.ubered &&
    p.healTarget === q.healTarget &&
    a.register === b.register &&
    a.positionOf === b.positionOf
  )
}

const Actor = memo(({ player, register, positionOf }: ActorProps) => {
  const actorRef = useRef<THREE.Group>(null)
  const bodyRef = useRef<THREE.Group>(null)
  const playerAimRef = useRef<THREE.Group>(null)

  const nameplate = useStore(state => state.settings.ui.nameplate)
  const focusedObject = useInstance(state => state.focusedObject)

  const { classId, health, team, user, healTarget, conditions, ubered } = player
  const entityId = user.entityId
  const cloaked = hasCondition(conditions, 'cloaked')
  const tint = ubered ? (team === 'red' ? '#ff3b3b' : '#3b8bff') : null
  const isFocusedPOV = focusedObject?.userData?.entityId === entityId
  const alive = health > 0
  const color = team === 'red' ? '#ff0202' : team === 'blue' ? '#0374ff' : undefined

  useLayoutEffect(() => {
    const group = actorRef.current
    const body = bodyRef.current
    const aim = playerAimRef.current
    if (!group || !body || !aim) return
    const actor = { group, body, aim }
    // Placed now, so a player who just appeared is not drawn at the origin for a frame.
    placeActor(actor, sceneFrame.playersByEntity.get(entityId) ?? player)
    register(entityId, actor)
    return () => register(entityId, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, register])

  const origin = actorRef.current?.position
  const target = healTarget ? positionOf(healTarget) : undefined

  return (
    <group name="actor" ref={actorRef} userData={user}>
      {/* Player model */}

      <group name="playerBody" ref={bodyRef}>
        <Suspense fallback={null}>
          {team && classId ? (
            // A new key per class and team mounts that model instead of reusing the last one.
            <PlayerModel
              key={`${team}-${classId}`}
              visible={alive && !isFocusedPOV}
              team={team}
              classId={classId}
              cloaked={cloaked}
              tint={tint}
            />
          ) : null}
        </Suspense>
      </group>

      {/* Player aim */}

      <group ref={playerAimRef} name="playerAim" position={[0, 0, ActorDimensions.z]}>
        <POVCamera />
      </group>

      {/* Medic heal beam: both ends are the players' objects, moved every frame */}

      {origin && target && <HealBeam origin={origin} target={target} color={color} />}

      {/* Nameplate */}

      {nameplate.enabled && !isFocusedPOV && (
        <Html
          name="html"
          className="pointer-events-none select-none"
          style={{ bottom: 0, transform: 'translateX(-50%)', textAlign: 'center' }}
          position={[0, 0, ActorDimensions.z * 0.85]}
        >
          {alive && (
            <Nameplate
              name={user.name}
              team={team}
              health={health}
              classId={classId}
              conditions={conditions}
              ubered={ubered}
              settings={nameplate}
            />
          )}
        </Html>
      )}
    </group>
  )
}, sameLook)

export interface POVCameraProps {}

export const POVCamera = ({}: POVCameraProps) => {
  const ref = useRef<THREE.PerspectiveCamera>(null)

  const settings = useStore(state => state.settings)

  const updateCamera = () => {
    if (!ref.current) return
    ref.current.aspect = window.innerWidth / window.innerHeight
    ref.current.updateProjectionMatrix()
  }

  useEffect(updateCamera, [settings])
  useEventListener('resize', updateCamera, window)

  return (
    <perspectiveCamera
      name="povCamera"
      ref={ref}
      {...settings?.camera}
      position={[0, 0, 0]}
      rotation={[0, 0, 0]}
    />
  )
}
