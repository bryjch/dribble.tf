import { useRef, useEffect, useLayoutEffect, useMemo, useCallback, memo, Suspense } from 'react'

import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, useGLTF } from '@react-three/drei'

import { HealBeam } from '@components/Scene/HealBeam'
import { Nameplate } from '@components/Scene/Nameplate'
import { markOutlined } from '@components/Scene/PlayerOutlines'
import {
  type ModelLook,
  PLAIN_LOOK,
  applyModelEffects,
  cloneMaterials,
  disposeMaterials,
  effectTime,
  lookKey,
  playerLook,
} from '@components/Scene/modelEffects'
import { SCENE_PRIORITY, isScenePlayer, sceneFrame } from '@components/Scene/PlaybackDriver'
import type { MatchSource } from '@components/Analyse/Data/MatchSource'
import { CachedPlayer } from '@components/Analyse/Data/PlayerTracks'

import { useInstance, useStore } from '@zus/store'
import { CLASS_MAP, PLAYER_DIMENSIONS } from '@constants/mappings'
import { cameraQuaternionFromSourceAnglesDeg, yawQuaternionFromDegrees } from '@utils/geometry'
import { getAsset } from '@utils/misc'

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
  /** How the player's conditions show on the model: a cloak, an über's glow, and so on. */
  look?: ModelLook
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
  const { look = PLAIN_LOOK, visible, team } = props

  // Each model its own materials, so one's look is not everyone's. Cloned once per model: drei's
  // <Clone deep> clones them again on every render, which dropped an über's tint (or a cloak)
  // whenever the player's health or conditions changed under it.
  const scene = useMemo(() => {
    const clone = gltf.scene.clone()
    cloneMaterials(clone)
    return clone
  }, [gltf.scene])

  useEffect(() => () => disposeMaterials(scene), [scene])

  useLayoutEffect(() => {
    if (ref.current) markOutlined(ref.current, team)
  }, [team, scene])

  const key = lookKey(look)
  useLayoutEffect(() => {
    applyModelEffects(scene, look)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scene])

  return (
    <group ref={ref} visible={visible} rotation={[Math.PI * 0.5, Math.PI * 0.5, 0]}>
      <primitive object={scene} />
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
  /** The nameplate's element while one is shown, sized by distance every frame. */
  plate: React.RefObject<HTMLDivElement>
}

// Nameplates shrink and fade from NEAR to FAR (Hammer units from the camera), and drop the name
// past COMPACT, so a zoomed-out RTS view is not a pile of overlapping names.
const PLATE_NEAR = 1200
const PLATE_FAR = 6000
const PLATE_COMPACT = 3500
const PLATE_MIN_SCALE = 0.6
const PLATE_MIN_OPACITY = 0.7
const _cameraPosition = new THREE.Vector3()

