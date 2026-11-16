import { useEffect, useState } from 'react'
import { clamp } from 'lodash'

import { TogglePanel, TogglePanelButton } from '@components/UI/Shared/TogglePanel'
import { Segmented, Switch } from '@components/UI/Shared/Controls'
import {
  IoMdSettingsIcon,
  CrosshairStyleIcon,
  CrossStyleIcon,
  CircleStyleIcon,
  DotStyleIcon,
} from '@components/Misc/Icons'
import { CrosshairStyle } from '@constants/types'
import { BRUSH_COLOR_OPTIONS } from '@constants/drawing'

import { useStore } from '@zus/store'
import { toggleOnlyUIPanelAction, updateSettingsOptionAction } from '@zus/actions'
import { cn } from '@utils/styling'
import { useIsMobile } from '@utils/hooks'
import { DEFAULT_THEME, THEMES, isThemeId } from '@theme/themes'

//
// ─── BASE OPTION WRAPPER ────────────────────────────────────────────────────────
//

type OptionProps = {
  label: string
  keyCode?: string
  children?: React.ReactNode
  leftClass?: string
  rightClass?: string
  onClickLabel?: () => void
}

const Option = ({
  label,
  keyCode,
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
      {!!keyCode && <kbd>{keyCode}</kbd>}
    </div>

    <div className={cn('flex items-center', rightClass)}>{children}</div>
  </div>
)

const Section = ({ children }: { children: React.ReactNode }) => (
  <div className="ui-section-title">{children}</div>
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
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}

const ToggleOption = ({ label, keyCode, checked, disabled, onChange }: ToggleOptionProps) => {
  const callback = () => {
    onChange(!checked)
  }

  return (
    <Option label={label} keyCode={keyCode} onClickLabel={callback}>
      <Switch checked={checked} disabled={disabled} onChange={callback} label={label} />
    </Option>
  )
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
        className="w-[min(440px,calc(100vw-5rem))]"
        title="Settings"
        showCloseButton
        isOpen={isOpen}
        onClickClose={toggleUIPanel}
      >
        <SettingsContent />
      </TogglePanel>
    </div>
  )
}

