import { CLASS_ORDER_MAP } from '@constants/mappings'

import classIcons from '@assets/class_icons_64.png'

export interface ClassIconProps {
  classId: number
  size?: string | number | undefined
}

export const ClassIcon = (props: ClassIconProps) => {
  const { classId, size } = props

  const classIndex = CLASS_ORDER_MAP[classId]
  const classIconSize =
    typeof size === 'string' ? size : typeof size === 'number' ? `${size}px` : '1.5rem'

  return (
    <>
      <div
        style={{
          width: classIconSize,
          height: classIconSize,
          background: `url(${classIcons})`,
          backgroundSize: classIconSize,
          backgroundPositionY: `calc(${classIconSize} * ${classIndex * -1})`,
        }}
      />
    </>
  )
}
