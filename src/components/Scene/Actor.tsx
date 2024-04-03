import { useRef, useEffect, Suspense, useState } from 'react'

import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Html, MeshWobbleMaterial, useGLTF, Clone } from '@react-three/drei'

import { Nameplate } from '@components/Scene/Nameplate'
import { CachedPlayer } from '@components/Analyse/Data/PlayerCache'

import { useStore } from '@zus/store'
import { CLASS_MAP, ACTOR_TEAM_COLORS } from '@constants/mappings'
import { objCoordsToVector3, radianizeVector } from '@utils/geometry'
import { getAsset } from '@utils/misc'

// Default TF2 player dimensions as specified in:
// https://developer.valvesoftware.com/wiki/TF2/Team_Fortress_2_Mapper%27s_Reference
export const ActorDimensions = new THREE.Vector3(49, 49, 83)

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
  const modelUrl = getAsset(`/models/players/${CLASS_MAP[props.classId]}_${props.team}.glb`)
  const gltf = useGLTF(modelUrl, true, false)

  if (true) {
    // TODO: Figure out how to do backface culling properly
    // so that players can be seen through walls nicely
    /*
    if (props.backface) {
      const a = cloned as THREE.Object3D
      const b = getSkinnedMeshes(a.children)

      b.forEach((skinnedMesh: SkinnedMesh) => {
        let originalMat: THREE.MeshStandardMaterial = skinnedMesh.material as THREE.MeshStandardMaterial
        let backfaceMat = originalMat.clone()
        backfaceMat.depthFunc = THREE.GreaterDepth
        backfaceMat.opacity = 0.5
        backfaceMat.transparent = true
        backfaceMat.needsUpdate = true
        skinnedMesh.material = backfaceMat.clone()
      })
    }
    */
    // TODO: Figure out how to swap the image texture on the model's material
    // instead of using a completely separate GLTF models for each class/team
    /*
    const skinnedMeshes = getSkinnedMeshes((cloned as THREE.Object3D).children)

    const loader = new THREE.TextureLoader()
    loader.load(`textures/demoman_blue.png`, function (texture: any) {
      skinnedMeshes.forEach((skinnedMesh: SkinnedMesh) => {
        let originalMat: THREE.MeshStandardMaterial = skinnedMesh.material as THREE.MeshStandardMaterial

        if (originalMat.map instanceof THREE.CanvasTexture) {
          originalMat.map = texture
          originalMat.needsUpdate = true
          texture.needsUpdate = true
        }
      })
    })
    */
  }

  return (
    <group {...props} visible={props.visible} rotation={[Math.PI * 0.5, Math.PI * 0.5, 0]}>
      <Clone object={gltf.scene} />
    </group>
  )
}

//
// ─── ACTOR ──────────────────────────────────────────────────────────────────────
//

export const Actor = (props: CachedPlayer) => {
  const ref = useRef<THREE.Group>()
  const lastViewAngleX = useRef<number>(0)
  const lastViewAngleY = useRef<number>(0)
  const [changing, setChanging] = useState<boolean>(false)
  const { scene } = useThree()

  const uiSettings = useStore(state => state.settings.ui)

  const { classId, health, team, user, healTarget } = props
  let { position, viewAngles } = props

  const alive = health > 0
  const color = ACTOR_TEAM_COLORS(team).actorModel

  // Hack for parser's tick data randomly returning 0 on certain frames
  if (viewAngles.x === 0) {
    viewAngles.x = lastViewAngleX.current
  } else {
    lastViewAngleX.current = viewAngles.x
  }

  // Hack for parser's tick data randomly returning 0 on certain frames
  if (viewAngles.y === 0) {
    viewAngles.y = lastViewAngleY.current
  } else {
    lastViewAngleY.current = viewAngles.y
  }

  // Conversion needed because parser uses different Vector type
  const positionVec3: THREE.Vector3 = objCoordsToVector3(position)
  const viewAnglesVec3: THREE.Vector3 = radianizeVector(objCoordsToVector3(viewAngles))
  const healTargetVec3: THREE.Vector3 | undefined = healTarget
    ? scene
        .getObjectByName('actors')
        ?.children.find(({ userData }) => userData.entityId === healTarget)?.position
    : undefined

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
    <group
      name="actor"
      ref={ref}
      position={positionVec3}
      rotation={[0, 0, viewAnglesVec3.x]}
      userData={user}
    >
      {/* Base box mesh */}
      {/* <mesh visible={alive}>
        <boxGeometry
          attach="geometry"
          args={[ActorDimensions.x, ActorDimensions.y, ActorDimensions.z]}
        />
        <meshStandardMaterial attach="material" color={color} metalness={0.5} />
      </mesh> */}

      <Suspense fallback={null}>
        {team && classId && !changing ? (
          <PlayerModel visible={alive} team={team} classId={classId} />
        ) : (
          <mesh visible={alive} position={new THREE.Vector3(0, 0, ActorDimensions.z * 0.5)}>
            <boxGeometry
              attach="geometry"
              args={[ActorDimensions.x, ActorDimensions.y, ActorDimensions.z]}
            />
            <meshStandardMaterial attach="material" color={color} metalness={0.5} />
          </mesh>
        )}

        {/* <PlayerModel visible={alive} backface={true} /> */}

        {/* Seethrough box mesh */}
        {/* This is used to make players visible through map geometry &
        uses a reverse depth function to determine when to display */}
        {/* <mesh position={[0, 0, ActorDimensions.z * 0.5]} visible={alive && uiSettings.xrayPlayers}>
          <boxGeometry
            attach="geometry"
            args={[ActorDimensions.x * 0.85, ActorDimensions.y * 0.85, ActorDimensions.z * 0.85]}
          />
          <meshStandardMaterial
            attach="material"
            color={color}
            opacity={0.7}
            transparent={true}
            depthFunc={THREE.GreaterDepth}
          />
        </mesh> */}
      </Suspense>

      {/* Player aim */}
      <group
        name="playerAim"
        position={[ActorDimensions.x * 0.4, 0, ActorDimensions.z]}
        rotation={[0, viewAnglesVec3.y, 0]}
      >
        {/* Aim line */}
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
      {uiSettings.nameplate.enabled && (
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
              settings={uiSettings.nameplate}
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

export const POVCamera = (props: POVCameraProps) => {
  const ref = useRef<THREE.PerspectiveCamera>()

  const settings = useStore(state => state.settings)

  // // Un-comment this to render camera helpers for debugging
  // const { scene } = useThree()

  // const cameraHelper = useRef<THREE.CameraHelper>()

  // if (ref.current && !cameraHelper.current) {
  //   cameraHelper.current = new THREE.CameraHelper(ref.current)
  //   scene.add(cameraHelper.current)
  // }

  useEffect(() => {
    ref.current?.updateProjectionMatrix()
    // cameraHelper.current?.update()
  }, [settings])

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
