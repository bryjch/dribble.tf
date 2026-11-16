import { useEffect, useMemo, useRef, useState } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { Drawer } from 'vaul'
import { motion } from 'framer-motion'

import type { MatchSource } from '@components/Analyse/Data/MatchSource'
import { PLAYBACK_SPEED_OPTIONS } from '@components/UI/PlaybackPanel'
import {
  AiFillFastForwardIcon,
  BsBookmarkFillIcon,
  BsBookmarkIcon,
  IoMdPauseIcon,
  IoMdPlayIcon,
} from '@components/Misc/Icons'
import { ControlsMode } from '@constants/types'

import { useInstance, useStore, getState } from '@zus/store'
import {
  changeControlsModeAction,
  changePlaySpeedAction,
  goToTickAction,
  jumpToRtsCamera,
  jumpToSpectatorCamera,
  toggleBookmarkAction,
  togglePlaybackAction,
} from '@zus/actions'
import { getDurationFromTicks } from '@utils/parser'
import { cn } from '@utils/styling'

//
// ─── SEEKING ────────────────────────────────────────────────────────────────────
//

/** Seconds a double-tap or a seek button moves: 50 ticks (under a second) is nothing on a phone. */
export const MOBILE_SEEK_SECONDS = 5

export const seekBySeconds = (seconds: number) => {
  const match = useInstance.getState().match
  const interval = match?.intervalPerTick ?? 0.015
  goToTickAction(getState().playback.tick + Math.round(seconds / interval))
}

//
// ─── SHEET ──────────────────────────────────────────────────────────────────────
//
// Vaul: a real bottom sheet, dragged by its body, with momentum, snap points and drag to dismiss.
//

type SheetProps = {
  open: boolean
  onOpenChange?: (open: boolean) => void
  title: string
  /** Shown under the handle, above the scrolling body (tabs, a title row). */
  header?: React.ReactNode
  children?: React.ReactNode
  modal?: boolean
  dismissible?: boolean
  snapPoints?: (number | string)[]
  activeSnapPoint?: number | string | null
  setActiveSnapPoint?: (snap: number | string | null) => void
  className?: string
  /** Height the body may scroll in; the content is full height when snap points are used. */
  bodyStyle?: React.CSSProperties
}

export const Sheet = ({
  open,
  onOpenChange,
  title,
  header,
  children,
  modal = true,
  dismissible = true,
  snapPoints,
  activeSnapPoint,
  setActiveSnapPoint,
  className,
  bodyStyle,
}: SheetProps) => (
  <Drawer.Root
    open={open}
    onOpenChange={onOpenChange}
    modal={modal}
    dismissible={dismissible}
    snapPoints={snapPoints}
    activeSnapPoint={activeSnapPoint}
    setActiveSnapPoint={setActiveSnapPoint}
    snapToSequentialPoint={!!snapPoints}
    noBodyStyles
  >
    <Drawer.Portal>
      {modal && <Drawer.Overlay className="m-sheet-overlay" />}
      <Drawer.Content
        className={cn('m-sheet', snapPoints && 'm-sheet--snapping', className)}
        aria-describedby={undefined}
        onOpenAutoFocus={event => event.preventDefault()}
      >
        <div className="m-sheet__grip" aria-hidden>
          <div className="m-sheet__handle" />
        </div>
        <Drawer.Title className="sr-only">{title}</Drawer.Title>
        {header}
        <div className="m-sheet__body" style={bodyStyle}>
          {children}
        </div>
      </Drawer.Content>
    </Drawer.Portal>
  </Drawer.Root>
)

/**
 * The desktop panels' contents are sized in rem, and a phone's root font is 8px (index.scss):
 * scale them back up the way the old sheets did (--ui-sheet-zoom, which a px-sized theme sets to 1).
 */
export const RemZoom = ({ children, force }: { children: React.ReactNode; force?: boolean }) => {
  useStore(state => state.settings.ui.theme) // re-read the theme's zoom when it changes
  const root = document.documentElement
  const rootPx = parseFloat(getComputedStyle(root).fontSize)
  const themeZoom = parseFloat(getComputedStyle(root).getPropertyValue('--ui-sheet-zoom')) || 1.5
  // force: contents sized in rem under every theme (the events list), so a px theme's 1 won't do.
  const zoom = rootPx >= 10 ? 1 : force ? 12 / rootPx : themeZoom
  return <div style={{ zoom }}>{children}</div>
}

