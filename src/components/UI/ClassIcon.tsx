import React from 'react'

import { CLASS_MAP } from '@constants/mappings'

const classIcons = require('@assets/class-icons-64.png')

export interface ClassIconProps {
  classId: number
  size?: string | number | undefined
}

export const ClassIcon = (props: ClassIconProps) => {
  const { classId, size } = props

  const className = CLASS_MAP[classId] || 'empty'
  const classIconSize =
    typeof size === 'string' ? size : typeof size === 'number' ? `${size}px` : '1.5rem'

  return (
    <>
      <div className={`class-icon ${className}`} />

      <style jsx>{`
        .class-icon {
          width: ${classIconSize};
          height: ${classIconSize};
          background: url(${classIcons});
          background-size: ${classIconSize};
          background-position-y: 0;

          &.scout {
            background-position-y: ${`calc(${classIconSize} * -1)`};
          }

          &.soldier {
            background-position-y: ${`calc(${classIconSize} * -2)`};
          }

          &.pyro {
            background-position-y: ${`calc(${classIconSize} * -3)`};
          }

          &.demoman {
            background-position-y: ${`calc(${classIconSize} * -4)`};
          }

          &.heavy {
            background-position-y: ${`calc(${classIconSize} * -5)`};
          }

          &.engineer {
            background-position-y: ${`calc(${classIconSize} * -6)`};
          }

          &.medic {
            background-position-y: ${`calc(${classIconSize} * -7)`};
          }

          &.sniper {
            background-position-y: ${`calc(${classIconSize} * -8)`};
          }

          &.spy {
            background-position-y: ${`calc(${classIconSize} * -9)`};
          }
        }
      `}</style>
    </>
  )
}
