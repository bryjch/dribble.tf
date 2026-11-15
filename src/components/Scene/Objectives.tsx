import { CachedPlayer } from '@components/Analyse/Data/PlayerTracks'
import { ObjectiveState, ObjectiveTeam } from '@components/Analyse/Data/ObjectiveTimeline'

//
// ─── OBJECTIVES IN THE WORLD ────────────────────────────────────────────────────
//
// A ring on each control point in its owner's colour, filling with the capping team's as it is
// captured; a block for the payload cart; a flag pole for each intelligence, over its carrier's
// head while carried. Hammer units, z up.
//

const TEAM_COLORS: Record<ObjectiveTeam, string> = {
  red: '#b8383b',
  blue: '#5885a2',
  spectator: '#9aa3ad',
  none: '#9aa3ad',
}

const POINT_RADIUS = 72

export interface ObjectivesProps {
  state: ObjectiveState | null
  players: CachedPlayer[]
}

export const Objectives = ({ state, players }: ObjectivesProps) => {
  if (!state) return null
  return (
    <group name="objectives">
      {state.points.map(point => {
        if (!point.position) return null
        const { x, y, z } = point.position
        const progress = point.capping !== 'none' ? point.progress : 0
        return (
          <group key={`point-${point.index}`} position={[x, y, z + 2]}>
            <mesh>
              <ringGeometry args={[POINT_RADIUS - 8, POINT_RADIUS, 48]} />
              <meshBasicMaterial
                color={TEAM_COLORS[point.owner]}
                transparent
                opacity={point.locked ? 0.25 : 0.7}
                depthWrite={false}
              />
            </mesh>
            {progress > 0 && (
              <mesh position={[0, 0, 0.5]} rotation={[0, 0, Math.PI / 2]}>
                <ringGeometry
                  args={[POINT_RADIUS - 20, POINT_RADIUS - 9, 48, 1, 0, progress * Math.PI * 2]}
                />
                <meshBasicMaterial
                  color={TEAM_COLORS[point.capping]}
                  transparent
                  opacity={0.85}
                  depthWrite={false}
                />
              </mesh>
            )}
          </group>
        )
      })}

      {state.carts.map(cart => {
        const { x, y, z } = cart.position
        return (
          <mesh key={`cart-${cart.id}`} position={[x, y, z + 24]}>
            <boxGeometry args={[44, 30, 40]} />
            <meshStandardMaterial color={TEAM_COLORS[cart.team]} roughness={0.6} metalness={0.3} />
          </mesh>
        )
      })}

      {state.flags.map(flag => {
        const carrier = flag.carrier ? players.find(p => p.user.entityId === flag.carrier) : undefined
        const at = carrier ? carrier.position : flag.position
        if (!at) return null
        // Carried: over the carrier's head, out of their model.
        const lift = carrier ? 90 : 0
        return (
          <group key={`flag-${flag.id}`} position={[at.x, at.y, at.z + lift]}>
            <mesh position={[0, 0, 24]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[1.2, 1.2, 48, 6]} />
              <meshStandardMaterial color="#d8d2bc" />
            </mesh>
            <mesh position={[10, 0, 40]}>
              <boxGeometry args={[20, 1, 14]} />
              <meshStandardMaterial
                color={TEAM_COLORS[flag.team]}
                emissive={TEAM_COLORS[flag.team]}
                emissiveIntensity={0.35}
              />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
