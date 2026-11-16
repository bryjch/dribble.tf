import { motion } from 'framer-motion'

import { HudTooltip } from '@components/UI/Shared/Controls'
import { cn } from '@utils/styling'
import { useIsMobile } from '@utils/hooks'

//
// ─── PANEL ──────────────────────────────────────────────────────────────────────
//
// A side panel opened from the toolbar: anchored beside the toolbar on desktop, a bottom
// sheet on phones. Styled entirely by the .ui-panel / .ui-sheet hooks in src/theme/base.css.
//

export interface TogglePanelProps {
  isOpen: boolean
  title?: React.ReactNode
  /** Shown after the title, e.g. a count. */
  count?: React.ReactNode
  /** Right side of the header, before the close button. */
  actions?: React.ReactNode
  /** Under the title, outside the scrolling body: tabs, say. */
  subheader?: React.ReactNode
  showCloseButton?: boolean
  onClickClose?: () => void
  className?: string
  bodyClassName?: string
  children?: React.ReactNode
}

const CloseButton = ({ onClick }: { onClick?: () => void }) => (
  <button type="button" className="ui-close-btn" onClick={onClick} aria-label="Close panel">
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
    </svg>
  </button>
)

const PanelHeader = ({
  title,
  count,
  actions,
  showCloseButton,
  onClickClose,
}: Pick<TogglePanelProps, 'title' | 'count' | 'actions' | 'showCloseButton' | 'onClickClose'>) => {
  if (!title && !showCloseButton) return null
  return (
    <div className="ui-panel__header">
      <div className="ui-panel__title">
        {title}
        {count != null && <span className="ui-panel__count">{count}</span>}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {showCloseButton && <CloseButton onClick={onClickClose} />}
      </div>
    </div>
  )
}

export const TogglePanel = (props: TogglePanelProps) => {
  const {
    isOpen = false,
    title,
    count,
    actions,
    subheader,
    showCloseButton = false,
    onClickClose,
    children,
    className,
    bodyClassName,
  } = props

  const isMobile = useIsMobile()
  const header = (
    <>
      <PanelHeader
        title={title}
        count={count}
        actions={actions}
        showCloseButton={showCloseButton}
        onClickClose={onClickClose}
      />
      {subheader && <div className="ui-panel__subheader">{subheader}</div>}
    </>
  )

  if (isMobile) {
    return (
      <>
        <motion.div
          className="ui-backdrop"
          animate={isOpen ? { opacity: 1, pointerEvents: 'auto' as any } : { opacity: 0, pointerEvents: 'none' as any }}
          transition={{ duration: 0.2 }}
          initial={false}
          onClick={onClickClose}
        />

        <motion.div
          className={cn('ui-sheet ui-scroll', className)}
          role="dialog"
          animate={
            isOpen
              ? { y: 0, display: 'block', transitionEnd: { display: 'block' } }
              : { y: '100%', display: 'block', transitionEnd: { display: 'none' } }
          }
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          initial={false}
        >
          <div className="sticky top-0 z-10 flex justify-center pb-1 pt-3">
            <div className="ui-sheet__handle" />
          </div>
          {header}
          <div className={cn('ui-panel__body', bodyClassName)}>{children}</div>
        </motion.div>
      </>
    )
  }

  return (
    <motion.div
      role="dialog"
      aria-hidden={!isOpen}
      animate={
        isOpen
          ? { display: 'flex', opacity: 1, x: 0, transitionEnd: { display: 'flex' } }
          : { display: 'flex', opacity: 0, x: -8, transitionEnd: { display: 'none' } }
      }
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      initial={false}
      className={cn('ui-panel', className)}
    >
      {header}
      <div className={cn('ui-panel__body ui-scroll', bodyClassName)}>{children}</div>
    </motion.div>
  )
}

//
// ─── TOOLBAR BUTTON ─────────────────────────────────────────────────────────────
//

export type TogglePanelButtonProps = {
  children: React.ReactNode
  /** The panel this button opens is open. */
  active?: boolean
  /** Accessible name, also shown as the hover tooltip (not on phones). */
  label: string
  /** Where the tooltip opens: right of the toolbar on the left, left of a button on the right. */
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
} & React.ButtonHTMLAttributes<HTMLButtonElement>

export const TogglePanelButton = (props: TogglePanelButtonProps) => {
  const { children, className, active, label, tooltipSide = 'right', ...otherProps } = props
  const isMobile = useIsMobile()

  const button = (
    <button
      type="button"
      className={cn('ui-toolbar-btn', isMobile && 'h-11 w-11', className)}
      data-active={active ? 'true' : undefined}
      aria-pressed={active}
      aria-label={label}
      {...otherProps}
    >
      {children}
    </button>
  )
  return isMobile ? (
    button
  ) : (
    <HudTooltip content={label} side={tooltipSide}>
      {button}
    </HudTooltip>
  )
}
