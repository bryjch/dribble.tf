import { useEffect, useId, useState } from 'react'
import { useDropzone } from 'react-dropzone'

import { TogglePanel, TogglePanelButton } from '@components/UI/Shared/TogglePanel'
import { FileIcon, LinkIcon, PlayCircleIcon, TiInfoLargeIcon } from '@components/Misc/Icons'

import { useStore } from '@zus/store'
import { toggleUIPanelAction, onUploadDemoAction, loadEmptySceneMapAction } from '@zus/actions'
import { loadSampleDemoAction } from '@utils/sampleDemo'
import { openMatchLink } from '@utils/matchLink'
import { cn } from '@utils/styling'
import { MAP_NAME_SEARCH_MAP } from '@constants/mappings'

//
// ─── ABOUT PANEL ────────────────────────────────────────────────────────────────
//
// The first thing open on load, and the first thing most people see: open your own demo
// (a file or a link), or watch the sample match, then the controls and maps below.
//

const TFTV_URL = 'https://www.teamfortress.tv/57837/dribble-tf-stv-demo-replay-in-browser'
const GITHUB_URL = 'https://www.github.com/bryjch/dribble.tf'

//
// ─── SHARED PIECES ──────────────────────────────────────────────────────────────
//

const useOpenFile = () => {
  const { open, getInputProps, acceptedFiles } = useDropzone({
    noClick: true,
    noKeyboard: true,
    maxFiles: 1,
    multiple: false,
  })
  useEffect(() => {
    if (acceptedFiles.length > 0) onUploadDemoAction(acceptedFiles)
  }, [acceptedFiles])
  return { open, input: <input {...getInputProps()} /> }
}

const FileButton = ({ onClick }: { onClick: () => void }) => (
  <button type="button" className="ui-dropbox" onClick={onClick}>
    <span className="ui-dropbox__icon">
      <FileIcon />
    </span>
    <span>
      <span className="ui-dropbox__title">
        Open a <code>.dem</code> file
      </span>
      <span className="ui-dropbox__hint">or drop one anywhere on the page</span>
    </span>
  </button>
)

/** A link to a demo or a live match, from any host. The field and its button read as one control. */
const LinkField = ({ label }: { label?: string }) => {
  const id = useId()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="ui-link-field"
      onSubmit={event => {
        event.preventDefault()
        setError(openMatchLink(value))
      }}
    >
      {label && (
        <label htmlFor={id} className="ui-field-label">
          {label}
        </label>
      )}
      <div className="ui-input-group" data-invalid={!!error}>
        <LinkIcon className="ui-input-group__icon" aria-hidden />
        <input
          id={id}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className="ui-input-group__input"
          placeholder="demos.tf/… or stv.tf/w/…"
          aria-label={label ? undefined : 'Link to a demo or a live match'}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          value={value}
          onChange={event => {
            setValue(event.target.value)
            setError(null)
          }}
        />
        <button type="submit" className="ui-input-group__button" disabled={!value.trim()}>
          Open
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className="ui-field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

const SampleButton = ({ className }: { className?: string }) => (
  <button
    type="button"
    className={cn('ui-btn ui-btn--primary ui-btn--cta', className)}
    onClick={loadSampleDemoAction}
  >
    <PlayCircleIcon className="h-5 w-5" />
    Watch a sample match
  </button>
)

const CONTROLS: [string[], string][] = [
  [['LMB'], 'Rotate camera'],
  [['RMB', 'WASD'], 'Pan camera'],
  [['1', '2', '3'], 'POV, spectator, RTS camera'],
  [['Space'], 'Play / pause'],
  [['←', '→'], 'Seek 50 ticks'],
  [['B'], 'Bookmark'],
  [['F'], 'Drawing tools'],
]

const ControlsList = () => (
  <dl className="ui-keys">
    {CONTROLS.map(([keys, value]) => (
      <div key={value} className="ui-keys__row">
        <dt className="ui-keys__keys">
          {keys.map(key => (
            <kbd key={key}>{key}</kbd>
          ))}
        </dt>
        <dd>{value}</dd>
      </div>
    ))}
  </dl>
)

const MapsList = () => (
  <ul className="ui-maps">
    {Object.keys(MAP_NAME_SEARCH_MAP)
      .sort((a, b) => a.localeCompare(b))
      .map(mapName => (
        <li key={mapName}>
          <button
            type="button"
            className="ui-maps__item"
            title={`Look around ${mapName} without a demo`}
            onClick={() => loadEmptySceneMapAction(mapName)}
          >
            {mapName}
          </button>
        </li>
      ))}
  </ul>
)

/** Controls and maps as underlined tabs, under the ways in. */
const Reference = () => {
  const id = useId()
  const [tab, setTab] = useState<'controls' | 'maps'>('controls')
  const tabs = [
    { value: 'controls', label: 'Controls' },
    { value: 'maps', label: 'Maps' },
  ] as const

  return (
    <section className="ui-reference">
      <div className="ui-tabs" role="tablist" aria-label="Reference">
        {tabs.map(t => (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={`${id}-${t.value}`}
            aria-selected={tab === t.value}
            aria-controls={`${id}-${t.value}-panel`}
            className="ui-tab"
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}`}>
        {tab === 'controls' ? <ControlsList /> : <MapsList />}
      </div>
    </section>
  )
}

const Footer = () => (
  <footer className="ui-panel-foot">
    <a href={TFTV_URL} target="_blank" rel="noopener noreferrer" className="ui-link">
      teamfortress.tv
    </a>
    <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="ui-link">
      GitHub
    </a>
  </footer>
)

//
// ─── BODY ───────────────────────────────────────────────────────────────────────
// Your own demo first (a file, or a link), then the sample match for a first visit.
//

const AboutBody = () => {
  const file = useOpenFile()
  return (
    <>
      <p className="ui-about__lede">Replay TF2 matches in 3D, tick by tick, in your browser.</p>
      <div className="ui-about__actions">
        {file.input}
        <FileButton onClick={file.open} />
        <LinkField label="Or paste a link" />
        <SampleButton className="ui-about__sample w-full" />
      </div>
    </>
  )
}

//
// ─── PANEL ──────────────────────────────────────────────────────────────────────
//

export const AboutPanel = () => {
  const isOpen = useStore(state => state.ui.activePanels.includes('About'))

  const toggleUIPanel = () => {
    toggleUIPanelAction('Settings', false)
    toggleUIPanelAction('MatchKillfeed', false)
    toggleUIPanelAction('Bookmarks', false)
    toggleUIPanelAction('Setups', false)
    toggleUIPanelAction('About')
  }

  return (
    <div className="flex items-start">
      <TogglePanelButton onClick={toggleUIPanel} active={isOpen} label="About and controls">
        <TiInfoLargeIcon />
      </TogglePanelButton>

      <TogglePanel
        className="ui-about-panel w-[min(380px,calc(100vw-5rem))]"
        bodyClassName="ui-about"
        title={
          <span className="ui-about-title">
            <img src="/logo192.png" alt="" className="ui-about-title__logo" />
            dribble.tf
          </span>
        }
        showCloseButton
        isOpen={isOpen}
        onClickClose={toggleUIPanel}
      >
        <AboutBody />

        <Reference />
        <Footer />
      </TogglePanel>
    </div>
  )
}
