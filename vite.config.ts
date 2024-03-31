import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['styled-jsx/babel', { plugins: ['@styled-jsx/plugin-sass'] }]],
      },
    }),
    tsconfigPaths(),
    nodePolyfills({ include: ['events'] }),
  ],
})
