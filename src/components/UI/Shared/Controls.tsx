import { useState } from 'react'
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
  const root = tapToOpen ? { open, onOpenChange: setOpen } : {}
  const trigger = tapToOpen
    ? {
        onClick: () => setOpen(prev => !prev),
        onFocus: () => setTimeout(() => setOpen(true), 0),
        onBlur: () => setOpen(false),
      }
    : {}

  return (
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root {...root}>
        <Tooltip.Trigger asChild {...trigger}>
          {children}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side={side} sideOffset={6} className="ui-root">
            <div className="ui-tooltip">{content}</div>
            <Tooltip.Arrow className="ui-tooltip__arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
