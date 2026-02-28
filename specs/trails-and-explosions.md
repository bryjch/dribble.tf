Projectile Trails & Explosion Effects

Context

The demo viewer currently renders projectiles (rockets, stickybombs, pipebombs, healing bolts)
as plain 3D models with no visual effects. We want to add:
1. Trails behind rockets, stickybombs, and arrows as they travel
2. Explosion effects when projectiles detonate

The tf2jump/dev branch has a trail implementation using @react-three/drei's Trail component
(MeshLine-based), but only in POV mode and with no explosion effects. We'll adapt that approach
for all camera modes and add explosion effects.

Key Design Decisions

- Trails in all camera modes, styled differently per mode:
  - POV mode: Bold trails matching tf2jump/dev style (screen-space width, additive blending, no
depth test)
  - 3rd-person modes (RTS/Spectator): Subtler, thinner trails with world-space width and
standard blending so they don't overpower the overview
- Trail styling: Rockets get a smoke-to-yellow gradient trail; stickybombs get team-colored
trails; pipebombs get shorter team-colored trails; healing bolts get a yellow trail
- Explosion detection: Track which projectile entityIds exist each tick. When one disappears,
spawn an explosion effect at its last known position. This is the only feasible approach
without parser changes.
- Explosion visual: Simple expanding/fading translucent sphere with additive blending —
lightweight, no textures needed, fits the clean aesthetic
- Port enhanced interpolation from tf2jump/dev (positionPrev, positionNext2, smoothingAlpha)
for smoother trail rendering
- Skip spawnTick for now — it requires WASM parser changes. Can be added later for spawn delay
polish.

Files to Modify

1. src/components/Scene/Projectiles.tsx — Main changes: add Trail wrapping, explosion tracking,
explosion component
2. src/components/DemoViewer.tsx — Pass additional tick data (prev/next2) and
tick/intervalPerTick props
3. src/components/Analyse/Data/ProjectileCache.ts — No changes needed (spawnTick deferred)

Implementation Steps

Step 1: Update DemoViewer to provide richer projectile data

File: src/components/DemoViewer.tsx

- Expand InterpolatedProjectile building to fetch prev tick and next2 tick projectile data
(matching tf2jump/dev pattern)
- Add MAX_PROJECTILES_FOR_HIGH_QUALITY_INTERPOLATION = 16 guard
- Pass tick and intervalPerTick props to <Projectiles> component
- Rename interpTick → renderTick for clarity (matching tf2jump/dev)

Changes to the projectile building block (~line 313-326):
// Fetch additional ticks for smoother interpolation
const useHighQualityProjectileInterpolation =
  projectilesCurrentTick.length <= MAX_PROJECTILES_FOR_HIGH_QUALITY_INTERPOLATION
const projectilesPrevTick = useHighQualityProjectileInterpolation
  ? demo.getProjectilesAtTick(Math.max(renderTick - 1, 1))
  : []
const projectilesNext2Tick = useHighQualityProjectileInterpolation
  ? demo.getProjectilesAtTick(renderTick + 2)
  : []

// Build maps and include positionPrev/positionNext2
projectilesThisTick = projectilesCurrentTick.map(projectile => ({
  ...projectile,
  positionPrev: prevProjectile?.position ?? projectile.position,
  positionNext: nextProjectile?.position ?? projectile.position,
  positionNext2: next2Projectile?.position ?? nextProjectile?.position ?? projectile.position,
  rotationNext: nextProjectile?.rotation ?? projectile.rotation,
}))

Render change:
<Projectiles
  projectiles={projectilesThisTick}
  tick={renderTick}
  intervalPerTick={demo?.intervalPerTick ?? 0.015}
/>

Step 2: Rewrite Projectiles.tsx with trails and enhanced interpolation

File: src/components/Scene/Projectiles.tsx

Port from tf2jump/dev with these adaptations:

a) Update interfaces and imports:
- Import Trail from @react-three/drei
- Import useStore for accessing settings/controls state
- InterpolatedProjectile adds positionPrev, positionNext2 fields
- ProjectilesProps adds tick and intervalPerTick
- BaseProjectileProps adds renderTick and intervalPerTick

b) Add interpolation helpers (from tf2jump/dev):
- interpolatePosition() — lerp with teleport detection
- smoothingAlpha() — exponential decay for frame-rate-independent smoothing
- Constants: PROJECTILE_POSITION_SMOOTH_SECONDS, PROJECTILE_ROTATION_SMOOTH_SECONDS

c) Add trail material functions (from tf2jump/dev):
- applyRocketTrailMaterial(trailMesh) — gradient grey→yellow, additive blending, no depth test,
screen-space width
- applyStickyTrailMaterial(trailMesh, color) — team-colored, additive blending

d) Wrap each projectile type with <Trail>:
- RocketProjectile: Trail with width=100, length=24, gradient material
- StickybombProjectile: Trail with width=80, length=20, team-colored
- PipebombProjectile: Trail with width=60, length=16, team-colored
- HealingBoltProjectile: Trail with width=40, length=12, yellow
- Trails render in all camera modes, but adapt style based on mode:
  - POV: bold (screen-space width via sizeAttenuation=0, additive blending, depthTest=false) —
matches tf2jump/dev
  - 3rd-person: subtle (world-space width via default sizeAttenuation, normal blending,
depthTest=true, lower opacity ~0.5)

e) Update useFrame loops to use the enhanced interpolation with smoothingAlpha and
delta-time-based blending.

Step 3: Add explosion effect system

File: src/components/Scene/Projectiles.tsx

a) Track projectile lifecycle in Projectiles component:
// Track previous tick's projectile IDs to detect disappearances
const prevProjectileIds = useRef<Map<number, { position: Vector; type: string; teamNumber:
number }>>(new Map())
const [explosions, setExplosions] = useState<Explosion[]>([])

// Each render: compare current projectile set to previous
// Missing entityIds → projectile detonated → spawn explosion at last position

b) Explosion data structure:
interface Explosion {
  id: number
  position: THREE.Vector3
  type: string       // rocket, pipebomb, stickybomb
  teamNumber: number
  startTime: number  // performance.now() when created
}

c) ExplosionEffect component:
- Renders a <Sphere> mesh with meshBasicMaterial
- Additive blending, transparent, no depth write
- Color based on projectile type/team (orange-red for rockets, team-colored for stickies/pipes)
- Animates over ~0.3-0.5 seconds: scale expands from 0 → ~80 HU radius, opacity fades from 0.6
→ 0
- Self-removes after animation completes
- Uses useFrame for animation

d) Render explosions alongside projectiles:
<group name="projectiles">
  {projectiles.map(p => <Projectile ... />)}
  {explosions.map(e => <ExplosionEffect key={e.id} ... />)}
</group>

Step 4: Add trail fallback / model normalization

Port normalizeProjectileModelKey and ProjectileFallback from tf2jump/dev for more robust model
loading (handles missing team gracefully with a colored sphere fallback).

Verification

1. Load a demo with rockets being fired — verify trails appear behind rockets with smoke→yellow
gradient
2. Load a demo with stickybombs — verify team-colored trails appear
3. Watch projectiles detonate — verify brief expanding sphere explosion appears at detonation
point
4. Switch between RTS/Spectator/POV camera modes — verify trails render in all modes
5. Scrub timeline back and forth — verify no trail/explosion artifacts persist incorrectly
6. Test with a demo containing many simultaneous projectiles — verify performance is acceptable
7. Run npm run build to confirm no type errors