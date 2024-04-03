import { useState } from 'react'
import { clamp } from 'lodash'

import { TogglePanel } from '@components/UI/Shared/TogglePanel'

import { useStore } from '@zus/store'
import { toggleUIPanelAction, updateSettingsOptionAction } from '@zus/actions'
import { cn } from '@utils/styling'

//
// ─── BASE OPTION WRAPPER ────────────────────────────────────────────────────────
//

type OptionProps = {
  label: string
  keyCode?: string
  children?: React.ReactNode
  leftClass?: string
  rightClass?: string
}

const Option = ({ label, keyCode, children, leftClass = '', rightClass = '' }: OptionProps) => (
  <div className="mb-4 flex items-center justify-between">
    <div className={cn('flex items-center', leftClass)}>
      <div className="text-base font-semibold">{label}</div>
      {!!keyCode && <kbd className="ml-2 text-[66%]">{keyCode}</kbd>}
    </div>

    <div className={cn('flex items-center', rightClass)}>{children}</div>
  </div>
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
}

const SliderOption = ({
  label,
  keyCode,
  value,
  onChange,
  min = 1,
  max = 10,
  step = 0.1,
}: SliderOptionProps) => {
  // Track value internally so that input[type=number] will only trigger
  // callback when appropriate (i.e. enter / up / down / blurred)
  const [val, setVal] = useState(value)
  const inputFields = { min: min, max: max, step: step }

  const callback = (newValue: number) => {
    setVal(clamp(newValue, min, max))
    onChange(clamp(newValue, min, max))
  }

  return (
    <Option label={label} keyCode={keyCode} leftClass="w-5/12" rightClass="w-7/12">
      <input
        type="range"
        className="slider h-[2px] flex-1 cursor-pointer rounded-md bg-white/30 outline-offset-4 [-webkit-appearance:none]"
        value={val}
        onChange={({ target }) => callback(Number(target.value))}
        {...inputFields}
      />
      <input
        type="number"
        className="ml-4 w-10 rounded-md border border-white/40 bg-transparent px-1 text-right text-base"
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
    <Option label={label} keyCode={keyCode}>
      <input
        type="checkbox"
        className="h-4 w-4"
        checked={checked}
        disabled={disabled}
        onChange={callback}
      />
    </Option>
  )
}

//
// ─── SETTINGS PANEL ─────────────────────────────────────────────────────────────
//

