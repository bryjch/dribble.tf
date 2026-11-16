import { useEffect, useMemo, useRef, useState } from 'react'

import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Hud, PerspectiveCamera } from '@react-three/drei'
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

import type { CachedPlayer } from '@components/Analyse/Data/PlayerTracks'
import { hasCondition } from '@components/Analyse/Data/StreamEvents'
import { SCENE_PRIORITY, sceneFrame } from '@components/Scene/PlaybackDriver'
import { getState, useInstance, useStore } from '@zus/store'
import { CLASS_MAP } from '@constants/mappings'
import { getAsset } from '@utils/misc'
import { sourceVerticalFov } from '@utils/fov'

//
// ─── VIEWMODEL ──────────────────────────────────────────────────────────────────
//
// In POV, the spectated player's arms and the weapon in their hand, drawn over the world the way
// TF2 draws them: in their own scene with their own camera, so they never clip into walls.
//
// The models come from scripts/viewmodels/build-viewmodels.mjs: each class's arms and their
// animations, and each weapon, rigged to the arms' bones. The manifest maps an item definition
// index to its model and animation slot (PRIMARY, MELEE, ...) per class.
//
// Like the rest of the scene it reads the spectated player from PlaybackDriver's sceneFrame
// every frame, and re-renders in React only when the models change (class, team, weapon). The
// pose is worked out from the tick (the last shot, how long ago), so it is right when paused,
// scrubbing or playing backwards.
//

interface ViewmodelManifest {
  classes: Record<
    string,
    {
      arms: { red: string; blue?: string }
      anims: string
      clips: Record<string, Clips>
    }
  >
  models: Record<string, { red: string; blue?: string }>
  items: Record<string, Record<string, [model: string, slot: string]>>
}

interface Clips {
  idle?: string[]
  fire?: string[]
  draw?: string[]
}

// Seconds a fire animation takes to hand back to idle at its end.
const FIRE_BLEND_SECONDS = 0.12

let manifestRequest: Promise<ViewmodelManifest | null> | null = null
const loadManifest = () =>
  (manifestRequest ??= fetch(getAsset('/models/viewmodels/manifest.json'))
    .then(response => (response.ok ? response.json() : null))
    .catch(() => null))

const useManifest = () => {
  const [manifest, setManifest] = useState<ViewmodelManifest | null>(null)
  useEffect(() => {
    loadManifest().then(setManifest)
  }, [])
  return manifest
}

const viewmodelUrl = (file: string) => getAsset(`/models/viewmodels/${file}`)

// The models load with plain state rather than Suspense: a suspended rig is only retried when
// something above it re-renders, which a paused match never does.
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const gltfs = new Map<string, Promise<GLTF>>()
const loadGltf = (url: string) => {
  let request = gltfs.get(url)
  if (!request) {
    request = loader.loadAsync(url)
    request.catch(() => gltfs.delete(url))
    gltfs.set(url, request)
  }
  return request
}


/**
 * Where the spectated medic's medigun nozzle is on screen, for the heal beam to start from: its
 * position in normalised device coordinates and its distance from the camera, in the viewmodel's
 * own view. entityId is -1 while no medigun is shown.
 */
export const viewmodelMuzzle = { entityId: -1, ndc: new THREE.Vector3(), distance: 0 }

interface Selection {
  key: string
  /** A medigun: the heal beam starts at its nozzle. */
  medigun: boolean
  armsUrl: string
  animsUrl: string
  weaponUrl: string
  clips: Clips
}

/** The models for what the player has in hand, or null when there is nothing to show. */
function selectViewmodel(manifest: ViewmodelManifest, player?: CachedPlayer): Selection | null {
  // A scoped sniper sees the scope, not the rifle.
  if (!player || player.health <= 0 || player.weapon == null) return null
  if (hasCondition(player.conditions, 'zoomed')) return null
  const className = CLASS_MAP[player.classId]
  const classModels = manifest.classes[className]
  const entry = manifest.items[player.weapon]?.[className]
  const weapon = entry && manifest.models[entry[0]]
  if (!classModels || !entry || !weapon) return null
  const blue = player.team === 'blue'
  return {
    key: `${className}-${blue ? 'blue' : 'red'}-${entry[0]}-${entry[1]}`,
    armsUrl: viewmodelUrl((blue && classModels.arms.blue) || classModels.arms.red),
    animsUrl: viewmodelUrl(classModels.anims),
    weaponUrl: viewmodelUrl((blue && weapon.blue) || weapon.red),
    clips: classModels.clips[entry[1]] ?? {},
    medigun: entry[0].includes('medigun'),
  }
}

