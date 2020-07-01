import React, { useState, useCallback } from 'react'
import { connect, useSelector, useDispatch } from 'react-redux'
import { clamp } from 'lodash'

import { toggleUIPanelAction, updateSettingsOptionAction } from '@redux/actions'

const Option = ({ label, children }) => (
  <div className="row align-items-center">
    <div className="col-sm-4 d-flex">{label}</div>
    <div className="col-sm-8 d-flex">{children}</div>
  </div>
)

const SliderOption = ({ label, value, onChange, min = 1, max = 10, step = 0.1 }) => {
  // Track value internally so that input[type=number] will only trigger
  // callback when appropriate (i.e. enter / up / down / blurred)
  const [val, setVal] = useState(value)
  const inputFields = { min: min, max: max, step: step }

  const callback = newValue => {
    setVal(clamp(newValue, min, max))
    onChange(clamp(newValue, min, max))
  }

  return (
    <Option label={label}>
      <input
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
        }

        input[type='number'] {
          width: 2.5rem;
          text-align: right;
          margin-left: 1rem;
        }
      `}</style>
    </Option>
  )
}

const ToggleOption = ({ label, checked, onChange }) => {
  const callback = () => {
    onChange(!checked)
  }

  return (
    <Option label={label}>
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
      <button className="mb-2" onClick={() => toggleUIPanel('SettingsPanel')}>
        Settings
      </button>

      {isOpen && (
        <div className="panel">
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

          <ToggleOption
            label="Wireframe"
            checked={settings.scene.mode === 'wireframe'} // TODO: make this a button group instead
            onChange={checked =>
              updateSettingsOption('scene.mode', checked ? 'wireframe' : 'normal')
            }
          />
        </div>
      )}

      <style jsx>{`
        .panel {
          width: 450px;
          max-width: 100%;
          background-color: rgba(0, 0, 0, 0.7);
          color: #ffffff;
          font-size: 1rem;
          font-family: monospace;
          padding: 1rem;
        }
      `}</style>
    </div>
  )
}
