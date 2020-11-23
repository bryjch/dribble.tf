// config-overrides.js for React App Rewired
// https://github.com/timarney/react-app-rewired/

const { override, addBabelPlugin, addWebpackAlias } = require('customize-cra')
const path = require('path')

module.exports = override(
  addBabelPlugin(['styled-jsx/babel', { plugins: ['styled-jsx-plugin-sass'] }]),
  addWebpackAlias({
    ['@assets']: path.resolve(__dirname, './src/assets'),
    ['@components']: path.resolve(__dirname, './src/components'),
    ['@constants']: path.resolve(__dirname, './src/constants'),
    ['@libs']: path.resolve(__dirname, './src/libs'),
    ['@pages']: path.resolve(__dirname, './src/pages'),
    ['@zus']: path.resolve(__dirname, './src/zustand'),
    ['@utils']: path.resolve(__dirname, './src/utils'),
  })
)
