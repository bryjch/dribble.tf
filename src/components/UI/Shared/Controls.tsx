import { useRef, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'

import { cn } from '@utils/styling'

//
// ─── CONTROLS ───────────────────────────────────────────────────────────────────
//
// The small set of controls every panel shares, so each theme restyles them in one place
// (.ui-switch, .ui-seg, .ui-tooltip in src/theme/base.css).
//

export const Switch = ({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  label?: string
}) => (
  <button
    type="button"
    role="switch"
    className="ui-switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  />
)

export interface SegmentedOption<T> {
  label: React.ReactNode
  value: T
  icon?: React.ReactNode
}

export const Segmented = <T extends string | number>({
  options,
  value,
  onChange,
  className,
  label,
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  label?: string
}) => (
  <div className={cn('ui-seg', className)} role="radiogroup" aria-label={label}>
    {options.map(option => (
      <button
        key={String(option.value)}
        type="button"
        role="radio"
        aria-checked={option.value === value}
        className="ui-seg__item"
        data-active={option.value === value}
        onClick={() => onChange(option.value)}
      >
        {option.icon}
        {option.label}
      </button>
    ))}
  </div>
)

/**
 * A themed tooltip. Radix doesn't open tooltips on touch, so `tapToOpen` lets a tap toggle it
 * (https://github.com/radix-ui/primitives/issues/1573).
 *
 * `tapToOpen` is also for tooltips with controls in them (a field, buttons): a click on the
 * trigger, or any press inside the tooltip, pins it open, and it stays until a click outside it,
 * Escape or another click on the trigger. Radix closes a tooltip whenever its trigger loses focus
 * or the pointer leaves, which would shut it the moment its own field is clicked.
 */
export const HudTooltip = ({
  content,
  children,
  side = 'top',
  tapToOpen,
}: {
  content: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  tapToOpen?: boolean
}) => {
  const [open, setOpen] = useState(false)
  // A ref, not state: Radix asks to close in the same event that unpins it (Escape, a click
  // outside), after the unpin, and must see it at once.
  const pinned = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const setPinned = (next: boolean) => {
    pinned.current = next
    setOpen(next)
  }

  const root = tapToOpen
    ? {
        open,
        // Hover still opens and closes it as usual; only a pinned one ignores Radix's closes.
        onOpenChange: (next: boolean) => {
          if (!next && pinned.current) return
          setOpen(next)
        },
      }
    : {}
  const trigger = tapToOpen ? { ref: triggerRef, onClick: () => setPinned(!pinned.current) } : {}
  const contentProps = tapToOpen
    ? {
        onPointerDownCapture: () => (pinned.current = true),
        onFocusCapture: () => (pinned.current = true),
        onEscapeKeyDown: () => (pinned.current = false),
        onPointerDownOutside: (event: Event) => {
          // The trigger's own click toggles it.
          if (triggerRef.current?.contains(event.target as Node)) return event.preventDefault()
          pinned.current = false
        },
      }
    : {}

  return (
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root {...root}>
        <Tooltip.Trigger asChild {...trigger}>
          {children}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side={side} sideOffset={6} className="ui-root" {...contentProps}>
            <div className="ui-tooltip">{content}</div>
            <Tooltip.Arrow className="ui-tooltip__arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
