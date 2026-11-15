import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tsconfigPaths(), nodePolyfills({ include: ['events'] })],
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
  server: {
    proxy: {
      '/serveme/maps': {
        target: 'https://fastdl.serveme.tf',
        changeOrigin: true,
        // Mirror the vercel.json rewrite: /serveme/maps/x.bsp -> /maps/x.bsp upstream.
        rewrite: path => path.replace(/^\/serveme/, ''),
      },
    },
  },
})
