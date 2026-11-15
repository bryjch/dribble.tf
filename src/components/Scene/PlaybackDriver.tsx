import { useFrame } from '@react-three/fiber'

import type { MatchSource } from '@components/Analyse/Data/MatchSource'
import type { CachedPlayer } from '@components/Analyse/Data/PlayerTracks'
import type { CachedProjectile } from '@components/Analyse/Data/ProjectileCache'
import { getState } from '@zus/store'
import { advanceClock } from '@utils/playback'

//
// ─── PLAYBACK DRIVER ────────────────────────────────────────────────────────────
//
// Runs first in every frame: moves the playback clock on, then reads the match once at the
// tick being drawn into `sceneFrame`. The scene's own frame callbacks (actors, projectiles)
// read that and move their objects directly, so nothing re-renders in React to animate.
//

/** Frame callback priorities: the driver, then what reads its frame, then everything else. */
export const DRIVER_PRIORITY = -2
export const SCENE_PRIORITY = -1

export interface SceneFrame {
  match?: MatchSource
  /** The tick drawn this frame, fractional while playing. */
  tick: number
  /** The tick drawn last frame. */
  previousTick: number
  /** Connected RED and BLU players. */
  players: CachedPlayer[]
  playersByEntity: Map<number, CachedPlayer>
  projectiles: CachedProjectile[]
}

export const sceneFrame: SceneFrame = {
  tick: 1,
  previousTick: 1,
  players: [],
  playersByEntity: new Map(),
  projectiles: [],
}

/** The players the scene draws: connected, on RED or BLU. */
export const isScenePlayer = (player: CachedPlayer) =>
  !!player.connected && (player.teamId === 2 || player.teamId === 3)

export const PlaybackDriver = ({ match }: { match?: MatchSource }) => {
  useFrame((_, delta) => {
    const clock = advanceClock(delta)
    const interpolate = getState().settings.scene.interpolateFrames !== false
    const tick = interpolate ? clock : Math.floor(clock)

    sceneFrame.previousTick = sceneFrame.match === match ? sceneFrame.tick : tick
    sceneFrame.tick = tick
    sceneFrame.match = match
    if (!match) {
      sceneFrame.players = []
      sceneFrame.playersByEntity = new Map()
      sceneFrame.projectiles = []
      return
    }
    sceneFrame.players = match.playersAt(tick).filter(isScenePlayer)
    sceneFrame.playersByEntity = new Map(sceneFrame.players.map(p => [p.user.entityId, p]))
    sceneFrame.projectiles = match.projectilesAt(tick)
  }, DRIVER_PRIORITY)

  return null
}
