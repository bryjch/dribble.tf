import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'

import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

//
// ─── PLAYER OUTLINES ────────────────────────────────────────────────────────────
//
// Each player gets an outline in their team's colour, seen through walls. Per frame, after the
// scene is drawn:
//
//   1. Mask: only the player models, flat in their team colour, into a colour-only target.
//      This draws the players' subtree, not the scene, so the map is never drawn twice.
//   2. Outline: one fullscreen pass over the canvas. A pixel outside every player that has a
//      player within OUTLINE_WIDTH_PX gets that player's colour; inside a player, nothing.
//
// That is a few hundred player triangles and one cheap fullscreen pass. Before this the
// postprocessing library's Outline effect drew the whole scene into an 8× multisampled buffer,
// then drew the map again for depth, and could only use one colour for every player.
//

/** The layer outlined meshes are on (as well as the default one), so the mask draws only them. */
const OUTLINE_LAYER = 30

export const OUTLINE_COLORS: Record<string, string> = {
  red: '#ff3b3b',
  blue: '#3b8bff',
}

/** How far the outline reaches past the model, in CSS pixels. */
const OUTLINE_WIDTH_PX = 2.5

/** Marks a player model's meshes to be outlined in their team's colour. */
export function markOutlined(root: THREE.Object3D, team: string) {
  root.traverse(object => {
    if (!(object as THREE.Mesh).isMesh) return
    object.layers.enable(OUTLINE_LAYER)
    object.userData.outlineTeam = team
  })
}

const maskMaterial = (color: string) =>
  new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      void main() {
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.DoubleSide,
    // Through walls: the mask has no depth, so nothing hides a player from it.
    depthTest: false,
    depthWrite: false,
  })

const outlineMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: {
      mask: { value: null },
      texel: { value: new THREE.Vector2() },
      radius: { value: OUTLINE_WIDTH_PX },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D mask;
      uniform vec2 texel;
      uniform float radius;
      varying vec2 vUv;

      const int TAPS = 12;
      const float TAU = 6.28318530718;

      void main() {
        // Inside a player: their own model shows (or the wall in front of them does).
        if (texture2D(mask, vUv).a > 0.5) discard;

        // Look for a player on two rings around this pixel; how many taps land on one gives a
        // soft outer edge, and their average is the colour (two teams side by side blend).
        vec3 color = vec3(0.0);
        float hits = 0.0;
        for (int i = 0; i < TAPS; i++) {
          float angle = (float(i) + 0.5) * TAU / float(TAPS);
          vec2 step = vec2(cos(angle), sin(angle)) * radius * texel;
          vec4 outer = texture2D(mask, vUv + step);
          vec4 inner = texture2D(mask, vUv + step * 0.5);
          color += outer.rgb * outer.a + inner.rgb * inner.a;
          hits += outer.a + inner.a;
        }
        if (hits < 0.01) discard;
        gl_FragColor = vec4(color / hits, clamp(hits / 3.0, 0.0, 1.0));
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })

/** A triangle that covers the screen, for the outline pass. */
const fullscreenTriangle = () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  return geometry
}

/**
 * Outlines the player models among its children while `enabled`. While on it draws the scene
 * itself (at render priority 1), so anything drawn over the scene after it, such as the POV
 * viewmodel, uses priority 2.
 */
export const PlayerOutlines = ({ enabled, children }: { enabled: boolean; children: ReactNode }) => {
  const root = useRef<THREE.Group>(null)
  return (
    <>
      <group name="outlined" ref={root}>
        {children}
      </group>
      {enabled && <OutlinePass root={root} />}
    </>
  )
}

const OutlinePass = ({ root }: { root: RefObject<THREE.Group> }) => {
  const resources = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false })
    const materials: Record<string, THREE.ShaderMaterial> = {
      red: maskMaterial(OUTLINE_COLORS.red),
      blue: maskMaterial(OUTLINE_COLORS.blue),
    }
    const outline = outlineMaterial()
    outline.uniforms.mask.value = target.texture
    const quad = new THREE.Mesh(fullscreenTriangle(), outline)
    quad.frustumCulled = false
    const quadScene = new THREE.Scene()
    quadScene.add(quad)
    return {
      target,
      materials,
      outline,
      quad,
      quadScene,
      quadCamera: new THREE.Camera(),
      size: new THREE.Vector2(),
      clearColor: new THREE.Color(),
      swapped: [] as { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[],
    }
  }, [])

  useEffect(
    () => () => {
      resources.target.dispose()
      for (const material of Object.values(resources.materials)) material.dispose()
      resources.outline.dispose()
      resources.quad.geometry.dispose()
    },
    [resources]
  )

  useFrame(({ gl, scene, camera }) => {
    gl.render(scene, camera)

    const group = root.current
    if (!group) return
    const { target, materials, outline, quadScene, quadCamera, size, clearColor, swapped } = resources

    gl.getDrawingBufferSize(size)
    if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y)
    outline.uniforms.texel.value.set(1 / size.x, 1 / size.y)
    outline.uniforms.radius.value = OUTLINE_WIDTH_PX * gl.getPixelRatio()

    // The outlined meshes in their team's flat colour, for the mask only.
    group.traverse(object => {
      const team = object.userData.outlineTeam
      if (!team || !materials[team]) return
      const mesh = object as THREE.Mesh
      swapped.push({ mesh, material: mesh.material })
      mesh.material = materials[team]
    })
    if (swapped.length === 0) return

    // The mask and outline draws count toward the frame's renderer.info, not replace it.
    const autoReset = gl.info.autoReset
    gl.info.autoReset = false
    const autoClear = gl.autoClear
    const clearAlpha = gl.getClearAlpha()
    gl.getClearColor(clearColor)
    const layers = camera.layers.mask

    gl.autoClear = false
    gl.setRenderTarget(target)
    gl.setClearColor(0x000000, 0)
    gl.clear(true, false, false)
    camera.layers.set(OUTLINE_LAYER)
    gl.render(group, camera)
    camera.layers.mask = layers
    gl.setRenderTarget(null)

    for (const { mesh, material } of swapped) mesh.material = material
    swapped.length = 0

    gl.render(quadScene, quadCamera)

    gl.setClearColor(clearColor, clearAlpha)
    gl.autoClear = autoClear
    gl.info.autoReset = autoReset
  }, 1)

  return null
}