function sizePlate(plate: HTMLDivElement, distance: number) {
  const t = Math.min(Math.max((distance - PLATE_NEAR) / (PLATE_FAR - PLATE_NEAR), 0), 1)
  // In steps, so the style is only written when it visibly changes.
  const step = Math.round(t * 20) / 20
  const compact = distance > PLATE_COMPACT ? 'true' : 'false'
  if (plate.dataset.step === String(step) && plate.dataset.compact === compact) return
  plate.dataset.step = String(step)
  plate.dataset.compact = compact
  plate.style.transform = `scale(${1 - (1 - PLATE_MIN_SCALE) * step})`
  plate.style.opacity = String(1 - (1 - PLATE_MIN_OPACITY) * step)
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

  useFrame(({ camera, clock }) => {
    effectTime.value = clock.elapsedTime
    camera.getWorldPosition(_cameraPosition)
    for (const player of sceneFrame.players) {
      const actor = handles.current.get(player.user.entityId)
      if (!actor) continue
      placeActor(actor, player)
      const plate = actor.plate.current
      if (plate) sizePlate(plate, actor.group.position.distanceTo(_cameraPosition))
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
    cameraQuaternionFromSourceAnglesDeg({
      pitch: viewAngles.x,
      yaw: viewAngles.y,
      roll: viewAngles.z,
    })
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
  const plateRef = useRef<HTMLDivElement>(null)

  const nameplate = useStore(state => state.settings.ui.nameplate)
  const focusedObject = useInstance(state => state.focusedObject)

  const { classId, health, team, user, healTarget, conditions, ubered } = player
  const entityId = user.entityId
  const look = useMemo(
    () => playerLook({ team, conditions, ubered }),
    [team, conditions, ubered]
  )
  const shielded = !!ubered?.startsWith('vaccinator')
  const isFocusedPOV = focusedObject?.userData?.entityId === entityId
  const alive = health > 0
  const color = team === 'red' ? '#ff0202' : team === 'blue' ? '#0374ff' : undefined

  useLayoutEffect(() => {
    const group = actorRef.current
    const body = bodyRef.current
    const aim = playerAimRef.current
    if (!group || !body || !aim) return
    const actor = { group, body, aim, plate: plateRef }
    // Placed now, so a player who just appeared is not drawn at the origin for a frame.
    placeActor(actor, sceneFrame.playersByEntity.get(entityId) ?? player)
    register(entityId, actor)
    return () => register(entityId, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, register])

  const aim = playerAimRef.current
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
              look={look}
            />
          ) : null}
        </Suspense>
      </group>

      {/* A Vaccinator über's shield */}

      {shielded && alive && !isFocusedPOV && (team === 'red' || team === 'blue') && (
        <VaccinatorBubble team={team} />
      )}

      {/* Player aim */}

      <group ref={playerAimRef} name="playerAim" position={[0, 0, ActorDimensions.z]}>
        <POVCamera />
      </group>

      {/* Medic heal beam: both ends are the players' objects, moved every frame */}

      {aim && target && (
        <HealBeam aim={aim} entityId={entityId} focused={isFocusedPOV} target={target} color={color} />
      )}

      {/* Nameplate */}

      {nameplate.enabled && !isFocusedPOV && (
        <Html
          name="html"
          className="pointer-events-none select-none text-white"
          style={{ bottom: 0, transform: 'translateX(-50%)', textAlign: 'center' }}
          position={[0, 0, ActorDimensions.z * 0.85]}
        >
          <div ref={plateRef} className="group/plate origin-bottom">
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
          </div>
        </Html>
      )}
    </group>
  )
}, sameLook)

// The Vaccinator's shield: a team-coloured bubble, clear in the middle and bright at its edge.
const BUBBLE_RADIUS = ActorDimensions.z * 0.72
const bubbleGeometry = new THREE.SphereGeometry(BUBBLE_RADIUS, 32, 20)
const bubbleMaterial = (color: string) =>
  new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = -view.xyz;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        gl_FragColor = vec4(color, 0.06 + 0.55 * pow(1.0 - facing, 2.5));
      }`,
    transparent: true,
    depthWrite: false,
  })
const bubbleMaterials = { red: bubbleMaterial('#ff4a4a'), blue: bubbleMaterial('#4a9dff') }

const VaccinatorBubble = ({ team }: { team: 'red' | 'blue' }) => (
  <mesh
    name="vaccinatorBubble"
    geometry={bubbleGeometry}
    material={bubbleMaterials[team]}
    position={[0, 0, ActorDimensions.z / 2]}
  />
)

export interface POVCameraProps {}

export const POVCamera = ({}: POVCameraProps) => {
  const ref = useRef<THREE.PerspectiveCamera>(null)

  const settings = useStore(state => state.settings)
  // The canvas, not the window: a docked sidebar makes the canvas narrower than the window.
  const size = useThree(state => state.size)

  const updateCamera = () => {
    if (!ref.current) return
    ref.current.aspect = size.width / size.height
    ref.current.updateProjectionMatrix()
  }

  useEffect(updateCamera, [settings, size.width, size.height])

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
