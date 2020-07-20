import React from 'react'
import { useSelector } from 'react-redux'

import { CachedPlayer } from '@components/Analyse/Data/PlayerCache'
import { ClassIcon } from '@components/UI/ClassIcon'

import { ACTOR_TEAM_COLORS } from '@constants/mappings'
import { parseClassHealth } from '@utils/players'

export interface FocusedPlayerProps {
  players: CachedPlayer[]
}

export const FocusedPlayer = (props: FocusedPlayerProps) => {
  const { mode, focusedObject } = useSelector((state: any) => state.scene.controls)

  if (mode !== 'pov' || !focusedObject) return null

  const { players } = props
  const focused = players.find(player => player.user.entityId === focusedObject.userData.entityId)

  if (!focused) return null

  let name, health, percentage, healthCls, icon
  name = focused.user.name
  health = focused.health
  percentage = parseClassHealth(focused.classId, health).percentage
  healthCls = percentage > 100 ? 'overhealed' : percentage < 40 ? 'low' : ''
  icon = <ClassIcon classId={focused.classId} />

  return (
    <>
      <div className="panel">
        <div className={`health ${healthCls}`}>{health}</div>
        <div className="name">{name}</div>
        <div className="class-icon-container">{icon}</div>
      </div>

      <style jsx>{`
        .panel {
          display: flex;
          flex-flow: row nowrap;
          align-items: center;
          max-width: 260px;
          background-color: rgba(0, 0, 0, 0.4);
          color: rgba(255, 255, 255, 1);
          font-size: 1rem;
          padding: 0.1rem 0;
          border-bottom-width: 6px;
          border-bottom-style: solid;
          border-bottom-color: ${ACTOR_TEAM_COLORS(focused.team).focusedBackground};

          .health {
            position: relative;
            color: #ffffff;
            font-size: 1.5rem;
            line-height: 1.5rem;
            font-weight: 700;
            padding: 0 0.3rem;

            &.overhealed {
              color: ${ACTOR_TEAM_COLORS(focused.team).healthOverhealed};
            }

            &.low {
              color: ${ACTOR_TEAM_COLORS(focused.team).healthLow};
            }
          }

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
      `}</style>
    </>
  )
}
