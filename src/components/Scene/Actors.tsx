import { useRef, useEffect, Suspense, useState } from 'react'

import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Select } from '@react-three/postprocessing'
import { Html, MeshWobbleMaterial, useGLTF, Clone } from '@react-three/drei'
import { Vector } from '@components/Analyse/Data/Types'

import { Nameplate } from '@components/Scene/Nameplate'
import { CachedPlayer } from '@components/Analyse/Data/PlayerCache'

import { useInstance, useStore } from '@zus/store'
import { CLASS_MAP } from '@constants/mappings'
import {
  degreesToRadians,
  objCoordsToVector3,
  cameraQuaternionFromSourceAnglesDeg,
  yawQuaternionFromDegrees,
  smoothingAlpha,
} from '@utils/geometry'
import { getAsset } from '@utils/misc'
import { useEventListener } from '@utils/hooks'

// Default TF2 player dimensions as specified in:
// https://developer.valvesoftware.com/wiki/TF2/Team_Fortress_2_Mapper%27s_Reference
export const ActorDimensions = new THREE.Vector3(49, 49, 83)

// Some reusable vectors used for quaternion calculations
const VectorZ = new THREE.Vector3(0, 0, 1)

export const AimLineSize = 150
const RENDER_POSITION_SMOOTH_SECONDS = 0.04
const RENDER_ROTATION_SMOOTH_SECONDS = 0.03
const TELEPORT_LERP_DISTANCE = 4096

/**
 * Resolve view angles that may erroneously be all-zero from the parser.
 * Updates lastGoodRef when non-zero angles are found, and falls back
 * to the last known good angles when all components are zero.
 */
function resolveViewAngles(
  angles: Vector,
  lastGoodRef: { current: Vector }
): Vector {
  if (angles.x === 0 && angles.y === 0 && angles.z === 0) {
    return lastGoodRef.current
  }
  lastGoodRef.current = angles
  return angles
}

//
// ─── PLAYER MODEL ───────────────────────────────────────────────────────────────
//

export interface PlayerModelProps {
  team: string
  classId: number
  visible?: boolean
  backface?: boolean
}

export const PlayerModel = (props: PlayerModelProps) => {
  // Note: currently RED and BLU models are separate GLTF files.
  // It would be awesome if we could use a single GLTF and swap the material/textures.
  // I tried doing that but dual materials wouldn't export from Blender.
  // The models have been hugely optimized by removing bones/animations and baking the pose,
  // so it's no longer as huge a deal. They're are also cached by the GLTF loader.
  const modelUrl = getAsset(`/models/players/${CLASS_MAP[props.classId]}_${props.team}.glb`)
  const gltf = useGLTF(modelUrl, true, false)

  return (
    <group {...props} visible={props.visible} rotation={[Math.PI * 0.5, Math.PI * 0.5, 0]}>
      <Select enabled={!!gltf.scene}>
        <Clone object={gltf.scene} />
      </Select>
    </group>
  )
}

// ─── ACTORS ──────────────────────────────────────────────────────────────────

export interface ActorsProps {
  actors: ActorProps[]
}

export const Actors = (props: ActorsProps) => {
  const { actors = [] } = props

  return (
    <group name="actors">
      {actors.map((actor, index) => (
        <Actor key={`actor-${index}`} {...actor} />
      ))}
    </group>
  )
}

//
// ─── ACTOR ──────────────────────────────────────────────────────────────────────
//

export type ActorProps = CachedPlayer & { positionNext: Vector; viewAnglesNext: Vector }

