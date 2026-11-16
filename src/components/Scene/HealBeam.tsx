import { useRef, useMemo } from 'react'

import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

import { viewmodelMuzzle } from '@components/Scene/Viewmodel'
import { getState } from '@zus/store'

// ─── SHADERS ────────────────────────────────────────────────────────────────

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec3  uOrigin;
  uniform vec3  uTarget;
  uniform float uWidth;

  varying vec2 vUv;

  void main() {
    vUv = uv;

    // t goes 0..1 along beam length, s goes -0.5..0.5 across width
    float t = uv.x;
    float s = uv.y - 0.5;

    vec3 beamDir = uTarget - uOrigin;
    vec3 beamPos = uOrigin + beamDir * t;

    // Build a camera-facing frame so the beam isn't edge-on from any angle
    vec3 forward = normalize(beamDir);
    vec3 viewDir = normalize(cameraPosition - beamPos);
    vec3 right = normalize(cross(forward, viewDir));
    vec3 up    = normalize(cross(right, forward));

    float speed = uTime * 3.0;

    // Multi-frequency sine waves for medigun-like distortion
    float wave = sin(t * 12.0 - speed * 1.8) * 0.6
               + sin(t * 20.0 + speed * 2.5) * 0.3
               + sin(t * 35.0 - speed * 3.2) * 0.15;

    // Taper distortion at endpoints so beam connects cleanly
    wave *= smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.9, t);

    // Width with subtle pulsing — wave amplitude is fixed so uWidth only scales thickness
    float finalWidth = uWidth * (1.0 + 0.3 * sin(t * 8.0 - speed));
    float waveAmp = 5.3;
    // Up close (a medic's own beam in POV) it narrows, rather than filling the screen
    float near = clamp(distance(cameraPosition, beamPos) / 100.0, 0.35, 1.0);
    vec3 offset = (right * s * finalWidth
                + right * wave * waveAmp * 0.8
                + up    * wave * waveAmp * 0.5) * near;

    vec3 worldPos = beamPos + offset;

    // Use viewMatrix directly (not modelViewMatrix) because worldPos
    // is already in world space — the parent group's transform must be skipped.
    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3  uColor;

  varying vec2 vUv;

  float hash(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  void main() {
    float t = vUv.x; // along beam
    float s = vUv.y;  // across beam (0..1)

    float speed = uTime * 3.0;

    // Core brightness (bright center, falloff at edges)
    float centerDist = abs(s - 0.5) * 2.0;
    float core = exp(-centerDist * centerDist * 8.0);
    float glow = exp(-centerDist * centerDist * 2.0);

    // Scrolling energy pulses
    float energy = (sin(t * 30.0 - speed * 4.0) * 0.5 + 0.5) * 0.4
                 + (sin(t * 50.0 + speed * 6.0) * 0.5 + 0.5) * 0.3
                 + (sin(t * 15.0 - speed * 2.0) * 0.5 + 0.5) * 0.3;

    // Sparkle / particle-like noise
    float sparkle = hash(floor(t * 80.0 + floor(uTime * 20.0) * 0.1));
    sparkle = pow(sparkle, 12.0) * core;

    // Taper alpha at endpoints
    float endTaper = smoothstep(0.0, 0.05, t) * smoothstep(1.0, 0.95, t);

    // Pulsing intensity
    float breathe = 0.85 + 0.15 * sin(uTime * 5.0);

    // "Heal cross" shimmer — brief bright flashes
    float crossFlash = pow(sin(t * 10.0 - speed * 3.0) * 0.5 + 0.5, 6.0) * core * 0.3;

    // Compose: tinted core with subtle white highlight, colored glow
    vec3 col = uColor * core * 0.45
             + vec3(1.0) * core * 0.1
             + uColor * glow * (0.25 + energy * 0.2)
             + uColor * crossFlash
             + uColor * sparkle * 0.25;
    col *= breathe;

    float alpha = clamp((core * 0.55 + glow * 0.25 + sparkle * 0.15) * endTaper, 0.0, 1.0) * 0.7;

    gl_FragColor = vec4(col, alpha);
  }
`

// ─── COMPONENT ──────────────────────────────────────────────────────────────

export interface HealBeamProps {
  /** The medic's aim (eye height, view angles), which the medigun is held from. */
  aim: THREE.Object3D
  /** The medic, and whether they are the one in focus (in POV, the beam leaves the viewmodel). */
  entityId: number
  focused: boolean
  target: THREE.Vector3
  color?: string
  width?: number
}

// Every beam is the same strip, shaped in the vertex shader; one geometry serves them all.
const BEAM_GEOMETRY = new THREE.PlaneGeometry(1, 1, 100, 1)

// Half player height (83 * 0.5) — beam connects at the patient's midsection
const BEAM_HEIGHT_OFFSET = 41.5

// Roughly where the medigun's nozzle is, from the medic's eye (right, up, forward is -Z): held at
// the hip when seen from outside, at the bottom right of the screen in POV without a viewmodel.
const NOZZLE_THIRD_PERSON = new THREE.Vector3(8, -32, -28)
const NOZZLE_POV = new THREE.Vector3(10, -14, -24)

const _camera = new THREE.Vector3()

export const HealBeam = ({ aim, entityId, focused, target, color, width = 20 }: HealBeamProps) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null)


  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector3() },
      uTarget: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(color || '#ffffff') },
      uWidth: { value: width },
    }),
    []
  )

  useFrame(state => {
    if (!materialRef.current) return
    const u = materialRef.current.uniforms
    u.uTime.value = state.clock.elapsedTime
    const origin = u.uOrigin.value as THREE.Vector3
    const pov = focused && getState().scene.controls.mode === 'pov'
    if (pov && viewmodelMuzzle.entityId === entityId) {
      // The viewmodel's nozzle, at the same place on screen and as far away.
      const camera = state.camera
      camera.updateWorldMatrix(true, false)
      camera.getWorldPosition(_camera)
      origin.copy(viewmodelMuzzle.ndc).setZ(0.5).unproject(camera).sub(_camera)
      origin.setLength(viewmodelMuzzle.distance).add(_camera)
    } else {
      aim.updateWorldMatrix(true, false)
      origin.copy(pov ? NOZZLE_POV : NOZZLE_THIRD_PERSON).applyMatrix4(aim.matrixWorld)
    }
    u.uTarget.value.set(target.x, target.y, target.z + BEAM_HEIGHT_OFFSET)
    u.uColor.value.set(color || '#ffffff')
  })

  return (
    <mesh name="healBeam" frustumCulled={false} geometry={BEAM_GEOMETRY}>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}
