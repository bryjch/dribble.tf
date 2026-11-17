import { useEffect, useRef, useState } from 'react'

import { cn } from '@utils/styling'

import { useDebug } from './session'

//
// ─── CONTROLS ───────────────────────────────────────────────────────────────────
//
// The debug panel's dense controls: a tool for testing the viewer, styled as one (small mono
// type, tight rows), apart from the viewer's own themed interface.
//

export const ink = {
  muted: 'text-[#8b93a3]',
  faint: 'text-[#6c7485]',
  accent: '#e8b54a',
}

export const Btn = ({
  children,
  onClick,
  active,
  title,
  disabled,
  className,
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  title?: string
  disabled?: boolean
  className?: string
}) => (
  <button
    type="button"
    title={title}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'rounded-[2px] border px-1.5 py-[1px] leading-tight disabled:opacity-40',
      active ? 'border-[#e8b54a] bg-[#e8b54a] text-black' : 'border-white/15 hover:border-white/40',
      className
    )}
  >
    {children}
  </button>
)

/** A number that changes by dragging its label sideways (Shift: finer); click it to type. */
export const Scrub = ({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
}) => {
  const start = useRef<{ x: number; v: number } | null>(null)
  const [text, setText] = useState(String(Math.round(value)))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setText(String(Math.round(value)))
  }, [value, editing])
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  return (
    <label className="flex min-w-0 items-center rounded-[2px] bg-white/[0.06]">
      <span
        className={cn('cursor-ew-resize touch-none select-none whitespace-nowrap px-1', ink.muted)}
        onPointerDown={event => {
          start.current = { x: event.clientX, v: value }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={event => {
          if (!start.current) return
          const scale = event.shiftKey ? 0.1 : 0.5
          onChange(
            clamp(Math.round(start.current.v + (event.clientX - start.current.x) * step * scale))
          )
        }}
        onPointerUp={() => (start.current = null)}
      >
        {label}
      </span>
      <input
        inputMode="decimal"
        className="w-full min-w-0 bg-transparent px-1 py-[1px] text-right tabular-nums outline-none focus:bg-white/10"
        value={text}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={event => {
          setText(event.target.value)
          const v = Number(event.target.value)
          if (event.target.value.trim() !== '' && Number.isFinite(v)) onChange(clamp(v))
        }}
      />
    </label>
  )
}

/** A labelled row. `top` keeps the label on the first line when what it labels runs to several. */
export const Prop = ({
  label,
  children,
  top,
}: {
  label: string
  children: React.ReactNode
  top?: boolean
}) => (
  <div
    className={cn(
      'grid grid-cols-[5.25rem_1fr] gap-1 py-[2px]',
      top ? 'items-start' : 'items-center'
    )}
  >
    <span className={cn('truncate', ink.muted, top && 'leading-[18px]')}>{label}</span>
    <div className="flex min-w-0 flex-wrap items-center gap-1">{children}</div>
  </div>
)

/** A titled block that folds; which are folded is remembered while the page is open. */
const openGroups = new Map<string, boolean>()
export const Group = ({
  title,
  children,
  right,
  startFolded,
  forceOpen,
}: {
  title: string
  children: React.ReactNode
  right?: React.ReactNode
  startFolded?: boolean
  /** Opens it (while something is being added to it, say). */
  forceOpen?: boolean
}) => {
  const [open, setOpen] = useState(() => openGroups.get(title) ?? !startFolded)
  // Adding to a folded section unfolds it for good, so what was added shows.
  useEffect(() => {
    if (forceOpen && !open) {
      openGroups.set(title, true)
      setOpen(true)
    }
  }, [forceOpen, open, title])
  const toggle = () => {
    openGroups.set(title, !open)
    setOpen(!open)
  }
  return (
    <div className="mt-3 border-t border-white/10 pt-2 first:mt-0 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex items-center gap-1">
        <button
          type="button"
          onClick={toggle}
          className={cn(
            'flex flex-1 items-center gap-1 text-left text-[10px] uppercase tracking-wider',
            ink.faint
          )}
        >
          <span className="w-2">{open || forceOpen ? '▾' : '▸'}</span>
          {title}
        </button>
        {right}
      </div>
      {(open || forceOpen) && children}
    </div>
  )
}

export const Select = <T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
  title,
}: {
  value: T
  options: readonly { value: T; label: string; group?: string; disabled?: boolean }[]
  onChange: (value: T) => void
  label?: string
  className?: string
  title?: string
}) => {
  const groups = [...new Set(options.map(o => o.group ?? ''))]
  const render = (list: typeof options) =>
    list.map(o => (
      <option
        key={String(o.value)}
        value={String(o.value)}
        disabled={o.disabled}
        className="bg-[#121418]"
      >
        {o.label}
      </option>
    ))
  return (
    <select
      aria-label={label}
      title={title}
      value={String(value)}
      onChange={event => {
        const option = options.find(o => String(o.value) === event.target.value)
        if (option) onChange(option.value)
      }}
      className={cn(
        'min-w-0 cursor-pointer rounded-[2px] bg-white/[0.06] px-1 py-[1px] outline-none focus:bg-white/10',
        className
      )}
    >
      {groups.length > 1
        ? groups.map(group => (
            <optgroup key={group} label={group} className="bg-[#121418]">
              {render(options.filter(o => (o.group ?? '') === group))}
            </optgroup>
          ))
        : render(options)}
    </select>
  )
}

