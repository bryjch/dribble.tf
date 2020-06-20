// config-overrides.js for React App Rewired
// https://github.com/timarney/react-app-rewired/

const { override, addBabelPlugin } = require('customize-cra')

module.exports = override(
  addBabelPlugin(['styled-jsx/babel', { plugins: ['styled-jsx-plugin-sass'] }])
)