export const SettingsPanel = () => {
  const isOpen = useStore(state => state.ui.activePanels.includes('Settings'))
  const scene = useStore(state => state.scene)
  const settings = useStore(state => state.settings)

  const toggleUIPanel = () => {
    toggleUIPanelAction('About', false)
    toggleUIPanelAction('Settings')
  }
  const updateSettingsOption = (option: string, value: any) => {
    updateSettingsOptionAction(option, value)
  }

  return (
    <div className="flex items-start">
      <button
        className="mr-2 flex h-9 w-9 items-center justify-center bg-pp-panel/75"
        onClick={toggleUIPanel}
      >
        SET
      </button>

      <TogglePanel className="w-[360px] max-w-full bg-pp-panel/80" isOpen={isOpen}>
        <div className="flex flex-row items-center justify-between bg-black/30 px-3 py-2 tracking-widest">
          <div>SETTINGS</div>

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md"
            onClick={toggleUIPanel}
          >
            <svg
              className="h-6 w-6"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto px-6 pb-8 pt-3">
          {/* ************************************************************* */}

          <div className="mb-5 text-center text-sm font-black uppercase tracking-widest">
            Camera
          </div>

          <Option label="POV Camera (next)" keyCode="1" leftClass="col" />
          <Option label="POV Camera (prev)" keyCode="Shift + 1" leftClass="col" />
          <Option label="Spectator Camera" keyCode="2" leftClass="col" />

          {scene.controls.mode === 'spectator' && (
            <div className="ml-3">
              <SliderOption
                label="- FOV"
                min={50}
                max={120}
                step={1}
                value={settings.camera.fov}
                onChange={value => updateSettingsOption('camera.fov', value)}
              />

              <SliderOption
                label="- Look Sensitivity"
                value={settings.controls.lookSpeed}
                onChange={value => updateSettingsOption('controls.lookSpeed', value)}
              />

              <SliderOption
                label="- Move Speed"
                value={settings.controls.moveSpeed}
                onChange={value => updateSettingsOption('controls.moveSpeed', value)}
              />
            </div>
          )}

          <Option label="RTS Camera" keyCode="3" />

          {scene.controls.mode === 'rts' && (
            <div className="ml-3">
              <SliderOption
                label="- FOV"
                min={50}
                max={120}
                step={1}
                value={settings.camera.fov}
                onChange={value => updateSettingsOption('camera.fov', value)}
              />

              <SliderOption
                label="- Pan speed"
                value={settings.controls.panSpeed}
                onChange={value => updateSettingsOption('controls.panSpeed', value)}
              />

              <SliderOption
                label="- Rotate speed"
                value={settings.controls.rotateSpeed}
                onChange={value => updateSettingsOption('controls.rotateSpeed', value)}
              />

              <SliderOption
                label="- Zoom speed"
                value={settings.controls.zoomSpeed}
                onChange={value => updateSettingsOption('controls.zoomSpeed', value)}
              />

              <ToggleOption
                label="- Inertia enabled"
                checked={settings.controls.enableDamping}
                onChange={checked => updateSettingsOption('controls.enableDamping', checked)}
              />
            </div>
          )}

          {/* ************************************************************* */}

          <div className="mb-5 mt-16 text-center text-sm font-black uppercase tracking-widest">
            Geometry
          </div>

          <Option label="Material" keyCode="M">
            <div className="flex gap-1">
              {[
                { label: 'Wireframe', value: 'wireframe' },
                { label: 'Plain', value: 'untextured' },
                { label: 'Textured', value: 'textured' },
              ].map(button => (
                <button
                  className={cn(
                    'rounded-xl border px-2 text-sm',
                    settings.scene.mode === button.value && 'border-[#3273f6] bg-[#3273f6]'
                  )}
                  onClick={() => updateSettingsOption('scene.mode', button.value)}
                >
                  {button.label}
                </button>
              ))}
            </div>
          </Option>

          {/* ************************************************************* */}

          <div className="mb-5 mt-16 text-center text-sm font-black uppercase tracking-widest">
            Players
          </div>

          {/* <ToggleOption
              label="Player models through walls"
              keyCode="P"
              checked={settings.ui.xrayPlayers}
              onChange={checked => updateSettingsOption('ui.xrayPlayers', checked)}
            /> */}

          <ToggleOption
            label="Show nameplates"
            keyCode="N"
            checked={settings.ui.nameplate.enabled}
            onChange={checked => updateSettingsOption('ui.nameplate.enabled', checked)}
          />

          {settings.ui.nameplate.enabled && (
            <div className="ml-3">
              <ToggleOption
                label="- Name"
                checked={settings.ui.nameplate.showName}
                disabled={!settings.ui.nameplate.enabled}
                onChange={checked => updateSettingsOption('ui.nameplate.showName', checked)}
              />

              <ToggleOption
                label="- Health"
                checked={settings.ui.nameplate.showHealth}
                disabled={!settings.ui.nameplate.enabled}
                onChange={checked => updateSettingsOption('ui.nameplate.showHealth', checked)}
              />

              <ToggleOption
                label="- Class"
                checked={settings.ui.nameplate.showClass}
                disabled={!settings.ui.nameplate.enabled}
                onChange={checked => updateSettingsOption('ui.nameplate.showClass', checked)}
              />
            </div>
          )}

          {/* ************************************************************* */}

          <div className="mb-5 mt-16 text-center text-sm font-black uppercase tracking-widest">
            Drawing
          </div>

          <Option label="Activate" keyCode="F" />
          <Option label="Clear" keyCode="C" />
          <Option label="Undo" keyCode="Z" />

          <Option label="Activation method" rightClass="col-auto">
            <div className="flex gap-1">
              {[
                { label: 'Hold', value: 'hold' },
                { label: 'Toggle', value: 'toggle' },
              ].map(button => (
                <button
                  className={cn(
                    'rounded-xl border px-2 text-sm',
                    settings.drawing.activation === button.value && 'border-[#3273f6] bg-[#3273f6]'
                  )}
                  onClick={() => updateSettingsOption('drawing.activation', button.value)}
                >
                  {button.label}
                </button>
              ))}
            </div>
          </Option>

          <ToggleOption
            label="Auto clear when dismissed"
            checked={settings.drawing.autoClear}
            onChange={checked => updateSettingsOption('drawing.autoClear', checked)}
          />

          {/* ************************************************************* */}

          <div className="mb-5 mt-16 text-center text-sm font-black uppercase tracking-widest">
            Misc
          </div>

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
        </div>
      </TogglePanel>
    </div>
  )
}
