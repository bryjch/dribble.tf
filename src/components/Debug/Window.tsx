import { useRef, useState } from 'react'

import { cn } from '@utils/styling'

import { ink } from './controls'

/**
 * A debug window: dragged by its title bar, folded to it by the arrow. It starts against the
 * left or right edge; once dragged it stays where it was put (until the page reloads). It never
 * reaches past the playback bar.
 */
export const Window = ({
  title,
  side,
  offset,
  width,
  right,
  children,
}: {
  title: React.ReactNode
  side: 'left' | 'right'
  /** From the window's edge and the top, in px. */
  offset: { x: number; y: number }
  width: number
  right?: React.ReactNode
  children: React.ReactNode
}) => {
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null)
  const [open, setOpen] = useState(true)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const top = placed?.top ?? offset.y
  const position: React.CSSProperties = placed
    ? { left: placed.left, top: placed.top }
    : { [side]: offset.x, top: offset.y }

  return (
    <div
      className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-[3px] border border-white/15 bg-[#121418]/95 font-mono text-[11px] text-[#d8dde6] shadow-[0_8px_30px_rgba(0,0,0,0.55)]"
      style={{
        ...position,
        width,
        maxWidth: 'calc(100vw - 1rem)',
        maxHeight: `calc(100dvh - ${top}px - var(--ui-dock-clearance, 0px) - 1rem)`,
      }}
    >
      <div
        className="flex cursor-move touch-none select-none items-center gap-1.5 border-b border-white/10 bg-[#1d2129] px-1.5 py-1"
        onPointerDown={event => {
          if ((event.target as HTMLElement).closest('button')) return
          const rect = event.currentTarget.parentElement!.getBoundingClientRect()
          drag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={event => {
          if (!drag.current) return
          setPlaced({
            left: Math.min(window.innerWidth - 80, Math.max(0, event.clientX - drag.current.dx)),
            top: Math.min(window.innerHeight - 40, Math.max(0, event.clientY - drag.current.dy)),
          })
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <button
          type="button"
          className={cn('w-3', ink.muted)}
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Fold' : 'Unfold'}
        >
          {open ? '▾' : '▸'}
        </button>
        <span className="min-w-0 flex-1 truncate font-semibold uppercase tracking-wider text-[#aab3c2]">
          {title}
        </span>
        {right}
      </div>
      {open && <div className="min-h-0 overflow-y-auto overscroll-contain p-1.5">{children}</div>}
    </div>
  )
}
