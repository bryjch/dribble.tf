import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { findAssetUrl } from './scripts/lib/asset-url.mjs'

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

/**
 * In dev, a /models file that isn't in public/models comes from the asset host instead, so a
 * checkout that hasn't built or pulled the maps (any new worktree: built maps aren't in git)
 * still shows them. Proxied, not saved: what's in public/models is only what was built or pulled.
 * Each response says where it came from (X-Models-Source), and the terminal says once per map.
 */
function modelsFromAssetHost(): Plugin {
  return {
    name: 'models-from-asset-host',
    apply: 'serve',
    configureServer: server => {
      const modelsDir = path.join(server.config.publicDir, 'models')
      const assetUrl = findAssetUrl(server.config.root)
      const logger = server.config.logger
      const told = new Set<string>()
      const tell = (key: string, message: string) => {
        if (told.has(key)) return
        told.add(key)
        logger.info(message, { timestamp: true })
      }

      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()
        let pathname: string
        try {
          pathname = decodeURIComponent(new URL(req.url ?? '', 'http://dev').pathname)
        } catch {
          return next()
        }
        if (!pathname.startsWith('/models/')) return next()
        const relative = pathname.slice('/models/'.length)
        const local = path.join(modelsDir, relative)
        if (!local.startsWith(modelsDir + path.sep) || fs.existsSync(local)) return next()
        if (!assetUrl) {
          tell(
            'none',
            `models: ${pathname} isn't in public/models, and no VITE_APP_ASSET_URL is set to load it from`
          )
          return next()
        }

        // maps/<name>/... is one map; props/, skybox/ and the rest are told by folder.
        const parts = relative.split('/')
        const isMap = parts[0] === 'maps' && parts.length > 2
        const what = isMap ? parts[1] : `${parts[0]}/`

        try {
          const headers: Record<string, string> = {}
          for (const name of ['if-none-match', 'if-modified-since']) {
            const value = req.headers[name]
            if (typeof value === 'string') headers[name] = value
          }
          const upstream = await fetch(`${assetUrl}${pathname}`, { method: req.method, headers })
          if (upstream.ok || upstream.status === 304) {
            tell(
              what,
              `models: ${what} isn't in public/models; loading it from ${assetUrl}` +
                (isMap ? ` (npm run maps:pull -- ${what} keeps a copy)` : '')
            )
          } else {
            tell(
              pathname,
              `models: ${pathname} isn't in public/models or on ${assetUrl} (HTTP ${upstream.status})`
            )
          }
          // S3 answers 403 for a file it doesn't have.
          res.statusCode = upstream.status === 403 ? 404 : upstream.status
          for (const name of ['content-type', 'content-length', 'etag', 'last-modified']) {
            const value = upstream.headers.get(name)
            if (value) res.setHeader(name, value)
          }
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('X-Models-Source', assetUrl)
          res.end(req.method === 'HEAD' ? undefined : Buffer.from(await upstream.arrayBuffer()))
        } catch (error) {
          logger.warn(
            `models: couldn't load ${pathname} from ${assetUrl}: ${(error as Error).message}`
          )
          res.statusCode = 502
          res.end()
        }
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tsconfigPaths(),
    nodePolyfills({ include: ['events'] }),
    modelsFromAssetHost(),
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
