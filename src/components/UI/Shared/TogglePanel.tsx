import { motion } from 'framer-motion'

import { cn } from '@utils/styling'

export interface TogglePanelProps {
  isOpen: boolean
  showCloseButton?: boolean
  onClickClose?: () => void
  className?: string
  [key: string]: any
}

export const TogglePanel = (props: TogglePanelProps) => {
  const {
    isOpen = false,
    showCloseButton = false,
    onClickClose,
    children,
    className,
    ...otherProps
  } = props

  return (
    <motion.div
      animate={
        isOpen
          ? { display: 'block', opacity: 1, x: 0, transitionEnd: { display: 'block' } }
          : { display: 'block', opacity: 0, x: -10, transitionEnd: { display: 'none' } }
      }
      transition={{ duration: 0.2 }}
      initial={false}
      className={cn('relative max-w-full overflow-hidden rounded-3xl bg-pp-panel/80', className)}
      {...otherProps}
    >
      {showCloseButton && (
        <div className="absolute right-3 top-3">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-2xl opacity-50 transition-all hover:opacity-100"
            onClick={onClickClose}
          >
            <svg
              className="h-6 w-6"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {children}
    </motion.div>
  )
}

export type TogglePanelButtonProps = {
  children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>

export const TogglePanelButton = (props: TogglePanelButtonProps) => {
  const { children, ...otherProps } = props

  return (
    <button
      className="mr-2 flex h-9 w-9 items-center justify-center rounded-xl bg-pp-panel/75 transition-all hover:scale-110 hover:invert"
      {...otherProps}
    >
      {children}
    </button>
  )
}