/** dribble.tf's name and logo, atop a sheet, as the desktop About panel's title is. */
export const SheetBrand = () => (
  <div className="m-sheet__brand ui-about-title">
    <img src="/logo192.png" alt="" className="ui-about-title__logo" />
    dribble.tf
  </div>
)

export type SheetTab = { id: string; label: string }

export const SheetTabs = ({
  tabs,
  value,
  onChange,
}: {
  tabs: SheetTab[]
  value: string
  onChange: (id: string) => void
}) => (
  <div className="m-tabs" role="tablist">
    {tabs.map(tab => (
      <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={tab.id === value}
        className="m-tabs__tab"
        data-active={tab.id === value ? 'true' : undefined}
        onClick={() => onChange(tab.id)}
      >
        {tab.label}
      </button>
    ))}
  </div>
)

//
// ─── BUTTONS ────────────────────────────────────────────────────────────────────
//

type IconButtonProps = {
  label: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'solid' | 'ghost' | 'accent'
  active?: boolean
  children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>

export const IconButton = ({
  label,
  size = 'md',
  variant = 'solid',
  active,
  children,
  className,
  ...rest
}: IconButtonProps) => (
  <button
    type="button"
    className={cn('m-btn', className)}
    data-size={size}
    data-variant={variant}
    data-active={active ? 'true' : undefined}
    aria-label={label}
    aria-pressed={active}
    {...rest}
  >
    {children}
  </button>
)

export const PlayButton = ({
  size = 'lg',
  variant,
}: {
  size?: IconButtonProps['size']
  variant?: IconButtonProps['variant']
}) => {
  const playing = useStore(state => state.playback.playing)
  return (
    <IconButton
      label={playing ? 'Pause' : 'Play'}
      size={size}
      variant={variant ?? 'accent'}
      onClick={() => togglePlaybackAction()}
    >
      {playing ? <IoMdPauseIcon /> : <IoMdPlayIcon />}
    </IconButton>
  )
}

export const SeekButton = ({
  direction,
  size = 'md',
  variant = 'ghost',
}: {
  direction: -1 | 1
  size?: IconButtonProps['size']
  variant?: IconButtonProps['variant']
}) => (
  <IconButton
    label={
      direction < 0
        ? `Back ${MOBILE_SEEK_SECONDS} seconds`
        : `Forward ${MOBILE_SEEK_SECONDS} seconds`
    }
    size={size}
    variant={variant}
    onClick={() => seekBySeconds(direction * MOBILE_SEEK_SECONDS)}
  >
    <span className="m-seek-icon">
      <AiFillFastForwardIcon className={direction < 0 ? 'rotate-180' : ''} />
      <span>{MOBILE_SEEK_SECONDS}</span>
    </span>
  </IconButton>
)

export const BookmarkButton = ({
  size = 'md',
  variant = 'ghost',
}: {
  size?: IconButtonProps['size']
  variant?: IconButtonProps['variant']
}) => {
  const tick = useStore(state => state.playback.tick)
  const bookmarked = useStore(state => state.bookmarks.includes(tick))
  return (
    <IconButton
      label={bookmarked ? 'Remove bookmark' : 'Bookmark this moment'}
      size={size}
      variant={variant}
      active={bookmarked}
      onClick={() => toggleBookmarkAction()}
    >
      {bookmarked ? <BsBookmarkFillIcon /> : <BsBookmarkIcon />}
    </IconButton>
  )
}

const SPEEDS = PLAYBACK_SPEED_OPTIONS.map(option => option.value)
  .filter(value => value >= 0.5)
  .sort((a, b) => a - b)

/** One tap steps through 0.5×, 1×, 2×, 3×. */
export const SpeedButton = ({
  size = 'md',
  variant = 'ghost',
}: {
  size?: IconButtonProps['size']
  variant?: IconButtonProps['variant']
}) => {
  const speed = useStore(state => state.playback.speed)
  const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1
  return (
    <IconButton
      label={`Playback speed ${speed}×, tap for ${next}×`}
      size={size}
      variant={variant}
      onClick={() => changePlaySpeedAction(next)}
    >
      <span className="m-speed">{speed}×</span>
    </IconButton>
  )
}

//
// ─── CAMERA ─────────────────────────────────────────────────────────────────────
//

const CAMERA_MODES = [
  { mode: ControlsMode.RTS, label: 'Orbit' },
  { mode: ControlsMode.POV, label: 'POV' },
  { mode: ControlsMode.SPECTATOR, label: 'Free' },
]

export const setCameraMode = (mode: ControlsMode) => {
  if (mode === ControlsMode.RTS) return jumpToRtsCamera()
  if (mode === ControlsMode.SPECTATOR) return jumpToSpectatorCamera()
  return changeControlsModeAction(ControlsMode.POV)
}

export const CameraSwitch = ({ className }: { className?: string }) => {
  const mode = useStore(state => state.scene.controls.mode)
  return (
    <div className={cn('m-seg', className)} role="radiogroup" aria-label="Camera">
      {CAMERA_MODES.map(option => (
        <button
          key={option.mode}
          type="button"
          role="radio"
          aria-checked={mode === option.mode}
          className="m-seg__item"
          data-active={mode === option.mode ? 'true' : undefined}
          onClick={() => setCameraMode(option.mode)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** One button that steps through the cameras, labelled with the current one. */
export const CameraCycleButton = ({ size = 'md' }: { size?: IconButtonProps['size'] }) => {
  const mode = useStore(state => state.scene.controls.mode)
  const index = CAMERA_MODES.findIndex(option => option.mode === mode)
  const next = CAMERA_MODES[(index + 1) % CAMERA_MODES.length]
  return (
    <IconButton
      label={`Camera: ${CAMERA_MODES[index]?.label}. Tap for ${next.label}`}
      size={size}
      variant="solid"
      onClick={() => setCameraMode(next.mode)}
    >
      <span className="m-camera-chip">
        <CameraGlyph />
        <span>{CAMERA_MODES[index]?.label}</span>
      </span>
    </IconButton>
  )
}

const CameraGlyph = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden
  >
    <path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <circle cx="12" cy="12.5" r="3.5" />
  </svg>
)

//
// ─── SCRUBBER ───────────────────────────────────────────────────────────────────
//

const useRounds = (match: MatchSource | undefined) =>
  useMemo(() => {
    if (!match) return []
    const starts = match.roundStarts()
    return (starts.length ? starts : [1]).map(start => {
      const end = match.rounds.find(round => round.endTick > start)
      return { tick: start, winner: end?.winner || 'none' }
    })
  }, [match, match?.revision])

const useKillMarks = (match: MatchSource | undefined) =>
  useMemo(() => {
    if (!match) return []
    const marks: { tick: number; team: string }[] = []
    for (const key in match.deaths) {
      for (const death of match.deaths[key]) {
        marks.push({
          tick: Number(key),
          team: death.killer && death.killer !== death.victim ? death.killer.user.team : 'none',
        })
      }
    }
    return marks
  }, [match, match?.revision])

/**
 * The timeline, sized for a thumb: a tall invisible hit area around a thin track that thickens
 * while dragged, with the time over the thumb.
 */
export const Scrubber = ({ className }: { className?: string }) => {
  const match = useInstance(state => state.match)
  const tick = useStore(state => state.playback.tick)
  const maxTicks = useStore(state => state.playback.maxTicks)
  const bookmarks = useStore(state => state.bookmarks)
  const [dragTick, setDragTick] = useState<number | null>(null)
  const rounds = useRounds(match)
  const kills = useKillMarks(match)

  const shown = dragTick ?? tick
  const pct = (t: number) => (Math.max(0, t - 1) / Math.max(1, maxTicks - 1)) * 100

  return (
    <div className={cn('m-scrub', className)} data-dragging={dragTick != null ? 'true' : undefined}>
      <Slider.Root
        className="m-scrub__root"
        min={1}
        max={Math.max(2, maxTicks)}
        step={1}
        value={[shown]}
        aria-label="Timeline"
        onValueChange={([value]) => {
          setDragTick(value)
          goToTickAction(value)
        }}
        onValueCommit={() => setDragTick(null)}
      >
        <Slider.Track className="m-scrub__track">
          {rounds.map((round, index) => {
            const from = index === 0 ? 0 : pct(round.tick)
            const to = pct(rounds[index + 1]?.tick ?? maxTicks)
            return (
              <span
                key={index}
                className="m-scrub__round"
                data-winner={round.winner}
                style={{ left: `${from}%`, width: `${to - from}%` }}
              />
            )
          })}
          <Slider.Range className="m-scrub__range" />
          {kills.map((mark, index) => (
            <span
              key={index}
              className="m-scrub__kill"
              data-team={mark.team}
              style={{ left: `${pct(mark.tick)}%` }}
            />
          ))}
          {bookmarks.map(bookmark => (
            <span
              key={bookmark}
              className="m-scrub__bookmark"
              style={{ left: `${pct(bookmark)}%` }}
            />
          ))}
        </Slider.Track>
        <Slider.Thumb className="m-scrub__thumb" aria-label="Playhead" />
      </Slider.Root>

      {dragTick != null && (
        <div
          className="m-scrub__bubble"
          style={{ left: `clamp(28px, ${pct(dragTick)}%, calc(100% - 28px))` }}
        >
          {getDurationFromTicks(dragTick).formatted}
        </div>
      )}
    </div>
  )
}

export const TimeReadout = ({ className }: { className?: string }) => {
  const tick = useStore(state => state.playback.tick)
  const maxTicks = useStore(state => state.playback.maxTicks)
  return (
    <span className={cn('m-time', className)}>
      {getDurationFromTicks(tick).formatted}
      <span className="m-time__total"> / {getDurationFromTicks(maxTicks).formatted}</span>
    </span>
  )
}

export const RoundChips = ({ className }: { className?: string }) => {
  const match = useInstance(state => state.match)
  const tick = useStore(state => state.playback.tick)
  const rounds = useRounds(match)
  if (rounds.length < 2) return null
  return (
    <div className={cn('m-rounds', className)}>
      {rounds.map((round, index) => (
        <button
          key={index}
          type="button"
          className="m-rounds__chip"
          data-winner={round.winner}
          data-reached={round.tick <= tick ? 'true' : undefined}
          aria-label={`Jump to round ${index + 1}`}
          onClick={() => goToTickAction(round.tick)}
        >
          {index + 1}
        </button>
      ))}
    </div>
  )
}

//
// ─── HUD ────────────────────────────────────────────────────────────────────────
//

//
// ─── TAPS ON THE SCENE ──────────────────────────────────────────────────────────
//

/**
 * A tap and a double-tap on the 3D view, told apart from drags and pinches (which stay the
 * camera's). Listens on the canvas itself rather than covering it, so the camera keeps its touches.
 */
export const useSceneTaps = (handlers: {
  onTap?: () => void
  onDoubleTap?: (side: 'left' | 'right') => void
}) => {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    const element = document.getElementById('main-canvas')
    if (!element) return
    let pointers = 0
    let multi = false
    let down: { x: number; y: number; t: number } | null = null
    let last: { t: number; side: 'left' | 'right' } | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const onDown = (event: PointerEvent) => {
      pointers++
      if (pointers > 1) multi = true
      if (pointers === 1) {
        multi = false
        down = { x: event.clientX, y: event.clientY, t: performance.now() }
      }
    }
    const onUp = (event: PointerEvent) => {
      pointers = Math.max(0, pointers - 1)
      if (!down || multi) {
        if (pointers === 0) down = null
        return
      }
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y) > 10
      const long = performance.now() - down.t > 350
      down = null
      if (moved || long) return
      const side = event.clientX < window.innerWidth / 2 ? 'left' : 'right'
      const now = performance.now()
      if (ref.current.onDoubleTap && last && now - last.t < 300 && last.side === side) {
        clearTimeout(timer)
        last = null
        ref.current.onDoubleTap(side)
        return
      }
      last = { t: now, side }
      clearTimeout(timer)
      // Wait out a second tap before treating this as a single one.
      timer = setTimeout(() => ref.current.onTap?.(), ref.current.onDoubleTap ? 260 : 0)
    }
    const onCancel = () => {
      pointers = Math.max(0, pointers - 1)
      down = null
    }
    element.addEventListener('pointerdown', onDown)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onCancel)
    return () => {
      clearTimeout(timer)
      element.removeEventListener('pointerdown', onDown)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onCancel)
    }
  }, [])
}

/** Double-tap a side of the scene to seek, with a ripple on that side. */
export const useDoubleTapSeek = () => {
  const [ripple, setRipple] = useState<{ side: 'left' | 'right'; key: number } | null>(null)
  const onDoubleTap = (side: 'left' | 'right') => {
    seekBySeconds(side === 'left' ? -MOBILE_SEEK_SECONDS : MOBILE_SEEK_SECONDS)
    setRipple({ side, key: performance.now() })
  }
  const rippleElement = ripple ? (
    <div className="m-ripple" data-side={ripple.side} key={ripple.key}>
      <motion.div
        className="m-ripple__bubble"
        initial={{ opacity: 1, scale: 0.85 }}
        animate={{ opacity: 0, scale: 1.05 }}
        transition={{ duration: 0.7 }}
      >
        <AiFillFastForwardIcon className={ripple.side === 'left' ? 'rotate-180' : ''} />
        <span>
          {ripple.side === 'left' ? '−' : '+'}
          {MOBILE_SEEK_SECONDS}s
        </span>
      </motion.div>
    </div>
  ) : null
  return { onDoubleTap, rippleElement }
}
