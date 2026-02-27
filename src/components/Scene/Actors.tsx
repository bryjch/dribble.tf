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
import { degreesToRadians, objCoordsToVector3, radianizeVector } from '@utils/geometry'
import { getAsset } from '@utils/misc'
import { useEventListener } from '@utils/hooks'

// Default TF2 player dimensions as specified in:
// https://developer.valvesoftware.com/wiki/TF2/Team_Fortress_2_Mapper%27s_Reference
export const ActorDimensions = new THREE.Vector3(49, 49, 83)

// Some reusable vectors used for quaternion calculations
const VectorZ = new THREE.Vector3(0, 0, 1)
const VectorY = new THREE.Vector3(0, 1, 0)

export const AimLineSize = 150

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
  const playerAimRef = useRef<THREE.Group>(null)
  const [changing, setChanging] = useState<boolean>(false)
  const { scene } = useThree()

  const playback = useStore(state => state.playback)
  const settings = useStore(state => state.settings)

  const { classId, health, team, user, healTarget } = props
  let { position, viewAngles, positionNext, viewAnglesNext } = props

  const alive = health > 0
  let color
  if (team === 'red') color = '#ff0202'
  if (team === 'blue') color = '#0374ff'

  // Conversion needed because parser uses different Vector type
  const positionVec3: THREE.Vector3 = objCoordsToVector3(position)
  const viewAnglesVec3: THREE.Vector3 = radianizeVector(objCoordsToVector3(viewAngles))
  const healTargetVec3: THREE.Vector3 | undefined = healTarget
    ? scene
        .getObjectByName('actors')
        ?.children.find(({ userData }) => userData.entityId === healTarget)?.position
    : undefined

  let actorQuat = new THREE.Quaternion()
  let nextActorQuat = new THREE.Quaternion()
  let aimQuat = new THREE.Quaternion()
  let nextAimQuat = new THREE.Quaternion()

  const frameProgress = useInstance(state => state.frameProgress)

  useFrame(() => {
    if (!actorRef.current || !playerAimRef.current) return

    // Prefer to only do lerping for slower playback speeds for performance reasons
    // and if the playback is currently paused / user explicitly doesn't want it
    if (
      settings.scene.interpolateFrames === false ||
      playback.playing === false ||
      playback.speed > 1
    ) {
      actorRef.current.position.set(position.x, position.y, position.z)
      if (viewAnglesVec3.x !== 0) {
        actorRef.current.rotation.set(0, 0, viewAnglesVec3.x)
      }
      if (viewAnglesVec3.y !== 0) {
        playerAimRef.current.rotation.set(0, viewAnglesVec3.y, 0)
      }
      return
    }

    // we skip rendering for 0 and 0.99 because there are some race conditions between useFrame
    // and requestAnimationFrame, which results in jerky rendering. This can be safely
    // done since the lerp smoothens out any potential "missed renders"
    if (frameProgress > 0 && frameProgress < 0.99) {
      // handle position lerping
      const lerpedPos = positionVec3.clone().lerp(positionNext, frameProgress)
      actorRef.current.position.set(lerpedPos.x, lerpedPos.y, lerpedPos.z)

      // handle actor Z rotation lerping
      // note: some ticks erronously return 0, so we skip lerping in those cases
      if (viewAnglesVec3.x !== 0 && viewAnglesNext.x !== 0) {
        actorQuat.setFromAxisAngle(VectorZ, viewAnglesVec3.x)
        nextActorQuat.setFromAxisAngle(VectorZ, degreesToRadians(viewAnglesNext.x))
        actorRef.current.rotation.setFromQuaternion(
          actorQuat.clone().slerp(nextActorQuat, frameProgress)
        )
      }

      // handle aim Y rotation lerping
      // note: some ticks erronously return 0, so we skip lerping in those cases
      if (viewAnglesVec3.y !== 0 && viewAnglesNext.y !== 0) {
        aimQuat.setFromAxisAngle(VectorY, viewAnglesVec3.y)
        nextAimQuat.setFromAxisAngle(VectorY, degreesToRadians(viewAnglesNext.y))
        playerAimRef.current.rotation.setFromQuaternion(aimQuat.slerp(nextAimQuat, frameProgress))
      }
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

      <Suspense fallback={null}>
        {
          team && classId && !changing ? (
            <PlayerModel visible={alive} team={team} classId={classId} />
          ) : null
          // <mesh visible={alive} position={new THREE.Vector3(0, 0, ActorDimensions.z * 0.5)}>
          //   <boxGeometry
          //     attach="geometry"
          //     args={[ActorDimensions.x * 0.75, ActorDimensions.y * 0.75, ActorDimensions.z]}
          //   />
          //   <meshStandardMaterial attach="material" color={color} metalness={0.5} />
          // </mesh>
        }
      </Suspense>

      {/* Player aim */}

      <group
        ref={playerAimRef}
        name="playerAim"
        position={[ActorDimensions.x * 0.4, 0, ActorDimensions.z]}
      >
        {/* Aim line (debugging) */}
        {/* <mesh visible={alive} position={[AimLineSize * 0.5, 0, 0]}>
          <boxGeometry attach="geometry" args={[AimLineSize, 5, 5]} />
          <meshBasicMaterial attach="material" color={color} opacity={0.5} transparent />
        </mesh> */}

        <POVCamera />
      </group>

      {/* Medic heal beam */}

      {healTargetVec3 && (
        <group rotation={[0, 0, -viewAnglesVec3.x]}>
          <HealBeam
            origin={positionVec3}
            target={healTargetVec3}
            control={new THREE.Vector3(100, 0, 0).applyAxisAngle(
              new THREE.Vector3(0, 1, 0),
              viewAnglesVec3.x
            )}
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
      rotation={[Math.PI * 0.5, Math.PI * -0.5, 0]}
    />
  )
}
