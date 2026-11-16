// The asset host (VITE_APP_ASSET_URL) that production loads /models/... from, for the scripts and
// the dev server: worktrees have no .env of their own, so the main checkout's is read too (where
// npm run assets saves it).
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/**
 * VITE_APP_ASSET_URL from the environment, else `repoRoot`'s or the main checkout's .env,
 * without a trailing slash; null when none is set.
 */
export function findAssetUrl(repoRoot) {
  const fromEnv = process.env.VITE_APP_ASSET_URL
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  const roots = [repoRoot]
  try {
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    ).trim()
    roots.push(path.dirname(common))
  } catch {
    // not a git checkout
  }
  for (const root of roots) {
    const file = path.join(root, '.env')
    if (!fs.existsSync(file)) continue
    const line = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .find(entry => entry.startsWith('VITE_APP_ASSET_URL='))
    const value = line
      ?.slice('VITE_APP_ASSET_URL='.length)
      .trim()
      .replace(/^['"]|['"]$/g, '')
    if (value) return value.replace(/\/+$/, '')
  }
  return null
}
