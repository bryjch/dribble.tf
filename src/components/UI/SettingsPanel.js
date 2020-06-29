import React, { useState } from 'react'
import { connect } from 'react-redux'

import { updateSettingsOptionAction } from '../../redux/actions'

const Option = ({ label, children }) => (
  <div className="row align-items-center">
    <div className="col-sm-4 d-flex">{label}</div>
    <div className="col-sm-8 d-flex">{children}</div>
  </div>
)

const SliderOption = ({ label, value, onChange, min = 1, max = 10, step = 0.1 }) => {
  const inputFields = {
    min: min,
    max: max,
    step: step,
    value: value,
    onChange: onChange,
    tabIndex: -1,
  }

  return (
    <Option label={label}>
      <input type="range" {...inputFields} />
      <input type="number" {...inputFields} />

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
  const inputFields = {
    checked: checked,
    onChange: onChange,
    tabIndex: -1,
  }

  return (
    <Option label={label}>
      <input type="checkbox" {...inputFields} />

      <style jsx>{`
        input[type='checkbox'] {
          width: 1rem;
          height: 1rem;
        }
      `}</style>
    </Option>
  )
}

let SettingsPanel = ({ settings, updateSettingsOption }) => {
  const [collapsed, toggleCollapse] = useState(true)

  return (
    <div className="d-flex flex-column align-items-start ml-2">
      <button className="mb-2" onClick={() => toggleCollapse(!collapsed)}>
        Settings
      </button>

      {!collapsed && (
        <div className="panel">
          <SliderOption
            label="Pan speed"
            value={settings.controls.panSpeed}
            onChange={({ target }) => {
              updateSettingsOption('controls.panSpeed', Number(target.value))
            }}
          />

          <SliderOption
            label="Rotate speed"
            value={settings.controls.rotateSpeed}
            onChange={({ target }) => {
              updateSettingsOption('controls.rotateSpeed', Number(target.value))
            }}
          />

          <SliderOption
            label="Zoom speed"
            value={settings.controls.zoomSpeed}
            onChange={({ target }) => {
              updateSettingsOption('controls.zoomSpeed', Number(target.value))
            }}
          />

          <ToggleOption
            label="Inertia enabled"
            checked={settings.controls.enableDamping}
            onChange={({ target }) => {
              updateSettingsOption('controls.enableDamping', target.checked)
            }}
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
          border-radius: 3px;
        }
      `}</style>
    </div>
  )
}

const mapState = state => ({
  settings: state.settings,
})

const mapDispatch = dispatch => ({
  updateSettingsOption: (option, value) => dispatch(updateSettingsOptionAction(option, value)),
})

SettingsPanel = connect(mapState, mapDispatch)(SettingsPanel)

export { SettingsPanel }