export const TextInput = ({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (value: string) => void
  label?: string
}) => (
  <input
    aria-label={label}
    className="w-full min-w-0 rounded-[2px] bg-white/[0.06] px-1 py-[1px] outline-none focus:bg-white/10"
    value={value}
    onChange={event => onChange(event.target.value)}
  />
)

export const Toggle = ({
  on,
  onChange,
  children,
  title,
}: {
  on: boolean
  onChange: (on: boolean) => void
  children: React.ReactNode
  title?: string
}) => (
  <Btn active={on} onClick={() => onChange(!on)} title={title}>
    {children}
  </Btn>
)

export const Note = ({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'bad' }) => (
  <div
    className={cn(
      'py-[2px] leading-snug',
      tone === 'warn' ? 'text-[#e8b54a]' : tone === 'bad' ? 'text-[#ff5b6b]' : ink.faint
    )}
  >
    {children}
  </div>
)

/**
 * An explanation under a control, shown only while help is on (the ? in a window's title bar),
 * so the panel stays quiet; `short` stands in for it otherwise, if given.
 */
export const Explain = ({
  children,
  short,
  tone,
}: {
  children: React.ReactNode
  short?: React.ReactNode
  tone?: 'warn' | 'bad'
}) => {
  const help = useDebug(s => s.help)
  if (help) return <Note tone={tone}>{children}</Note>
  return short ? <Note tone={tone}>{short}</Note> : null
}

/** A short tag on a control's row, such as what a rig is made of. */
export const Tag = ({
  children,
  tone,
  title,
}: {
  children: React.ReactNode
  tone?: 'warn' | 'bad' | 'good'
  title?: string
}) => (
  <span
    title={title}
    className={cn(
      'shrink-0 whitespace-nowrap rounded-[2px] border px-1 text-[10px] leading-[14px]',
      tone === 'warn'
        ? 'border-[#e8b54a]/50 text-[#e8b54a]'
        : tone === 'bad'
          ? 'border-[#ff5b6b]/50 text-[#ff5b6b]'
          : tone === 'good'
            ? 'border-[#57d68d]/50 text-[#57d68d]'
            : 'border-white/20 text-[#8b93a3]'
    )}
  >
    {children}
  </span>
)

/** The ? in a window's title bar: shows or hides the explanations. */
export const HelpToggle = () => {
  const help = useDebug(s => s.help)
  return (
    <button
      type="button"
      title={help ? 'Hide explanations' : 'Show explanations'}
      onClick={() => useDebug.setState({ help: !help })}
      className={cn(
        'h-4 w-4 shrink-0 rounded-full border text-[10px] leading-none',
        help
          ? 'border-[#e8b54a] bg-[#e8b54a] text-black'
          : 'border-white/30 text-[#8b93a3] hover:text-white'
      )}
    >
      ?
    </button>
  )
}
