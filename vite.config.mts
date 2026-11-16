import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

/**
 * A production build with an asset host (VITE_APP_ASSET_URL) loads every model from it
 * (getAsset in @utils/misc), so public/models, hundreds of MB, is left out of dist rather than
 * uploaded with every deploy. Without one, the build keeps them, as the site would need them.
 */
function leaveOutModels(assetUrl: string | undefined): Plugin {
  let outDir = 'dist'
  return {
    name: 'leave-out-models',
    apply: 'build',
    configResolved: config => {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle: () => {
      if (!assetUrl) return
      fs.rmSync(path.join(outDir, 'models'), { recursive: true, force: true })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tsconfigPaths(),
    nodePolyfills({ include: ['events'] }),
    leaveOutModels(
      loadEnv(mode, process.cwd()).VITE_APP_ASSET_URL || process.env.VITE_APP_ASSET_URL
    ),
  ],
  build: {
    rollupOptions: {
      output: {
        // three.js and React change far less often than the app: in their own chunks, a deploy
        // of the app leaves them cached. Only packages that import nothing from the rest, so
        // the chunks cannot import each other in a cycle (which breaks their start-up order).
        manualChunks(id) {
          if (/node_modules\/three\//.test(id)) return 'three'
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
          return undefined
        },
      },
    },
  },
}))
