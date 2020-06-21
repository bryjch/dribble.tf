import React from 'react'

import { CLASS_MAP, HEALTH_MAP } from './Mappings'

const classIcons = require('../assets/class-icons-64.png')

const CLASS_ICON_SIZE = '1.2rem'
const HEALTH_BUFFED_COLOR = '#6ed6ff'
const HEALTH_LOW_COLOR = '#ff6262'

export const Nameplate = React.forwardRef((props, ref) => {
  const healthCls = []
  if (props.health / HEALTH_MAP[props.classId] > 1) healthCls.push('buffed')
  if (props.health / HEALTH_MAP[props.classId] < 0.4) healthCls.push('low')

  return (
    <>
      <div className="nameplate" ref={ref}>
        <div className="name">{props.user.name}</div>

        <div className="panel">
          <div className="class">
            <div className={`icon ${CLASS_MAP[props.classId]}`} />
          </div>
          <div className={`health ${healthCls.join(' ')}`}>{props.health}</div>
        </div>
      </div>

      <style jsx>{`
        .nameplate {
          display: flex;
          flex-flow: column nowrap;
          align-items: center;
          font-family: monospace;

          .name {
            font-size: 0.9rem;
            line-height: 0.9rem;
            color: #222222;
          }

          .panel {
            display: flex;
            flex-flow: row nowrap;
            justify-content: center;
            background-color: rgba(0, 0, 0, 0.7);
            color: #ffffff;
            padding: 0.2rem 0.3rem;
            border-radius: 3px;
          }

          .class {
            font-size: 1.2rem;
            line-height: 1.2rem;
            margin-right: 0.2rem;

            .icon {
              width: ${CLASS_ICON_SIZE};
              height: ${CLASS_ICON_SIZE};
              background: url(${classIcons});
              background-size: ${CLASS_ICON_SIZE};

              &.empty {
                width: 0;
                height: 0;
              }

              &.scout {
                background-position-y: 0px;
              }

              &.soldier {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -1)`};
              }

              &.pyro {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -2)`};
              }

              &.demoman {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -3)`};
              }

              &.heavy {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -4)`};
              }

              &.engineer {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -5)`};
              }

              &.medic {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -6)`};
              }

              &.sniper {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -7)`};
              }

              &.spy {
                background-position-y: ${`calc(${CLASS_ICON_SIZE} * -8)`};
              }
            }
          }

          .health {
            &.buffed {
              color: ${HEALTH_BUFFED_COLOR};
            }

            &.low {
              color: ${HEALTH_LOW_COLOR};
            }
          }
        }
      `}</style>
    </>
  )
})
