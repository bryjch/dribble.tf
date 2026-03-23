import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'

import * as THREE from 'three'
import { useFrame, useLoader, useThree } from '@react-three/fiber'

import classIconsAtlasUrl from '@assets/class_icons_64.png'
import { useStore, getState, useInstance } from '@zus/store'
import {
  addStickerAction,
  cancelStickerDragAction,
  moveStickerAction,
  selectStickerAction,
  startStickerDragAction,
} from '@zus/actions'
import { CLASS_ORDER_MAP } from '@constants/mappings'
import { ControlsMode, StickerTeam } from '@constants/types'
import { useIsMobile } from '@utils/hooks'

const STICKER_GROUP_NAME = 'stickers'
const STICKER_MARKER_NAME = 'sticker-marker'
const IS_FIXED_SIZE = true
const STICKER_FIXED_SCREEN_SIZE_PX = 45
const STICKER_MARKER_SIZE_MIN = 60
const STICKER_MARKER_SIZE_MAX = 100
const STICKER_MARKER_SIZE_FACTOR = 0.045
const STICKER_WORLD_OFFSET = 4
const STICKER_DRAG_COMMIT_DISTANCE_PX = 10
const STICKER_RING_ANIMATION_SPEED = 12
const STICKER_RING_SCALE_MIN = 1.1
const STICKER_RING_SCALE_MAX = 1.45

const STICKER_TEAM_COLORS: Record<StickerTeam, string> = {
  red: '#cf4a2e',
  blue: '#5885a2',
}

const STICKER_CLASS_IDS = Object.entries(CLASS_ORDER_MAP)
  .filter(([classId]) => classId !== '0')
  .sort(([, leftOrder], [, rightOrder]) => leftOrder - rightOrder)
  .map(([classId]) => Number(classId))

type SurfaceHit = {
  position: [number, number, number]
}

type SceneStickerProps = {
  stickerId?: string
  position: [number, number, number]
  texture?: THREE.Texture
  selected?: boolean
  preview?: boolean
  dragged?: boolean
  ringTexture: THREE.Texture
  dragPreviewPositionRef?: MutableRefObject<THREE.Vector3 | null>
}