export const Actor = (props: ActorProps) => {
  const actorRef = useRef<THREE.Group>(null)
  const bodyRef = useRef<THREE.Group>(null)
  const playerAimRef = useRef<THREE.Group>(null)
  const lastGoodViewAngles = useRef<Vector>({ x: 0, y: 0, z: 0 })
  const lerpedPosition = useRef(new THREE.Vector3())
  const hasPositionInit = useRef(false)
  const [changing, setChanging] = useState<boolean>(false)
  const { scene } = useThree()

  const playback = useStore(state => state.playback)
  const settings = useStore(state => state.settings)

  const { classId, health, team, user, healTarget } = props
  let { position, viewAngles, positionNext, viewAnglesNext } = props

  // Resolve zero-valued view angles (parser bug) by falling back to last non-zero angles
  viewAngles = resolveViewAngles(viewAngles, lastGoodViewAngles)
  if (viewAnglesNext.x === 0 && viewAnglesNext.y === 0 && viewAnglesNext.z === 0) {
    viewAnglesNext = viewAngles
  }

  const alive = health > 0
  let color
  if (team === 'red') color = '#ff0202'
  if (team === 'blue') color = '#0374ff'

  // Source QAngle convention (degrees): x=pitch, y=yaw, z=roll
  const positionVec3: THREE.Vector3 = objCoordsToVector3(position)
  const positionNextVec3: THREE.Vector3 = objCoordsToVector3(positionNext)
  const pitchDeg = viewAngles.x
  const yawDeg = viewAngles.y
  const rollDeg = viewAngles.z
  const pitchNextDeg = viewAnglesNext.x
  const yawNextDeg = viewAnglesNext.y
  const rollNextDeg = viewAnglesNext.z
  const yawRad = degreesToRadians(yawDeg)

  const healTargetVec3: THREE.Vector3 | undefined = healTarget
    ? scene
        .getObjectByName('actors')
        ?.children.find(({ userData }) => userData.entityId === healTarget)?.position
    : undefined

  useFrame((_, delta) => {
    if (!actorRef.current || !bodyRef.current || !playerAimRef.current) return

    // Actor group is position-only; rotations are applied to children.
    actorRef.current.quaternion.identity()

    // Skip interpolation when disabled or paused
    if (settings.scene.interpolateFrames === false || playback.playing === false) {
      actorRef.current.position.set(position.x, position.y, position.z)
      hasPositionInit.current = true
      bodyRef.current.quaternion.copy(yawQuaternionFromDegrees(yawDeg))
      playerAimRef.current.position.set(0, 0, ActorDimensions.z)
      playerAimRef.current.quaternion.copy(
        cameraQuaternionFromSourceAnglesDeg({ pitch: pitchDeg, yaw: yawDeg, roll: rollDeg })
      )
      return
    }

    const frameProgress = useInstance.getState().frameProgress
    const lerpProgress = Math.min(Math.max(frameProgress, 0), 0.999)
    const didTeleport = positionVec3.distanceTo(positionNextVec3) > TELEPORT_LERP_DISTANCE
    const wasInitialized = hasPositionInit.current
    const positionBlend = smoothingAlpha(delta, RENDER_POSITION_SMOOTH_SECONDS)
    const rotationBlend = smoothingAlpha(delta, RENDER_ROTATION_SMOOTH_SECONDS)

    // Position interpolation
    if (didTeleport) {
      lerpedPosition.current.copy(positionVec3)
    } else {
      lerpedPosition.current.copy(positionVec3).lerp(positionNextVec3, lerpProgress)
    }

    if (didTeleport || !wasInitialized) {
      actorRef.current.position.copy(lerpedPosition.current)
    } else {
      actorRef.current.position.lerp(lerpedPosition.current, positionBlend)
    }
    hasPositionInit.current = true

    // Body: yaw-only quaternion
    const bodyTarget = yawQuaternionFromDegrees(yawDeg)
      .clone()
      .slerp(yawQuaternionFromDegrees(yawNextDeg), lerpProgress)
    if (didTeleport || !wasInitialized) {
      bodyRef.current.quaternion.copy(bodyTarget)
    } else {
      bodyRef.current.quaternion.slerp(bodyTarget, rotationBlend)
    }

    // Aim/camera: full view angles
    const camTarget = cameraQuaternionFromSourceAnglesDeg({
      pitch: pitchDeg,
      yaw: yawDeg,
      roll: rollDeg,
    })
      .clone()
      .slerp(
        cameraQuaternionFromSourceAnglesDeg({
          pitch: pitchNextDeg,
          yaw: yawNextDeg,
          roll: rollNextDeg,
        }),
        lerpProgress
      )
    if (didTeleport || !wasInitialized) {
      playerAimRef.current.quaternion.copy(camTarget)
    } else {
      playerAimRef.current.quaternion.slerp(camTarget, rotationBlend)
    }
  })

  // Kinda hacky solution to fix player models not updating when they change class,
  // which is due to how PlayerModel handles caching of loaded GLTF models. So this
  // solution relies of quickly remounting the PlayerModel with the updated team/classId
  // values. It doesn't appear to trigger any network refetches, so this should be ok
  useEffect(() => {
    setChanging(true)
    const timer = setTimeout(() => setChanging(false), 10)
    return () => clearTimeout(timer)
  }, [team, classId])

  return (
    <group name="actor" ref={actorRef} userData={user}>
      {/* Player model */}

      <group name="playerBody" ref={bodyRef}>
        <Suspense fallback={null}>
          {
            team && classId && !changing ? (
              <PlayerModel visible={alive} team={team} classId={classId} />
            ) : null
          }
        </Suspense>
      </group>

      {/* Player aim */}

      <group ref={playerAimRef} name="playerAim" position={[0, 0, ActorDimensions.z]}>
        {/* Aim line (debugging) */}
        {/* <mesh visible={alive} position={[AimLineSize * 0.5, 0, 0]}>
          <boxGeometry attach="geometry" args={[AimLineSize, 5, 5]} />
          <meshBasicMaterial attach="material" color={color} opacity={0.5} transparent />
        </mesh> */}

        <POVCamera />
      </group>

      {/* Medic heal beam */}

      {healTargetVec3 && (
        <group rotation={[0, 0, -yawRad]}>
          <HealBeam
            origin={positionVec3}
            target={healTargetVec3}
            control={new THREE.Vector3(100, 0, 0).applyAxisAngle(VectorZ, yawRad)}
            color={color}
          />
        </group>
      )}

      {/* Nameplate */}

      {settings.ui.nameplate.enabled && (
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
              settings={settings.ui.nameplate}
            />
          )}
        </Html>
      )}
    </group>
  )
}

// TODO: This implementation is quite sketchy (it relies on being parented to the Actor
// and does weird stuff with vectors / angles). It might be worth trying to rewrite
// this so it's rendered completely in world space.

export interface HealBeamProps {
  origin: THREE.Vector3
  target: THREE.Vector3
  control: THREE.Vector3
  color?: string
}

export const HealBeam = (props: HealBeamProps) => {
  const targetPos = new THREE.Vector3()
  targetPos.subVectors(props.target, props.origin)

  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0),
    props.control,
    targetPos
  )

  const geometry = new THREE.TubeGeometry(curve, 10, 5, 5)

  return (
    <group name="healBeam" position={new THREE.Vector3(0, 0, ActorDimensions.z * 0.5)}>
      <mesh geometry={geometry}>
        <MeshWobbleMaterial
          attach="material"
          factor={0.15}
          speed={8}
          time={1}
          color={props.color || '#ffffff'}
          opacity={0.7}
          transparent
        />
      </mesh>
    </group>
  )
}

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
