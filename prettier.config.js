/** @type {import("prettier").Config} */
module.exports = {
  printWidth: 100,
  semi: false,
  tabWidth: 2,
  useTabs: false,
  singleQuote: true,
  trailingComma: 'es5',
  bracketSpacing: true,
  jsxBracketSameLine: false,
  arrowParens: 'avoid',
  plugins: ['prettier-plugin-tailwindcss'],
}
