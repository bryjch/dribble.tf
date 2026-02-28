import { motion } from 'framer-motion'

import { cn } from '@utils/styling'
import { useIsMobile } from '@utils/hooks'

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

  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <>
        {/* Backdrop */}
        <motion.div
          className="fixed inset-0 z-50 bg-black/50"
          animate={isOpen ? { opacity: 1, pointerEvents: 'auto' as any } : { opacity: 0, pointerEvents: 'none' as any }}
          transition={{ duration: 0.2 }}
          initial={false}
          onClick={onClickClose}
        />

        {/* Bottom sheet */}
        <motion.div
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-pp-panel/95',
            className
          )}
          animate={
            isOpen
              ? { y: 0, display: 'block', transitionEnd: { display: 'block' } }
              : { y: '100%', display: 'block', transitionEnd: { display: 'none' } }
          }
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          initial={false}
          {...otherProps}
        >
          {/* Drag handle */}
          <div className="sticky top-0 z-10 flex justify-center bg-pp-panel/95 pb-2 pt-3">
            <div className="h-1.5 w-12 rounded-full bg-white/30" />
          </div>

          {showCloseButton && (
            <div className="absolute right-3 top-3">
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl opacity-50 transition-all active:opacity-100"
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
      </>
    )
  }

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
  const { children, className, ...otherProps } = props
  const isMobile = useIsMobile()

  return (
    <button
      className={cn(
        'flex items-center justify-center rounded-xl bg-pp-panel/75 transition-all hover:scale-110 hover:invert active:scale-95',
        isMobile ? 'mr-1.5 h-11 w-11' : 'mr-2 h-9 w-9',
        className
      )}
      {...otherProps}
    >
      {children}
    </button>
  )
}
