import React, { useState } from 'react'
import { Button, Divider } from 'semantic-ui-react'
import { clamp } from 'lodash'

import { TogglePanel } from '@components/UI/Shared/TogglePanel'

import { useStore, dispatch } from '@redux/store'
import { toggleUIPanelAction, updateSettingsOptionAction } from '@redux/actions'

//
// ─── BASE OPTION WRAPPER ────────────────────────────────────────────────────────
//

const Option = ({ label, keyCode, children, leftClass = '', rightClass = '' }) => (
  <div className="row align-items-center mb-2">
    <div className={`d-flex align-items-center ${leftClass}`}>
      <div className="label">{label}</div>
      {!!keyCode && <kbd className="key-code">{keyCode}</kbd>}
    </div>

    <div className={`d-flex align-items-center ${rightClass}`}>{children}</div>

    <style jsx>{`
      .label {
        font-size: 1rem;
        font-weight: 600;
      }

      .key-code {
        font-size: 66%;
        margin-left: 0.5rem;
      }
    `}</style>
  </div>
)

//
// ─── SLIDER OPTION ──────────────────────────────────────────────────────────────
//

const SLIDER_THUMB_SIZE = '10px'

const SliderOption = ({ label, keyCode, value, onChange, min = 1, max = 10, step = 0.1 }) => {
  // Track value internally so that input[type=number] will only trigger
  // callback when appropriate (i.e. enter / up / down / blurred)
  const [val, setVal] = useState(value)
  const inputFields = { min: min, max: max, step: step }

  const callback = newValue => {
    setVal(clamp(newValue, min, max))
    onChange(clamp(newValue, min, max))
  }

  return (
    <Option label={label} keyCode={keyCode} leftClass="col-sm-5" rightClass="col-sm-7">
      <input
        className="slider"
        type="range"
        value={val}
        onChange={({ target }) => callback(target.value)}
        {...inputFields}
      />
      <input
        type="number"
        value={val}
        onChange={({ target }) => setVal(target.value)}
        onBlur={() => callback(val)}
        onKeyDown={({ key }) => {
          if (key === 'Enter') callback(val)
          if (key === 'ArrowUp') callback(val)
          if (key === 'ArrowDown') callback(val)
        }}
        {...inputFields}
      />

      <style jsx>{`
        input[type='range'] {
          flex: 1;
          height: 2px;
          border-radius: 5px;
          background: rgba(255, 255, 255, 0.3);
          outline-offset: 4px;
          cursor: pointer;
          -webkit-appearance: none;

          &::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: ${SLIDER_THUMB_SIZE};
            height: ${SLIDER_THUMB_SIZE};
            border-radius: 50%;
            background: #ffffff;
            cursor: pointer;
          }

          &::-moz-range-thumb {
            width: ${SLIDER_THUMB_SIZE};
            height: ${SLIDER_THUMB_SIZE};
            border-radius: 50%;
            background: #ffffff;
            cursor: pointer;
          }
        }

        input[type='number'] {
          width: 2.5rem;
          text-align: right;
          font-size: 0.8rem;
          margin-left: 1rem;
          background: none;
          border: 1px solid rgba(255, 255, 255, 0.4);
          border-radius: 4px;
          padding: 0 0.25rem;
          color: #ffffff;

          &::selection {
            background: #ffffff;
          }
        }
      `}</style>
    </Option>
  )
}

//
// ─── TOGGLE OPTION ──────────────────────────────────────────────────────────────
//

const ToggleOption = ({ label, keyCode, checked, disabled, onChange }) => {
  const callback = () => {
    onChange(!checked)
  }

  return (
    <Option label={label} keyCode={keyCode} leftClass="col" rightClass="col-auto">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={callback} />

      <style jsx>{`
        input[type='checkbox'] {
          width: 1rem;
          height: 1rem;
        }
      `}</style>
    </Option>
  )
}

//
// ─── SETTINGS PANEL ─────────────────────────────────────────────────────────────
//

