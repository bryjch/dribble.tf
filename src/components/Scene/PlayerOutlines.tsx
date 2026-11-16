import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'

import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

//
// ─── PLAYER OUTLINES ────────────────────────────────────────────────────────────
//
// Each player, engineer building and stickybomb gets an outline in its team's colour, seen
// through walls. Per frame, after the scene is drawn:
//
//   1. Mask: only the outlined meshes, flat, into a colour-only target: red is RED, blue is
//      BLU, and green marks a thin outline. This draws the outlined subtree, not the scene, so
//      the map is never drawn twice. Instanced meshes (stickies) and skinned ones (buildings)
//      are drawn as the scene draws them.
//   2. Outline: one fullscreen pass over the canvas. A pixel outside every outlined mesh that
//      has one within OUTLINE_WIDTH_PX gets its team's colour (within half that for a thin
//      outline); inside one, nothing.
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

/**
 * Marks a model's meshes (instanced and skinned ones too) to be outlined in their team's colour;
 * `thin` gives a small model (a sticky) half the outline width.
 */
export function markOutlined(root: THREE.Object3D, team: string, { thin = false } = {}) {
  root.traverse(object => {
    if (!(object as THREE.Mesh).isMesh) return
    object.layers.enable(OUTLINE_LAYER)
    object.userData.outlineTeam = team
    object.userData.outlineThin = thin
  })
}

const maskMaterial = (team: string, thin: boolean) =>
  new THREE.ShaderMaterial({
    uniforms: {
      mask: { value: new THREE.Vector4(team === 'red' ? 1 : 0, thin ? 1 : 0, team === 'blue' ? 1 : 0, 1) },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      void main() {
        #include <skinbase_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 local = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          local = instanceMatrix * local;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * local;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec4 mask;
      void main() {
        gl_FragColor = mask;
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
      red: { value: new THREE.Color(OUTLINE_COLORS.red) },
      blue: { value: new THREE.Color(OUTLINE_COLORS.blue) },
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
      uniform vec3 red;
      uniform vec3 blue;
      uniform vec2 texel;
      uniform float radius;
      varying vec2 vUv;

      const int TAPS = 12;
      const float TAU = 6.28318530718;

      // A tap's team colour, weighted by how much of it the tap covers.
      vec3 team(vec4 tap) {
        return red * tap.r + blue * tap.b;
      }

      void main() {
        // Inside an outlined model: its own model shows (or the wall in front of it does).
        if (texture2D(mask, vUv).a > 0.5) discard;

        // Look for a model on two rings around this pixel; how many taps land on one gives a
        // soft outer edge, and their average is the colour (two teams side by side blend). A
        // thin outline (green in the mask) reaches the inner ring only.
        vec3 color = vec3(0.0);
        float hits = 0.0;
        for (int i = 0; i < TAPS; i++) {
          float angle = (float(i) + 0.5) * TAU / float(TAPS);
          vec2 step = vec2(cos(angle), sin(angle)) * radius * texel;
          vec4 outer = texture2D(mask, vUv + step);
          vec4 inner = texture2D(mask, vUv + step * 0.5);
          float thick = max(outer.a - outer.g, 0.0);
          color += team(outer) * (thick / max(outer.a, 1e-4)) + team(inner);
          hits += thick + inner.a;
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
 * Outlines the marked meshes among its children while `enabled`. While on it draws the scene
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
      red: maskMaterial('red', false),
      blue: maskMaterial('blue', false),
      'red:thin': maskMaterial('red', true),
      'blue:thin': maskMaterial('blue', true),
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

    // The outlined meshes flat in their team's mask colour, for the mask only.
    group.traverse(object => {
      const team = object.userData.outlineTeam
      const material = team && materials[object.userData.outlineThin ? `${team}:thin` : team]
      if (!material) return
      const mesh = object as THREE.Mesh
      swapped.push({ mesh, material: mesh.material })
      mesh.material = material
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