export const Viewmodel = () => {
  const controlsMode = useStore(state => state.scene.controls.mode)
  const settings = useStore(state => state.settings.ui.viewmodel)
  const outlines = useStore(state => state.settings.ui.playerOutlines)
  const focusedObject = useInstance(state => state.focusedObject)
  const manifest = useManifest()

  if (controlsMode !== 'pov' || !settings?.enabled || !manifest) return null
  const entityId: number | undefined = focusedObject?.userData?.entityId

  return (
    // Player outlines draw the world at priority 1 when on; otherwise the HUD draws it.
    <Hud renderPriority={outlines ? 2 : 1}>
      <PerspectiveCamera makeDefault fov={sourceVerticalFov(settings.fov)} near={1} far={256} />
      <ambientLight intensity={2.2} />
      <directionalLight position={[2, 3, 1]} intensity={2.4} />
      {entityId != null && <ViewmodelSelector manifest={manifest} entityId={entityId} />}
    </Hud>
  )
}

/** Follows the spectated player every frame; re-renders only when their models change. */
const ViewmodelSelector = ({
  manifest,
  entityId,
}: {
  manifest: ViewmodelManifest
  entityId: number
}) => {
  const [selection, setSelection] = useState<Selection | null>(null)
  const shown = useRef('')

  useFrame(() => {
    const next = selectViewmodel(manifest, sceneFrame.playersByEntity.get(entityId))
    const key = next?.key ?? ''
    if (key === shown.current) return
    shown.current = key
    setSelection(next)
  }, SCENE_PRIORITY)

  if (!selection) return null
  return <ViewmodelLoader key={selection.key} selection={selection} entityId={entityId} />
}

/** Loads the arms, their animations and the weapon (all at once), then shows the rig. */
const ViewmodelLoader = ({ selection, entityId }: { selection: Selection; entityId: number }) => {
  const { armsUrl, animsUrl, weaponUrl, clips, medigun } = selection
  const [models, setModels] = useState<[GLTF, GLTF, GLTF] | null>(null)
  useEffect(() => {
    let live = true
    Promise.all([loadGltf(armsUrl), loadGltf(animsUrl), loadGltf(weaponUrl)])
      .then(loaded => live && setModels(loaded))
      .catch(error => console.warn('Viewmodel failed to load', error))
    return () => {
      live = false
    }
  }, [armsUrl, animsUrl, weaponUrl])
  if (!models) return null
  return (
    <ViewmodelRig
      arms={models[0]}
      anims={models[1]}
      weapon={models[2]}
      clips={clips}
      entityId={entityId}
      medigun={medigun}
    />
  )
}

//
// ─── RIG ────────────────────────────────────────────────────────────────────────
//

interface ViewmodelRigProps {
  arms: GLTF
  anims: GLTF
  weapon: GLTF
  clips: Clips
  entityId: number
  medigun: boolean
}

// The nozzle's vertex: the weapon's farthest point from the camera, found on the first frame.
interface Nozzle {
  mesh: THREE.SkinnedMesh
  index: number
}

const _vertex = new THREE.Vector3()

/** The weapon vertex farthest into the screen: a medigun's nozzle. */
function findNozzle(weapon: THREE.Object3D, camera: THREE.Camera): Nozzle | null {
  let best: Nozzle | null = null
  let bestZ = Infinity
  weapon.traverse(o => {
    const mesh = o as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    const count = mesh.geometry.attributes.position.count
    for (let i = 0; i < count; i++) {
      mesh.getVertexPosition(i, _vertex)
      _vertex.applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse)
      if (_vertex.z < bestZ) {
        bestZ = _vertex.z
        best = { mesh, index: i }
      }
    }
  })
  return best
}