export const Stickers = () => {
  const { camera, gl, scene } = useThree()
  const isMobile = useIsMobile()

  const controlsMode = useStore(state => state.scene.controls.mode)
  const stickers = useStore(state => state.drawing.stickerHistory.present)
  const stickerDrag = useStore(state => state.drawing.stickerDrag)
  const selectedStickerId = useStore(state => state.drawing.selectedStickerId)

  const classIconsAtlas = useLoader(THREE.TextureLoader, classIconsAtlasUrl)
  const stickerTextures = useMemo(
    () => createStickerTextureMap(classIconsAtlas.image as HTMLImageElement),
    [classIconsAtlas.image]
  )
  const ringTexture = useMemo(() => createStickerRingTexture(), [])
  const dragCursorRef = useRef<{ screenX: number; screenY: number } | null>(null)
  const dragPreviewPositionRef = useRef<THREE.Vector3 | null>(null)
  const dragPlaneRef = useRef<THREE.Plane | null>(null)
  const dragRaycasterRef = useRef(new THREE.Raycaster())
  const dragPointerRef = useRef(new THREE.Vector2())
  const dragPlaneNormalRef = useRef(new THREE.Vector3())
  const dragPlaneAnchorRef = useRef(new THREE.Vector3())
  const dragPlaneIntersectionRef = useRef(new THREE.Vector3())

  if (isMobile) {
    return null
  }

  const interactionEnabled =
    controlsMode === ControlsMode.RTS || controlsMode === ControlsMode.SPECTATOR

  useEffect(() => {
    if (!interactionEnabled || stickerDrag.active) return

    const handlePointerDownCapture = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (isStickerPanelPointerEvent(event)) return

      const stickerId = isSceneCanvasPointerEvent(event, gl.domElement)
        ? getStickerIdFromScreen({
            camera,
            domElement: gl.domElement,
            scene,
            screenX: event.clientX,
            screenY: event.clientY,
          })
        : null

      if (!stickerId) {
        if (selectedStickerId) {
          selectStickerAction(undefined)
        }
        return
      }

      const currentControls = (useInstance.getState().threeScene as any).controls
      if (currentControls) {
        currentControls.enabled = false
      }

      event.preventDefault()
      event.stopImmediatePropagation()

      selectStickerAction(stickerId)
      startStickerDragAction({
        kind: 'move',
        stickerId,
        screenX: event.clientX,
        screenY: event.clientY,
      })
    }

    window.addEventListener('pointerdown', handlePointerDownCapture, true)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDownCapture, true)
    }
  }, [camera, gl, interactionEnabled, scene, selectedStickerId, stickerDrag.active])

  useEffect(() => {
    if (!interactionEnabled || !stickerDrag.active) return

    const currentControls = (useInstance.getState().threeScene as any).controls
    if (currentControls) {
      currentControls.enabled = false
    }

    dragCursorRef.current = {
      screenX: stickerDrag.screenX,
      screenY: stickerDrag.screenY,
    }

    if (stickerDrag.kind === 'move' && stickerDrag.stickerId) {
      const draggedSticker = stickers.find(sticker => sticker.id === stickerDrag.stickerId)

      if (draggedSticker) {
        dragPreviewPositionRef.current = new THREE.Vector3(...draggedSticker.position)
        initializeDragPlane(
          camera,
          dragPreviewPositionRef.current,
          dragPlaneRef,
          dragPlaneNormalRef,
          dragPlaneAnchorRef
        )
      }
    } else {
      dragPreviewPositionRef.current = null
      dragPlaneRef.current = null
    }

    const handlePointerMove = (event: PointerEvent) => {
      dragCursorRef.current = {
        screenX: event.clientX,
        screenY: event.clientY,
      }
    }

    const handlePointerUp = () => {
      const currentDrag = getState().drawing.stickerDrag
      const currentCursor = dragCursorRef.current
      const hasCommittedDrag =
        currentCursor &&
        hasExceededStickerDragThreshold(
          currentDrag.screenX,
          currentDrag.screenY,
          currentCursor.screenX,
          currentCursor.screenY
        )

      if (!hasCommittedDrag) {
        cancelStickerDragAction()
        return
      }

      const currentHit = currentCursor
        ? getSurfaceHitFromScreen({
            camera,
            domElement: gl.domElement,
            scene,
            screenX: currentCursor.screenX,
            screenY: currentCursor.screenY,
            raycaster: dragRaycasterRef.current,
            pointer: dragPointerRef.current,
          })
        : null

      if (currentHit) {
        if (
          currentDrag.kind === 'create' &&
          currentDrag.stickerClassId &&
          currentDrag.stickerTeam
        ) {
          addStickerAction({
            id: createStickerId(),
            position: currentHit.position,
            classId: currentDrag.stickerClassId,
            team: currentDrag.stickerTeam,
          })
        }

        if (currentDrag.kind === 'move' && currentDrag.stickerId) {
          moveStickerAction(currentDrag.stickerId, currentHit.position)
        }
      }

      cancelStickerDragAction()
    }

    const handlePointerCancel = () => {
      cancelStickerDragAction()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)

    return () => {
      dragCursorRef.current = null
      dragPreviewPositionRef.current = null
      dragPlaneRef.current = null
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [
    camera,
    gl,
    interactionEnabled,
    scene,
    stickerDrag.active,
    stickerDrag.kind,
    stickerDrag.screenX,
    stickerDrag.screenY,
    stickerDrag.stickerId,
    stickers,
  ])

  useFrame(() => {
    if (!interactionEnabled || !stickerDrag.active || !dragCursorRef.current) return

    const { screenX, screenY } = dragCursorRef.current
    const hasCommittedDrag = hasExceededStickerDragThreshold(
      stickerDrag.screenX,
      stickerDrag.screenY,
      screenX,
      screenY
    )

    if (!hasCommittedDrag) return

    const raycasterReady = setRaycasterFromScreen({
      camera,
      domElement: gl.domElement,
      screenX,
      screenY,
      raycaster: dragRaycasterRef.current,
      pointer: dragPointerRef.current,
    })

    if (!raycasterReady) return

    if (!dragPlaneRef.current) {
      const initialHit = getSurfaceHitFromScreen({
        camera,
        domElement: gl.domElement,
        scene,
        screenX,
        screenY,
        raycaster: dragRaycasterRef.current,
        pointer: dragPointerRef.current,
      })

      if (!initialHit) return

      dragPreviewPositionRef.current = new THREE.Vector3(...initialHit.position)
      initializeDragPlane(
        camera,
        dragPreviewPositionRef.current,
        dragPlaneRef,
        dragPlaneNormalRef,
        dragPlaneAnchorRef
      )
    }

    if (!dragPlaneRef.current) return

    const intersection = dragRaycasterRef.current.ray.intersectPlane(
      dragPlaneRef.current,
      dragPlaneIntersectionRef.current
    )

    if (!intersection) return

    if (!dragPreviewPositionRef.current) {
      dragPreviewPositionRef.current = intersection.clone()
    } else {
      dragPreviewPositionRef.current.copy(intersection)
    }
  })

  const previewTexture =
    stickerDrag.stickerClassId && stickerDrag.stickerTeam
      ? stickerTextures[getStickerTextureKey(stickerDrag.stickerClassId, stickerDrag.stickerTeam)]
      : undefined

  return (
    <group name={STICKER_GROUP_NAME}>
      {stickers.map(sticker => (
        <SceneSticker
          key={sticker.id}
          stickerId={sticker.id}
          texture={stickerTextures[getStickerTextureKey(sticker.classId, sticker.team)]}
          position={sticker.position}
          selected={selectedStickerId === sticker.id}
          dragged={
            stickerDrag.active &&
            stickerDrag.kind === 'move' &&
            stickerDrag.stickerId === sticker.id
          }
          ringTexture={ringTexture}
          dragPreviewPositionRef={dragPreviewPositionRef}
        />
      ))}

      {interactionEnabled && stickerDrag.active && stickerDrag.kind === 'create' ? (
        <SceneSticker
          texture={previewTexture}
          position={[0, 0, 0]}
          preview
          ringTexture={ringTexture}
          dragPreviewPositionRef={dragPreviewPositionRef}
        />
      ) : null}
    </group>
  )
}

const SceneSticker = ({
  stickerId,
  position,
  texture,
  selected = false,
  preview = false,
  dragged = false,
  ringTexture,
  dragPreviewPositionRef,
}: SceneStickerProps) => {
  const viewportHeight = useThree(state => state.size.height)
  const groupRef = useRef<THREE.Group>(null)
  const markerMaterialRef = useRef<THREE.SpriteMaterial>(null)
  const ringMaterialRef = useRef<THREE.SpriteMaterial>(null)
  const hitMaterialRef = useRef<THREE.SpriteMaterial>(null)
  const markerSpriteRef = useRef<THREE.Sprite>(null)
  const ringSpriteRef = useRef<THREE.Sprite>(null)
  const hitSpriteRef = useRef<THREE.Sprite>(null)
  const cameraPositionRef = useRef(new THREE.Vector3())
  const stickerPositionRef = useRef(new THREE.Vector3())
  const basePositionRef = useRef(new THREE.Vector3(...position))
  const targetPositionRef = useRef(new THREE.Vector3(...position))
  const ringSelectionProgressRef = useRef(selected ? 1 : 0)

  useEffect(() => {
    basePositionRef.current.set(position[0], position[1], position[2])
    targetPositionRef.current.set(position[0], position[1], position[2])

    if (!dragged && groupRef.current) {
      groupRef.current.position.copy(basePositionRef.current)
    }
  }, [dragged, position])

  useEffect(() => {
    if (markerMaterialRef.current) {
      markerMaterialRef.current.map = texture ?? null
      markerMaterialRef.current.needsUpdate = true
    }
  }, [texture])

  useFrame(({ camera }, delta) => {
    if (
      !groupRef.current ||
      !markerMaterialRef.current ||
      !ringMaterialRef.current ||
      !hitMaterialRef.current ||
      !markerSpriteRef.current ||
      !ringSpriteRef.current ||
      !hitSpriteRef.current ||
      !texture
    ) {
      return
    }

    const dragPosition = dragPreviewPositionRef?.current

    if ((dragged || preview) && dragPosition) {
      targetPositionRef.current.copy(dragPosition)
      groupRef.current.visible = true
      groupRef.current.position.copy(targetPositionRef.current)
    } else if (preview) {
      groupRef.current.visible = false
    } else {
      groupRef.current.visible = true
    }

    camera.getWorldPosition(cameraPositionRef.current)
    groupRef.current.getWorldPosition(stickerPositionRef.current)

    const distance = cameraPositionRef.current.distanceTo(stickerPositionRef.current)
    const markerSize = IS_FIXED_SIZE
      ? getWorldSpaceSizeForScreenPixels(
          camera,
          viewportHeight,
          STICKER_FIXED_SCREEN_SIZE_PX,
          distance
        )
      : THREE.MathUtils.clamp(
          distance * STICKER_MARKER_SIZE_FACTOR,
          STICKER_MARKER_SIZE_MIN,
          STICKER_MARKER_SIZE_MAX
        )

    markerSpriteRef.current.scale.set(markerSize, markerSize, 1)
    hitSpriteRef.current.scale.set(markerSize * 1.35, markerSize * 1.35, 1)

    ringSelectionProgressRef.current = THREE.MathUtils.damp(
      ringSelectionProgressRef.current,
      selected ? 1 : 0,
      STICKER_RING_ANIMATION_SPEED,
      delta
    )

    const ringScaleMultiplier = THREE.MathUtils.lerp(
      STICKER_RING_SCALE_MIN,
      STICKER_RING_SCALE_MAX,
      ringSelectionProgressRef.current
    )
    ringSpriteRef.current.scale.set(
      markerSize * ringScaleMultiplier,
      markerSize * ringScaleMultiplier,
      1
    )

    if (preview) {
      markerMaterialRef.current.opacity = 0.9
      ringMaterialRef.current.opacity = 0
      hitMaterialRef.current.opacity = 0
      return
    }

    markerMaterialRef.current.opacity = 1
    ringMaterialRef.current.opacity = ringSelectionProgressRef.current
    hitMaterialRef.current.opacity = 0.001
  })

  return (
    <group ref={groupRef} userData={{ stickerId }}>
      <sprite ref={hitSpriteRef} name="sticker-hit-area" userData={{ stickerId }}>
        <spriteMaterial
          ref={hitMaterialRef}
          map={texture ?? null}
          color="#ffffff"
          transparent
          depthTest={false}
          depthWrite={false}
          opacity={0.001}
        />
      </sprite>

      <sprite ref={ringSpriteRef} name="sticker-ring" userData={{ stickerId }}>
        <spriteMaterial
          ref={ringMaterialRef}
          map={ringTexture}
          color="#FFC800"
          transparent
          depthTest={false}
          depthWrite={false}
          opacity={selected ? 1 : 0}
        />
      </sprite>

      <sprite ref={markerSpriteRef} name={STICKER_MARKER_NAME} userData={{ stickerId }}>
        <spriteMaterial
          ref={markerMaterialRef}
          map={texture ?? null}
          color="#ffffff"
          transparent
          depthTest={false}
          depthWrite={false}
          opacity={preview ? 0.9 : 1}
        />
      </sprite>
    </group>
  )
}

function createStickerTextureMap(image: HTMLImageElement): Record<string, THREE.Texture> {
  const textures: Record<string, THREE.Texture> = {}
  const sliceSize = image.width

  STICKER_CLASS_IDS.forEach(classId => {
    const classIndex = CLASS_ORDER_MAP[classId]

    ;(['red', 'blue'] as StickerTeam[]).forEach(team => {
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 128

      const context = canvas.getContext('2d')
      if (!context) return

      context.clearRect(0, 0, canvas.width, canvas.height)
      context.translate(64, 64)

      context.beginPath()
      context.arc(0, 0, 56, 0, Math.PI * 2)
      context.fillStyle = STICKER_TEAM_COLORS[team]
      context.fill()

      context.beginPath()
      context.arc(0, 0, 56, 0, Math.PI * 2)
      context.strokeStyle = '#ffffff'
      context.lineWidth = 10
      context.stroke()

      context.beginPath()
      context.arc(0, 0, 48, 0, Math.PI * 2)
      context.fillStyle = 'rgba(15, 18, 24, 0.12)'
      context.fill()

      context.save()
      context.beginPath()
      context.arc(0, 0, 47, 0, Math.PI * 2)
      context.clip()
      context.drawImage(image, 0, classIndex * sliceSize, sliceSize, sliceSize, -38, -38, 76, 76)
      context.restore()

      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.needsUpdate = true
      textures[getStickerTextureKey(classId, team)] = texture
    })
  })

  return textures
}

function createStickerRingTexture(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128

  const context = canvas.getContext('2d')
  if (!context) return new THREE.Texture()

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.translate(64, 64)
  context.beginPath()
  context.arc(0, 0, 56, 0, Math.PI * 2)
  context.strokeStyle = '#ffffff'
  context.lineWidth = 10
  context.stroke()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function getStickerTextureKey(classId: number, team: StickerTeam): string {
  return `${team}-${classId}`
}

function getSurfaceHitFromScreen({
  camera,
  domElement,
  scene,
  screenX,
  screenY,
  raycaster,
  pointer,
}: {
  camera: THREE.Camera
  domElement: HTMLCanvasElement
  scene: THREE.Scene
  screenX: number
  screenY: number
  raycaster?: THREE.Raycaster
  pointer?: THREE.Vector2
}): SurfaceHit | null {
  const rect = domElement.getBoundingClientRect()
  if (screenX < rect.left || screenX > rect.right || screenY < rect.top || screenY > rect.bottom) {
    return null
  }

  const world = scene.getObjectByName('world')
  if (!world) return null

  const nextPointer = pointer ?? new THREE.Vector2()
  nextPointer.set(
    ((screenX - rect.left) / rect.width) * 2 - 1,
    -((screenY - rect.top) / rect.height) * 2 + 1
  )

  const nextRaycaster = raycaster ?? new THREE.Raycaster()
  nextRaycaster.setFromCamera(nextPointer, camera)

  const intersections = nextRaycaster.intersectObject(world, true)
  const intersection = intersections.find(item => item.object.visible)

  if (!intersection) return null

  const point = intersection.point.clone()
  if (intersection.face) {
    const worldNormal = intersection.face.normal
      .clone()
      .transformDirection(intersection.object.matrixWorld)
      .normalize()
    point.addScaledVector(worldNormal, STICKER_WORLD_OFFSET)
  }

  return {
    position: [point.x, point.y, point.z],
  }
}

function initializeDragPlane(
  camera: THREE.Camera,
  anchor: THREE.Vector3,
  planeRef: MutableRefObject<THREE.Plane | null>,
  normalRef: MutableRefObject<THREE.Vector3>,
  anchorRef: MutableRefObject<THREE.Vector3>
) {
  camera.getWorldDirection(normalRef.current)
  anchorRef.current.copy(anchor)
  planeRef.current = new THREE.Plane().setFromNormalAndCoplanarPoint(
    normalRef.current,
    anchorRef.current
  )
}

function setRaycasterFromScreen({
  camera,
  domElement,
  screenX,
  screenY,
  raycaster,
  pointer,
}: {
  camera: THREE.Camera
  domElement: HTMLCanvasElement
  screenX: number
  screenY: number
  raycaster: THREE.Raycaster
  pointer: THREE.Vector2
}): boolean {
  const rect = domElement.getBoundingClientRect()
  if (screenX < rect.left || screenX > rect.right || screenY < rect.top || screenY > rect.bottom) {
    return false
  }

  pointer.set(
    ((screenX - rect.left) / rect.width) * 2 - 1,
    -((screenY - rect.top) / rect.height) * 2 + 1
  )
  raycaster.setFromCamera(pointer, camera)

  return true
}

function getStickerIdFromScreen({
  camera,
  domElement,
  scene,
  screenX,
  screenY,
}: {
  camera: THREE.Camera
  domElement: HTMLCanvasElement
  scene: THREE.Scene
  screenX: number
  screenY: number
}): string | null {
  const rect = domElement.getBoundingClientRect()
  if (screenX < rect.left || screenX > rect.right || screenY < rect.top || screenY > rect.bottom) {
    return null
  }

  const stickerGroup = scene.getObjectByName(STICKER_GROUP_NAME)
  if (!stickerGroup) return null

  const pointer = new THREE.Vector2(
    ((screenX - rect.left) / rect.width) * 2 - 1,
    -((screenY - rect.top) / rect.height) * 2 + 1
  )

  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(pointer, camera)

  const intersections = raycaster.intersectObject(stickerGroup, true)
  const stickerIntersection = intersections.find(intersection =>
    resolveStickerId(intersection.object)
  )

  return stickerIntersection ? resolveStickerId(stickerIntersection.object)! : null
}

function resolveStickerId(object: THREE.Object3D): string | undefined {
  if (typeof object.userData.stickerId === 'string') return object.userData.stickerId
  if (typeof object.parent?.userData.stickerId === 'string') return object.parent.userData.stickerId
  return undefined
}

function createStickerId(): string {
  return `sticker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function hasExceededStickerDragThreshold(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number
): boolean {
  return Math.hypot(currentX - startX, currentY - startY) >= STICKER_DRAG_COMMIT_DISTANCE_PX
}

function getWorldSpaceSizeForScreenPixels(
  camera: THREE.Camera,
  viewportHeight: number,
  pixelSize: number,
  distance: number
): number {
  const safeViewportHeight = Math.max(viewportHeight, 1)

  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const perspectiveCamera = camera as THREE.PerspectiveCamera
    const verticalFov = THREE.MathUtils.degToRad(perspectiveCamera.fov)
    return ((2 * Math.tan(verticalFov / 2) * distance) / safeViewportHeight) * pixelSize
  }

  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const orthographicCamera = camera as THREE.OrthographicCamera
    return (
      ((orthographicCamera.top - orthographicCamera.bottom) /
        orthographicCamera.zoom /
        safeViewportHeight) *
      pixelSize
    )
  }

  return pixelSize
}

function isSceneCanvasPointerEvent(event: PointerEvent, sceneCanvas: HTMLCanvasElement): boolean {
  const target = event.target

  if (target === sceneCanvas) return true
  return target instanceof HTMLCanvasElement
}

function isStickerPanelPointerEvent(event: PointerEvent): boolean {
  const target = event.target
  return target instanceof Element && !!target.closest('[data-sticker-panel="true"]')
}
