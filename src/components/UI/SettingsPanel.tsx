import { useEffect, useRef, useState } from 'react'
import { clamp } from 'lodash'

import { TogglePanel, TogglePanelButton } from '@components/UI/Shared/TogglePanel'
import { AutoHeight } from '@components/UI/Shared/AutoHeight'
import { StorageTab } from '@components/UI/StorageList'
import { Segmented, Switch } from '@components/UI/Shared/Controls'
import {
  IoMdSettingsIcon,
  CrosshairStyleIcon,
  CrossStyleIcon,
  CircleStyleIcon,
  DotStyleIcon,
} from '@components/Misc/Icons'
import { CrosshairStyle, SettingsTab } from '@constants/types'
import { BRUSH_COLOR_OPTIONS } from '@constants/drawing'
import { SHORTCUTS } from '@constants/shortcuts'

import { useStore } from '@zus/store'
import {
  setSettingsTabAction,
  toggleOnlyUIPanelAction,
  updateSettingsOptionAction,
} from '@zus/actions'
import { cn } from '@utils/styling'
import { useIsMobile } from '@utils/hooks'
import { useMobileLayout } from '@components/Mobile/useMobileLayout'
import { DEFAULT_THEME, THEMES, isThemeId } from '@theme/themes'

//
// ─── SETTINGS ───────────────────────────────────────────────────────────────────
//
// One short page per tab: what is drawn over the scene (HUD), on players and buildings
// (Players), the map, how each camera feels, drawing, the rest (General), and the maps and demos
// kept in the browser (Storage). Keys lists every shortcut (from @constants/shortcuts); ? opens
// it. A row's <kbd> is the key that flips it.
//

const updateSettingsOption = (option: string, value: any) => {
  updateSettingsOptionAction(option, value)
}

//
// ─── BASE OPTION WRAPPER ────────────────────────────────────────────────────────
//

type OptionProps = {
  label: string
  keyCode?: string
  hint?: string
  children?: React.ReactNode
  leftClass?: string
  rightClass?: string
  onClickLabel?: () => void
}

const Option = ({
  label,
  keyCode,
  hint,
  children,
  leftClass = '',
  rightClass = '',
  onClickLabel,
}: OptionProps) => (
  <div className="ui-option">
    <div className={cn('ui-option__label', leftClass)}>
      <span className={cn(!!onClickLabel && 'cursor-default')} onClick={onClickLabel}>
        {label}
      </span>
      {!!keyCode && <KeyHint className="">{keyCode}</KeyHint>}
      {!!hint && <span className="ui-option__hint">{hint}</span>}
    </div>

    <div className={cn('flex items-center', rightClass)}>{children}</div>
  </div>
)

/** A setting's shortcut, left out on the touch layout, which has no keyboard. */
const KeyHint = ({ children, className }: { children: string; className: string }) =>
  useMobileLayout().active ? null : <kbd className={className}>{children}</kbd>

const Section = ({ children, keyCode }: { children: React.ReactNode; keyCode?: string }) => (
  <div className="ui-section-title flex items-center gap-2">
    {children}
    {!!keyCode && <KeyHint className="normal-case tracking-normal">{keyCode}</KeyHint>}
  </div>
)

const OptionGroup = ({ children }: { children: React.ReactNode }) => (
  <div className="ui-option-group">{children}</div>
)

//
// ─── SLIDER OPTION ──────────────────────────────────────────────────────────────
//

type SliderOptionProps = {
  label: string
  keyCode?: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  inputClassName?: string
}

const SliderOption = ({
  label,
  keyCode,
  value,
  onChange,
  min = 1,
  max = 10,
  step = 0.1,
  inputClassName = '',
}: SliderOptionProps) => {
  // Track value internally so that input[type=number] will only trigger
  // callback when appropriate (i.e. enter / up / down / blurred)
  const [val, setVal] = useState(value)
  const inputFields = { min: min, max: max, step: step }

  useEffect(() => {
    setVal(value)
  }, [value])

  const callback = (newValue: number) => {
    setVal(clamp(newValue, min, max))
    onChange(clamp(newValue, min, max))
  }

  return (
    // min-w-0: a range input's intrinsic width would otherwise push the number box out of a
    // narrow panel (phone sheets).
    <Option label={label} keyCode={keyCode} leftClass="w-5/12 shrink-0" rightClass="min-w-0 flex-1">
      <input
        type="range"
        className="ui-range"
        aria-label={label}
        value={val}
        onChange={({ target }) => callback(Number(target.value))}
        {...inputFields}
      />
      <input
        type="number"
        className={cn('ui-input ui-input--number ml-3', inputClassName)}
        aria-label={`${label} value`}
        value={val}
        onChange={({ target }) => setVal(Number(target.value))}
        onBlur={() => callback(val)}
        onKeyDown={({ key }) => {
          if (key === 'Enter') callback(val)
          if (key === 'ArrowUp') callback(val)
          if (key === 'ArrowDown') callback(val)
        }}
        {...inputFields}
      />
    </Option>
  )
}

