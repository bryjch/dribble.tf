import { Html } from '@react-three/drei'

import { CachedBuilding } from '@components/Analyse/Data/BuildingCache'

import { useStore } from '@zus/store'
import { degreesToRadians } from '@utils/geometry'
import { cn } from '@utils/styling'

//
// ─── BUILDINGS ──────────────────────────────────────────────────────────────────
//
// Engineer buildings as simple team-coloured shapes until there are models for them: a sentry
// whose turret turns to its aim, a dispenser cabinet, a teleporter pad. Sizes are roughly the
// game's, in Hammer units, z up.
//

const TEAM_COLORS: Record<number, string> = { 2: '#b8383b', 3: '#5885a2' }
const SAPPED_COLOR = '#9aa3ad'

/** The label TF2's engineer HUD gives a building: S1-S3, MS, D1-D3, T1-T3. */
const buildingLabel = (b: CachedBuilding) => {
  if (b.kind === 'sentry') return b.mini ? 'MS' : `S${b.level}`
  if (b.kind === 'dispenser') return `D${b.level}`
  return `T${b.level}${b.entrance ? '↓' : '↑'}`
}

interface BuildingMaterialProps {
  color: string
  ghost: boolean
}

/** Team colour; see-through while still being built. */
const BuildingMaterial = ({ color, ghost }: BuildingMaterialProps) => (
  <meshStandardMaterial
    color={color}
    roughness={0.7}
    metalness={0.2}
    transparent={ghost}
    opacity={ghost ? 0.45 : 1}
  />
)

const Sentry = ({ building, color }: { building: CachedBuilding; color: string }) => {
  const scale = building.mini ? 0.75 : 0.85 + building.level * 0.1
  const aim = degreesToRadians((building.aim ?? building.yaw) - building.yaw)
  const ghost = building.constructing
  return (
    <group scale={scale}>
      {/* Tripod */}
      <mesh position={[0, 0, 10]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[6, 16, 20, 3]} />
        <BuildingMaterial color={color} ghost={ghost} />
      </mesh>
      {/* Turret, turning to where it aims */}
      <group position={[0, 0, 30]} rotation={[0, 0, aim]}>
        <mesh>
          <boxGeometry args={[26, 18, 18]} />
          <BuildingMaterial color={color} ghost={ghost} />
        </mesh>
        <mesh position={[20, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[3, 3, 16, 8]} />
          <meshStandardMaterial
            color={building.attacking ? '#ffd27a' : '#2b2b2b'}
            emissive={building.attacking ? '#ff9f1c' : '#000000'}
            transparent={ghost}
            opacity={ghost ? 0.45 : 1}
          />
        </mesh>
      </group>
    </group>
  )
}

const Dispenser = ({ building, color }: { building: CachedBuilding; color: string }) => (
  <group>
    <mesh position={[0, 0, 25]}>
      <boxGeometry args={[24, 30, 50]} />
      <BuildingMaterial color={color} ghost={building.constructing} />
    </mesh>
    {/* The screen, a level tall */}
    <mesh position={[12.5, 0, 26]}>
      <boxGeometry args={[1, 16, 8 + building.level * 6]} />
      <meshStandardMaterial color="#e8e2c8" emissive="#6b6450" />
    </mesh>
  </group>
)

const Teleporter = ({ building, color }: { building: CachedBuilding; color: string }) => (
  <group>
    <mesh position={[0, 0, 3]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[24, 26, 6, 24]} />
      <BuildingMaterial color={color} ghost={building.constructing} />
    </mesh>
    {/* Entrance: a ring to step on. Exit: an arrow the way it faces. */}
    {building.entrance ? (
      <mesh position={[0, 0, 6.5]}>
        <torusGeometry args={[14, 2, 6, 24]} />
        <meshStandardMaterial color="#f2f2f2" emissive="#555555" />
      </mesh>
    ) : (
      <mesh position={[6, 0, 7]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[8, 16, 3]} />
        <meshStandardMaterial color="#f2f2f2" emissive="#555555" />
      </mesh>
    )}
  </group>
)

interface BuildingTagProps {
  building: CachedBuilding
}

/** The label and health bar above a building, like a player's nameplate. */
const BuildingTag = ({ building }: BuildingTagProps) => {
  const percentage = building.maxHealth ? (building.health / building.maxHealth) * 100 : 0
  return (
    <div className="pointer-events-none flex select-none flex-col items-center">
      <div
        className={cn(
          'text-[0.75rem] font-bold leading-none',
          '[text-shadow:0_0_2px_#000000,0_0_2px_#000000,0_0_2px_#000000]',
          building.constructing && 'opacity-60'
        )}
      >
        {buildingLabel(building)}
        {building.sapped && <span className="ml-1 text-[#c9d6e3]">SAPPED</span>}
      </div>
      <div className="relative mt-[2px] h-[4px] w-10 overflow-hidden bg-[#8f7b89]">
        <div
          className={cn(
            'absolute inset-0 right-auto',
            building.team === 2 && 'bg-pp-healthbar-red',
            building.team === 3 && 'bg-pp-healthbar-blue'
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

export interface BuildingsProps {
  buildings: CachedBuilding[]
}

export const Buildings = ({ buildings }: BuildingsProps) => {
  const nameplates = useStore(state => state.settings.ui.nameplate)

  return (
    <group name="buildings">
      {buildings.map(building => {
        const color = building.sapped ? SAPPED_COLOR : (TEAM_COLORS[building.team] ?? '#888888')
        const { x, y, z } = building.position
        return (
          <group key={`building-${building.entityId}`} position={[x, y, z]}>
            <group rotation={[0, 0, degreesToRadians(building.yaw)]}>
              {building.kind === 'sentry' && <Sentry building={building} color={color} />}
              {building.kind === 'dispenser' && <Dispenser building={building} color={color} />}
              {building.kind === 'teleporter' && <Teleporter building={building} color={color} />}
            </group>
            {nameplates?.enabled && (
              <Html
                className="pointer-events-none select-none"
                style={{ bottom: 0, transform: 'translateX(-50%)', textAlign: 'center' }}
                position={[0, 0, building.kind === 'teleporter' ? 24 : 64]}
              >
                <BuildingTag building={building} />
              </Html>
            )}
          </group>
        )
      })}
    </group>
  )
}
