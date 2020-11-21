import React from 'react'
import { motion } from 'framer-motion'

export interface TogglePanelProps {
  isOpen: boolean
  [key: string]: any
}

export const TogglePanel = (props: TogglePanelProps) => {
  const { isOpen = false, children, ...otherProps } = props

  return (
    <motion.div
      animate={
        isOpen
          ? { display: 'block', opacity: 1, x: 0, transitionEnd: { display: 'block' } }
          : { display: 'block', opacity: 0, x: -10, transitionEnd: { display: 'none' } }
      }
      transition={{ duration: 0.2 }}
      initial={false}
      {...otherProps}
    >
      {children}
    </motion.div>
  )
}