/** Every setting, shared by the desktop panel and the phone sheets. */
export const SettingsContent = () => {
  const scene = useStore(state => state.scene)
  const settings = useStore(state => state.settings)
  const isMobile = useIsMobile()

  const updateSettingsOption = (option: string, value: any) => {
    updateSettingsOptionAction(option, value)
  }

  return (
    <div>
      <Section>Theme</Section>

      <Option label="Look">
        <Segmented
          label="Theme"
          options={THEMES.map(theme => ({ label: theme.label, value: theme.id }))}
          value={isThemeId(settings.ui.theme) ? settings.ui.theme : DEFAULT_THEME}
          onChange={value => updateSettingsOption('ui.theme', value)}
        />
      </Option>

      {/* ************************************************************* */}

      <Section>Camera</Section>

      <Option label="POV Camera (next)" keyCode="1" />
      <Option label="POV Camera (prev)" keyCode="Shift + 1" />

      {!isMobile && <Option label="Spectator Camera" keyCode="2" />}
      {isMobile && (
        <Option label="Spectator Camera">
          <span className="ui-option__hint">Desktop only</span>
        </Option>
      )}

      {scene.controls.mode === 'spectator' && !isMobile && (
        <OptionGroup>
          <SliderOption
            label="FOV"
            min={50}
            max={120}
            step={1}
            value={settings.camera.fov}
            onChange={value => updateSettingsOption('camera.fov', value)}
          />

          <SliderOption
            label="Look Sensitivity"
            value={settings.controls.lookSpeed}
            onChange={value => updateSettingsOption('controls.lookSpeed', value)}
          />

          <SliderOption
            label="Move Speed"
            value={settings.controls.moveSpeed}
            onChange={value => updateSettingsOption('controls.moveSpeed', value)}
          />
        </OptionGroup>
      )}

      <Option label="RTS Camera" keyCode="3" />

      {scene.controls.mode === 'rts' && (
        <OptionGroup>
          <SliderOption
            label="FOV"
            min={50}
            max={120}
            step={1}
            value={settings.camera.fov}
            onChange={value => updateSettingsOption('camera.fov', value)}
          />

          <SliderOption
            label="Pan speed"
            value={settings.controls.panSpeed}
            onChange={value => updateSettingsOption('controls.panSpeed', value)}
          />

          <SliderOption
            label="Rotate speed"
            value={settings.controls.rotateSpeed}
            onChange={value => updateSettingsOption('controls.rotateSpeed', value)}
          />

          <SliderOption
            label="Zoom speed"
            value={settings.controls.zoomSpeed}
            onChange={value => updateSettingsOption('controls.zoomSpeed', value)}
          />

          <ToggleOption
            label="Inertia enabled"
            checked={settings.controls.enableDamping}
            onChange={checked => updateSettingsOption('controls.enableDamping', checked)}
          />
        </OptionGroup>
      )}

      {/* ************************************************************* */}

      <Section>Scene</Section>

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

      <Option label="Lighting">
        <Segmented
          label="Lighting"
          options={[
            { label: 'Flat', value: 'flat' },
            { label: 'Baked', value: 'baked' },
          ]}
          value={settings.scene.lighting ?? 'baked'}
          onChange={value => updateSettingsOption('scene.lighting', value)}
        />
      </Option>

      {(settings.scene.lighting ?? 'baked') === 'baked' && (
        <SliderOption
          label="Brightness"
          min={0.6}
          max={2.2}
          step={0.1}
          value={settings.scene.bakedBrightness ?? 1.3}
          onChange={value => updateSettingsOption('scene.bakedBrightness', value)}
        />
      )}

      <ToggleOption
        label="Frame smoothing"
        checked={settings.scene.interpolateFrames}
        onChange={checked => updateSettingsOption('scene.interpolateFrames', checked)}
      />

      <SliderOption
        label="View distance"
        min={2000}
        max={30000}
        step={500}
        value={settings.ui.viewDistance}
        onChange={value => updateSettingsOption('ui.viewDistance', value)}
      />

      {/* ************************************************************* */}

      <Section>Players</Section>

      <ToggleOption
        label="Player, building and sticky outlines"
        keyCode="O"
        checked={settings.ui.playerOutlines}
        onChange={checked => updateSettingsOption('ui.playerOutlines', checked)}
      />

      <ToggleOption
        label="Damage numbers in POV"
        checked={settings.ui.damageNumbers}
        onChange={checked => updateSettingsOption('ui.damageNumbers', checked)}
      />

      <ToggleOption
        label="Show nameplates"
        keyCode="N"
        checked={settings.ui.nameplate.enabled}
        onChange={checked => updateSettingsOption('ui.nameplate.enabled', checked)}
      />

      {settings.ui.nameplate.enabled && (
        <OptionGroup>
          <ToggleOption
            label="Name"
            checked={settings.ui.nameplate.showName}
            disabled={!settings.ui.nameplate.enabled}
            onChange={checked => updateSettingsOption('ui.nameplate.showName', checked)}
          />

          <ToggleOption
            label="Health"
            checked={settings.ui.nameplate.showHealth}
            disabled={!settings.ui.nameplate.enabled}
            onChange={checked => updateSettingsOption('ui.nameplate.showHealth', checked)}
          />

          <ToggleOption
            label="Class"
            checked={settings.ui.nameplate.showClass}
            disabled={!settings.ui.nameplate.enabled}
            onChange={checked => updateSettingsOption('ui.nameplate.showClass', checked)}
          />

          <ToggleOption
            label="Conditions"
            checked={settings.ui.nameplate.showConditions !== false}
            disabled={!settings.ui.nameplate.enabled}
            onChange={checked => updateSettingsOption('ui.nameplate.showConditions', checked)}
          />
        </OptionGroup>
      )}

      {/* ************************************************************* */}

      <Section>Buildings</Section>

      <ToggleOption
        label="Sentry targets"
        checked={settings.ui.buildings.sentryTargets}
        onChange={checked => updateSettingsOption('ui.buildings.sentryTargets', checked)}
      />

      <ToggleOption
        label="Sentry range"
        checked={settings.ui.buildings.sentryRange}
        onChange={checked => updateSettingsOption('ui.buildings.sentryRange', checked)}
      />

      {/* ************************************************************* */}

      <Section>Viewmodel</Section>

      <ToggleOption
        label="Show weapon in POV"
        checked={settings.ui.viewmodel?.enabled !== false}
        onChange={checked => updateSettingsOption('ui.viewmodel.enabled', checked)}
      />

      {settings.ui.viewmodel?.enabled !== false && (
        <OptionGroup>
          <SliderOption
            label="Viewmodel FOV"
            min={54}
            max={90}
            step={1}
            value={settings.ui.viewmodel?.fov ?? 70}
            onChange={value => updateSettingsOption('ui.viewmodel.fov', value)}
          />
        </OptionGroup>
      )}

      {/* ************************************************************* */}

      <Section>Crosshair</Section>

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
          value={settings.ui.crosshair.style}
          onChange={value => updateSettingsOption('ui.crosshair.style', value)}
        />
      </Option>

      {settings.ui.crosshair.style !== 'none' && (
        <>
          <SliderOption
            label="Size"
            min={10}
            max={60}
            step={1}
            value={settings.ui.crosshair.size}
            onChange={value => updateSettingsOption('ui.crosshair.size', value)}
          />

          <SliderOption
            label="Opacity"
            min={0.1}
            max={1}
            step={0.05}
            value={settings.ui.crosshair.opacity}
            onChange={value => updateSettingsOption('ui.crosshair.opacity', value)}
          />

          <Option label="Color">
            <div className="flex items-center gap-1.5">
              {BRUSH_COLOR_OPTIONS.map(({ color }) => (
                <button
                  type="button"
                  key={`crosshair-color-${color}`}
                  className="ui-swatch"
                  data-active={settings.ui.crosshair.color === color}
                  aria-label={`Crosshair colour ${color}`}
                  style={{ backgroundColor: color }}
                  onClick={() => updateSettingsOption('ui.crosshair.color', color)}
                />
              ))}
            </div>
          </Option>
        </>
      )}

      {/* ************************************************************* */}

      <Section>Drawing</Section>

      <Option label="Activate" keyCode="F" />
      <Option label="Clear active tool" keyCode="C" />
      <Option label="Undo active tool" keyCode="Z" />
      <Option label="Redo stickers" keyCode="Shift + Z" />
      <Option label="Delete selected sticker" keyCode="Delete" />

      <Option label="Activation method" rightClass="col-auto">
        <Segmented
          label="Activation method"
          options={[
            { label: 'Hold', value: 'hold' },
            { label: 'Toggle', value: 'toggle' },
          ]}
          value={settings.drawing.activation}
          onChange={value => updateSettingsOption('drawing.activation', value)}
        />
      </Option>

      <ToggleOption
        label="Auto clear when dismissed"
        checked={settings.drawing.autoClear}
        onChange={checked => updateSettingsOption('drawing.autoClear', checked)}
      />

      {/* ************************************************************* */}

      <Section>Misc</Section>

      <ToggleOption
        label="Show FPS"
        checked={settings.ui.showStats}
        onChange={checked => updateSettingsOption('ui.showStats', checked)}
      />
      <ToggleOption
        label="Show Skybox"
        checked={settings.ui.showSkybox}
        onChange={checked => updateSettingsOption('ui.showSkybox', checked)}
      />

      <ToggleOption
        label="Show objectives and score"
        checked={settings.ui.showObjectives !== false}
        onChange={checked => updateSettingsOption('ui.showObjectives', checked)}
      />
      <ToggleOption
        label="Show chat"
        checked={settings.ui.showChat !== false}
        onChange={checked => updateSettingsOption('ui.showChat', checked)}
      />

      <SliderOption
        label="Killfeed seek buffer"
        min={1}
        max={10}
        step={1}
        value={settings.ui.killfeedSeekBuffer}
        onChange={value => updateSettingsOption('ui.killfeedSeekBuffer', value)}
      />
    </div>
  )
}