//
// ─── TOGGLE OPTION ──────────────────────────────────────────────────────────────
//

type ToggleOptionProps = {
  label: string
  keyCode?: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}

const ToggleOption = ({ label, keyCode, hint, checked, disabled, onChange }: ToggleOptionProps) => {
  const callback = () => {
    onChange(!checked)
  }

  return (
    <Option label={label} keyCode={keyCode} hint={hint} onClickLabel={callback}>
      <Switch checked={checked} disabled={disabled} onChange={callback} label={label} />
    </Option>
  )
}

//
// ─── TABS ───────────────────────────────────────────────────────────────────────
//

const TABS: { id: SettingsTab; label: string; desktopOnly?: boolean }[] = [
  { id: 'hud', label: 'HUD' },
  { id: 'players', label: 'Players' },
  { id: 'map', label: 'Map' },
  { id: 'camera', label: 'Camera' },
  // Phones leave drawing out (see Mobile/panels), and have no keyboard.
  { id: 'drawing', label: 'Drawing', desktopOnly: true },
  { id: 'general', label: 'General' },
  { id: 'storage', label: 'Storage' },
  { id: 'keys', label: 'Keys', desktopOnly: true },
]

/** The tab showing: the stored one, or HUD if this layout leaves that tab out. */
const useSettingsTab = () => {
  const touch = useMobileLayout().active
  const stored = useStore(state => state.ui.settingsTab)
  const tabs = TABS.filter(tab => !(touch && tab.desktopOnly))
  const current = tabs.some(tab => tab.id === stored) ? stored : 'hud'
  return { tabs, current }
}

/**
 * The tabs: one line across the desktop panel, which is wide enough for all of them; in a
 * phone's sheet, the same underlined tabs in a line that scrolls sideways, keeping the picked
 * one in view.
 */