const ViewmodelRig = ({ arms, anims, weapon, clips, entityId, medigun }: ViewmodelRigProps) => {
  // The weapon came out (this rig mounted during playback): the draw animation plays from this
  // tick. Paused, or jumping to another player or tick, it is simply in hand.
  const drawTick = useRef(getState().playback.playing ? sceneFrame.tick : -Infinity)

  const rig = useMemo(() => {
    const armsScene = cloneSkinned(arms.scene)
    const weaponScene = cloneSkinned(weapon.scene)

    // The weapon is rigged to the arms' bones by name (Source's bonemerge).
    const bones = new Map<string, THREE.Bone>()
    armsScene.traverse(o => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone)
    })
    weaponScene.traverse(o => {
      const mesh = o as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh) return
      const merged = mesh.skeleton.bones.map(b => bones.get(b.name) ?? b)
      mesh.bind(new THREE.Skeleton(merged, mesh.skeleton.boneInverses), mesh.bindMatrix)
    })
    for (const scene of [armsScene, weaponScene]) {
      scene.traverse(o => {
        if ((o as THREE.Mesh).isMesh) o.frustumCulled = false
      })
    }

    const root = new THREE.Group()
    root.add(armsScene, weaponScene)
    // Source's viewmodel faces +X with Z up; the camera looks down -Z with Y up.
    root.rotation.y = Math.PI / 2

    const mixer = new THREE.AnimationMixer(armsScene)
    const byName = new Map(anims.animations.map(clip => [clip.name, clip]))
    const actions = (names?: string[]) =>
      (names ?? [])
        .map(name => byName.get(name))
        .filter((clip): clip is THREE.AnimationClip => !!clip)
        .map(clip => {
          const action = mixer.clipAction(clip)
          action.setLoop(THREE.LoopRepeat, Infinity)
          action.play()
          action.weight = 0
          return action
        })
    return {
      root,
      weaponScene,
      nozzle: null as Nozzle | null,
      mixer,
      idle: actions(clips.idle),
      fire: actions(clips.fire),
      draw: actions(clips.draw),
    }
  }, [arms, anims, weapon, clips])

  useEffect(
    () => () => {
      rig.mixer.stopAllAction()
      if (viewmodelMuzzle.entityId === entityId) viewmodelMuzzle.entityId = -1
    },
    [rig, entityId]
  )

  useFrame(({ camera }) => {
    const now = sceneFrame.tick
    const intervalPerTick = sceneFrame.match?.intervalPerTick || 0.015
    const lastShotTick = sceneFrame.playersByEntity.get(entityId)?.lastShotTick ?? null
    const seconds = (fromTick: number) => (now - fromTick) * intervalPerTick

    for (const action of [...rig.idle, ...rig.fire, ...rig.draw]) action.weight = 0

    const idle = rig.idle[0]
    // A shot from before this weapon came out was another weapon's.
    const fireElapsed =
      lastShotTick != null && lastShotTick >= drawTick.current ? seconds(lastShotTick) : Infinity
    // Melee swings and the like have a few to pick from: the same one for the same shot.
    const fire =
      lastShotTick != null ? rig.fire[lastShotTick % Math.max(1, rig.fire.length)] : undefined
    const drawElapsed = seconds(drawTick.current)
    const draw = rig.draw[0]

    let played = false
    if (fire && fireElapsed >= 0 && fireElapsed < fire.getClip().duration) {
      const left = fire.getClip().duration - fireElapsed
      const blend = idle ? Math.min(1, left / FIRE_BLEND_SECONDS) : 1
      fire.time = fireElapsed
      fire.weight = blend
      if (idle && blend < 1) {
        idle.time = 0
        idle.weight = 1 - blend
      }
      played = true
    } else if (draw && drawElapsed >= 0 && drawElapsed < draw.getClip().duration) {
      draw.time = drawElapsed
      draw.weight = 1
      played = true
    }
    if (!played && idle) {
      const duration = idle.getClip().duration
      idle.time = duration > 0 ? (((now * intervalPerTick) % duration) + duration) % duration : 0
      idle.weight = 1
    }
    rig.mixer.update(0)

    if (medigun) {
      // Posed bones now, so the nozzle is where this frame draws it.
      rig.root.updateMatrixWorld(true)
      rig.nozzle ??= findNozzle(rig.weaponScene, camera)
      if (rig.nozzle) {
        rig.nozzle.mesh.getVertexPosition(rig.nozzle.index, _vertex)
        _vertex.applyMatrix4(rig.nozzle.mesh.matrixWorld)
        viewmodelMuzzle.ndc.copy(_vertex).project(camera)
        viewmodelMuzzle.distance = _vertex.applyMatrix4(camera.matrixWorldInverse).length()
        viewmodelMuzzle.entityId = entityId
      }
    }
  })

  return <primitive object={rig.root} />
}
