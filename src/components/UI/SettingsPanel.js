import React, { useState, useCallback } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { Button, Divider } from 'semantic-ui-react'
import { clamp } from 'lodash'

import { toggleUIPanelAction, updateSettingsOptionAction } from '@redux/actions'

//
// ─── BASE OPTION WRAPPER ────────────────────────────────────────────────────────
//

const Option = ({ label, keyCode, children }) => (
  <div className="row align-items-center mb-2">
    <div className="col-sm-5 d-flex align-items-center">
      <div className="label">{label}</div>
      {!!keyCode && <kbd className="key-code">{keyCode}</kbd>}
    </div>

    <div className="col-sm-7 d-flex align-items-center">{children}</div>

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
    <Option label={label} keyCode={keyCode}>
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

const ToggleOption = ({ label, keyCode, checked, onChange }) => {
  const callback = () => {
    onChange(!checked)
  }

  return (
    <Option label={label} keyCode={keyCode}>
      <input type="checkbox" checked={checked} onChange={callback} />

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
  const isOpen = useSelector(state => state.ui.activePanels.includes('SettingsPanel'))
  const settings = useSelector(state => state.settings)

  const dispatch = useDispatch()
  const toggleUIPanel = useCallback(
    name => {
      dispatch(toggleUIPanelAction(name))
    },
    [dispatch]
  )
  const updateSettingsOption = useCallback(
    (option, value) => {
      dispatch(updateSettingsOptionAction(option, value))
    },
    [dispatch]
  )

  return (
    <div className="d-flex flex-column align-items-start ml-2">
      <Button
        circular
        icon="setting"
        className="mb-2"
        onClick={() => toggleUIPanel('SettingsPanel')}
      ></Button>

      {isOpen && (
        <div className="panel">
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

          {/* <ToggleOption
            label="Orthographic"
            checked={settings.camera.orthographic} // TODO: make this a button group instead
            onChange={checked => updateSettingsOption('camera.orthographic', checked)}
          /> */}

          <Divider horizontal style={{ color: '#ffffff' }} className="mt-4">
            Geometry
          </Divider>

          <ToggleOption
            label="Wireframe"
            checked={settings.scene.mode === 'wireframe'} // TODO: make this a button group instead
            onChange={checked =>
              updateSettingsOption('scene.mode', checked ? 'wireframe' : 'normal')
            }
          />

          <Divider horizontal style={{ color: '#ffffff' }} className="mt-4">
            Players
          </Divider>

          <ToggleOption
            label="Show names"
            keyCode="N"
            checked={settings.ui.showNames}
            onChange={checked => updateSettingsOption('ui.showNames', checked)}
          />
        </div>
      )}

      <style jsx>{`
        .panel {
          width: 400px;
          max-width: 100%;
          border-radius: 6px;
          background-color: rgba(0, 0, 0, 0.7);
          color: #ffffff;
          font-size: 1rem;
          padding: 1rem;
        }
      `}</style>
    </div>
  )
}