const SettingsTabs = ({ layout }: { layout: 'row' | 'scroll' }) => {
  const { tabs, current } = useSettingsTab()
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (layout !== 'scroll') return
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [layout, current])
  return (
    <div
      ref={listRef}
      className={layout === 'row' ? 'ui-tabs ui-tabs--fill ui-tabs--fit' : 'ui-tabs ui-tabs--scroll'}
      role="tablist"
      aria-label="Settings"
    >
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={current === tab.id}
          className="ui-tab"
          onClick={() => setSettingsTabAction(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

const SettingsTabBody = () => {
  const { current } = useSettingsTab()
  switch (current) {
    case 'hud':
      return <HudTab />
    case 'players':
      return <PlayersTab />
    case 'map':
      return <MapTab />
    case 'camera':
      return <CameraTab />
    case 'drawing':
      return <DrawingTab />
    case 'general':
      return <GeneralTab />
    case 'storage':
      return <StorageTab />
    case 'keys':
      return <KeysTab />
  }
}

//
// ─── SETTINGS PANEL ─────────────────────────────────────────────────────────────
//

export const SettingsPanel = () => {
  const isOpen = useStore(state => state.ui.activePanels.includes('Settings'))
  const toggleUIPanel = () => toggleOnlyUIPanelAction('Settings')
  return (
    <div className="flex items-start">
      <TogglePanelButton onClick={toggleUIPanel} active={isOpen} label="Settings">
        <IoMdSettingsIcon />
      </TogglePanelButton>

      <TogglePanel
        className="w-[min(500px,calc(100vw-5rem))]"
        title="Settings"
        subheader={<SettingsTabs layout="row" />}
        showCloseButton
        isOpen={isOpen}
        onClickClose={toggleUIPanel}
      >
        <AutoHeight>
          <SettingsTabBody />
        </AutoHeight>
      </TogglePanel>
    </div>
  )
}

/** The tabs and their settings, for the phone sheets (the desktop panel puts the tabs in its header). */
export const SettingsContent = () => (
  <div>
    <SettingsTabs layout="scroll" />
    <div className="pt-3">
      <SettingsTabBody />
    </div>
  </div>
)

//
// ─── HUD ────────────────────────────────────────────────────────────────────────
//

const HudTab = () => {
  const ui = useStore(state => state.settings.ui)
  const touch = useMobileLayout().active

  return (
    <div>
      <Option label="Player rails" keyCode="P">
        <Segmented
          label="Player rails"
          options={[
            { label: 'Full', value: 'full' },
            { label: 'Compact', value: 'compact' },
            { label: 'Hidden', value: 'hidden' },
          ]}
          value={ui.rails ?? 'full'}
          onChange={value => updateSettingsOption('ui.rails', value)}
        />
      </Option>

      <ToggleOption
        label="Objectives and score"
        checked={ui.showObjectives !== false}
        onChange={checked => updateSettingsOption('ui.showObjectives', checked)}
      />

      <ToggleOption
        label="Chat"
        keyCode="T"
        checked={ui.showChat !== false}
        onChange={checked => updateSettingsOption('ui.showChat', checked)}
      />

      {/* The touch layout shows match events in their own sheet. */}
      {!touch && (
        <ToggleOption
          label="Match events sidebar"
          keyCode="I"
          checked={ui.matchEvents.open}
          onChange={checked => updateSettingsOption('ui.matchEvents.open', checked)}
        />
      )}

      <ToggleOption
        label="FPS counter"
        checked={ui.showStats}
        onChange={checked => updateSettingsOption('ui.showStats', checked)}
      />

      <Section keyCode="X">Crosshair</Section>

      <Option label="Style">
        <Segmented
          label="Crosshair style"
          options={[
            { label: 'None', value: CrosshairStyle.NONE },
            {
              label: 'Cross',
              value: CrosshairStyle.CROSSHAIR,
              icon: <CrosshairStyleIcon className="h-3.5 w-3.5" />,
            },
            {
              label: 'Plus',
              value: CrosshairStyle.CROSS,
              icon: <CrossStyleIcon className="h-3.5 w-3.5" />,
            },
            {
              label: 'Circle',
              value: CrosshairStyle.CIRCLE,
              icon: <CircleStyleIcon className="h-3.5 w-3.5" />,
            },
            {
              label: 'Dot',
              value: CrosshairStyle.DOT,
              icon: <DotStyleIcon className="h-3.5 w-3.5" />,
            },
          ]}
          value={ui.crosshair.style}
          onChange={value => updateSettingsOption('ui.crosshair.style', value)}
        />
      </Option>

      {ui.crosshair.style !== 'none' && (
        <>
          <SliderOption
            label="Size"
            min={10}
            max={60}
            step={1}
            value={ui.crosshair.size}
            onChange={value => updateSettingsOption('ui.crosshair.size', value)}
          />

          <SliderOption
            label="Opacity"
            min={0.1}
            max={1}
            step={0.05}
            value={ui.crosshair.opacity}
            onChange={value => updateSettingsOption('ui.crosshair.opacity', value)}
          />

          <Option label="Colour">
            <div className="flex items-center gap-1.5">
              {BRUSH_COLOR_OPTIONS.map(({ color }) => (
                <button
                  type="button"
                  key={`crosshair-color-${color}`}
                  className="ui-swatch"
                  data-active={ui.crosshair.color === color}
                  aria-label={`Crosshair colour ${color}`}
                  style={{ backgroundColor: color }}
                  onClick={() => updateSettingsOption('ui.crosshair.color', color)}
                />
              ))}
            </div>
          </Option>
        </>
      )}
    </div>
  )
}

//
// ─── PLAYERS ────────────────────────────────────────────────────────────────────
//

const PlayersTab = () => {
  const ui = useStore(state => state.settings.ui)

  return (
    <div>
      <ToggleOption
        label="Outlines"
        keyCode="O"
        hint="Players, buildings, stickies"
        checked={ui.playerOutlines}
        onChange={checked => updateSettingsOption('ui.playerOutlines', checked)}
      />

      <ToggleOption
        label="Damage numbers in POV"
        checked={ui.damageNumbers}
        onChange={checked => updateSettingsOption('ui.damageNumbers', checked)}
      />

      {ui.damageNumbers && (
        <OptionGroup>
          <SliderOption
            label="Combine hits within (s)"
            min={0}
            max={2}
            step={0.05}
            value={ui.damageBatchSeconds}
            onChange={value => updateSettingsOption('ui.damageBatchSeconds', value)}
          />
        </OptionGroup>
      )}

      <ToggleOption
        label="Damage direction in POV"
        checked={ui.damageIndicator}
        onChange={checked => updateSettingsOption('ui.damageIndicator', checked)}
      />

      <ToggleOption
        label="Nameplates"
        keyCode="N"
        checked={ui.nameplate.enabled}
        onChange={checked => updateSettingsOption('ui.nameplate.enabled', checked)}
      />

      {ui.nameplate.enabled && (
        <OptionGroup>
          <ToggleOption
            label="Name"
            checked={ui.nameplate.showName}
            onChange={checked => updateSettingsOption('ui.nameplate.showName', checked)}
          />

          <ToggleOption
            label="Health"
            checked={ui.nameplate.showHealth}
            onChange={checked => updateSettingsOption('ui.nameplate.showHealth', checked)}
          />

          <ToggleOption
            label="Class"
            checked={ui.nameplate.showClass}
            onChange={checked => updateSettingsOption('ui.nameplate.showClass', checked)}
          />

          <ToggleOption
            label="Conditions"
            checked={ui.nameplate.showConditions !== false}
            onChange={checked => updateSettingsOption('ui.nameplate.showConditions', checked)}
          />
        </OptionGroup>
      )}

      <Section>Sentries</Section>

      <ToggleOption
        label="Targets"
        checked={ui.buildings.sentryTargets}
        onChange={checked => updateSettingsOption('ui.buildings.sentryTargets', checked)}
      />

      <ToggleOption
        label="Range"
        checked={ui.buildings.sentryRange}
        onChange={checked => updateSettingsOption('ui.buildings.sentryRange', checked)}
      />

      <Section>Viewmodel</Section>

      <ToggleOption
        label="Weapon in POV"
        keyCode="V"
        checked={ui.viewmodel?.enabled !== false}
        onChange={checked => updateSettingsOption('ui.viewmodel.enabled', checked)}
      />

      {ui.viewmodel?.enabled !== false && (
        <OptionGroup>
          <SliderOption
            label="Viewmodel FOV"
            min={54}
            max={90}
            step={1}
            value={ui.viewmodel?.fov ?? 70}
            onChange={value => updateSettingsOption('ui.viewmodel.fov', value)}
          />
        </OptionGroup>
      )}
    </div>
  )
}

//
// ─── MAP ────────────────────────────────────────────────────────────────────────
//

const MapTab = () => {
  const settings = useStore(state => state.settings)
  const lighting = settings.scene.lighting ?? 'baked'

  return (
    <div>
      <Option label="Material" keyCode="M">
        <Segmented
          label="Material"
          options={[
            { label: 'Wireframe', value: 'wireframe' },
            { label: 'Plain', value: 'untextured' },
            { label: 'Textured', value: 'textured' },
          ]}
          value={settings.scene.mode}
          onChange={value => updateSettingsOption('scene.mode', value)}
        />
      </Option>

      <Option label="Lighting" keyCode="L">
        <Segmented
          label="Lighting"
          options={[
            { label: 'Flat', value: 'flat' },
            { label: 'Baked', value: 'baked' },
          ]}
          value={lighting}
          onChange={value => updateSettingsOption('scene.lighting', value)}
        />
      </Option>

      {lighting === 'baked' && (
        <OptionGroup>
          <SliderOption
            label="Brightness"
            min={0.6}
            max={2.2}
            step={0.1}
            value={settings.scene.bakedBrightness ?? 1.3}
            onChange={value => updateSettingsOption('scene.bakedBrightness', value)}
          />
        </OptionGroup>
      )}

      <ToggleOption
        label="Skybox"
        checked={settings.ui.showSkybox}
        onChange={checked => updateSettingsOption('ui.showSkybox', checked)}
      />

      <SliderOption
        label="View distance"
        min={2000}
        max={30000}
        step={500}
        value={settings.ui.viewDistance}
        onChange={value => updateSettingsOption('ui.viewDistance', value)}
      />

      <ToggleOption
        label="Frame smoothing"
        hint="Between ticks"
        checked={settings.scene.interpolateFrames}
        onChange={checked => updateSettingsOption('scene.interpolateFrames', checked)}
      />
    </div>
  )
}

//
// ─── CAMERA ─────────────────────────────────────────────────────────────────────
//
// Every camera's settings at once, whichever is in use, so they stay where you left them.
//

const CameraTab = () => {
  const settings = useStore(state => state.settings)
  const isMobile = useIsMobile()

  return (
    <div>
      {/* The free and orbit cameras are one camera, so they share a field of view. */}
      <SliderOption
        label="Field of view"
        min={50}
        max={120}
        step={1}
        value={settings.camera.fov}
        onChange={value => updateSettingsOption('camera.fov', value)}
      />

      <Section keyCode="3">Orbit camera</Section>

      <SliderOption
        label="Rotate speed"
        min={0.25}
        max={2}
        step={0.05}
        value={settings.controls.rts.rotateSpeed}
        onChange={value => updateSettingsOption('controls.rts.rotateSpeed', value)}
      />

      <SliderOption
        label="Zoom speed"
        min={0.25}
        max={2}
        step={0.05}
        value={settings.controls.rts.zoomSpeed}
        onChange={value => updateSettingsOption('controls.rts.zoomSpeed', value)}
      />

      {!isMobile && (
        <SliderOption
          label="Keyboard speed"
          min={0.25}
          max={2}
          step={0.05}
          value={settings.controls.rts.keyPanSpeed}
          onChange={value => updateSettingsOption('controls.rts.keyPanSpeed', value)}
        />
      )}

      <ToggleOption
        label="Smooth movement"
        checked={settings.controls.rts.smoothing}
        onChange={checked => updateSettingsOption('controls.rts.smoothing', checked)}
      />

      {/* The free (spectator) camera needs a mouse and keyboard. */}
      {!isMobile && (
        <>
          <Section keyCode="2">Free camera</Section>

          <SliderOption
            label="Look sensitivity"
            value={settings.controls.lookSpeed}
            onChange={value => updateSettingsOption('controls.lookSpeed', value)}
          />

          <SliderOption
            label="Move speed"
            value={settings.controls.moveSpeed}
            onChange={value => updateSettingsOption('controls.moveSpeed', value)}
          />
        </>
      )}
    </div>
  )
}

//
// ─── DRAWING ────────────────────────────────────────────────────────────────────
//

const DrawingTab = () => {
  const drawing = useStore(state => state.settings.drawing)

  return (
    <div>
      <Option label="Draw key" keyCode="F">
        <Segmented
          label="Draw key"
          options={[
            { label: 'Hold', value: 'hold' },
            { label: 'Toggle', value: 'toggle' },
          ]}
          value={drawing.activation}
          onChange={value => updateSettingsOption('drawing.activation', value)}
        />
      </Option>

      <ToggleOption
        label="Clear when dismissed"
        checked={drawing.autoClear}
        onChange={checked => updateSettingsOption('drawing.autoClear', checked)}
      />
    </div>
  )
}

//
// ─── GENERAL ────────────────────────────────────────────────────────────────────
//

const GeneralTab = () => {
  const ui = useStore(state => state.settings.ui)

  return (
    <div>
      <Option label="Theme">
        <Segmented
          label="Theme"
          options={THEMES.map(theme => ({ label: theme.label, value: theme.id }))}
          value={isThemeId(ui.theme) ? ui.theme : DEFAULT_THEME}
          onChange={value => updateSettingsOption('ui.theme', value)}
        />
      </Option>

      <Option label="Layout">
        <Segmented
          label="Layout"
          options={[
            { label: 'Auto', value: 'auto' },
            { label: 'Desktop', value: 'desktop' },
            { label: 'Touch', value: 'touch' },
          ]}
          value={ui.layout ?? 'auto'}
          onChange={value => updateSettingsOption('ui.layout', value)}
        />
      </Option>

      <SliderOption
        label="Killfeed seek buffer"
        min={1}
        max={10}
        step={1}
        value={ui.killfeedSeekBuffer}
        onChange={value => updateSettingsOption('ui.killfeedSeekBuffer', value)}
      />
    </div>
  )
}

//
// ─── KEYS ───────────────────────────────────────────────────────────────────────
//

const KeysTab = () => (
  <div>
    {SHORTCUTS.map(section => (
      <div key={section.group}>
        <Section>{section.group}</Section>
        <dl className="ui-keys">
          {section.items.map(item => (
            <div key={item.label} className="ui-keys__row">
              <dt className="ui-keys__keys">
                {item.keys.map(key => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </dt>
              <dd>{item.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    ))}
  </div>
)
