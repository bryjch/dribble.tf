import { useEffect, useState } from 'react'

import type { MatchSource } from '@components/Analyse/Data/MatchSource'
import { isScenePlayer } from '@components/Scene/PlaybackDriver'
import { FocusedPlayer } from '@components/UI/FocusedPlayer'
import { Killfeed } from '@components/UI/Killfeed'
import { ObjectiveHud } from '@components/UI/ObjectiveHud'

import { useStore } from '@zus/store'
import { setScoreboardOpenAction } from '@zus/actions'

import {
  BookmarkButton,
  CameraCycleButton,
  CameraSwitch,
  IconButton,
  PlayButton,
  RoundChips,
  Scrubber,
  SeekButton,
  Sheet,
  SheetBrand,
  SheetTabs,
  SpeedButton,
  TimeReadout,
  useDoubleTapSeek,
  useSceneTaps,
} from './parts'
import { PANEL_TABS, PanelBody, PanelId } from './panels'
import { Rails } from './Rails'

//
// ─── THEATER ────────────────────────────────────────────────────────────────────
//
// A video player with the teams down the sides. The match fills the screen between the two team
// rails (class and health only), with the score and the last kills on top. A tap brings up the
// controls, which fade after a few seconds of play: play and seek in the middle, the timeline
// along the bottom. Tap the score and the rails open out into a scoreboard, with names. Everything
// else is behind one menu button, in a single sheet with tabs.
//

const HIDE_AFTER_MS = 3500

const TABS: PanelId[] = ['events', 'bookmarks', 'settings', 'about']

export const Theater = ({ match, landscape }: { match: MatchSource; landscape: boolean }) => {
  const playing = useStore(state => state.playback.playing)
  const tick = useStore(state => state.playback.tick)
  const [chrome, setChrome] = useState(true)
  const [touchedAt, setTouchedAt] = useState(0)
  const [panel, setPanel] = useState<PanelId | null>(null)
  // Opened out into the scoreboard: the same state as holding Tab on desktop.
  const expanded = useStore(state => state.ui.scoreboardOpen)
  const { onDoubleTap, rippleElement } = useDoubleTapSeek()

  useSceneTaps({
    onTap: () => (expanded ? setScoreboardOpenAction(false) : setChrome(shown => !shown)),
    onDoubleTap,
  })

  useEffect(() => {
    if (!chrome || !playing || panel) return
    const timer = setTimeout(() => setChrome(false), HIDE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [chrome, playing, panel, touchedAt])

  const visible = chrome || !playing
  const keepAlive = () => setTouchedAt(Date.now())
  const players = match.playersAt(tick).filter(isScenePlayer)

  return (
    <div
      className="m-shell"
      data-variant="theater"
      data-landscape={landscape ? 'true' : undefined}
      data-chrome={visible ? 'true' : undefined}
      data-expanded={expanded ? 'true' : undefined}
    >
      <div className="m-theater__scrim" aria-hidden />

      <Rails match={match} top={landscape ? 80 : 160} bottom={landscape ? 92 : 150} />

      {/* Always on: the score, the kill feed, who you are watching */}
      <div className="m-theater__top">
        <div className="m-fade" onPointerDown={keepAlive}>
          <IconButton label="Menu" size="md" onClick={() => setPanel(TABS[0])}>
            <MenuGlyph />
          </IconButton>
        </div>

        <ScoreButton match={match} expanded={expanded} onTap={() => setScoreboardOpenAction()} />

        <div className="m-fade" onPointerDown={keepAlive}>
          {landscape ? <CameraSwitch /> : <CameraCycleButton size="md" />}
        </div>
      </div>

      <div className="m-theater__killfeed">
        <Killfeed parser={match} tick={tick} />
      </div>

      {/* Play and seek in the middle, shown on tap */}
      <div className="m-theater__center m-fade" onPointerDown={keepAlive}>
        <SeekButton direction={-1} size={landscape ? 'lg' : 'md'} />
        <PlayButton size="xl" />
        <SeekButton direction={1} size={landscape ? 'lg' : 'md'} />
      </div>

      <div className="m-theater__bottom" onPointerDown={keepAlive}>
        {/* The desktop's POV card; it settles to the bottom edge when the controls hide */}
        <div className="m-theater__focused">
          <FocusedPlayer players={players} tick={tick} intervalPerTick={match.intervalPerTick} />
        </div>

        <div className="m-theater__bar-wrap">
          <div className="m-fade m-theater__bar">
            <div className="m-theater__meta">
              <TimeReadout />
              <RoundChips />
              <span className="flex-1" />
              <SpeedButton size="sm" />
              <BookmarkButton size="sm" />
            </div>
            <Scrubber />
          </div>
        </div>

        {/* With the controls hidden, a hairline of progress, as on a video */}
        <Progress className="m-theater__hairline" />
      </div>

      {rippleElement}

      <Sheet
        open={panel !== null}
        onOpenChange={open => !open && setPanel(null)}
        title="Menu"
        header={
          <>
            <SheetBrand />
            <SheetTabs
              tabs={TABS.map(id => PANEL_TABS[id])}
              value={panel ?? TABS[0]}
              onChange={id => setPanel(id as PanelId)}
            />
          </>
        }
      >
        {panel && <PanelBody panel={panel} match={match} />}
      </Sheet>
    </div>
  )
}

/** The theme's own score and objectives, as the button that opens the rails into a scoreboard. */
const ScoreButton = ({
  match,
  expanded,
  onTap,
}: {
  match: MatchSource
  expanded: boolean
  onTap: () => void
}) => {
  const tick = useStore(state => state.playback.tick)
  const showObjectives = useStore(state => state.settings.ui.showObjectives !== false)
  const objectives = showObjectives ? match.objectivesAt(tick) : null
  const players = match.playersAt(tick).filter(isScenePlayer)

  return (
    <button
      type="button"
      className="m-score-btn"
      aria-label={expanded ? 'Close the scoreboard' : 'Scoreboard'}
      aria-expanded={expanded}
      onClick={onTap}
    >
      {objectives ? (
        <ObjectiveHud state={objectives} players={players} />
      ) : (
        <span className="m-score-fallback">Scores</span>
      )}
      <span className="m-score-btn__hint">{expanded ? 'Tap to close' : 'Tap for scores'}</span>
    </button>
  )
}

const Progress = ({ className }: { className?: string }) => {
  const tick = useStore(state => state.playback.tick)
  const maxTicks = useStore(state => state.playback.maxTicks)
  return (
    <div className={className} aria-hidden>
      <i style={{ width: `${(tick / Math.max(1, maxTicks)) * 100}%` }} />
    </div>
  )
}

export const MenuGlyph = () => (
  <svg
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    aria-hidden
  >
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
)