export const SettingsPanel = () => {
  const isOpen = useStore(state => state.ui.activePanels.includes('SettingsPanel'))
  const settings = useStore(state => state.settings)

  const toggleUIPanel = () => {
    dispatch(toggleUIPanelAction('AboutPanel', false))
    dispatch(toggleUIPanelAction('SettingsPanel'))
  }
  const updateSettingsOption = (option, value) => {
    dispatch(updateSettingsOptionAction(option, value))
  }

  return (
    <div className="d-flex flex-row align-items-start">
      <Button
        compact
        icon="setting"
        className="dribble-btn mr-2"
        secondary
        style={{ backgroundColor: 'rgba(30,30,30,0.75)' }}
        onClick={toggleUIPanel}
      />

      <TogglePanel className="panel" isOpen={isOpen}>
        <div className="header">
          <div>SETTINGS</div>
          <Button compact secondary icon="close" size="mini" onClick={toggleUIPanel} />
        </div>

        <div className="content">
          {/* ************************************************************* */}

          <Divider horizontal style={{ color: '#ffffff' }}>
            Camera
          </Divider>

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

          <Option label="POV Camera (cycle)" keyCode="1" leftClass="col" />

          <Option label="Free Camera" keyCode="3" leftClass="col" />

          {/* ************************************************************* */}

          <Divider horizontal style={{ color: '#ffffff' }} className="mt-4">
            Geometry
          </Divider>

          <Option label="Material" leftClass="col" rightClass="col-auto">
            <Button.Group size="tiny">
              <Button
                compact
                color={settings.scene.mode === 'wireframe' ? 'blue' : undefined}
                onClick={() => updateSettingsOption('scene.mode', 'wireframe')}
              >
                Wireframe
              </Button>

              <Button
                compact
                color={settings.scene.mode === 'untextured' ? 'blue' : undefined}
                onClick={() => updateSettingsOption('scene.mode', 'untextured')}
              >
                Plain
              </Button>

              {/* <Button
                  compact
                  color={settings.scene.mode === 'textured' ? 'blue' : undefined}
                  onClick={() => updateSettingsOption('scene.mode', 'textured')}
                >
                  Textured
                </Button> */}
            </Button.Group>
          </Option>

          {/* ************************************************************* */}

          <Divider horizontal style={{ color: '#ffffff' }} className="mt-4">
            Players
          </Divider>

          {/* <ToggleOption
              label="Models through walls"
              keyCode="M"
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
            <>
              <ToggleOption
                label="&nbsp;&nbsp;&nbsp;&nbsp;- Name"
                checked={settings.ui.nameplate.showName}
                disabled={!settings.ui.nameplate.enabled}
                onChange={checked => updateSettingsOption('ui.nameplate.showName', checked)}
              />

              <ToggleOption
                label="&nbsp;&nbsp;&nbsp;&nbsp;- Health"
                checked={settings.ui.nameplate.showHealth}
                disabled={!settings.ui.nameplate.enabled}
                onChange={checked => updateSettingsOption('ui.nameplate.showHealth', checked)}
              />

              <ToggleOption
                label="&nbsp;&nbsp;&nbsp;&nbsp;- Class"
                checked={settings.ui.nameplate.showClass}
                disabled={!settings.ui.nameplate.enabled}
                onChange={checked => updateSettingsOption('ui.nameplate.showClass', checked)}
              />
            </>
          )}

          {/* ************************************************************* */}

          <Divider horizontal style={{ color: '#ffffff' }} className="mt-4">
            Misc
          </Divider>

          <ToggleOption
            label="Show FPS"
            checked={settings.ui.showStats}
            onChange={checked => updateSettingsOption('ui.showStats', checked)}
          />
        </div>
      </TogglePanel>

      <style jsx>{`
        div > :global(.panel) {
          width: 500px;
          max-width: 100%;
          background-color: rgba(0, 0, 0, 0.7);
          color: #ffffff;
          font-size: 1rem;
          overflow: hidden;

          .header {
            display: flex;
            flex-flow: row nowrap;
            justify-content: space-between;
            align-items: center;
            letter-spacing: 2px;
            padding: 0.45rem 0.2rem 0.45rem 1.5rem;
            background-color: rgba(0, 0, 0, 0.3);
          }

          .content {
            padding: 0rem 1.5rem 1rem 1.5rem;
          }
        }
      `}</style>
    </div>
  )
}
