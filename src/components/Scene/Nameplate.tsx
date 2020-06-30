import React from 'react'

import { CLASS_MAP, HEALTH_MAP, ACTOR_TEAM_COLORS } from '@constants/mappings'

const classIcons = require('@assets/class-icons-64.png')

const CLASS_ICON_SIZE = '1.5rem'
export interface NameplateProps {
  health: number
  classId: number
  name: string
  team: string
}

export const Nameplate = (props: NameplateProps) => {
  const { health, classId, name, team } = props

  const character = CLASS_MAP[classId] || 'empty'
  const healthMax = HEALTH_MAP[classId] || 100
  const healthPercent = (health / healthMax) * 100
  const healthColor = ACTOR_TEAM_COLORS(team).healthBar
  const healthCls = []
  if (healthPercent > 100) healthCls.push('buffed')
  if (healthPercent < 40) healthCls.push('low')

  return (
    <>
      <div className="nameplate">
        <div className="name">{name}</div>

        <div className="healthbar">
          <div className="fill" />
          <div className="overbuff" />
        </div>

        <div className="class">
          <div className={`icon ${character}`} />
        </div>
      </div>

      <style jsx>{`
        .nameplate {
          display: flex;
          flex-flow: column nowrap;
          align-items: center;
          font-family: monospace;
          text-align: center;
          pointer-events: none;
          user-select: none;
          bottom: 0;

          .name {
            font-size: 0.9rem;
            line-height: 0.9rem;
            font-weight: bold;
            white-space: nowrap;
            max-width: 10rem;
            text-overflow: ellipsis;
            overflow: hidden;
          }

          .healthbar {
            position: relative;
            width: 80px;
            height: 6px;
            background-color: #8f7b89;
            overflow: hidden;
            margin-bottom: 0.3rem;

            .fill {
              position: absolute;
              top: 0;
              left: 0;
              bottom: 0;
              width: ${healthPercent + '%'};
              background-color: ${healthColor};
            }

            .overbuff {
              position: absolute;
              top: 0;
              left: 0;
              bottom: 0;
              width: ${healthPercent - 100 + '%'};
              background-color: #eeeeee;
            }
          }

          .class {
            border-radius: 50%;
            background-color: ${healthColor};
            border: 3px solid rgba(0, 0, 0, 0.2);

            .icon {
              width: ${CLASS_ICON_SIZE};
              height: ${CLASS_ICON_SIZE};
              background: url(${classIcons});
              background-size: ${CLASS_ICON_SIZE};
              background-position-y: 0;

              &.scout {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -1)`};
              }

              &.soldier {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -2)`};
              }

              &.pyro {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -3)`};
              }

              &.demoman {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -4)`};
              }

              &.heavy {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -5)`};
              }

              &.engineer {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -6)`};
              }

              &.medic {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -7)`};
              }

              &.sniper {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -8)`};
              }

              &.spy {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -9)`};
              }
            }
          }

          .health {
            font-weight: bold;

            &.buffed {
              color: ${ACTOR_TEAM_COLORS(team).healthBuffed};
            }

            &.low {
              color: ${ACTOR_TEAM_COLORS(team).healthLow};
            }
          }
        }
      `}</style>
    </>
  )
}
