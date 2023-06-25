import React from 'react'

import { CachedPlayer } from '@components/Analyse/Data/PlayerCache'
import { ClassIcon } from '@components/UI/ClassIcon'

import { useStore, useInstance } from '@zus/store'

import { ACTOR_TEAM_COLORS } from '@constants/mappings'
import { parseClassHealth } from '@utils/players'

export interface FocusedPlayerProps {
  players: CachedPlayer[]
}

export const FocusedPlayer = (props: FocusedPlayerProps) => {
  const controlsMode = useStore((state: any) => state.scene.controls.mode)
  const focusedObject = useInstance(state => state.focusedObject)

  if (controlsMode !== 'pov' || !focusedObject) return null

  const { players } = props
  const focused = players.find(player => player.user.entityId === focusedObject?.userData?.entityId)

  if (!focused) return null

  let name, health, percentage, healthCls, icon
  name = focused.user.name
  health = focused.health
  percentage = parseClassHealth(focused.classId, health).percentage
  healthCls = percentage > 100 ? 'overhealed' : percentage < 40 ? 'low' : ''
  icon = <ClassIcon classId={focused.classId} />

  return (
    <div className="container">
      <div className="state">{health === 0 && <div className="dead">*RESPAWNING*</div>}</div>

      <div className="player">
        <div className={`health ${healthCls}`}>{health}</div>

        <div className="panel">
          <div className="name">{name}</div>
          <div className="class-icon-container">{icon}</div>
        </div>
      </div>

      <style jsx>{`
        .container {
          display: flex;
          flex-flow: column nowrap;
          align-items: center;
          width: auto;

          .state {
            margin-bottom: 1rem;

            .dead {
              font-size: 2rem;
              font-weight: 900;
              color: #fbff09;
              text-shadow: 0 0 3px #0a0a0a;
              animation: dead-pulse 0.3s ease-in infinite alternate;
            }

            @keyframes dead-pulse {
              0% {
                opacity: 0.5;
              }
              100% {
                opacity: 1;
              }
            }
          }

          .player {
            display: flex;
            flex-flow: row nowrap;

            .health {
              position: relative;
              font-weight: 900;
              color: #fff;
              font-size: 2.5rem;
              text-shadow: 0 0 3px #000000;
              line-height: 2.5rem;
              width: 65px;
              text-align: center;

              &.overhealed {
                color: ${ACTOR_TEAM_COLORS(focused.team).healthOverhealed};
              }

              &.low {
                color: ${ACTOR_TEAM_COLORS(focused.team).healthLow};
              }
            }

            .panel {
              display: flex;
              flex-flow: row nowrap;
              align-items: center;
              max-width: 260px;
              background-color: rgba(0, 0, 0, 0.3);
              color: rgba(255, 255, 255, 1);
              font-size: 1rem;
              padding: 0.1rem 0;
              border-bottom-width: 6px;
              border-bottom-style: solid;
              border-bottom-color: ${ACTOR_TEAM_COLORS(focused.team).focusedBackground};

              .name {
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                padding: 0 0.3rem;
              }

              .class-icon-container {
                padding: 0 0.3rem;
              }
            }
          }
        }
      `}</style>
    </div>
  )
}
